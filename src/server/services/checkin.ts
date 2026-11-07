/**
 * Guided check-in: the guest's photo ID (scanned or typed, with a photo), the
 * room, the folio, a security deposit, and the registration card the guest
 * signs on the desk's device; then the booking is checked in.
 *
 * Everything commits together with the check-in itself: the records are
 * written inside transitionBooking's transaction (its date, room and
 * permission rules are reused, not copied), so a failed check-in leaves no
 * half-saved ID or deposit. A booking someone already checked in (the agent,
 * a walk-in, the old dialog) can have the same records added afterwards.
 *
 * What is kept: the ID's type, country, last four characters, expiry and the
 * name on it in clear; the full number, date of birth and address sealed with
 * the vault; the front photo sealed in its own table. Both sealed parts are
 * deleted after the retention period (CARD_AUTH_ID_PHOTO_DAYS after
 * check-out, longer while a dispute is open). The registration card is kept as
 * signed, like a paper card: its exact wording (the home address printed on it
 * included), the signature, and the record its hash covers. Nothing goes into the booking's status
 * history beyond "Checked in", because guests read it on their booking page.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { BookingSummary, ISODate } from '@/lib/dto';
import { COUNTRY_CODES, ID_TYPES, ID_TYPE_LABEL, countryName, typedSignatureMatches, type IdType } from '@/lib/card-authorization';
import { depositDueCents, depositHeldCents, type DeskPaymentLike, type SecurityDepositMode } from '@/lib/desk-payments';
import { formatClock } from '@/lib/format';
import { fromCents, toCents } from '@/lib/payments';
import { idLast4Of, idWarnings } from '@/lib/guest-id';
import { REGISTRATION_VERSION, registrationCardText, type RegistrationDeposit } from '@/lib/registration-card';
import { money } from '@/lib/status';
import { can, requirePermission, type Actor } from '../authz';
import { HOTEL_POLICY, runsOnHotelOne } from '../concierge/facts';
import { atNoonUTC, toISODate } from '../dates';
import { badRequest, conflict, notFound } from '../errors';
import { logError } from '../log';
import { MAX_ID_PHOTO_BYTES, MAX_SIGNATURE_BYTES, idPhotoRetentionDays, idRetentionOver, parseImageDataUrl } from '../payments/cardAuthorization';
import { paymentLines } from '../payments/record';
import { hashPolicy } from '../payments/policy';
import { open, seal, sha256, vaultAvailable } from '../vault';
import { recordAudit, type OpContext } from './audit';
import { checkTransition, getBookingForStaff, transitionBooking } from './bookings';
import { todayAt } from './hotels';
import { personName, toBookingSummary, type BookingWithRelations } from './mappers';

const DAY = 86_400_000;
const detailsAad = (id: string) => `guest-id:${id}`;
const photoAad = (id: string) => `guest-id-photo:${id}`;

export type IdSource = 'SCAN_AAMVA' | 'SCAN_MRZ' | 'MANUAL';

export interface GuestIdInput {
  source: IdSource;
  idType: IdType;
  nameOnId: string;
  documentNumber: string;
  /** Two-letter country that issued the ID. */
  country: string;
  region?: string | null;
  expiresOn?: string | null;
  dateOfBirth?: string | null;
  address?: { line1: string; city: string; region: string; postalCode: string; country: string | null } | null;
  sex?: 'M' | 'F' | 'X' | null;
  nationality?: string | null;
  /** The front of the ID as a data URL (required when the vault is set up). */
  photo?: string | null;
  /** Staff looked at the ID and the person in front of them: it's theirs. */
  confirmed: boolean;
  /** Why staff accepted an expired ID, a different name or a minor. */
  overrideReason?: string | null;
}

/**
 * The security deposit on the registration card: the one already held for the reservation (taken through the
 * desk payments flow: card reader, typed card, cash, the hotel's own terminal), or none, with a reason when
 * the hotel's policy asks for one.
 */
