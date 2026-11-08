import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/stripe', async (original) => ({
  ...(await original<typeof import('@/lib/stripe')>()),
  getStripe: () => ({}),
  isStripeConfigured: () => true,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => null }));

import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { recordCashPayment } from '@/server/payments/desk';
import { canAtProperty, grantedPermissionsByProperty } from '@/server/authz';
import { getBookingForStaff, transitionBooking } from '@/server/services/bookings';
import { addAllowance, editFolio, getFolio } from '@/server/services/folio';
import { toBookingSummary } from '@/server/services/mappers';
import { getPermissionSettings, setPermissionGrant } from '@/server/services/permissions';
import { createDeskReservation } from '@/server/services/reservations';
import { actorFor, makeHotel, makeUser } from './fixtures';

/** A hotel (Queen, 120 a night, 10% tax), its owner, a manager, a front desk clerk, and a two-night stay: 264.00. */
async function setup() {
  const h = await makeHotel({ basePrice: 120, charges: [{ name: 'Sales tax', kind: 'PERCENT', amount: 10 }] });
  const as = async (role: 'OWNER' | 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPER') => {
    const user = await makeUser({ role, propertyIds: [h.property.id] });
    return { actor: await actorFor(user.id), source: 'classic' as const, user };
  };
  const owner = await as('OWNER');
  const manager = await as('MANAGER');
  const desk = await as('FRONT_DESK');
  const booking = await createDeskReservation(desk, {
    propertyId: h.property.id,
    roomTypeId: h.roomType.id,
    checkIn: h.today,
    checkOut: addDaysISO(h.today, 2),
    guests: 1,
    rooms: 1,
    guest: { firstName: 'Mia', lastName: 'Ortiz' },
  });
  return { h, owner, manager, desk, as, booking };
}

const audits = (propertyId: string, action: string) => prisma.agentAuditLog.findMany({ where: { propertyId, action }, orderBy: { createdAt: 'asc' } });

