import { describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { toCents } from '@/lib/payments';
import { addDaysISO } from '@/server/dates';
import { expireUnpaidBooking } from '@/server/payments/expiry';
import { applyRefundState, recordPaymentSucceeded } from '@/server/payments/record';
import { confirmReservationPayAtProperty, createReservation, getBookingForStaff } from '@/server/services/bookings';
import { quoteStay } from '@/server/services/inventory';
import { toBookingSummary } from '@/server/services/mappers';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

// Stripe is the hotel's: the tests hand recordPaymentSucceeded the payment intent it would fetch.
const { intents } = vi.hoisted(() => ({ intents: new Map<string, unknown>() }));
vi.mock('@/lib/stripe', async (original) => ({
  ...(await original<typeof import('@/lib/stripe')>()),
  getStripe: () => ({ paymentIntents: { retrieve: async (id: string) => intents.get(id) } }),
}));

/** A hotel with a Queen (sleeps 2, 100/night) and a Suite (sleeps 4, 200/night), taxes and fees. */
async function twoTypeHotel() {
  const h = await makeHotel({
    currency: 'EUR',
    charges: [
      { name: 'City tax', kind: 'PER_GUEST_NIGHT', amount: 2 },
      { name: 'Cleaning', kind: 'PER_STAY', amount: 15 },
    ],
  });
  const suite = await prisma.roomType.create({ data: { propertyId: h.property.id, name: 'Suite', capacity: 4, basePrice: 200, totalRooms: 2, amenities: [] } });
  for (const n of ['201', '202']) await prisma.room.create({ data: { propertyId: h.property.id, roomTypeId: suite.id, roomNumber: n, floor: '2', status: 'CLEAN' } });
  const guest = await makeUser({ role: 'CUSTOMER' });
  const checkIn = addDaysISO(h.today, 10);
  const stay = { userId: guest.id, propertyId: h.property.id, checkIn, checkOut: addDaysISO(checkIn, 2), guests: 5 };
  const lines = [
    { roomTypeId: h.roomType.id, rooms: 1 },
    { roomTypeId: suite.id, rooms: 1 },
  ];
  return { ...h, suite, guest, stay, lines };
}

function paidIntent(lead: { id: string; propertyId: string }, ids: string[], cents: number) {
  const id = `pi_test_${uid()}`;
  intents.set(id, { id, status: 'succeeded', amount: cents, amount_received: cents, currency: 'eur', latest_charge: null, metadata: { bookingId: lead.id, bookingIds: ids.join(','), propertyId: lead.propertyId } });
  return id;
}

const reservation = (groupCode: string) => prisma.booking.findMany({ where: { groupCode }, orderBy: { id: 'asc' }, include: { payments: true } });

describe('reservations with several room types', () => {
  it('books each room type as its own line, priced for its share of the party, under one code', async () => {
    const h = await twoTypeHotel();
    const rows = await createReservation({ ...h.stay, lines: h.lines, notes: 'Late arrival', paymentStatus: 'PAY_AT_PROPERTY', source: 'WEB' });
    expect(rows).toHaveLength(2);
    const [lead, other] = rows;
    expect(lead.groupCode).toBe(lead.code);
    expect(other.groupCode).toBe(lead.code);
    expect(rows.map((r) => r.guests)).toEqual([2, 3]);
    expect(rows.map((r) => r.currency)).toEqual(['EUR', 'EUR']);
    // Special requests are for the whole party, so every room type carries them.
    expect(rows.map((r) => r.notes)).toEqual(['Late arrival', 'Late arrival']);
    for (const [i, r] of rows.entries()) {
      const quote = await quoteStay(prisma, { roomTypeId: h.lines[i].roomTypeId, checkIn: h.stay.checkIn, checkOut: h.stay.checkOut, rooms: 1, guests: r.guests });
      expect(Number(r.totalPrice)).toBe(quote.total);
    }

    const confirmed = await confirmReservationPayAtProperty(rows.map((r) => r.id));
    expect(confirmed.map((r) => r.status)).toEqual(['CONFIRMED', 'CONFIRMED']);

    // The same request again moments later is the same reservation, not a second one.
    const again = await createReservation({ ...h.stay, lines: h.lines, paymentStatus: 'PAY_AT_PROPERTY' });
    expect(again.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(again[0].duplicate).toBe(true);
  });

  it('holds every room type for one card payment and confirms them all when it is paid', async () => {
    const h = await twoTypeHotel();
    const rows = await createReservation({ ...h.stay, lines: h.lines, onlinePayment: { policy: 'DEPOSIT', depositNights: 1 } });
    expect(rows.map((r) => r.paymentStatus)).toEqual(['AWAITING_PAYMENT', 'AWAITING_PAYMENT']);
    expect(rows.map((r) => Number(r.paymentDue))).toEqual([100, 200]);
    expect(rows[1].expiresAt?.getTime()).toBe(rows[0].expiresAt?.getTime());
    const [lead] = rows;
    const due = rows.reduce((s, r) => s + toCents(Number(r.paymentDue)), 0);
    const pi = paidIntent(lead, rows.map((r) => r.id), due);

    await recordPaymentSucceeded(pi);
    await recordPaymentSucceeded(pi); // Stripe delivers more than once
    const after = await reservation(lead.code!);
    expect(after.map((r) => [r.status, r.paymentStatus])).toEqual([
      ['CONFIRMED', 'DEPOSIT_PAID'],
      ['CONFIRMED', 'DEPOSIT_PAID'],
    ]);
    expect(after.flatMap((r) => r.payments)).toHaveLength(1);
    expect(after.find((r) => r.id === lead.id)!.payments).toHaveLength(1);

    // Each line shows its share of the one payment, so the desk collects only the rest.
    const actor = await actorFor((await makeUser({ role: 'OWNER', propertyIds: [h.property.id] })).id);
    const shown = await Promise.all(rows.map(async (r) => toBookingSummary(await getBookingForStaff(actor, r.id))));
    expect(shown.map((s) => s.amountPaid)).toEqual([100, 200]);

    // Refunding the whole payment moves every line.
    await applyRefundState({ paymentIntentId: pi, amountRefundedCents: due });
    expect((await reservation(lead.code!)).map((r) => r.paymentStatus)).toEqual(['REFUNDED', 'REFUNDED']);
  });

  it('books a smaller reservation moments later as a new one, not as part of the earlier one', async () => {
    const h = await twoTypeHotel();
    const twin = await prisma.roomType.create({ data: { propertyId: h.property.id, name: 'Twin', capacity: 2, basePrice: 90, totalRooms: 1, amenities: [] } });
    await prisma.room.create({ data: { propertyId: h.property.id, roomTypeId: twin.id, roomNumber: '301', floor: '3', status: 'CLEAN' } });
    const first = await createReservation({ ...h.stay, guests: 3, lines: [...h.lines, { roomTypeId: twin.id, rooms: 1 }], paymentStatus: 'PAY_AT_PROPERTY' });
    const second = await createReservation({ ...h.stay, guests: 2, lines: h.lines, paymentStatus: 'PAY_AT_PROPERTY' });
    expect(second[0].duplicate).toBeUndefined();
    expect(second[0].groupCode).not.toBe(first[0].groupCode);
    expect(second.map((r) => r.id).filter((id) => first.some((f) => f.id === id))).toEqual([]);
  });

  it('refunds a cancelled room type out of its own share, leaving the rooms kept fully paid', async () => {
    const h = await twoTypeHotel();
    const rows = await createReservation({ ...h.stay, lines: h.lines, onlinePayment: { policy: 'FULL_PREPAYMENT', depositNights: 1 } });
    const [queen, suite] = rows;
    const total = rows.reduce((s, r) => s + toCents(Number(r.totalPrice)), 0);
    const pi = paidIntent(queen, rows.map((r) => r.id), total);
    await recordPaymentSucceeded(pi);

    await prisma.booking.update({ where: { id: suite.id }, data: { status: 'CANCELLED' } });
    await applyRefundState({ paymentIntentId: pi, amountRefundedCents: toCents(Number(suite.totalPrice)) });
    const after = await prisma.booking.findMany({ where: { id: { in: [queen.id, suite.id] } }, select: { id: true, paymentStatus: true } });
    expect(after.find((r) => r.id === queen.id)!.paymentStatus).toBe('PAID');
    expect(after.find((r) => r.id === suite.id)!.paymentStatus).toBe('REFUNDED');

    const actor = await actorFor((await makeUser({ role: 'OWNER', propertyIds: [h.property.id] })).id);
    const shown = toBookingSummary(await getBookingForStaff(actor, queen.id));
    expect(shown.amountPaid).toBe(Number(queen.totalPrice));
  });

  it('releases the whole reservation when the hold runs out, and takes it back if the money arrives late', async () => {
    const h = await twoTypeHotel();
    const rows = await createReservation({ ...h.stay, lines: h.lines, onlinePayment: { policy: 'FULL_PREPAYMENT', depositNights: 1 } });
    const [lead] = rows;
    expect(await expireUnpaidBooking(lead.id)).toBe(true);
    expect((await reservation(lead.code!)).map((r) => [r.status, r.paymentStatus])).toEqual([
      ['CANCELLED', 'EXPIRED'],
      ['CANCELLED', 'EXPIRED'],
    ]);

    const total = rows.reduce((s, r) => s + toCents(Number(r.totalPrice)), 0);
    await recordPaymentSucceeded(paidIntent(lead, rows.map((r) => r.id), total));
    expect((await reservation(lead.code!)).map((r) => [r.status, r.paymentStatus])).toEqual([
      ['CONFIRMED', 'PAID'],
      ['CONFIRMED', 'PAID'],
    ]);
  });
});