export type DepositChoice = { kind: 'HELD' } | { kind: 'NONE'; reason?: string | null };

export interface RegistrationDraft {
  /** The room the guest is checking into (null once checked in: their current room). */
  roomId: string | null;
  guestAddress: string | null;
  id: { idType: IdType; country: string | null; last4: string };
  deposit: DepositChoice;
}

export interface GuidedCheckInInput {
  id: GuestIdInput;
  roomId?: string | null;
  allowDirtyRoom?: boolean;
  deposit: DepositChoice;
  guestAddress?: string | null;
  registration: { textHash: string; signature: { method: 'DRAWN'; image: string } | { method: 'TYPED'; text: string } };
}

export interface CheckInRecordSummary {
  id: {
    source: string;
    idType: string;
    country: string | null;
    region: string | null;
    last4: string;
    expiresOn: string | null;
    nameOnId: string;
    nameMatched: boolean;
    adult: boolean | null;
    confirmedBy: string | null;
    at: string;
    photo: boolean;
    sealed: boolean;
    purgedAt: string | null;
  } | null;
  registration: {
    signedAt: string;
    guestName: string;
    signatureMethod: string;
    signatureImage: string | null;
    witnessedBy: string | null;
    text: string;
    textVersion: string;
    documentHash: string;
  } | null;
}

export interface CheckInContext {
  booking: BookingSummary;
  /** CHECK_IN: the guest arrives now. RECORD: already checked in; add the ID and registration card. */
  mode: 'CHECK_IN' | 'RECORD';
  /** Why it can't happen right now (wrong day, wrong status), before staff collect anything. */
  blocked: string | null;
  recorded: CheckInRecordSummary;
  /** False without the vault: the ID is recorded without a photo or sealed details. */
  idPhotos: boolean;
  /** The hotel's deposit policy and what is held for the reservation (desk payments, server/payments/desk.ts). */
  deposit: { mode: SecurityDepositMode; amount: number; held: number; due: number };
  checkOutTime: string;
  /** From the guest's profile, to prefill the registration card. */
  guestAddress: string | null;
  today: ISODate;
  can: { viewId: boolean; collect: boolean };
}

async function checkOutTimeFor(propertyId: string): Promise<string> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { setupPath: true, voiceAgent: { select: { checkOutTime: true } } } });
  if (runsOnHotelOne(p?.setupPath)) return HOTEL_POLICY.checkOut;
  return p?.voiceAgent?.checkOutTime ? `by ${formatClock(p.voiceAgent.checkOutTime)}` : 'by the hotel’s check-out time';
}

function profileAddress(u: { address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null; country?: string | null } | null): string | null {
  if (!u) return null;
  const line = [u.address, [u.city, u.state, u.zipCode].filter(Boolean).join(' '), u.country].map((p) => p?.trim()).filter(Boolean).join(', ');
  return line || null;
}

async function recordSummary(bookingId: string): Promise<CheckInRecordSummary> {
  const [gid, card] = await Promise.all([
    prisma.guestIdentification.findUnique({ where: { bookingId }, include: { photo: { select: { guestIdentificationId: true } } } }),
    prisma.registrationCard.findUnique({ where: { bookingId } }),
  ]);
  const ids = [gid?.confirmedById, card?.witnessedById].filter((id): id is string => !!id);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const nameOf = (id: string | null | undefined) => {
    const u = users.find((x) => x.id === id);
    return u ? personName(u) : null;
  };
  return {
    id: gid
      ? {
          source: gid.source,
          idType: gid.idType,
          country: gid.idCountry,
          region: gid.idRegion,
          last4: gid.idLast4,
          expiresOn: gid.expiresOn ? toISODate(gid.expiresOn) : null,
          nameOnId: gid.nameOnId,
          nameMatched: gid.nameMatched,
          adult: gid.adult,
          confirmedBy: nameOf(gid.confirmedById),
          at: gid.createdAt.toISOString(),
          photo: !!gid.photo,
          sealed: !!gid.detailsCipher,
          purgedAt: gid.purgedAt?.toISOString() ?? null,
        }
      : null,
    registration: card
      ? {
          signedAt: card.signedAt.toISOString(),
          guestName: card.guestName,
          signatureMethod: card.signatureMethod,
          signatureImage: card.signatureImage,
          witnessedBy: nameOf(card.witnessedById),
          text: card.text,
          textVersion: card.textVersion,
          documentHash: card.documentHash,
        }
      : null,
  };
}

