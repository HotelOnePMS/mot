import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Stripe for refunds: the card's refunded total, as the charge would report it. Like Stripe, a request sent
// again with the same idempotency key returns the first refund instead of refunding twice. `duringRefund` runs while
// the refund is "at Stripe", for races.
const stripe = vi.hoisted(() => {
  const refunded = new Map<string, number>();
  const byKey = new Map<string, { id: string; amount: number }>();
  const hooks = { duringRefund: null as null | (() => Promise<void>) };
  return {
    refunded,
    byKey,
    hooks,
    api: {
      refunds: {
        create: vi.fn(async (params: { payment_intent: string; amount: number }, opts?: { idempotencyKey?: string }) => {
          const key = opts?.idempotencyKey;
          if (key && byKey.has(key)) return byKey.get(key)!;
          const refund = { id: `re_${byKey.size + refunded.size}`, amount: params.amount };
          if (key) byKey.set(key, refund);
          refunded.set(params.payment_intent, (refunded.get(params.payment_intent) ?? 0) + params.amount);
          if (hooks.duringRefund) {
            const run = hooks.duringRefund;
            hooks.duringRefund = null;
            await run();
          }
          return refund;
        }),
      },
      paymentIntents: {
        retrieve: vi.fn(async (id: string) => ({ id, status: 'succeeded', latest_charge: { id: `ch_${id}`, amount_refunded: refunded.get(id) ?? 0 } })),
      },
    },
  };
});
vi.mock('@/lib/stripe', async (original) => ({
  ...(await original<typeof import('@/lib/stripe')>()),
  getStripe: () => stripe.api,
  isStripeConfigured: () => true,
}));

// Refunds read the signed-in staff member from the session (requireStaff): whoever the test signs in.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId, sessionVersion: 0, authMethod: 'password' } } : null),
}));

import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { getDeskPayments, recordCashPayment } from '@/server/payments/desk';
import { refreshEvidence } from '@/server/payments/disputes';
import { refundPayment } from '@/server/payments/refunds';
import { checkTransition, createReservation, getBookingForStaff, transitionBooking } from '@/server/services/bookings';
import { previewRegistration } from '@/server/services/checkin';
import { addAllowance, getFolio, voidAllowance } from '@/server/services/folio';
import { toBookingSummary } from '@/server/services/mappers';
import { createDeskReservation } from '@/server/services/reservations';
import type { Actor } from '@/server/authz';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

/** A hotel (Queen, 120 a night), a front desk clerk, a manager, and a two-night stay at the desk: 240.00 owed. */
async function setup(opts: { paid?: boolean } = {}) {
  const h = await makeHotel({ basePrice: 120 });
  const deskUser = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
  const managerUser = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
  const desk = { actor: await actorFor(deskUser.id), source: 'classic' as const };
  const manager = { actor: await actorFor(managerUser.id), source: 'classic' as const };
  const booking = await createDeskReservation(desk, {
    propertyId: h.property.id,
    roomTypeId: h.roomType.id,
    checkIn: h.today,
    checkOut: addDaysISO(h.today, 2),
    guests: 1,
    rooms: 1,
    guest: { firstName: 'Mia', lastName: 'Ortiz' },
    paid: opts.paid,
  });
  return { h, desk, manager, deskUser, managerUser, booking };
}

/** A hotel with a Queen (100) and a Suite (300), and one reservation of both, paid at the hotel. */
async function sharedReservation() {
  const h = await makeHotel({ basePrice: 100 });
  const suite = await prisma.roomType.create({ data: { propertyId: h.property.id, name: 'Suite', capacity: 4, basePrice: 300, totalRooms: 1, amenities: [] } });
  const suiteRoom = await prisma.room.create({ data: { propertyId: h.property.id, roomTypeId: suite.id, roomNumber: '301', floor: '3', status: 'CLEAN' } });
  const desk = { actor: await actorFor((await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] })).id), source: 'classic' as const };
  const managerUser = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
  const manager = { actor: await actorFor(managerUser.id), source: 'classic' as const };
  const guest = await makeUser({ role: 'CUSTOMER' });
  const rows = await createReservation({
    userId: guest.id,
    propertyId: h.property.id,
    checkIn: h.today,
    checkOut: addDaysISO(h.today, 2),
    guests: 3,
    lines: [
      { roomTypeId: h.roomType.id, rooms: 1 },
      { roomTypeId: suite.id, rooms: 1 },
    ],
    paymentStatus: 'PAY_AT_PROPERTY',
  });
  const queen = rows.find((r) => r.roomTypeId === h.roomType.id)!;
  const suiteLine = rows.find((r) => r.roomTypeId === suite.id)!;
  return { h, suiteRoom, desk, manager, managerUser, queen, suiteLine, total: Number(queen.totalPrice) + Number(suiteLine.totalPrice) };
}