describe('editing the folio', () => {
  it('owners can edit; managers and the front desk only once the owner allows it, at that hotel', async () => {
    const { h, owner, manager, desk, booking } = await setup();
    expect((await getFolio(owner.actor, booking.id)).canEdit).toBe(true);
    expect((await getFolio(manager.actor, booking.id)).canEdit).toBe(false);
    expect((await getFolio(desk.actor, booking.id)).canEdit).toBe(false);
    const add = { target: 'addCharge' as const, name: 'Minibar', amount: 12 };
    await expect(editFolio(manager, booking.id, add)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/Settings → Permissions/) });
    await expect(editFolio(desk, booking.id, add)).rejects.toMatchObject({ status: 403 });

    // Only owners manage permissions, and only grantable roles.
    await expect(setPermissionGrant(manager, h.property.id, { permission: 'folio.edit', role: 'MANAGER', granted: true })).rejects.toMatchObject({ status: 403 });
    await expect(setPermissionGrant(owner, h.property.id, { permission: 'folio.edit', role: 'HOUSEKEEPER', granted: true })).rejects.toMatchObject({ status: 400 });
    await expect(setPermissionGrant(owner, h.property.id, { permission: 'payments.manage', role: 'MANAGER', granted: true })).rejects.toMatchObject({ status: 400 });

    const settings = await setPermissionGrant(owner, h.property.id, { permission: 'folio.edit', role: 'MANAGER', granted: true });
    expect(settings.permissions[0]).toMatchObject({ permission: 'folio.edit', always: ['OWNER'] });
    expect(settings.permissions[0].roles).toMatchObject([
      { role: 'MANAGER', granted: true, grantedBy: `Test ${owner.user.lastName}` },
      { role: 'FRONT_DESK', granted: false },
    ]);
    expect((await getFolio(manager.actor, booking.id)).canEdit).toBe(true);
    expect((await getFolio(desk.actor, booking.id)).canEdit).toBe(false);
    await editFolio(manager, booking.id, add);
    expect((await grantedPermissionsByProperty(manager.actor, [h.property.id])).get(h.property.id)).toEqual(['folio.edit']);

    // Granted at this hotel only.
    const other = await makeHotel();
    expect(await canAtProperty(manager.actor, 'folio.edit', other.property.id)).toBe(false);
    // An owner of another hotel can't change this one's permissions.
    const stranger = { actor: await actorFor((await makeUser({ role: 'OWNER', propertyIds: [other.property.id] })).id), source: 'classic' as const };
    await expect(getPermissionSettings(stranger.actor, h.property.id)).rejects.toMatchObject({ status: 403 });

    // Taken back: refused again.
    await setPermissionGrant(owner, h.property.id, { permission: 'folio.edit', role: 'MANAGER', granted: false });
    await expect(editFolio(manager, booking.id, add)).rejects.toMatchObject({ status: 403 });
    expect((await audits(h.property.id, 'PERMISSION_GRANT')).length).toBe(1);
    expect((await audits(h.property.id, 'PERMISSION_REVOKE')).length).toBe(1);
  });

  it('changes the room line and taxes, adds and removes charges, and the balance and booking follow', async () => {
    const { h, owner, booking } = await setup();
    let folio = await getFolio(owner.actor, booking.id);
    expect(folio.lines.filter((l) => l.section === 'CHARGES').map((l) => [l.kind, l.label, l.amount])).toEqual([
      ['ROOM', 'Queen', 240],
      ['TAX', 'Sales tax', 24],
    ]);
    expect(folio.edits.room).toMatchObject({ type: 'room', label: 'Queen', amount: 240 });

    folio = await editFolio(owner, booking.id, { target: 'room', label: 'Queen, ocean view', amount: 200, expected: { label: 'Queen', amount: 240 }, reason: 'Rate match' });
    folio = await editFolio(owner, booking.id, { target: 'charge', index: 0, amount: 20, name: 'State tax', expected: { name: 'Sales tax', amount: 24 } });
    folio = await editFolio(owner, booking.id, { target: 'addCharge', name: 'Parking', amount: 15, date: h.today });
    expect(folio.lines.filter((l) => l.section === 'CHARGES').map((l) => [l.kind, l.label, l.amount, l.at])).toEqual([
      ['ROOM', 'Queen, ocean view', 200, null],
      ['TAX', 'State tax', 20, null],
      ['CHARGE', 'Parking', 15, h.today],
    ]);
    expect(folio.totals).toMatchObject({ charges: 235, balance: 235 });

    const b = await getBookingForStaff(owner.actor, booking.id);
    expect(Number(b.totalPrice)).toBe(235);
    expect(Number(b.subtotalPrice)).toBe(200);
    expect(toBookingSummary(b)).toMatchObject({ totalPrice: 235, balance: 235, checkOutDue: 235 });

    // A stale edit (someone changed the line meanwhile) is refused.
    await expect(editFolio(owner, booking.id, { target: 'charge', index: 0, amount: 1, expected: { name: 'Sales tax', amount: 24 } })).rejects.toMatchObject({ status: 409 });

    folio = await editFolio(owner, booking.id, { target: 'removeCharge', index: 1, expected: { name: 'Parking', amount: 15 } });
    expect(folio.totals.charges).toBe(220);
    // Back to the room type's name.
    folio = await editFolio(owner, booking.id, { target: 'room', label: '', expected: { label: 'Queen, ocean view', amount: 200 } });
    expect(folio.lines[0].label).toBe('Queen');

    const log = await audits(h.property.id, 'FOLIO_EDIT');
    expect(log.length).toBe(5);
    const first = JSON.parse(log[0].detail!);
    expect(first).toMatchObject({ bookingId: booking.id, target: 'room', reason: 'Rate match', before: { roomLabel: 'Queen', room: 240 }, after: { roomLabel: 'Queen, ocean view', room: 200 } });
    expect(first.summary).toContain('room $200.00 (was $240.00)');
  });

  it('sets several lines to one total: the room and a percentage tax share it, fixed fees keep theirs', async () => {
    const { h, owner, booking } = await setup();
    // Two nights at 120 with 10% tax: 240 + 24. "Make the room and tax together 200."
    let folio = await editFolio(owner, booking.id, { target: 'setTotal', refs: ['room', 'charge:0'], amount: 200, expected: { room: 240, 'charge:0': 24 }, reason: 'Agreed rate' });
    expect(folio.lines.filter((l) => l.section === 'CHARGES').map((l) => [l.kind, l.label, l.amount])).toEqual([
      ['ROOM', 'Queen', 181.82],
      ['TAX', 'Sales tax', 18.18],
    ]);
    expect(folio.totals.charges).toBe(200);
    // The tax moved with the room, so it's still 10% of it.
    expect(folio.edits['charge:0']).toMatchObject({ percent: 10 });

    // A fixed fee keeps its amount; the room and tax share the rest.
    folio = await editFolio(owner, booking.id, { target: 'addCharge', name: 'Resort fee', amount: 15 });
    folio = await editFolio(owner, booking.id, { target: 'setTotal', refs: ['room', 'charge:0', 'charge:1'], amount: 150, expected: { room: 181.82, 'charge:0': 18.18, 'charge:1': 15 } });
    expect(folio.lines.filter((l) => l.section === 'CHARGES').map((l) => [l.label, l.amount])).toEqual([
      ['Queen', 122.73],
      ['Sales tax', 12.27],
      ['Resort fee', 15],
    ]);
    const b = await getBookingForStaff(owner.actor, booking.id);
    expect([Number(b.totalPrice), Number(b.subtotalPrice)]).toEqual([150, 122.73]);

    // The tax alone to a total: it's a fixed amount from then on.
    folio = await editFolio(owner, booking.id, { target: 'setTotal', refs: ['charge:0'], amount: 10, expected: { 'charge:0': 12.27 } });
    expect(folio.edits['charge:0']).toMatchObject({ amount: 10, percent: null });

    // Changed meanwhile: refused, nothing written.
    await expect(editFolio(owner, booking.id, { target: 'setTotal', refs: ['room', 'charge:0'], amount: 100, expected: { room: 240, 'charge:0': 24 } })).rejects.toMatchObject({ status: 409 });
    const log = await audits(h.property.id, 'FOLIO_EDIT');
    expect(JSON.parse(log[0].detail!).summary).toMatch(/room \+ “Sales tax” together \$200\.00 \(was \$264\.00\): room \$181\.82, “Sales tax” \$18\.18 \(Agreed rate\)/);
  });

  it('edits recorded payments fully, removes them, and edits allowances', async () => {
    const { h, owner, desk, booking } = await setup();
    await recordCashPayment(desk, booking.id, { kind: 'PAYMENT', amount: 100 });
    let folio = await getFolio(owner.actor, booking.id);
    const pay = folio.lines.find((l) => l.kind === 'PAYMENT')!;
    const target = folio.edits[pay.ref!];
    expect(target).toMatchObject({ type: 'payment', recorded: true, amount: 100, method: 'CASH' });

    const paidAt = new Date(Date.now() - 3_600_000).toISOString();
    folio = await editFolio(owner, booking.id, { target: 'payment', id: pay.ref!.slice('payment:'.length), amount: 264, method: 'EXTERNAL_CARD', paidAt, note: 'Front terminal' });
    expect(folio.totals).toMatchObject({ paid: 264, balance: 0 });
    expect(folio.settled).toBe(true);
    const row = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(row).toMatchObject({ method: 'EXTERNAL_CARD', note: 'Front terminal', status: 'SUCCEEDED' });
    expect(row.paidAt?.toISOString()).toBe(paidAt);
    expect((await getBookingForStaff(owner.actor, booking.id)).paymentStatus).toBe('PAID');

    // Card numbers never go in a note.
    await expect(editFolio(owner, booking.id, { target: 'payment', id: row.id, note: '4242 4242 4242 4242' })).rejects.toMatchObject({ status: 400 });

    folio = await editFolio(owner, booking.id, { target: 'removePayment', id: row.id, reason: 'Entered twice' });
    expect(folio.totals).toMatchObject({ paid: 0, balance: 264 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('CANCELED');

    // Allowances: amount and reason, at most the charges less the others.
    folio = await addAllowance(owner, booking.id, { amount: 20, reason: 'Noisy room' });
    const id = folio.allowances[0].id;
    folio = await editFolio(owner, booking.id, { target: 'allowance', id, amount: 30, allowanceReason: 'Noisy room, both nights' });
    expect(folio.allowances[0]).toMatchObject({ amount: 30, reason: 'Noisy room, both nights' });
    await expect(editFolio(owner, booking.id, { target: 'allowance', id, amount: 300 })).rejects.toMatchObject({ status: 400 });
    expect(folio.totals.balance).toBe(234);
    expect((await audits(h.property.id, 'FOLIO_EDIT')).length).toBe(3);
  });

  it('a card payment through Stripe keeps its amount: only the note changes', async () => {
    const { owner, booking } = await setup();
    const p = await prisma.payment.create({
      data: { bookingId: booking.id, propertyId: booking.propertyId, method: 'TERMINAL', kind: 'PAYMENT', status: 'SUCCEEDED', amount: 50, stripePaymentIntentId: `pi_${booking.id}`, paidAt: new Date() },
    });
    const folio = await getFolio(owner.actor, booking.id);
    expect(folio.edits[`payment:${p.id}`]).toMatchObject({ recorded: false });
    await expect(editFolio(owner, booking.id, { target: 'payment', id: p.id, amount: 10 })).rejects.toMatchObject({ status: 403 });
    await expect(editFolio(owner, booking.id, { target: 'removePayment', id: p.id })).rejects.toMatchObject({ status: 403 });
    await editFolio(owner, booking.id, { target: 'payment', id: p.id, note: 'Guest asked for a receipt' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).note).toBe('Guest asked for a receipt');
  });

  it('works after check-out, not on a cancelled stay', async () => {
    const { h, owner, desk, booking } = await setup();
    await recordCashPayment(desk, booking.id, { kind: 'PAYMENT', amount: 264 });
    await transitionBooking(desk, booking.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    await transitionBooking(desk, booking.id, 'CHECKED_OUT');
    const folio = await editFolio(owner, booking.id, { target: 'addCharge', name: 'Minibar', amount: 8 });
    expect(folio.totals.balance).toBe(8);

    const second = (await setup()).booking;
    await prisma.booking.update({ where: { id: second.id }, data: { status: 'CANCELLED' } });
    const owner2 = { actor: await actorFor((await makeUser({ role: 'OWNER', propertyIds: [second.propertyId] })).id), source: 'classic' as const };
    expect((await getFolio(owner2.actor, second.id)).canEdit).toBe(false);
    await expect(editFolio(owner2, second.id, { target: 'addCharge', name: 'Minibar', amount: 8 })).rejects.toMatchObject({ status: 400 });
  });
});
