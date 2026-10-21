import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { refreshEvidence } from '@/server/payments/disputes';
import { recordCashPayment, recordExternalPayment } from '@/server/payments/desk';
import { checkTransition, createReservation, getBookingForStaff, transitionBooking } from '@/server/services/bookings';
import { completeGuidedCheckIn, getCheckInContext, getCheckInRecord, previewRegistration, purgeExpiredGuestIds, readGuestIdPhoto, type GuidedCheckInInput } from '@/server/services/checkin';
import { getFolio } from '@/server/services/folio';
import { toBookingSummary } from '@/server/services/mappers';
import { createDeskReservation } from '@/server/services/reservations';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

// 1×1 PNG, and the start of a JPEG (only the first bytes are checked).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 1, 2, 3, 4]);
const JPEG = `data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}`;
const meta = { ip: '203.0.113.9', userAgent: 'vitest' };

async function setup(opts: { deposit?: 'NONE' | 'CHARGE'; paid?: boolean } = {}) {
  const h = await makeHotel({ basePrice: 120 });
  await prisma.property.update({ where: { id: h.property.id }, data: { securityDepositMode: opts.deposit ?? 'NONE', securityDepositAmount: opts.deposit === 'CHARGE' ? 100 : 0 } });
  const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
  const actor = await actorFor(desk.id);
  const op = { actor, source: 'classic' as const };
  const booking = await createDeskReservation(op, {
    propertyId: h.property.id,
    roomTypeId: h.roomType.id,
    checkIn: h.today,
    checkOut: addDaysISO(h.today, 2),
    guests: 1,
    rooms: 1,
    guest: { firstName: 'Mia', lastName: 'Ortiz' },
    paid: opts.paid,
  });
  return { h, actor, op, booking };
}

const guestId = (over: Partial<GuidedCheckInInput['id']> = {}): GuidedCheckInInput['id'] => ({
  source: 'MANUAL',
  idType: 'DRIVERS_LICENSE',
  nameOnId: 'Mia Ortiz',
  documentNumber: 'D1234567',
  country: 'US',
  region: 'CA',
  expiresOn: '2030-01-31',
  dateOfBirth: '1990-04-02',
  photo: JPEG,
  confirmed: true,
  ...over,
});

async function sign(op: Parameters<typeof completeGuidedCheckIn>[0], bookingId: string, roomId: string | null, deposit: GuidedCheckInInput['deposit'], id = guestId()) {
  const preview = await previewRegistration(op.actor, bookingId, { roomId, guestAddress: '4 Elm St, Santa Cruz', id: { idType: id.idType, country: id.country, last4: id.documentNumber.slice(-4) }, deposit });
  const input: GuidedCheckInInput = { id, roomId, deposit, guestAddress: '4 Elm St, Santa Cruz', registration: { textHash: preview.textHash, signature: { method: 'DRAWN', image: PNG } } };
  return { preview, input };
}