const summaryOf = async (actor: Actor, bookingId: string) => toBookingSummary(await getBookingForStaff(actor, bookingId));
const history = (bookingId: string) => prisma.bookingStatusHistory.findMany({ where: { bookingId } });
const audits = (propertyId: string, action: string) => prisma.agentAuditLog.findMany({ where: { propertyId, action } });

describe('allowances on the folio', () => {
  it('a manager’s allowance lowers the balance and shows on the folio; paying the rest marks the stay paid', async () => {
    const { h, desk, manager, managerUser, booking } = await setup();
    expect(booking.totalPrice).toBe(240);

    const folio = await addAllowance(manager, booking.id, { amount: 40, reason: '  Air   conditioning broken ' });
    const allowance = folio.lines.find((l) => l.kind === 'ALLOWANCE')!;
    expect(allowance).toMatchObject({ section: 'CHARGES', label: 'Allowance', amount: -40 });
    expect(allowance.detail).toContain('Air conditioning broken');
    expect(allowance.detail).toContain(`by Test ${managerUser.lastName}`);
    expect(allowance.at).not.toBeNull();
    expect(folio.totals).toEqual({ charges: 240, allowances: 40, paid: 0, refunded: 0, balance: 200 });
    expect(folio.allowances).toMatchObject([{ amount: 40, reason: 'Air conditioning broken', by: `Test ${managerUser.lastName}` }]);
    expect(folio.maxAllowance).toBe(200);
    expect(folio).toMatchObject({ checkOutDue: 200, settled: false, checkoutOverride: null });
    // The front desk sees the same folio.
    expect((await getFolio(desk.actor, booking.id)).totals.allowances).toBe(40);

    const summary = await summaryOf(desk.actor, booking.id);
    expect(summary).toMatchObject({ totalPrice: 240, allowances: 40, balance: 200, checkOutDue: 200 });
    // The desk collects what is left after the allowance, and no more.
    expect(await getDeskPayments(desk.actor, booking.id)).toMatchObject({ total: 200, balance: 200 });
    await expect(recordCashPayment(desk, booking.id, { kind: 'PAYMENT', amount: 240 })).rejects.toThrow(/balance/);

    // 200 in cash covers the stay now (it wouldn't without the allowance).
    await recordCashPayment(desk, booking.id, { kind: 'PAYMENT', amount: 200 });
    expect((await summaryOf(desk.actor, booking.id)).paymentStatus).toBe('PAID');
    expect((await getDeskPayments(desk.actor, booking.id)).balance).toBe(0);
    expect((await getFolio(desk.actor, booking.id)).settled).toBe(true);

    await transitionBooking(desk, booking.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    const out = await transitionBooking(desk, booking.id, 'CHECKED_OUT');
    expect(out.booking).toMatchObject({ status: 'CHECKED_OUT', balance: 0, allowances: 40 });
    // Nothing was owed, so no override was recorded.
    expect(await prisma.checkoutOverride.count({ where: { bookingId: booking.id } })).toBe(0);

    const [audit] = await audits(h.property.id, 'FOLIO_ALLOWANCE');
    expect(audit.userId).toBe(managerUser.id);
    expect(audit.detail).toContain('Allowance of $40.00');
    expect(audit.detail).toContain('Air conditioning broken');
  });

  it('removing an allowance brings the balance back and keeps it on record; twice is a 409', async () => {
    const { h, desk, manager, managerUser, booking } = await setup();
    const added = await addAllowance(manager, booking.id, { amount: 40, reason: 'Left a night early' });
    const id = added.allowances[0].id;
    await recordCashPayment(desk, booking.id, { kind: 'PAYMENT', amount: 200 });
    expect((await summaryOf(desk.actor, booking.id)).paymentStatus).toBe('PAID');

    const folio = await voidAllowance(manager, booking.id, id);
    expect(folio.lines.some((l) => l.kind === 'ALLOWANCE')).toBe(false);
    expect(folio.allowances).toEqual([]);
    expect(folio.totals).toMatchObject({ charges: 240, allowances: 0, paid: 200, balance: 40 });
    expect(folio.maxAllowance).toBe(240);
    expect(folio).toMatchObject({ checkOutDue: 40, settled: false });

    const summary = await summaryOf(desk.actor, booking.id);
    expect(summary).toMatchObject({ allowances: 0, balance: 40, checkOutDue: 40, paymentStatus: 'DEPOSIT_PAID' });
    expect((await getDeskPayments(desk.actor, booking.id)).balance).toBe(40);

    await expect(voidAllowance(manager, booking.id, id)).rejects.toMatchObject({ status: 409 });
    const row = await prisma.folioAllowance.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ reason: 'Left a night early', currency: 'USD', createdById: managerUser.id, voidedById: managerUser.id });
    expect(Number(row.amount)).toBe(40);
    expect(row.voidedAt).toBeInstanceOf(Date);
    const [audit] = await audits(h.property.id, 'FOLIO_ALLOWANCE_REMOVED');
    expect(audit.detail).toContain('Removed the allowance of $40.00');

    // An allowance of another booking, or one that doesn't exist, isn't found.
    const other = await createDeskReservation(desk, { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: 'Ana', lastName: 'Ruiz' } });
    const theirs = (await addAllowance(manager, other.id, { amount: 10, reason: 'Noisy room' })).allowances[0].id;
    await expect(voidAllowance(manager, booking.id, theirs)).rejects.toMatchObject({ status: 404 });
    await expect(voidAllowance(manager, booking.id, 'nope')).rejects.toMatchObject({ status: 404 });
    expect((await prisma.folioAllowance.findUniqueOrThrow({ where: { id: theirs } })).voidedAt).toBeNull();
  });

  it('takes off at most what is left of the charges', async () => {
    const { desk, manager, booking } = await setup();
    await expect(addAllowance(manager, booking.id, { amount: 240.01, reason: 'Rate correction' })).rejects.toMatchObject({ status: 400 });
    await addAllowance(manager, booking.id, { amount: 200, reason: 'Rate correction' });
    await expect(addAllowance(manager, booking.id, { amount: 40.01, reason: 'Service recovery' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/At most \$40\.00/) });
    const folio = await addAllowance(manager, booking.id, { amount: 40, reason: 'Service recovery' });
    expect(folio.maxAllowance).toBe(0);
    expect(folio.totals).toMatchObject({ allowances: 240, balance: 0 });
    await expect(addAllowance(manager, booking.id, { amount: 0.01, reason: 'One more' })).rejects.toMatchObject({ status: 400 });
    expect((await summaryOf(desk.actor, booking.id)).checkOutDue).toBe(0);
    // Nothing or less than nothing isn't an allowance.
    await expect(addAllowance(manager, booking.id, { amount: 0, reason: 'Nothing' })).rejects.toMatchObject({ status: 400 });
    await expect(addAllowance(manager, booking.id, { amount: -5, reason: 'Negative' })).rejects.toMatchObject({ status: 400 });
    expect(await prisma.folioAllowance.count({ where: { bookingId: booking.id } })).toBe(2);
  });

  it('two allowances at once can’t together take off more than the charges', async () => {
    const { desk, manager, booking } = await setup();
    const results = await Promise.allSettled([
      addAllowance(manager, booking.id, { amount: 150, reason: 'Broken shower' }),
      addAllowance(manager, booking.id, { amount: 150, reason: 'Broken heater' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 400 });
    const rows = await prisma.folioAllowance.findMany({ where: { bookingId: booking.id } });
    expect(rows).toHaveLength(1);
    expect((await summaryOf(desk.actor, booking.id)).allowances).toBe(150);
  });

  it('is for managers only, at their own hotels', async () => {
    const { desk, manager, booking } = await setup();
    await expect(addAllowance(desk, booking.id, { amount: 10, reason: 'Noisy room' })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/roles/) });
    const { allowances } = await addAllowance(manager, booking.id, { amount: 10, reason: 'Noisy room' });
    await expect(voidAllowance(desk, booking.id, allowances[0].id)).rejects.toMatchObject({ status: 403 });
    // A manager of another hotel can't reach it.
    const other = await makeHotel();
    const stranger = { actor: await actorFor((await makeUser({ role: 'MANAGER', propertyIds: [other.property.id] })).id), source: 'classic' as const };
    await expect(addAllowance(stranger, booking.id, { amount: 10, reason: 'Noisy room' })).rejects.toMatchObject({ status: 403 });
    await expect(voidAllowance(stranger, booking.id, allowances[0].id)).rejects.toMatchObject({ status: 403 });
    // Owners can too.
    const owner = { actor: await actorFor((await makeUser({ role: 'OWNER', propertyIds: [booking.propertyId] })).id), source: 'classic' as const };
    await addAllowance(owner, booking.id, { amount: 5, reason: 'Late breakfast' });
    const rows = await prisma.folioAllowance.findMany({ where: { bookingId: booking.id } });
    expect(rows.map((r) => Number(r.amount)).sort((a, b) => a - b)).toEqual([5, 10]);
    expect(rows.every((r) => r.voidedAt === null)).toBe(true);
  });

  it('refuses a closed reservation, a missing reason and a card number', async () => {
    const { desk, manager, booking } = await setup();
    // One given before the stay was cancelled stays as it is: it can't be removed while the reservation is closed.
    const given = await addAllowance(manager, booking.id, { amount: 5, reason: 'Goodwill' });
    await expect(addAllowance(manager, booking.id, { amount: 10, reason: 'ok' })).rejects.toMatchObject({ status: 400 });
    await expect(addAllowance(manager, booking.id, { amount: 10, reason: '  a   ' })).rejects.toMatchObject({ status: 400 });
    await expect(addAllowance(manager, booking.id, { amount: 10, reason: 'Refund to card 4242 4242 4242 4242' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/card number/) });
    expect(await prisma.folioAllowance.count({ where: { bookingId: booking.id } })).toBe(1);

    await transitionBooking(desk, booking.id, 'CANCELLED');
    await expect(addAllowance(manager, booking.id, { amount: 10, reason: 'Goodwill' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/closed/) });
    await expect(voidAllowance(manager, booking.id, given.allowances[0].id)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/closed/) });
    expect(await prisma.folioAllowance.count({ where: { bookingId: booking.id, voidedAt: null } })).toBe(1);
  });

  it('never shows in the guest’s status history', async () => {
    const { desk, manager, booking } = await setup();
    await recordCashPayment(desk, booking.id, { kind: 'PAYMENT', amount: 200 });
    const before = (await history(booking.id)).length;
    // The allowance and its removal each change the payment status, without a word to the guest.
    const { allowances } = await addAllowance(manager, booking.id, { amount: 40, reason: 'Housekeeping missed the room' });
    expect((await summaryOf(desk.actor, booking.id)).paymentStatus).toBe('PAID');
    await voidAllowance(manager, booking.id, allowances[0].id);
    expect((await summaryOf(desk.actor, booking.id)).paymentStatus).toBe('DEPOSIT_PAID');
    const after = await history(booking.id);
    expect(after).toHaveLength(before);
    expect(JSON.stringify(after)).not.toMatch(/Housekeeping missed|[Aa]llowance/);
  });

  it('on a reservation of two room types, lowers that room type and the reservation’s balance', async () => {
    const { h, suiteRoom, desk, manager, queen, suiteLine, total } = await sharedReservation();
    expect((await getDeskPayments(desk.actor, queen.id)).balance).toBe(total);
    expect((await summaryOf(desk.actor, queen.id)).checkOutDue).toBe(total);

    const folio = await addAllowance(manager, queen.id, { amount: 50, reason: 'View blocked by scaffolding' });
    expect(folio.reservation).toMatchObject({ roomTypes: 2 });
    expect(folio.totals).toMatchObject({ charges: Number(queen.totalPrice), allowances: 50, balance: Number(queen.totalPrice) - 50 });
    expect(folio.maxAllowance).toBe(Number(queen.totalPrice) - 50);

    const q = await summaryOf(desk.actor, queen.id);
    expect(q).toMatchObject({ allowances: 50, balance: Number(queen.totalPrice) - 50, checkOutDue: total - 50 });
    // The other room type keeps its own price, and the reservation still owes 50 less.
    const s = await summaryOf(desk.actor, suiteLine.id);
    expect(s).toMatchObject({ allowances: 0, balance: Number(suiteLine.totalPrice), checkOutDue: total - 50 });
    const suiteFolio = await getFolio(desk.actor, suiteLine.id);
    expect(suiteFolio.allowances).toEqual([]);
    expect(suiteFolio.maxAllowance).toBe(Number(suiteLine.totalPrice));
    for (const id of [queen.id, suiteLine.id]) expect(await getDeskPayments(desk.actor, id)).toMatchObject({ total: total - 50, balance: total - 50 });

    await expect(recordCashPayment(desk, suiteLine.id, { kind: 'PAYMENT', amount: total })).rejects.toThrow(/balance/);
    await recordCashPayment(desk, suiteLine.id, { kind: 'PAYMENT', amount: total - 50 });
    expect((await getDeskPayments(desk.actor, queen.id)).balance).toBe(0);
    for (const id of [queen.id, suiteLine.id]) expect((await summaryOf(desk.actor, id)).checkOutDue).toBe(0);

    // Paid in full: each room type is paid, neither in credit nor owing (the payment is spread by what each costs after
    // its allowances).
    for (const id of [queen.id, suiteLine.id]) expect(await summaryOf(desk.actor, id)).toMatchObject({ balance: 0, paymentStatus: 'PAID' });
    expect((await getFolio(desk.actor, suiteLine.id)).totals.balance).toBe(0);

    // Both room types check out with the reservation paid.
    await transitionBooking(desk, queen.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    await transitionBooking(desk, suiteLine.id, 'CHECKED_IN', { roomId: suiteRoom.id });
    expect((await transitionBooking(desk, queen.id, 'CHECKED_OUT')).booking.status).toBe('CHECKED_OUT');
    expect((await transitionBooking(desk, suiteLine.id, 'CHECKED_OUT')).booking.status).toBe('CHECKED_OUT');
  });

  it('in a currency without decimals, rounds to whole units so nothing uncollectable is left', async () => {
    const h = await makeHotel({ basePrice: 12000, currency: 'JPY' });
    const desk = { actor: await actorFor((await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] })).id), source: 'classic' as const };
    const manager = { actor: await actorFor((await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] })).id), source: 'classic' as const };
    const booking = await createDeskReservation(desk, { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 2), guests: 1, rooms: 1, guest: { firstName: 'Mia', lastName: 'Ortiz' } });
    const folio = await addAllowance(manager, booking.id, { amount: 1000.4, reason: 'Noise' });
    expect(folio.allowances[0].amount).toBe(1000);
    const s = await summaryOf(desk.actor, booking.id);
    expect(s).toMatchObject({ allowances: 1000, balance: 23000, checkOutDue: 23000 });
    await recordCashPayment(desk, booking.id, { kind: 'PAYMENT', amount: 23000 });
    expect((await summaryOf(desk.actor, booking.id)).checkOutDue).toBe(0);
  });

  it('on a shared reservation with a cancelled room type, the credit lands on the room type kept', async () => {
    const { desk, manager, queen, suiteLine } = await sharedReservation();
    const total = Number(queen.totalPrice) + Number(suiteLine.totalPrice);
    await recordCashPayment(desk, queen.id, { kind: 'PAYMENT', amount: total });
    await transitionBooking(desk, suiteLine.id, 'CANCELLED');
    // Hand back the cancelled room type's price, then take 50 off the room type kept: the guest is owed 50.
    const cash = await prisma.payment.findFirstOrThrow({ where: { bookingId: queen.id, method: 'CASH' } });
    await prisma.payment.update({ where: { id: cash.id }, data: { amountRefunded: Number(suiteLine.totalPrice), status: 'PARTIALLY_REFUNDED' } });
    expect((await summaryOf(desk.actor, queen.id)).balance).toBe(0);
    await addAllowance(manager, queen.id, { amount: 50, reason: 'Noise' });
    expect(await summaryOf(desk.actor, queen.id)).toMatchObject({ allowances: 50, balance: -50, checkOutDue: 0 });
    expect((await getFolio(desk.actor, queen.id)).totals.balance).toBe(-50);
  });

  it('prints the allowance on the registration card', async () => {
    const { h, desk, manager, booking } = await setup();
    const draft = { roomId: h.rooms[0].id, guestAddress: null, id: { idType: 'PASSPORT' as const, country: 'US', last4: '4567' }, deposit: { kind: 'NONE' as const } };
    const before = await previewRegistration(desk.actor, booking.id, draft);
    expect(before.text).toContain('Room and taxes: $240.00. Paid so far: $0.00.');
    expect(before.text).not.toContain('Allowances');

    await addAllowance(manager, booking.id, { amount: 40, reason: 'Pool closed' });
    const after = await previewRegistration(desk.actor, booking.id, draft);
    expect(after.text).toContain('Room and taxes: $240.00. Allowances: $40.00 off. Paid so far: $0.00.');
    expect(after.text).toContain('Balance to pay: $200.00.');
    // The reason is for staff, not printed for the guest to sign.
    expect(after.text).not.toContain('Pool closed');
    expect(after.textHash).not.toBe(before.textHash);
  });
  it('lists the allowances in force in dispute evidence', async () => {
    const { h, manager, booking } = await setup();
    const kept = await addAllowance(manager, booking.id, { amount: 40, reason: 'Air conditioning broken' });
    const removed = await addAllowance(manager, booking.id, { amount: 15, reason: 'Entered twice' });
    await voidAllowance(manager, booking.id, removed.allowances.find((a) => a.reason === 'Entered twice')!.id);
    const dispute = await prisma.dispute.create({ data: { stripeDisputeId: `dp_${uid()}`, bookingId: booking.id, propertyId: h.property.id, amount: 200, status: 'needs_response' } });
    const evidence = await refreshEvidence(dispute.id);
    const text = JSON.stringify(evidence!.summary);
    expect(text).toContain(`Allowance given by the hotel: 40.00 USD off, ${kept.allowances[0].at.slice(0, 10)}: Air conditioning broken`);
    expect(text).not.toContain('Entered twice');
  });
});