/** Everything the check-in screen needs before staff start. */
export async function getCheckInContext(actor: Actor, bookingId: string): Promise<CheckInContext> {
  requirePermission(actor, 'booking.checkin');
  const booking = await getBookingForStaff(actor, bookingId);
  const mode = booking.status === 'CHECKED_IN' ? 'RECORD' : 'CHECK_IN';
  const check = mode === 'CHECK_IN' ? await checkTransition(actor, booking, 'CHECKED_IN') : { ok: true as const };
  const [recorded, deposit, checkOutTime, user, today] = await Promise.all([
    recordSummary(booking.id),
    depositState(booking),
    checkOutTimeFor(booking.propertyId),
    prisma.user.findUnique({ where: { id: booking.userId }, select: { address: true, city: true, state: true, zipCode: true, country: true } }),
    todayAt(booking.propertyId),
  ]);
  return {
    booking: toBookingSummary(booking),
    mode,
    blocked: !check.ok ? check.reason : ['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(booking.status) ? 'This reservation isn’t arriving or in house.' : null,
    recorded,
    idPhotos: vaultAvailable(),
    deposit: { mode: deposit.mode, amount: deposit.amount, held: deposit.held, due: deposit.due },
    checkOutTime,
    guestAddress: profileAddress(user),
    today,
    can: { viewId: can(actor, 'guestId.view'), collect: can(actor, 'payments.collect') },
  };
}

/** The hotel's deposit policy, and the security deposit held for the reservation (on its lead line). */
async function depositState(booking: BookingWithRelations) {
  const lines = await paymentLines(booking);
  const [property, payments] = await Promise.all([
    prisma.property.findUniqueOrThrow({ where: { id: booking.propertyId }, select: { securityDepositMode: true, securityDepositAmount: true } }),
    prisma.payment.findMany({ where: { bookingId: { in: lines.map((l) => l.id) }, kind: 'SECURITY_DEPOSIT' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const likes: DeskPaymentLike[] = payments.map((p) => ({
    kind: p.kind,
    status: p.status,
    settled: !!p.settledAt,
    amountCents: toCents(Number(p.amount)),
    authorizedCents: p.amountAuthorized === null ? null : toCents(Number(p.amountAuthorized)),
    refundedCents: toCents(Number(p.amountRefunded)),
  }));
  const mode = property.securityDepositMode as SecurityDepositMode;
  const amountCents = toCents(Number(property.securityDepositAmount));
  // Each deposit still held, oldest first, with what it holds now: they're listed one by one on the registration card.
  const stillHeld = payments
    .filter((p) => !p.settledAt && (p.status === 'AUTHORIZED' || p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED'))
    .map((p) => ({ payment: p, heldCents: p.status === 'AUTHORIZED' ? toCents(Number(p.amountAuthorized ?? p.amount)) : toCents(Number(p.amount)) - toCents(Number(p.amountRefunded)) }))
    .filter((d) => d.heldCents > 0)
    .reverse();
  return { mode, amount: fromCents(amountCents), held: fromCents(depositHeldCents(likes)), due: fromCents(depositDueCents({ mode, amountCents, payments: likes })), stillHeld };
}

const CARD_METHODS = ['TERMINAL', 'CARD_ENTRY', 'VIRTUAL_CARD', 'EXTERNAL_CARD'];

/** The deposits as the registration card states them. */
async function depositsForCard(booking: BookingWithRelations, choice: DepositChoice): Promise<RegistrationDeposit[]> {
  if (choice.kind === 'NONE') return [];
  const state = await depositState(booking);
  if (!state.stillHeld.length) throw badRequest('No security deposit is held yet. Take it first, or choose to check in without one.');
  return state.stillHeld.map(({ payment: d, heldCents }) => ({
    kind: d.status === 'AUTHORIZED' ? 'CARD_HOLD' : d.method === 'CASH' ? 'CASH' : CARD_METHODS.includes(d.method) ? 'CARD_CHARGE' : 'OTHER',
    amount: fromCents(heldCents),
    cardBrand: d.cardBrand,
    cardLast4: d.cardLast4,
  }));
}

async function roomNumberFor(booking: BookingWithRelations, roomId: string | null): Promise<string> {
  if (!roomId) {
    if (booking.room) return booking.room.roomNumber;
    throw badRequest('Choose a room first.');
  }
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { propertyId: true, roomNumber: true } });
  if (!room || room.propertyId !== booking.propertyId) throw notFound('Room');
  return room.roomNumber;
}

async function registrationFor(booking: BookingWithRelations, draft: RegistrationDraft): Promise<{ text: string; textHash: string; deposits: RegistrationDeposit[] }> {
  const s = toBookingSummary(booking);
  const deposits = await depositsForCard(booking, draft.deposit);
  const p = await prisma.property.findUnique({ where: { id: booking.propertyId }, select: { name: true, address: true, city: true, state: true, zipCode: true } });
  if (!p) throw notFound('Property');
  const text = registrationCardText({
    hotelName: p.name,
    hotelAddress: [p.address, [p.city, p.state, p.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    bookingCode: s.code,
    guestName: s.guest.name,
    guestAddress: draft.guestAddress?.replace(/\s+/g, ' ').trim() || null,
    checkIn: s.checkIn,
    checkOut: s.checkOut,
    nights: s.nights,
    guests: s.guests,
    roomNumber: await roomNumberFor(booking, draft.roomId),
    roomTypeName: s.roomType.name,
    currency: s.currency,
    stayTotal: s.totalPrice,
    allowances: s.allowances,
    paid: s.amountPaid,
    balance: s.balance,
    deposits,
    id: { typeLabel: ID_TYPE_LABEL[draft.id.idType] ?? 'Photo ID', country: draft.id.country ? countryName(draft.id.country) || null : null, last4: draft.id.last4 },
    checkOutTime: await checkOutTimeFor(booking.propertyId),
  });
  return { text, textHash: hashPolicy(REGISTRATION_VERSION, text), deposits };
}

/** The registration card the guest is about to sign, exactly as it will be stored. */
export async function previewRegistration(actor: Actor, bookingId: string, draft: RegistrationDraft): Promise<{ text: string; textHash: string; version: string }> {
  requirePermission(actor, 'booking.checkin');
  const booking = await getBookingForStaff(actor, bookingId);
  // Already checked in (by someone else since the screen opened, too): the card names the room the guest is in, as the
  // check-in itself will (completeGuidedCheckIn), so the two always agree.
  const forBooking = booking.status === 'CHECKED_IN' ? { ...draft, roomId: null } : draft;
  return { ...(await registrationFor(booking, forBooking)), version: REGISTRATION_VERSION };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function cleanId(input: GuestIdInput, guestName: string, today: string) {
  if (!ID_TYPES.includes(input.idType)) throw badRequest('Choose the type of ID.');
  const nameOnId = input.nameOnId.replace(/\s+/g, ' ').trim();
  if (nameOnId.length < 2) throw badRequest('Enter the name as it appears on the ID.');
  const number = input.documentNumber.replace(/\s+/g, '').toUpperCase();
  if (idLast4Of(number).length < 4 || number.length > 30) throw badRequest('Enter the ID number.');
  const country = input.country.trim().toUpperCase();
  if (!COUNTRY_CODES.includes(country)) throw badRequest('Choose the country that issued the ID.');
  for (const [label, v] of [['expiry date', input.expiresOn], ['date of birth', input.dateOfBirth]] as const) {
    if (v && !ISO_DAY.test(v)) throw badRequest(`Check the ${label}.`);
  }
  if (!input.confirmed) throw badRequest('Look at the ID and confirm it belongs to the guest in front of you.');
  const warnings = idWarnings({ nameOnId, guestName, expiresOn: input.expiresOn ?? null, dateOfBirth: input.dateOfBirth ?? null, today });
  const reason = input.overrideReason?.replace(/\s+/g, ' ').trim() || null;
  if (warnings.needsReason && (!reason || reason.length < 3)) throw badRequest(`${warnings.messages.join(' ')} Say why you’re accepting it.`);
  return { nameOnId, number, last4: idLast4Of(number), country, region: input.region?.trim().toUpperCase().slice(0, 10) || null, warnings, reason };
}

/**
 * Check the guest in with everything recorded, or add the records to a stay that's already checked in.
 * The client sends the registration card's hash from the preview: a change in between (a payment, a
 * different room) means the guest re-reads the card.
 */
export async function completeGuidedCheckIn(
  ctx: OpContext,
  bookingId: string,
  input: GuidedCheckInInput,
  meta: { ip: string; userAgent: string | null },
): Promise<{ booking: BookingSummary; effects: string[] }> {
  requirePermission(ctx.actor, 'booking.checkin');
  const booking = await getBookingForStaff(ctx.actor, bookingId);
  const mode = booking.status === 'CHECKED_IN' ? 'RECORD' : 'CHECK_IN';
  if (mode === 'CHECK_IN') {
    const check = await checkTransition(ctx.actor, booking, 'CHECKED_IN');
    if (!check.ok) throw badRequest(check.reason);
  } else if (await prisma.registrationCard.findUnique({ where: { bookingId: booking.id }, select: { bookingId: true } })) {
    throw conflict('The registration card for this stay is already signed.');
  }
  const summary = toBookingSummary(booking);
  const today = await todayAt(booking.propertyId);
  const id = cleanId(input.id, summary.guest.name, today);

  const photos = vaultAvailable();
  if (photos && !input.id.photo) throw badRequest('Add a photo of the front of the ID.');
  const photo = photos && input.id.photo ? parseImageDataUrl(input.id.photo, ['image/jpeg', 'image/png', 'image/webp'], MAX_ID_PHOTO_BYTES, 'The ID photo') : null;

  const sig = input.registration.signature;
  let signatureImage: string | null = null;
  let signatureDigest: string;
  if (sig.method === 'DRAWN') {
    signatureImage = sig.image;
    signatureDigest = sha256(parseImageDataUrl(sig.image, ['image/png'], MAX_SIGNATURE_BYTES, 'The signature').bytes.toString('base64'));
  } else {
    if (!typedSignatureMatches(sig.text, summary.guest.name) && !typedSignatureMatches(sig.text, id.nameOnId)) throw badRequest('To sign by typing, the guest types their full name as it is on the reservation or the ID.');
    signatureDigest = sha256(sig.text.trim());
  }

  // Without a deposit where the hotel asks for one: staff say why, and it's logged. A hotel that asks for none needs neither.
  let waived = false;
  if (input.deposit.kind === 'NONE') {
    const state = await depositState(booking);
    waived = state.due > 0 && state.held <= 0;
    if (waived && (input.deposit.reason?.trim().length ?? 0) < 3) {
      throw badRequest(`This hotel takes a security deposit of ${money(state.amount, { currency: booking.currency })}. Take it, or say why this guest checks in without one.`);
    }
  }
  const draft: RegistrationDraft = { roomId: mode === 'CHECK_IN' ? (input.roomId ?? null) : null, guestAddress: input.guestAddress ?? null, id: { idType: input.id.idType, country: id.country, last4: id.last4 }, deposit: input.deposit };
  const card = await registrationFor(booking, draft);
  if (card.textHash !== input.registration.textHash) {
    throw conflict('Something on the registration card changed (a payment, the room or the deposit). Show the guest the updated card and sign again.', { cardChanged: true });
  }

  const gidId = randomUUID();
  const signedAt = new Date();
  const photoDigest = photo ? sha256(photo.bytes.toString('base64')) : null;
  // Everything signed, stored as is next to its hash so the hash can be checked later. A typed signature is the guest's
  // typed name, kept in clear here; a drawn one is stored as the image (signatureImage) and named by its hash.
  const signedRecord = JSON.stringify({
    v: 1,
    bookingId: booking.id,
    textVersion: REGISTRATION_VERSION,
    textHash: card.textHash,
    guest: summary.guest.name,
    id: { type: input.id.idType, country: id.country, last4: id.last4, photoSha256: photoDigest },
    deposits: card.deposits,
    signature: sig.method === 'DRAWN' ? { method: sig.method, sha256: signatureDigest } : { method: sig.method, text: sig.text.trim() },
    signedAt: signedAt.toISOString(),
    ip: meta.ip,
    witnessedById: ctx.actor.userId,
  });
  const documentHash = sha256(signedRecord);
  const sealed = photos
    ? seal({ documentNumber: id.number, dateOfBirth: input.id.dateOfBirth ?? null, address: input.id.address ?? null, sex: input.id.sex ?? null, nationality: input.id.nationality ?? null }, detailsAad(gidId))
    : null;

  const write = async (tx: Prisma.TransactionClient) => {
    await tx.guestIdentification.create({
      data: {
        id: gidId,
        bookingId: booking.id,
        propertyId: booking.propertyId,
        source: input.id.source,
        idType: input.id.idType,
        idCountry: id.country,
        idRegion: id.region,
        idLast4: id.last4,
        expiresOn: input.id.expiresOn ? atNoonUTC(input.id.expiresOn) : null,
        nameOnId: id.nameOnId,
        nameMatched: id.warnings.nameMatched,
        adult: id.warnings.minor === null ? null : !id.warnings.minor,
        confirmedById: ctx.actor.userId,
        detailsCipher: sealed,
        ...(photo ? { photo: { create: { mime: photo.mime, sha256: photoDigest!, cipher: seal(photo.bytes.toString('base64'), photoAad(gidId)) } } } : {}),
      },
    });
    await tx.registrationCard.create({
      data: {
        bookingId: booking.id,
        propertyId: booking.propertyId,
        textVersion: REGISTRATION_VERSION,
        text: card.text,
        textHash: card.textHash,
        guestName: summary.guest.name,
        signatureMethod: sig.method,
        signatureImage,
        signedAt,
        signedIp: meta.ip,
        signedUserAgent: meta.userAgent?.slice(0, 400) ?? null,
        witnessedById: ctx.actor.userId,
        documentHash,
        signedRecord,
      },
    });
  };

  let result: { booking: BookingSummary; effects: string[] };
  try {
    if (mode === 'CHECK_IN') {
      if (!input.roomId) throw badRequest('Choose a room first.');
      const r = await transitionBooking(ctx, booking.id, 'CHECKED_IN', { roomId: input.roomId, allowDirtyRoom: input.allowDirtyRoom, note: 'Guided check-in', inTransaction: write });
      result = { booking: r.booking, effects: r.effects };
    } else {
      await prisma.$transaction(write);
      result = { booking: toBookingSummary(await getBookingForStaff(ctx.actor, booking.id)), effects: [] };
    }
  } catch (e) {
    // Saved a moment ago from another screen (or a retried request): one ID and one registration card per stay.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('The photo ID and registration card for this stay were just saved from another screen.');
    throw e;
  }

  const idText = `${ID_TYPE_LABEL[input.id.idType] ?? 'ID'} (${id.country}, ending ${id.last4})`;
  await recordAudit(ctx, booking.propertyId, 'GUEST_ID_RECORDED', `Checked ${summary.guest.name}’s ${idText}${id.reason ? ` — accepted: ${id.reason}` : ''}`, { bookingId: booking.id });
  await recordAudit(ctx, booking.propertyId, 'REGISTRATION_SIGNED', `${summary.guest.name} signed the registration card (${sig.method === 'DRAWN' ? 'drawn' : 'typed'} signature)`, { bookingId: booking.id });
  if (waived && input.deposit.kind === 'NONE') {
    await recordAudit(ctx, booking.propertyId, 'DEPOSIT_WAIVED', `Checked in without a security deposit (${summary.code})${input.deposit.reason?.trim() ? `: ${input.deposit.reason.trim().slice(0, 200)}` : ''}`, { bookingId: booking.id });
  }
  // Old ID photos and sealed details are cleared now and then (and by the hold-release cron).
  if (Math.random() < 0.05) purgeExpiredGuestIds().catch((e) => logError('services/checkin', 'Guest ID purge failed:', e));
  return result;
}

/** The check-in records of a booking, for the reservation page. */
export async function getCheckInRecord(actor: Actor, bookingId: string): Promise<CheckInRecordSummary> {
  requirePermission(actor, 'booking.view');
  const booking = await getBookingForStaff(actor, bookingId);
  return recordSummary(booking.id);
}

/** The sealed ID details (full number, date of birth, address), for someone allowed to see them. Every view is logged. */
export async function revealGuestIdDetails(ctx: OpContext, bookingId: string) {
  requirePermission(ctx.actor, 'guestId.view');
  const booking = await getBookingForStaff(ctx.actor, bookingId);
  const gid = await prisma.guestIdentification.findUnique({ where: { bookingId: booking.id } });
  if (!gid) throw notFound('Guest ID');
  if (!gid.detailsCipher) throw notFound(gid.purgedAt ? 'ID details (deleted after the retention period)' : 'ID details');
  const details = open<{ documentNumber: string; dateOfBirth: string | null; address: GuestIdInput['address']; sex: string | null; nationality: string | null }>(gid.detailsCipher, detailsAad(gid.id));
  await recordAudit(ctx, booking.propertyId, 'GUEST_ID_VIEWED', `Viewed the full ID details of ${toBookingSummary(booking).guest.name}`, { bookingId: booking.id });
  return details;
}

/** The front photo of the guest's ID. Every view is logged. */
export async function readGuestIdPhoto(ctx: OpContext, bookingId: string): Promise<{ mime: string; bytes: Buffer }> {
  requirePermission(ctx.actor, 'guestId.view');
  const booking = await getBookingForStaff(ctx.actor, bookingId);
  const gid = await prisma.guestIdentification.findUnique({ where: { bookingId: booking.id }, include: { photo: true } });
  if (!gid?.photo) throw notFound(gid?.purgedAt ? 'ID photo (deleted after the retention period)' : 'ID photo');
  const bytes = Buffer.from(open<string>(gid.photo.cipher, photoAad(gid.id)), 'base64');
  await recordAudit(ctx, booking.propertyId, 'GUEST_ID_VIEWED', `Viewed ${toBookingSummary(booking).guest.name}’s ID photo`, { bookingId: booking.id });
  return { mime: gid.photo.mime, bytes };
}

/** Delete ID photos and sealed details past the retention period, keeping any whose booking has an open dispute. */
export async function purgeExpiredGuestIds(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - idPhotoRetentionDays() * DAY);
  const due = await prisma.guestIdentification.findMany({
    where: { purgedAt: null, booking: idRetentionOver(cutoff) },
    select: { id: true },
    take: 500,
  });
  if (!due.length) return 0;
  const ids = due.map((d) => d.id);
  await prisma.$transaction([
    prisma.guestIdentificationPhoto.deleteMany({ where: { guestIdentificationId: { in: ids } } }),
    prisma.guestIdentification.updateMany({ where: { id: { in: ids } }, data: { detailsCipher: null, purgedAt: now } }),
  ]);
  return ids.length;
}