describe('guided check-in', () => {
  it('records the ID, the room and the signed registration card with the check-in', async () => {
    const { h, actor, op, booking } = await setup({ paid: true });
    const ctx = await getCheckInContext(actor, booking.id);
    expect(ctx).toMatchObject({ mode: 'CHECK_IN', blocked: null, idPhotos: true, deposit: { mode: 'NONE', due: 0, held: 0 } });

    const { preview, input } = await sign(op, booking.id, h.rooms[0].id, { kind: 'NONE' });
    expect(preview.text).toContain('Photo ID: Driver’s license issued in United States, number ending 4567.');
    expect(preview.text).toContain('room 101 (Queen)');
    expect(preview.text).toContain('Nothing left to pay for the room.');
    expect(preview.text).toContain('No security deposit was taken.');
    expect(preview.text).not.toContain('D1234567');

    const done = await completeGuidedCheckIn(op, booking.id, input, meta);
    expect(done.booking.status).toBe('CHECKED_IN');
    expect(done.booking.room?.number).toBe('101');

    const record = await getCheckInRecord(actor, booking.id);
    expect(record.id).toMatchObject({ idType: 'DRIVERS_LICENSE', country: 'US', last4: '4567', nameMatched: true, adult: true, photo: true, sealed: true });
    expect(record.registration).toMatchObject({ guestName: 'Mia Ortiz', signatureMethod: 'DRAWN', text: preview.text });
    // The full number is only in the sealed details, never in clear.
    const row = await prisma.guestIdentification.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(JSON.stringify(row)).not.toContain('D1234567');
    const photo = await readGuestIdPhoto(op, booking.id);
    expect(photo.bytes.equals(JPEG_BYTES)).toBe(true);
    // Guests read the status history: it says checked in and nothing about the ID.
    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
    expect(JSON.stringify(history)).not.toMatch(/4567|Driver|D1234567/);
  });

  it('refuses a card that changed after the guest read it, and saves nothing', async () => {
    const { h, op, booking } = await setup();
    const { input } = await sign(op, booking.id, h.rooms[0].id, { kind: 'NONE' });
    // A payment lands between the preview and the signature: the balance on the card is now wrong.
    await recordCashPayment(op, booking.id, { kind: 'PAYMENT', amount: 50 });
    await expect(completeGuidedCheckIn(op, booking.id, input, meta)).rejects.toMatchObject({ status: 409 });
    expect((await getBookingForStaff(op.actor, booking.id)).status).toBe('CONFIRMED');
    expect(await prisma.guestIdentification.count({ where: { bookingId: booking.id } })).toBe(0);
    expect(await prisma.registrationCard.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('needs the hotel’s security deposit, or a reason to check in without one', async () => {
    const { h, actor, op, booking } = await setup({ deposit: 'CHARGE', paid: true });
    expect((await getCheckInContext(actor, booking.id)).deposit).toMatchObject({ mode: 'CHARGE', amount: 100, due: 100, held: 0 });

    // Saying a deposit is held when none is.
    await expect(previewRegistration(actor, booking.id, { roomId: h.rooms[0].id, guestAddress: null, id: { idType: 'PASSPORT', country: 'US', last4: '4567' }, deposit: { kind: 'HELD' } })).rejects.toMatchObject({ status: 400 });

    const none = await sign(op, booking.id, h.rooms[0].id, { kind: 'NONE' });
    await expect(completeGuidedCheckIn(op, booking.id, none.input, meta)).rejects.toThrow(/security deposit of \$100\.00/);

    // Taken in cash through the desk payments flow: the card names it.
    await recordCashPayment(op, booking.id, { kind: 'SECURITY_DEPOSIT', amount: 100 });
    const held = await sign(op, booking.id, h.rooms[0].id, { kind: 'HELD' });
    expect(held.preview.text).toContain('Security deposit: $100.00 in cash, returned at check-out less any charges.');
    const done = await completeGuidedCheckIn(op, booking.id, held.input, meta);
    expect(done.booking.status).toBe('CHECKED_IN');
  });

  it('accepts no deposit with a reason, and audits it', async () => {
    const { h, op, booking } = await setup({ deposit: 'CHARGE', paid: true });
    const { input } = await sign(op, booking.id, h.rooms[0].id, { kind: 'NONE', reason: 'Regular corporate guest' });
    await completeGuidedCheckIn(op, booking.id, input, meta);
    const audit = await prisma.agentAuditLog.findFirst({ where: { action: 'DEPOSIT_WAIVED', propertyId: h.property.id } });
    expect(audit?.detail).toMatch(/Regular corporate guest/);
  });

  it('asks why for an expired ID or a different name', async () => {
    const { h, op, booking } = await setup({ paid: true });
    const expired = guestId({ expiresOn: '2020-01-01' });
    const { input } = await sign(op, booking.id, h.rooms[0].id, { kind: 'NONE' }, expired);
    await expect(completeGuidedCheckIn(op, booking.id, input, meta)).rejects.toMatchObject({ status: 400 });
    const withReason = { ...input, id: { ...expired, overrideReason: 'Renewal paperwork shown' } };
    const done = await completeGuidedCheckIn(op, booking.id, withReason, meta);
    expect(done.booking.status).toBe('CHECKED_IN');
  });

  it('adds the ID and registration card to a stay that is already checked in', async () => {
    const { h, actor, op, booking } = await setup({ paid: true });
    await transitionBooking(op, booking.id, 'CHECKED_IN', { roomId: h.rooms[1].id });
    expect((await getCheckInContext(actor, booking.id)).mode).toBe('RECORD');
    const { preview, input } = await sign(op, booking.id, null, { kind: 'NONE' });
    expect(preview.text).toContain('room 102 (Queen)');
    await completeGuidedCheckIn(op, booking.id, input, meta);
    expect((await getCheckInRecord(actor, booking.id)).registration).not.toBeNull();
    // Once only.
    await expect(completeGuidedCheckIn(op, booking.id, input, meta)).rejects.toMatchObject({ status: 409 });
  });
});

describe('check-out needs the balance at zero', () => {
  it('blocks check-out while money is owed, then allows it once paid', async () => {
    const { h, actor, op, booking } = await setup();
    await transitionBooking(op, booking.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    const owed = await getBookingForStaff(actor, booking.id);
    expect(await checkTransition(actor, owed, 'CHECKED_OUT')).toMatchObject({ ok: false, reason: expect.stringMatching(/balance of \$240\.00/) });
    await expect(transitionBooking(op, booking.id, 'CHECKED_OUT')).rejects.toThrow(/balance of \$240\.00/);

    // Part on the hotel's own terminal, the rest another way: both are recorded and count.
    await recordExternalPayment(op, booking.id, { kind: 'PAYMENT', method: 'EXTERNAL_CARD', amount: 200, cardBrand: 'visa', cardLast4: '4242', reference: 'A1B2C3' });
    await expect(recordExternalPayment(op, booking.id, { kind: 'PAYMENT', method: 'OTHER', amount: 40 })).rejects.toMatchObject({ status: 400 });
    await recordExternalPayment(op, booking.id, { kind: 'PAYMENT', method: 'OTHER', amount: 40, note: 'Bank transfer' });

    const folio = await getFolio(actor, booking.id);
    expect(folio.totals).toMatchObject({ charges: 240, paid: 240, balance: 0 });
    expect(folio.settled).toBe(true);
    expect(folio.lines.filter((l) => l.section === 'PAYMENTS').map((l) => l.label)).toEqual(['Paid · Card on another terminal', 'Paid · Paid another way']);
    expect((await getBookingForStaff(actor, booking.id)).paymentStatus).toBe('PAID');

    const out = await transitionBooking(op, booking.id, 'CHECKED_OUT');
    expect(out.booking.status).toBe('CHECKED_OUT');
  });

  it('a held security deposit doesn’t count toward the balance', async () => {
    const { h, actor, op, booking } = await setup({ deposit: 'CHARGE' });
    await recordCashPayment(op, booking.id, { kind: 'SECURITY_DEPOSIT', amount: 100 });
    const folio = await getFolio(actor, booking.id);
    expect(folio.totals.balance).toBe(240);
    expect(folio.depositHeld).toBe(100);
    expect(folio.deposits).toMatchObject([{ method: 'CASH', state: 'HELD', amount: 100 }]);
    await transitionBooking(op, booking.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    await expect(transitionBooking(op, booking.id, 'CHECKED_OUT')).rejects.toThrow(/balance/);
  });

  it('a reservation paid in full at the desk can check out', async () => {
    const { h, actor, op, booking } = await setup({ paid: true });
    expect(toBookingSummary(await getBookingForStaff(actor, booking.id)).balance).toBe(0);
    await transitionBooking(op, booking.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    expect((await transitionBooking(op, booking.id, 'CHECKED_OUT')).booking.status).toBe('CHECKED_OUT');
  });
});

describe('after review', () => {
  it('a room type of a shared reservation can check out once the reservation is paid, even after another was cancelled', async () => {
    const h = await makeHotel({ basePrice: 100 });
    const suite = await prisma.roomType.create({ data: { propertyId: h.property.id, name: 'Suite', capacity: 4, basePrice: 300, totalRooms: 1, amenities: [] } });
    await prisma.room.create({ data: { propertyId: h.property.id, roomTypeId: suite.id, roomNumber: '301', floor: '3', status: 'CLEAN' } });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const op = { actor: await actorFor(desk.id), source: 'classic' as const };
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
    const other = rows.find((r) => r.roomTypeId === suite.id)!;
    // The Suite is cancelled: the reservation now owes the Queen's total.
    await prisma.booking.update({ where: { id: other.id }, data: { status: 'CANCELLED' } });
    await transitionBooking(op, queen.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    const before = toBookingSummary(await getBookingForStaff(op.actor, queen.id));
    expect(before.checkOutDue).toBe(Number(queen.totalPrice));
    await recordCashPayment(op, queen.id, { kind: 'PAYMENT', amount: Number(queen.totalPrice) });
    const after = toBookingSummary(await getBookingForStaff(op.actor, queen.id));
    // Its own share still lags (the payment is spread with the cancelled line), but nothing is left to collect.
    expect(after.checkOutDue).toBe(0);
    expect((await transitionBooking(op, queen.id, 'CHECKED_OUT')).booking.status).toBe('CHECKED_OUT');
  });

  it('a reservation marked paid and resubmitted records its payment once', async () => {
    const h = await makeHotel({ basePrice: 100 });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const op = { actor: await actorFor(desk.id), source: 'classic' as const };
    const guest = await makeUser({ role: 'CUSTOMER' });
    const input = { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: 'Ana', lastName: 'Ruiz', email: guest.email }, paid: true };
    const first = await createDeskReservation(op, input);
    const again = await createDeskReservation(op, input);
    expect(again.id).toBe(first.id);
    expect(await prisma.payment.count({ where: { bookingId: first.id } })).toBe(1);
    expect(toBookingSummary(await getBookingForStaff(op.actor, first.id)).balance).toBe(0);
  });

  it('the backfill skips security deposits, pays a shared reservation on its lead line, and runs once', async () => {
    const sql = readFileSync('prisma/migrations/20261026_guided_check_in/migration.sql', 'utf8');
    const backfill = sql.slice(sql.indexOf('INSERT INTO "payments"'));
    const h = await makeHotel({ basePrice: 100 });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const op = { actor: await actorFor(desk.id), source: 'classic' as const };
    // Paid when booked (before desk payments were recorded), then a cash deposit was taken.
    const single = await createDeskReservation(op, { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: 'Old', lastName: `Paid${uid()}` } });
    await prisma.booking.update({ where: { id: single.id }, data: { paymentStatus: 'PAID' } });
    await recordCashPayment(op, single.id, { kind: 'SECURITY_DEPOSIT', amount: 50 });
    // A shared reservation marked paid, nothing recorded.
    const suite = await prisma.roomType.create({ data: { propertyId: h.property.id, name: 'Suite', capacity: 4, basePrice: 300, totalRooms: 1, amenities: [] } });
    const guest = await makeUser({ role: 'CUSTOMER' });
    const rows = await createReservation({
      userId: guest.id,
      propertyId: h.property.id,
      checkIn: addDaysISO(h.today, 3),
      checkOut: addDaysISO(h.today, 4),
      guests: 3,
      lines: [
        { roomTypeId: h.roomType.id, rooms: 1 },
        { roomTypeId: suite.id, rooms: 1 },
      ],
      paymentStatus: 'PAID',
    });
    const lead = rows.find((r) => r.code === r.groupCode)!;

    await prisma.$executeRawUnsafe(backfill);
    expect(toBookingSummary(await getBookingForStaff(op.actor, single.id)).balance).toBe(0);
    const leadPayments = await prisma.payment.findMany({ where: { bookingId: lead.id } });
    expect(leadPayments.length).toBe(2);
    for (const r of rows) expect(toBookingSummary(await getBookingForStaff(op.actor, r.id)).balance).toBe(0);
    // Again: nothing more.
    await prisma.$executeRawUnsafe(backfill).catch(() => undefined);
    expect(await prisma.payment.count({ where: { bookingId: { in: [single.id, lead.id] }, method: 'OTHER' } })).toBe(3);
  });

  it('a shared reservation’s open dispute keeps every room type’s ID, and its evidence names them', async () => {
    const h = await makeHotel({ basePrice: 100 });
    const suite = await prisma.roomType.create({ data: { propertyId: h.property.id, name: 'Suite', capacity: 4, basePrice: 300, totalRooms: 1, amenities: [] } });
    const suiteRoom = await prisma.room.create({ data: { propertyId: h.property.id, roomTypeId: suite.id, roomNumber: '301', floor: '3', status: 'CLEAN' } });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const op = { actor: await actorFor(desk.id), source: 'classic' as const };
    const guest = await makeUser({ role: 'CUSTOMER' });
    await prisma.user.update({ where: { id: guest.id }, data: { firstName: 'Mia', lastName: 'Ortiz' } });
    const rows = await createReservation({
      userId: guest.id,
      propertyId: h.property.id,
      checkIn: h.today,
      checkOut: addDaysISO(h.today, 1),
      guests: 3,
      lines: [
        { roomTypeId: h.roomType.id, rooms: 1 },
        { roomTypeId: suite.id, rooms: 1 },
      ],
      paymentStatus: 'PAY_AT_PROPERTY',
    });
    const lead = rows.find((r) => r.code === r.groupCode)!;
    const line = rows.find((r) => r.code !== r.groupCode)!;
    const { input } = await sign(op, line.id, line.roomTypeId === suite.id ? suiteRoom.id : h.rooms[0].id, { kind: 'NONE' });
    await completeGuidedCheckIn(op, line.id, input, meta);
    // Staff ticked another checklist item: the recorded ID still counts as "ID matches guest".
    await prisma.bookingChecklist.create({ data: { bookingId: lead.id, cardShownAt: new Date(), cardShownById: op.actor.userId } });
    const dispute = await prisma.dispute.create({ data: { stripeDisputeId: `dp_${uid()}`, bookingId: lead.id, propertyId: h.property.id, amount: 100, status: 'needs_response' } });

    const evidence = await refreshEvidence(dispute.id);
    const text = JSON.stringify(evidence!.summary);
    expect(text).toContain('Photo ID checked at the desk');
    expect(text).toContain('number ending 4567');
    expect(text).not.toMatch(/ID matches guest — not done/);
    expect(text).not.toMatch(/Registration signed — not done/);

    // Long after check-out, the dispute is still open: the Suite line's photo stays.
    const later = new Date(Date.now() + 400 * 86_400_000);
    await purgeExpiredGuestIds(later);
    const kept = await prisma.guestIdentification.findUniqueOrThrow({ where: { bookingId: line.id }, include: { photo: true } });
    expect(kept.purgedAt).toBeNull();
    expect(kept.photo).not.toBeNull();
    await prisma.dispute.update({ where: { id: dispute.id }, data: { closedAt: new Date() } });
    await purgeExpiredGuestIds(later);
    expect((await prisma.guestIdentification.findUniqueOrThrow({ where: { bookingId: line.id } })).purgedAt).not.toBeNull();
  });

  it('two saves of the same record: one wins, the other gets a 409', async () => {
    const { h, op, booking } = await setup({ paid: true });
    await transitionBooking(op, booking.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    const { input } = await sign(op, booking.id, null, { kind: 'NONE' });
    const results = await Promise.allSettled([completeGuidedCheckIn(op, booking.id, input, meta), completeGuidedCheckIn(op, booking.id, input, meta)]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
  });

  it('once someone else checked the guest in, the card names their room and the save goes through', async () => {
    const { h, op, booking } = await setup({ paid: true });
    // The screen picked room 101; meanwhile the guest was checked in to 102.
    await transitionBooking(op, booking.id, 'CHECKED_IN', { roomId: h.rooms[1].id });
    const { preview, input } = await sign(op, booking.id, h.rooms[0].id, { kind: 'NONE' });
    expect(preview.text).toContain('room 102');
    await completeGuidedCheckIn(op, booking.id, input, meta);
  });

  it('lists each deposit as it was taken, and keeps the exact record its hash covers', async () => {
    const { h, actor, op, booking } = await setup({ deposit: 'CHARGE', paid: true });
    await recordCashPayment(op, booking.id, { kind: 'SECURITY_DEPOSIT', amount: 60 });
    await recordExternalPayment(op, booking.id, { kind: 'SECURITY_DEPOSIT', method: 'EXTERNAL_CARD', amount: 40, cardBrand: 'visa', cardLast4: '4242' });
    const { preview, input } = await sign(op, booking.id, h.rooms[0].id, { kind: 'HELD' });
    expect(preview.text).toContain('Security deposits: $60.00 in cash, returned at check-out; $40.00 charged to Visa ending 4242, refunded after check-out; each less any charges.');
    await completeGuidedCheckIn(op, booking.id, { ...input, registration: { textHash: preview.textHash, signature: { method: 'TYPED', text: 'Mia Ortiz' } } }, meta);
    const card = await prisma.registrationCard.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(createHash('sha256').update(card.signedRecord).digest('hex')).toBe(card.documentHash);
    expect(JSON.parse(card.signedRecord)).toMatchObject({ signature: { method: 'TYPED', text: 'Mia Ortiz' }, deposits: [{ kind: 'CASH', amount: 60 }, { kind: 'CARD_CHARGE', amount: 40 }] });
    expect((await getCheckInRecord(actor, booking.id)).registration?.documentHash).toBe(card.documentHash);
  });

  it('refuses a full card number typed into an approval code or note', async () => {
    const { op, booking } = await setup();
    await expect(recordExternalPayment(op, booking.id, { kind: 'PAYMENT', method: 'OTHER', amount: 10, note: 'card 4242 4242 4242 4242' })).rejects.toMatchObject({ status: 400 });
    await expect(recordExternalPayment(op, booking.id, { kind: 'PAYMENT', method: 'EXTERNAL_CARD', amount: 10, cardLast4: '4242', reference: '4111111111111111' })).rejects.toMatchObject({ status: 400 });
    await expect(recordCashPayment(op, booking.id, { kind: 'PAYMENT', amount: 10, note: '5555-5555-5555-4444' })).rejects.toMatchObject({ status: 400 });
    // An ordinary reference is fine.
    await recordExternalPayment(op, booking.id, { kind: 'PAYMENT', method: 'EXTERNAL_CARD', amount: 10, cardLast4: '4242', reference: 'A1B2C3' });
  });

});
