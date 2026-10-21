import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { recordCashPayment, recordExternalPayment } from '@/server/payments/desk';
import { checkTransition, getBookingForStaff, transitionBooking } from '@/server/services/bookings';
import { completeGuidedCheckIn, getCheckInContext, getCheckInRecord, previewRegistration, readGuestIdPhoto, type GuidedCheckInInput } from '@/server/services/checkin';
import { getFolio } from '@/server/services/folio';
import { toBookingSummary } from '@/server/services/mappers';
import { createDeskReservation } from '@/server/services/reservations';
import { actorFor, makeHotel, makeUser } from './fixtures';

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
