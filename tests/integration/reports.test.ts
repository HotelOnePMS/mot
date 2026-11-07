import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO, atNoonUTC } from '@/server/dates';
import type { ReportSpec } from '@/lib/reports';
import { runReport } from '@/server/services/reports';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

const spec = (o: Partial<ReportSpec> & Pick<ReportSpec, 'from' | 'to'>): ReportSpec => ({
  kind: 'list',
  dateField: 'stay',
  groupBy: 'date',
  roomTypes: [],
  sources: [],
  statuses: [],
  paymentMethods: [],
  columns: [],
  ...o,
});

async function book(h: Awaited<ReturnType<typeof makeHotel>>, guestId: string, o: { checkIn: string; nights: number; status?: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED'; source?: string | null; total?: number; subtotal?: number; paid?: number }) {
  const b = await prisma.booking.create({
    data: {
      userId: guestId,
      propertyId: h.property.id,
      roomTypeId: h.roomType.id,
      checkIn: atNoonUTC(o.checkIn),
      checkOut: atNoonUTC(addDaysISO(o.checkIn, o.nights)),
      guests: 1,
      totalPrice: o.total ?? 100 * o.nights,
      subtotalPrice: o.subtotal ?? null,
      status: o.status ?? 'CONFIRMED',
      source: o.source === undefined ? 'FRONT_DESK' : o.source,
      code: `R${uid()}`.toUpperCase(),
    },
  });
  if (o.paid) {
    await prisma.payment.create({
      data: { bookingId: b.id, propertyId: h.property.id, stripePaymentIntentId: `pi_${uid()}${uid()}`, status: 'SUCCEEDED', amount: o.paid, kind: 'DEPOSIT' },
    });
  }
  return b;
}

describe('front desk reports', () => {
  it('lists arrivals with balances and filters by source, status and payment method', async () => {
    const h = await makeHotel({ rooms: 3 });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const guest = await makeUser({ role: 'CUSTOMER' });
    const actor = await actorFor(desk.id);
    const a = await book(h, guest.id, { checkIn: h.today, nights: 2, paid: 50 });
    const b = await book(h, guest.id, { checkIn: h.today, nights: 1, source: 'EXPEDIA' });
    await book(h, guest.id, { checkIn: h.today, nights: 1, status: 'CANCELLED' });
    await book(h, guest.id, { checkIn: addDaysISO(h.today, 1), nights: 1 });

    const arrivals = await runReport(actor, h.property.id, spec({ from: h.today, to: h.today, dateField: 'checkIn', statuses: ['CONFIRMED'], columns: ['code', 'source', 'paymentMethod', 'total', 'paid', 'balance'] }));
    expect(arrivals.columns.map((c) => c.key)).toEqual(['code', 'source', 'paymentMethod', 'total', 'paid', 'balance']);
    expect(arrivals.rows).toHaveLength(2);
    const rowA = arrivals.rows.find((r) => r.code === a.code)!;
    expect(rowA).toMatchObject({ source: 'Front desk', paymentMethod: 'Card (online)', total: 200, paid: 50, balance: 150 });
    expect(arrivals.totals).toMatchObject({ total: 300, paid: 50, balance: 250 });

    const ota = await runReport(actor, h.property.id, spec({ from: h.today, to: h.today, dateField: 'checkIn', sources: ['EXPEDIA'] }));
    expect(ota.rows.map((r) => r.code)).toEqual([b.code]);

    const atProperty = await runReport(actor, h.property.id, spec({ from: h.today, to: h.today, dateField: 'checkIn', statuses: ['CONFIRMED'], paymentMethods: ['PAY_AT_PROPERTY'] }));
    expect(atProperty.rows.map((r) => r.code)).toEqual([b.code]);
  });

  it('includes guests still checked in after their check-out date', async () => {
    const h = await makeHotel();
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const guest = await makeUser({ role: 'CUSTOMER' });
    const overdue = await book(h, guest.id, { checkIn: addDaysISO(h.today, -3), nights: 2, status: 'CHECKED_IN' });
    const r = await runReport(await actorFor(desk.id), h.property.id, spec({ from: h.today, to: h.today, statuses: ['CHECKED_IN'] }));
    expect(r.rows.map((x) => x.code)).toContain(overdue.code);
  });

  it('sums occupancy and room revenue by night', async () => {
    const h = await makeHotel({ rooms: 2 });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const guest = await makeUser({ role: 'CUSTOMER' });
    await book(h, guest.id, { checkIn: h.today, nights: 2, total: 220, subtotal: 200 });
    await book(h, guest.id, { checkIn: h.today, nights: 1, status: 'CANCELLED' });
    const r = await runReport(await actorFor(desk.id), h.property.id, spec({ kind: 'summary', from: h.today, to: addDaysISO(h.today, 1) }));
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ group: h.today, roomNights: 1, available: 2, occupancy: 50, roomRevenue: 100, taxes: 10, adr: 100, arrivals: 1 });
    expect(r.totals).toMatchObject({ roomNights: 2, roomRevenue: 200, revpar: 50 });
  });

  it('keeps staff to their own hotels and housekeepers out', async () => {
    const [mine, theirs] = await Promise.all([makeHotel(), makeHotel()]);
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [mine.property.id] });
    const keeper = await makeUser({ role: 'HOUSEKEEPER', propertyIds: [mine.property.id] });
    await expect(runReport(await actorFor(desk.id), theirs.property.id, spec({ from: theirs.today, to: theirs.today }))).rejects.toThrow(/access/);
    await expect(runReport(await actorFor(keeper.id), mine.property.id, spec({ from: mine.today, to: mine.today }))).rejects.toThrow(/roles/);
  });

  it('refuses backwards and over-long ranges', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const actor = await actorFor(owner.id);
    await expect(runReport(actor, h.property.id, spec({ from: h.today, to: addDaysISO(h.today, -1) }))).rejects.toThrow(/after its end/);
    await expect(runReport(actor, h.property.id, spec({ from: h.today, to: addDaysISO(h.today, 400) }))).rejects.toThrow(/at most/);
  });
});