describe('check-out with a balance', () => {
  async function checkedIn() {
    const s = await setup();
    await transitionBooking(s.desk, s.booking.id, 'CHECKED_IN', { roomId: s.h.rooms[0].id });
    // 40 paid at the desk: 200 still owed.
    await recordCashPayment(s.desk, s.booking.id, { kind: 'PAYMENT', amount: 40 });
    return s;
  }

  it('only a manager can, and only saying why', async () => {
    const { desk, manager, booking } = await checkedIn();
    const owed = await getBookingForStaff(desk.actor, booking.id);
    expect(await checkTransition(desk.actor, owed, 'CHECKED_OUT')).toEqual({ ok: false, reason: expect.stringMatching(/balance of \$200\.00 to collect.*A manager can check them out with it owing/) });
    expect(await checkTransition(manager.actor, owed, 'CHECKED_OUT')).toEqual({ ok: false, reason: expect.stringMatching(/balance of \$200\.00 to collect.*Or check them out with it owing/) });
    expect(await checkTransition(desk.actor, owed, 'CHECKED_OUT', { balanceOverride: { reason: 'Billed to Acme Corp' } })).toEqual({ ok: false, reason: expect.stringMatching(/Only a manager/) });
    expect(await checkTransition(manager.actor, owed, 'CHECKED_OUT', { balanceOverride: { reason: 'Billed to Acme Corp' } })).toEqual({ ok: true });

    await expect(transitionBooking(desk, booking.id, 'CHECKED_OUT', { balanceOverride: { reason: 'Billed to Acme Corp' } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Only a manager/) });
    await expect(transitionBooking(manager, booking.id, 'CHECKED_OUT')).rejects.toThrow(/balance of \$200\.00/);
    await expect(transitionBooking(manager, booking.id, 'CHECKED_OUT', { balanceOverride: { reason: '' } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Say why/) });
    await expect(transitionBooking(manager, booking.id, 'CHECKED_OUT', { balanceOverride: { reason: '  ok \n ' } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Say why/) });
    await expect(transitionBooking(manager, booking.id, 'CHECKED_OUT', { balanceOverride: { reason: 'Card 4111 1111 1111 1111 on file' } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/card number/) });

    expect((await getBookingForStaff(desk.actor, booking.id)).status).toBe('CHECKED_IN');
    expect(await prisma.checkoutOverride.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('records what was owed and why, keeps it from the guest, and the balance stays collectable', async () => {
    const { h, desk, manager, managerUser, booking } = await checkedIn();
    const out = await transitionBooking(manager, booking.id, 'CHECKED_OUT', { balanceOverride: { reason: '  Billed to\n Acme   Corp ' } });
    expect(out.booking.status).toBe('CHECKED_OUT');

    const override = await prisma.checkoutOverride.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(override).toMatchObject({ propertyId: h.property.id, currency: 'USD', reason: 'Billed to Acme Corp', approvedById: managerUser.id });
    expect(Number(override.amount)).toBe(200);
    const [audit] = await audits(h.property.id, 'CHECKOUT_WITH_BALANCE');
    expect(audit.userId).toBe(managerUser.id);
    expect(audit.detail).toContain('$200.00 owing');
    expect(audit.detail).toContain('Billed to Acme Corp');
    expect(audit.detail).toContain(booking.id);

    // The guest's history says checked out, never why it was allowed with money owing.
    const rows = await history(booking.id);
    expect(rows.some((r) => r.status === 'CHECKED_OUT')).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/Acme|owing/);

    // Staff still see the balance, and the folio names the override.
    expect(out.booking).toMatchObject({ balance: 200, checkOutDue: 200 });
    const folio = await getFolio(desk.actor, booking.id);
    expect(folio.checkoutOverride).toMatchObject({ amount: 200, reason: 'Billed to Acme Corp', by: `Test ${managerUser.lastName}` });
    expect(folio).toMatchObject({ checkOutDue: 200, settled: false });
    expect((await getDeskPayments(desk.actor, booking.id)).balance).toBe(200);

    // Acme pays later, at the desk.
    await recordCashPayment(desk, booking.id, { kind: 'PAYMENT', amount: 200 });
    const paid = await summaryOf(desk.actor, booking.id);
    expect(paid).toMatchObject({ status: 'CHECKED_OUT', balance: 0, checkOutDue: 0, paymentStatus: 'PAID' });
    expect((await getDeskPayments(desk.actor, booking.id)).balance).toBe(0);
    // What was owed at check-out stays on record.
    expect(Number((await prisma.checkoutOverride.findUniqueOrThrow({ where: { bookingId: booking.id } })).amount)).toBe(200);
  });

  it('a manager can still take the rest off with an allowance after check-out', async () => {
    const { desk, manager, booking } = await checkedIn();
    await transitionBooking(manager, booking.id, 'CHECKED_OUT', { balanceOverride: { reason: 'Disputed minibar' } });
    const folio = await addAllowance(manager, booking.id, { amount: 200, reason: 'Written off' });
    expect(folio).toMatchObject({ checkOutDue: 0, settled: true, maxAllowance: 40 });
    expect(await summaryOf(desk.actor, booking.id)).toMatchObject({ balance: 0, paymentStatus: 'PAID' });
  });

  it('ignores the override when nothing is owed', async () => {
    const { h, desk, manager, booking } = await setup({ paid: true });
    await transitionBooking(desk, booking.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    // Even the front desk: there's no balance to override.
    const out = await transitionBooking(desk, booking.id, 'CHECKED_OUT', { balanceOverride: { reason: 'Billed to Acme Corp' } });
    expect(out.booking.status).toBe('CHECKED_OUT');
    expect(await prisma.checkoutOverride.count({ where: { bookingId: booking.id } })).toBe(0);
    expect(await audits(h.property.id, 'CHECKOUT_WITH_BALANCE')).toHaveLength(0);

    const second = await createDeskReservation(desk, { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: 'Ana', lastName: 'Ruiz' }, paid: true });
    await transitionBooking(desk, second.id, 'CHECKED_IN', { roomId: h.rooms[1].id });
    await transitionBooking(manager, second.id, 'CHECKED_OUT', { balanceOverride: { reason: 'Billed to Acme Corp' } });
    expect(await prisma.checkoutOverride.count({ where: { bookingId: second.id } })).toBe(0);
    expect((await getFolio(desk.actor, second.id)).checkoutOverride).toBeNull();
  });

  it('a room type of a shared reservation records what the reservation owed', async () => {
    const { h, desk, manager, queen, total } = await sharedReservation();
    await recordCashPayment(desk, queen.id, { kind: 'PAYMENT', amount: 100 });
    await transitionBooking(desk, queen.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    await expect(transitionBooking(desk, queen.id, 'CHECKED_OUT')).rejects.toThrow(/on reservation/);
    await transitionBooking(manager, queen.id, 'CHECKED_OUT', { balanceOverride: { reason: 'Group billed to the tour operator' } });
    const override = await prisma.checkoutOverride.findUniqueOrThrow({ where: { bookingId: queen.id } });
    expect(Number(override.amount)).toBe(total - 100);
  });
});

describe('refund with an allowance', () => {
  /** A stay paid in full online (240.00), refunded by whoever is signed in. */
  async function paidOnline() {
    const s = await setup();
    const intent = `pi_test_${uid()}`;
    const payment = await prisma.payment.create({
      data: { bookingId: s.booking.id, propertyId: s.h.property.id, method: 'ONLINE', kind: 'FULL', status: 'SUCCEEDED', amount: 240, currency: 'usd', stripePaymentIntentId: intent, paidAt: new Date() },
    });
    await prisma.booking.update({ where: { id: s.booking.id }, data: { paymentStatus: 'PAID' } });
    session.userId = s.managerUser.id;
    return { ...s, intent, payment };
  }

  beforeEach(() => {
    stripe.refunded.clear();
    stripe.byKey.clear();
    stripe.hooks.duringRefund = null;
    stripe.api.refunds.create.mockClear();
    session.userId = null;
  });

  it('sent twice at once (a double click, two tabs): refunded once, one allowance', async () => {
    const { desk, booking, payment } = await paidOnline();
    const results = await Promise.allSettled([
      refundPayment(booking.id, { paymentId: payment.id, amount: 40, reason: 'Pool closed both days', allowance: true }),
      refundPayment(booking.id, { paymentId: payment.id, amount: 40, reason: 'Pool closed both days', allowance: true }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect([...stripe.refunded.values()]).toEqual([4000]);
    expect(await prisma.folioAllowance.count({ where: { bookingId: booking.id, voidedAt: null } })).toBe(1);
    expect(await summaryOf(desk.actor, booking.id)).toMatchObject({ allowances: 40, amountPaid: 200, balance: 0 });
  });

  it('when the guest already has a credit, refunds it as it is (no second allowance)', async () => {
    const { desk, manager, booking, payment } = await paidOnline();
    await addAllowance(manager, booking.id, { amount: 40, reason: 'Air conditioning broken' });
    expect((await summaryOf(desk.actor, booking.id)).balance).toBe(-40);
    await expect(refundPayment(booking.id, { paymentId: payment.id, amount: 40, reason: 'Air conditioning broken', allowance: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/credit of 40\.00 USD/) });
    expect(stripe.api.refunds.create).not.toHaveBeenCalled();
    await refundPayment(booking.id, { paymentId: payment.id, amount: 40 });
    expect(await summaryOf(desk.actor, booking.id)).toMatchObject({ allowances: 40, balance: 0 });
  });

  it('if another allowance takes the charges off while the refund is at Stripe, the refund stands and says so', async () => {
    const { desk, manager, booking, payment } = await paidOnline();
    stripe.hooks.duringRefund = async () => {
      await addAllowance(manager, booking.id, { amount: 220, reason: 'Rate correction' });
    };
    const result = await refundPayment(booking.id, { paymentId: payment.id, amount: 40, reason: 'Pool closed', allowance: true });
    expect(result).toMatchObject({ refunded: 40, allowanceError: expect.stringMatching(/refund went through/) });
    expect(Number((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountRefunded)).toBe(40);
    expect((await summaryOf(desk.actor, booking.id)).allowances).toBe(220);
  });

  it('lowers what the stay costs by the refunded amount, so nothing is owed again', async () => {
    const { h, desk, managerUser, booking, intent, payment } = await paidOnline();
    const result = await refundPayment(booking.id, { paymentId: payment.id, amount: 40, reason: 'Pool closed both days', allowance: true });
    expect(result).toEqual({ refunded: 40, remaining: 200 });
    expect(stripe.api.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: intent, amount: 4000 }), expect.anything());

    const summary = await summaryOf(desk.actor, booking.id);
    expect(summary).toMatchObject({ allowances: 40, amountPaid: 200, balance: 0, checkOutDue: 0 });
    const folio = await getFolio(desk.actor, booking.id);
    expect(folio.totals).toEqual({ charges: 240, allowances: 40, paid: 240, refunded: 40, balance: 0 });
    expect(folio.allowances).toMatchObject([{ amount: 40, reason: 'Pool closed both days', by: `Test ${managerUser.lastName}` }]);
    expect(await audits(h.property.id, 'FOLIO_ALLOWANCE')).toHaveLength(1);

    // Without the allowance, the refunded amount is owed again.
    await refundPayment(booking.id, { paymentId: payment.id, amount: 10 });
    expect(await summaryOf(desk.actor, booking.id)).toMatchObject({ allowances: 40, balance: 10 });
  });

  it('says why itself when no reason is given', async () => {
    const { desk, booking, payment } = await paidOnline();
    await refundPayment(booking.id, { paymentId: payment.id, amount: 25, allowance: true });
    expect((await getFolio(desk.actor, booking.id)).allowances).toMatchObject([{ amount: 25, reason: 'Refunded to the card' }]);
  });

  it('refuses taking more off than is owed before any money moves', async () => {
    const { desk, manager, booking, payment } = await paidOnline();
    await addAllowance(manager, booking.id, { amount: 220, reason: 'Rate correction' });
    // The charges are already 220 lower than what was paid: another allowance would take the same money off twice.
    await expect(refundPayment(booking.id, { paymentId: payment.id, amount: 30, allowance: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/credit of 220\.00 USD/) });
    expect(stripe.api.refunds.create).not.toHaveBeenCalled();
    expect(Number((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountRefunded)).toBe(0);
    expect((await summaryOf(desk.actor, booking.id)).allowances).toBe(220);

    // Refunding the credit as it is works.
    await refundPayment(booking.id, { paymentId: payment.id, amount: 220 });
    expect(stripe.api.refunds.create).toHaveBeenCalledTimes(1);
    expect(await summaryOf(desk.actor, booking.id)).toMatchObject({ allowances: 220, balance: 0 });
  });

  it('refuses a reason the allowance wouldn’t take, or a card number, before any money moves', async () => {
    const { desk, booking, payment } = await paidOnline();
    await expect(refundPayment(booking.id, { paymentId: payment.id, amount: 40, reason: 'ok', allowance: true })).rejects.toMatchObject({ status: 400 });
    await expect(refundPayment(booking.id, { paymentId: payment.id, amount: 40, reason: 'card 4242 4242 4242 4242', allowance: true })).rejects.toMatchObject({ status: 400 });
    await expect(refundPayment(booking.id, { paymentId: payment.id, amount: 40, reason: 'card 4242 4242 4242 4242' })).rejects.toMatchObject({ status: 400 });
    expect(stripe.api.refunds.create).not.toHaveBeenCalled();
    expect((await summaryOf(desk.actor, booking.id)).balance).toBe(0);
  });

  it('refuses a closed reservation before any money moves', async () => {
    const { desk, booking, payment } = await paidOnline();
    await transitionBooking(desk, booking.id, 'CANCELLED');
    await expect(refundPayment(booking.id, { paymentId: payment.id, amount: 40, allowance: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/closed/) });
    expect(stripe.api.refunds.create).not.toHaveBeenCalled();
    // A plain refund of the cancelled stay still works.
    await refundPayment(booking.id, { paymentId: payment.id, amount: 40 });
    expect(stripe.api.refunds.create).toHaveBeenCalledTimes(1);
    expect(await prisma.folioAllowance.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('the front desk can’t refund, with or without an allowance', async () => {
    const { deskUser, booking, payment } = await paidOnline();
    session.userId = deskUser.id;
    await expect(refundPayment(booking.id, { paymentId: payment.id, amount: 40, allowance: true })).rejects.toMatchObject({ status: 403 });
    expect(stripe.api.refunds.create).not.toHaveBeenCalled();
    expect(await prisma.folioAllowance.count({ where: { bookingId: booking.id } })).toBe(0);
  });
});
