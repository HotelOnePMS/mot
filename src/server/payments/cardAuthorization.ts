/**
 * Third-party card authorization. When the person paying (online, at the
 * desk, or not there at all) isn't the guest checking in, staff send the
 * cardholder a link — by email, as a link to text them, or opened on the
 * desk's own device. The cardholder enters their details and the card's last
 * four digits (checked against the card that paid online), adds a photo of
 * their ID and signs. Staff look at the ID and verify it; a verified
 * authorization satisfies "card shown" on the check-in checklist and goes into
 * dispute evidence.
 *
 * What is kept: the exact wording and its hash, what the cardholder entered,
 * the ID photo (sealed with the vault, deleted CARD_AUTH_ID_PHOTO_DAYS after
 * check-out unless a dispute is open), the signature, IP and device, and a
 * SHA-256 over all of it. Never a card number: only the last four digits.
 *
 * Nothing here writes to the booking's status history: guests read that on
 * their booking page, and it would show them the payer's details.
 */
import type { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import { prisma } from '@/lib/prisma';
import {
  CARD_AUTH_VERSION,
  LINK_TTL_DAYS,
  MAX_CARD_ATTEMPTS,
  cardAuthorizationText,
  cardBrandLabel,
  cardDigitsMatch,
  checksOutcome,
  digits4,
  effectiveStatus,
  evaluateChecks,
  joinNames,
  typedSignatureMatches,
  type CardAuthCheck,
  type CardAuthDisplayStatus,
  type IdType,
} from '@/lib/card-authorization';
import { roundMoney } from '@/lib/currency';
import { fromCents, toCents } from '@/lib/payments';
import { namesMatch } from '@/lib/risk';
import { money } from '@/lib/status';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { assertWithinLimits, CARD_AUTH_IP, recordAttempt } from '../auth/limits';
import { toISODate } from '../dates';
import { DomainError, badRequest, conflict, notFound } from '../errors';
import { isEmailConfigured, sendCardAuthorizationReceipt, sendCardAuthorizationRequest } from '../email';
import { logError } from '../log';
import { publicSiteUrl } from '../public-url';
import { recordAudit, type OpContext } from '../services/audit';
import { getBookingForStaff } from '../services/bookings';
import { personName, toBookingSummary } from '../services/mappers';
import { open, randomToken, seal, sha256, vaultAvailable } from '../vault';
import { hashPolicy } from './policy';
import { paymentLines } from './record';

const DAY = 86_400_000;
const PAID = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const ENDED = ['CANCELLED', 'NO_SHOW'];

/** Decoded size limits. The form shrinks photos before sending (about 0.5 MB); hosts cap request bodies near 4.5 MB. */
export const MAX_ID_PHOTO_BYTES = 2_500_000;
export const MAX_SIGNATURE_BYTES = 300_000;

/** Days after check-out an ID photo is kept (CARD_AUTH_ID_PHOTO_DAYS, default 180), unless a dispute is still open. */
export function idPhotoRetentionDays(): number {
  const n = Number(process.env.CARD_AUTH_ID_PHOTO_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 180;
}

/**
 * Bookings whose ID photos and sealed ID details can be deleted: checked out before `cutoff`, with no open dispute
 * on the booking or on its reservation's lead line (a reservation of several room types is paid, and so disputed, there).
 */
export function idRetentionOver(cutoff: Date): Prisma.BookingWhereInput {
  const noOpenDispute = { disputes: { none: { closedAt: null } } };
  return { checkOut: { lt: cutoff }, ...noOpenDispute, OR: [{ reservationLead: { is: null } }, { reservationLead: { is: noOpenDispute } }] };
}

const tokenHashOf = (token: string) => sha256(`card-auth:${token}`);
const photoAad = (id: string) => `card-auth-id:${id}`;

function linkFor(token: string, origin: string): string {
  return `${publicSiteUrl() ?? origin.replace(/\/$/, '')}/authorize/${token}`;
}

const readableDay = (d: Date) => d.toUTCString().replace(/ \d\d:\d\d:\d\d GMT$/, '');

/** Every line of the reservation (lead first) and what it adds up to, for the booking staff are looking at. */
async function reservationOf(booking: { id: string; groupCode: string | null }) {
  const lines = await paymentLines(booking);
  const lead = lines[0];
  const live = lines.filter((l) => !ENDED.includes(l.status));
  const totalCents = (live.length ? live : lines).reduce((s, l) => s + toCents(Number(l.totalPrice)), 0);
  return { lead, lines, amount: fromCents(totalCents) };
}

/**
 * The card that paid remotely for the reservation (its first successful online or typed-in payment), if any.
 * Security deposits and cards presented at the desk are left out: the cardholder was there.
 */
async function paidCard(leadId: string) {
  return prisma.payment.findFirst({
    where: { bookingId: leadId, status: { in: PAID }, cardLast4: { not: null }, kind: { not: 'SECURITY_DEPOSIT' }, method: { in: ['ONLINE', 'CARD_ENTRY'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, cardBrand: true, cardLast4: true, cardholderName: true, billingCountry: true, billingEmail: true },
  });
}

const ROW_SELECT = {
  id: true,
  bookingId: true,
  propertyId: true,
  status: true,
  expiresAt: true,
  cardholderName: true,
  cardholderEmail: true,
  guestNames: true,
  amount: true,
  currency: true,
  coversIncidentals: true,
  incidentalsLimit: true,
  paymentId: true,
  cardBrand: true,
  cardLast4: true,
  requestedById: true,
  emailedAt: true,
  failedAttempts: true,
  signerName: true,
  signerEmail: true,
  signerPhone: true,
  billingAddress: true,
  signerCardBrand: true,
  signerCardLast4: true,
  idType: true,
  idCountry: true,
  idLast4: true,
  signatureMethod: true,
  signatureImage: true,
  textVersion: true,
  text: true,
  textHash: true,
  documentHash: true,
  checks: true,
  signedAt: true,
  signedIp: true,
  signedUserAgent: true,
  reviewedAt: true,
  reviewedById: true,
  reviewNote: true,
  cancelledAt: true,
  idPhotoPurgedAt: true,
  createdAt: true,
  idPhoto: { select: { authorizationId: true } },
  booking: { select: { code: true, id: true, status: true, checkIn: true, checkOut: true } },
} satisfies Prisma.CardAuthorizationSelect;

type Row = Prisma.CardAuthorizationGetPayload<{ select: typeof ROW_SELECT }>;

export interface BillingAddress {
  line1: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface CardAuthorizationDTO {
  id: string;
  status: CardAuthDisplayStatus;
  createdAt: string;
  expiresAt: string;
  requestedBy: string | null;
  cardholderName: string;
  cardholderEmail: string | null;
  guestNames: string[];
  amount: number;
  currency: string;
  coversIncidentals: boolean;
  incidentalsLimit: number | null;
  /** The card that paid online, which the cardholder's digits were checked against. */
  card: { brand: string | null; last4: string } | null;
  emailedAt: string | null;
  failedAttempts: number;
  signed: {
    name: string;
    email: string | null;
    phone: string | null;
    billingAddress: BillingAddress | null;
    card: { brand: string | null; last4: string | null };
    id: { type: string | null; country: string | null; last4: string | null; photo: boolean; photoPurgedAt: string | null };
    signature: { method: string | null; image: string | null };
    at: string;
    ip: string | null;
    userAgent: string | null;
    text: string | null;
    textVersion: string | null;
    textHash: string | null;
    documentHash: string | null;
  } | null;
  checks: CardAuthCheck[];
  outcome: 'MATCH' | 'REVIEW' | null;
  review: { decision: 'VERIFIED' | 'REJECTED'; at: string; by: string | null; note: string | null } | null;
  cancelledAt: string | null;
}

async function namesById(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, personName(u)]));
}

function toDTO(r: Row, names: Map<string, string>, now = new Date()): CardAuthorizationDTO {
  const checks = (r.checks as unknown as CardAuthCheck[] | null) ?? [];
  const reviewed = r.status === 'VERIFIED' || r.status === 'REJECTED';
  return {
    id: r.id,
    status: effectiveStatus(r, now),
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    requestedBy: names.get(r.requestedById) ?? null,
    cardholderName: r.cardholderName,
    cardholderEmail: r.cardholderEmail,
    guestNames: r.guestNames,
    amount: Number(r.amount),
    currency: r.currency,
    coversIncidentals: r.coversIncidentals,
    incidentalsLimit: r.incidentalsLimit === null ? null : Number(r.incidentalsLimit),
    card: r.cardLast4 ? { brand: r.cardBrand, last4: r.cardLast4 } : null,
    emailedAt: r.emailedAt?.toISOString() ?? null,
    failedAttempts: r.failedAttempts,
    signed: r.signedAt
      ? {
          name: r.signerName ?? '',
          email: r.signerEmail,
          phone: r.signerPhone,
          billingAddress: (r.billingAddress as unknown as BillingAddress | null) ?? null,
          card: { brand: r.signerCardBrand, last4: r.signerCardLast4 },
          id: { type: r.idType, country: r.idCountry, last4: r.idLast4, photo: !!r.idPhoto, photoPurgedAt: r.idPhotoPurgedAt?.toISOString() ?? null },
          signature: { method: r.signatureMethod, image: r.signatureImage },
          at: r.signedAt.toISOString(),
          ip: r.signedIp,
          userAgent: r.signedUserAgent,
          text: r.text,
          textVersion: r.textVersion,
          textHash: r.textHash,
          documentHash: r.documentHash,
        }
      : null,
    checks,
    outcome: r.signedAt ? checksOutcome(checks) : null,
    review: reviewed && r.reviewedAt ? { decision: r.status as 'VERIFIED' | 'REJECTED', at: r.reviewedAt.toISOString(), by: names.get(r.reviewedById ?? '') ?? null, note: r.reviewNote } : null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  };
}

async function toDTOs(rows: Row[]): Promise<CardAuthorizationDTO[]> {
  const names = await namesById(rows.flatMap((r) => [r.requestedById, r.reviewedById]));
  return rows.map((r) => toDTO(r, names));
}

async function loadForStaff(actor: Actor, id: string): Promise<Row> {
  requirePermission(actor, 'booking.cardAuth');
  const row = await prisma.cardAuthorization.findUnique({ where: { id }, select: ROW_SELECT });
  if (!row) throw notFound('Card authorization');
  assertPropertyAccess(actor, row.propertyId);
  return row;
}

/** Staff-only activity entry for something the cardholder did, credited to whoever sent them the request. */
async function systemAudit(row: { propertyId: string; requestedById: string; bookingId: string }, action: string, summary: string, data: Record<string, unknown> = {}) {
  try {
    await prisma.agentAuditLog.create({
      data: { propertyId: row.propertyId, userId: row.requestedById, action, detail: JSON.stringify({ source: 'system', summary, bookingId: row.bookingId, ...data }).slice(0, 4000) },
    });
  } catch (e) {
    logError('payments/cardAuthorization', 'Audit log write failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface CardAuthorizationOverview {
  authorizations: CardAuthorizationDTO[];
  /** Prefilled values for a new request. */
  defaults: { cardholderName: string; cardholderEmail: string; guestNames: string[]; amount: number; currency: string; card: { brand: string | null; last4: string } | null };
  emailEnabled: boolean;
  /** False when the vault isn't configured: the form then asks for ID details without a photo. */
  idPhotos: boolean;
  /** Set when the authorization covers several room types booked together. */
  reservation: { code: string; roomTypes: number } | null;
}

/** A reservation's authorizations, newest first, with what a new request would be prefilled with. */
export async function listCardAuthorizations(actor: Actor, bookingId: string): Promise<CardAuthorizationOverview> {
  requirePermission(actor, 'booking.cardAuth');
  const booking = await getBookingForStaff(actor, bookingId);
  const { lead, lines, amount } = await reservationOf(booking);
  const [rows, payment] = await Promise.all([
    prisma.cardAuthorization.findMany({ where: { bookingId: lead.id }, orderBy: { createdAt: 'desc' }, take: 20, select: ROW_SELECT }),
    paidCard(lead.id),
  ]);
  const guestName = toBookingSummary(booking).guest.name;
  return {
    authorizations: await toDTOs(rows),
    defaults: {
      // Prefill the payer only when Stripe's cardholder isn't the guest.
      cardholderName: payment?.cardholderName && !namesMatch(payment.cardholderName, guestName) ? payment.cardholderName : '',
      cardholderEmail: payment?.billingEmail ?? '',
      guestNames: guestName ? [guestName] : [],
      amount,
      currency: booking.currency,
      card: payment?.cardLast4 ? { brand: payment.cardBrand, last4: payment.cardLast4 } : null,
    },
    emailEnabled: isEmailConfigured(),
    idPhotos: vaultAvailable(),
    reservation: lines.length > 1 ? { code: lead.code ?? lead.id, roomTypes: lines.length } : null,
  };
}

export interface CardAuthorizationRequest {
  cardholderName: string;
  cardholderEmail?: string | null;
  guestNames: string[];
  coversIncidentals: boolean;
  incidentalsLimit?: number | null;
  /** Email the link to the cardholder (needs an email and Resend). */
  sendEmail: boolean;
}

export interface IssuedLink {
  authorization: CardAuthorizationDTO;
  /** The link with its token. Shown once: a new link replaces it. */
  url: string;
  /** The link as a QR code (SVG), for a cardholder at the desk to open on their own phone. */
  qrSvg: string;
  emailed: boolean;
}

async function issued(id: string, url: string, emailed: boolean): Promise<IssuedLink> {
  const row = await prisma.cardAuthorization.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { authorization: (await toDTOs([row]))[0], url, qrSvg, emailed };
}

async function emailLink(row: Row, url: string, hotelName: string): Promise<boolean> {
  if (!row.cardholderEmail) return false;
  const sent = await sendCardAuthorizationRequest({
    to: row.cardholderEmail,
    cardholderName: row.cardholderName,
    propertyName: hotelName,
    bookingCode: row.booking.code ?? row.booking.id,
    guestNames: joinNames(row.guestNames),
    checkIn: toISODate(row.booking.checkIn),
    checkOut: toISODate(row.booking.checkOut),
    amount: money(Number(row.amount), { currency: row.currency }),
    url,
    expires: readableDay(row.expiresAt),
  });
  if (sent) await prisma.cardAuthorization.update({ where: { id: row.id }, data: { emailedAt: new Date() } });
  return sent;
}

async function hotelName(propertyId: string): Promise<string> {
  return (await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } }))?.name ?? 'The hotel';
}

/**
 * Ask a cardholder to authorize a reservation. Any request still waiting for
 * a signature is replaced, so only the newest link works.
 */
export async function requestCardAuthorization(ctx: OpContext, bookingId: string, input: CardAuthorizationRequest, origin: string): Promise<IssuedLink> {
  requirePermission(ctx.actor, 'booking.cardAuth');
  const booking = await getBookingForStaff(ctx.actor, bookingId);
  if (ENDED.includes(booking.status)) throw badRequest('This reservation is cancelled. Reinstate it before asking for a card authorization.');
  const cardholderName = input.cardholderName.replace(/\s+/g, ' ').trim();
  const guestNames = input.guestNames.map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (cardholderName.length < 2) throw badRequest('Enter the cardholder’s name.');
  if (!guestNames.length) throw badRequest('Name at least one guest the card pays for.');
  const email = input.cardholderEmail?.trim() || null;
  if (input.sendEmail && !email) throw badRequest('Add the cardholder’s email to send them the link, or copy the link instead.');

  const { lead, amount } = await reservationOf(booking);
  const payment = await paidCard(lead.id);
  const limit = input.coversIncidentals && input.incidentalsLimit != null ? roundMoney(input.incidentalsLimit, booking.currency) : null;
  const token = randomToken(32);
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    // Only the newest link works.
    await tx.cardAuthorization.updateMany({ where: { bookingId: lead.id, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: now } });
    return tx.cardAuthorization.create({
      data: {
        bookingId: lead.id,
        propertyId: booking.propertyId,
        tokenHash: tokenHashOf(token),
        expiresAt: new Date(now.getTime() + LINK_TTL_DAYS * DAY),
        cardholderName,
        cardholderEmail: email,
        guestNames,
        amount,
        currency: booking.currency,
        coversIncidentals: input.coversIncidentals,
        incidentalsLimit: limit,
        paymentId: payment?.id ?? null,
        cardBrand: payment?.cardBrand ?? null,
        cardLast4: payment?.cardLast4 ?? null,
        requestedById: ctx.actor.userId,
      },
      select: ROW_SELECT,
    });
  });
  const url = linkFor(token, origin);
  const emailed = input.sendEmail ? await emailLink(created, url, booking.property.name) : false;
  await recordAudit(ctx, booking.propertyId, 'CARD_AUTH_REQUESTED', `Asked ${cardholderName} to authorize their card for ${created.booking.code ?? 'the reservation'}${emailed ? ` (emailed to ${email})` : ''}`, { bookingId: booking.id, authorizationId: created.id });
  // Old ID photos are cleared now and then (and by the hold-release cron).
  if (Math.random() < 0.05) purgeExpiredIdPhotos().catch((e) => logError('payments/cardAuthorization', 'ID photo purge failed:', e));
  return issued(created.id, url, emailed);
}

/** A new link for a request that hasn't been signed (the old link stops working), optionally emailed. */
export async function renewCardAuthorizationLink(ctx: OpContext, id: string, opts: { sendEmail: boolean }, origin: string): Promise<IssuedLink> {
  const row = await loadForStaff(ctx.actor, id);
  const status = effectiveStatus(row);
  if (status !== 'PENDING' && status !== 'EXPIRED') throw badRequest('Only a request that hasn’t been signed can get a new link.');
  if (opts.sendEmail && !row.cardholderEmail) throw badRequest('This request has no email address. Copy the link instead.');
  const token = randomToken(32);
  const claimed = await prisma.cardAuthorization.updateMany({
    where: { id, status: 'PENDING' },
    data: { tokenHash: tokenHashOf(token), expiresAt: new Date(Date.now() + LINK_TTL_DAYS * DAY) },
  });
  if (!claimed.count) throw conflict('This request was just signed or cancelled. Reload to see it.');
  const fresh = await prisma.cardAuthorization.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
  const url = linkFor(token, origin);
  const emailed = opts.sendEmail ? await emailLink(fresh, url, await hotelName(row.propertyId)) : false;
  await recordAudit(ctx, row.propertyId, 'CARD_AUTH_LINK_RENEWED', `Made a new card authorization link for ${row.cardholderName}${emailed ? ` and emailed it to ${row.cardholderEmail}` : ''}`, { bookingId: row.bookingId, authorizationId: id });
  return issued(id, url, emailed);
}

export async function cancelCardAuthorization(ctx: OpContext, id: string): Promise<CardAuthorizationDTO> {
  const row = await loadForStaff(ctx.actor, id);
  const done = await prisma.cardAuthorization.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  if (!done.count) throw badRequest('Only a request that hasn’t been signed can be cancelled.');
  await recordAudit(ctx, row.propertyId, 'CARD_AUTH_CANCELLED', `Cancelled the card authorization request to ${row.cardholderName}`, { bookingId: row.bookingId, authorizationId: id });
  return (await toDTOs([await prisma.cardAuthorization.findUniqueOrThrow({ where: { id }, select: ROW_SELECT })]))[0];
}

/** After looking at the ID photo and the checks: verify the authorization, or reject it with a reason. */
export async function reviewCardAuthorization(ctx: OpContext, id: string, input: { decision: 'VERIFY' | 'REJECT'; note?: string | null }): Promise<CardAuthorizationDTO> {
  const row = await loadForStaff(ctx.actor, id);
  const note = input.note?.trim() || null;
  if (input.decision === 'REJECT' && !note) throw badRequest('Say why it’s rejected, for the record.');
  const status = input.decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED';
  const done = await prisma.cardAuthorization.updateMany({ where: { id, status: 'SIGNED' }, data: { status, reviewedAt: new Date(), reviewedById: ctx.actor.userId, reviewNote: note } });
  if (!done.count) throw badRequest('Only a signed authorization waiting for review can be verified or rejected.');
  await recordAudit(
    ctx,
    row.propertyId,
    input.decision === 'VERIFY' ? 'CARD_AUTH_VERIFIED' : 'CARD_AUTH_REJECTED',
    input.decision === 'VERIFY' ? `Verified ${row.signerName ?? row.cardholderName}’s card authorization and ID` : `Rejected ${row.signerName ?? row.cardholderName}’s card authorization: ${note}`,
    { bookingId: row.bookingId, authorizationId: id },
  );
  return (await toDTOs([await prisma.cardAuthorization.findUniqueOrThrow({ where: { id }, select: ROW_SELECT })]))[0];
}

/** The cardholder's ID photo, unsealed for someone allowed to see it. Every view is logged. */
export async function readIdPhoto(ctx: OpContext, id: string): Promise<{ mime: string; bytes: Buffer }> {
  const row = await loadForStaff(ctx.actor, id);
  const photo = await prisma.cardAuthorizationIdPhoto.findUnique({ where: { authorizationId: id } });
  if (!photo) throw notFound(row.idPhotoPurgedAt ? 'ID photo (deleted after the retention period)' : 'ID photo');
  const bytes = Buffer.from(open<string>(photo.cipher, photoAad(id)), 'base64');
  await recordAudit(ctx, row.propertyId, 'CARD_AUTH_ID_VIEWED', `Viewed ${row.signerName ?? row.cardholderName}’s ID photo`, { bookingId: row.bookingId, authorizationId: id });
  return { mime: photo.mime, bytes };
}

/** The newest verified authorization for a reservation, for the check-in checklist. */
export async function verifiedAuthorizationFor(booking: { id: string; groupCode: string | null }) {
  const { lead } = await reservationOf(booking);
  const row = await prisma.cardAuthorization.findFirst({
    where: { bookingId: lead.id, status: 'VERIFIED' },
    orderBy: { reviewedAt: 'desc' },
    select: { signerName: true, reviewedAt: true, reviewedById: true },
  });
  if (!row?.reviewedAt) return null;
  const names = await namesById([row.reviewedById]);
  return { signerName: row.signerName ?? '', at: row.reviewedAt, by: names.get(row.reviewedById ?? '') ?? null };
}

/** Delete ID photos past the retention period (CARD_AUTH_ID_PHOTO_DAYS after check-out), keeping any whose reservation has an open dispute. */
export async function purgeExpiredIdPhotos(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - idPhotoRetentionDays() * DAY);
  const due = await prisma.cardAuthorizationIdPhoto.findMany({
    where: { authorization: { booking: idRetentionOver(cutoff) } },
    select: { authorizationId: true },
    take: 500,
  });
  if (!due.length) return 0;
  const ids = due.map((d) => d.authorizationId);
  await prisma.$transaction([
    prisma.cardAuthorizationIdPhoto.deleteMany({ where: { authorizationId: { in: ids } } }),
    prisma.cardAuthorization.updateMany({ where: { id: { in: ids } }, data: { idPhotoPurgedAt: now } }),
  ]);
  return ids.length;
}

// ---------------------------------------------------------------------------
// The cardholder (public, by link)
// ---------------------------------------------------------------------------

const PUBLIC_SELECT = {
  ...ROW_SELECT,
  property: { select: { name: true, primaryColor: true, phone: true, email: true } },
} satisfies Prisma.CardAuthorizationSelect;

type PublicRow = Prisma.CardAuthorizationGetPayload<{ select: typeof PUBLIC_SELECT }>;

async function findByToken(token: string): Promise<PublicRow | null> {
  if (!token || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  return prisma.cardAuthorization.findUnique({ where: { tokenHash: tokenHashOf(token) }, select: PUBLIC_SELECT });
}

function textFor(row: PublicRow): string {
  return cardAuthorizationText({
    hotelName: row.property.name,
    bookingCode: row.booking.code ?? row.booking.id.slice(-8).toUpperCase(),
    guestNames: row.guestNames,
    checkIn: toISODate(row.booking.checkIn),
    checkOut: toISODate(row.booking.checkOut),
    amount: Number(row.amount),
    currency: row.currency,
    coversIncidentals: row.coversIncidentals,
    incidentalsLimit: row.incidentalsLimit === null ? null : Number(row.incidentalsLimit),
    paidCard: row.cardLast4 ? { brand: row.cardBrand } : null,
  });
}

export interface AuthorizationForm {
  status: CardAuthDisplayStatus;
  hotel: { name: string; primaryColor: string | null; phone: string | null; email: string | null };
  /** When it was signed (signed, verified or rejected forms). */
  signedAt: string | null;
  /** Only while the form can be signed. */
  form: {
    cardholderName: string;
    guestNames: string[];
    bookingCode: string;
    checkIn: string;
    checkOut: string;
    amount: number;
    currency: string;
    coversIncidentals: boolean;
    incidentalsLimit: number | null;
    /** The brand of the card that paid online (the cardholder confirms its last four digits). */
    paidCard: { brand: string | null } | null;
    attemptsLeft: number;
    idPhotoRequired: boolean;
    text: string;
    textVersion: string;
    textHash: string;
    expiresAt: string;
  } | null;
}

/** What the cardholder's link shows. Unknown links are a 404; closed ones say why, without the details. */
export async function getAuthorizationForm(token: string): Promise<AuthorizationForm> {
  const row = await findByToken(token);
  if (!row) throw notFound('Authorization link');
  const status = effectiveStatus(row);
  const p = row.property;
  const base = { status, hotel: { name: p.name, primaryColor: p.primaryColor, phone: p.phone || null, email: p.email }, signedAt: row.signedAt?.toISOString() ?? null };
  if (status !== 'PENDING') return { ...base, form: null };
  const text = textFor(row);
  return {
    ...base,
    form: {
      cardholderName: row.cardholderName,
      guestNames: row.guestNames,
      bookingCode: row.booking.code ?? row.booking.id.slice(-8).toUpperCase(),
      checkIn: toISODate(row.booking.checkIn),
      checkOut: toISODate(row.booking.checkOut),
      amount: Number(row.amount),
      currency: row.currency,
      coversIncidentals: row.coversIncidentals,
      incidentalsLimit: row.incidentalsLimit === null ? null : Number(row.incidentalsLimit),
      paidCard: row.cardLast4 ? { brand: row.cardBrand } : null,
      attemptsLeft: Math.max(0, MAX_CARD_ATTEMPTS - row.failedAttempts),
      idPhotoRequired: vaultAvailable(),
      text,
      textVersion: CARD_AUTH_VERSION,
      textHash: hashPolicy(CARD_AUTH_VERSION, text),
      expiresAt: row.expiresAt.toISOString(),
    },
  };
}

export interface AuthorizationSubmission {
  textHash: string;
  name: string;
  email: string;
  phone?: string | null;
  billing: BillingAddress;
  card: { brand?: string | null; last4: string };
  id: { type: IdType; country: string; last4: string; photo?: string | null };
  signature: { method: 'DRAWN'; image: string } | { method: 'TYPED'; text: string };
}

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** A base64 data URL of an allowed image type, decoded and checked by its first bytes. */
export function parseImageDataUrl(dataUrl: string, allowed: readonly string[], maxBytes: number, what: string): { mime: string; bytes: Buffer } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m || !allowed.includes(m[1])) throw badRequest(`${what} must be a ${allowed.map((t) => t.replace('image/', '').toUpperCase()).join(' or ')} image.`);
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) throw badRequest(`${what} is empty.`);
  if (bytes.length > maxBytes) throw badRequest(`${what} is too large. Try a smaller photo.`);
  if (!MAGIC[m[1]](bytes)) throw badRequest(`${what} isn’t a valid image.`);
  return { mime: m[1], bytes };
}

const CLOSED_MESSAGE: Record<Exclude<CardAuthDisplayStatus, 'PENDING'>, string> = {
  SIGNED: 'This authorization has already been signed. Thank you.',
  VERIFIED: 'This authorization has already been signed. Thank you.',
  REJECTED: 'This authorization was reviewed by the hotel. Contact them if they asked you to sign again.',
  CANCELLED: 'This link was replaced or cancelled by the hotel. Ask them for a new one.',
  LOCKED: 'This link is locked because the card digits didn’t match too many times. Contact the hotel.',
  EXPIRED: 'This link has expired. Ask the hotel for a new one.',
};

export interface SubmitMeta {
  ip: string;
  userAgent: string | null;
}

/**
 * The cardholder signs. The card digits must match the card that paid online
 * (after MAX_CARD_ATTEMPTS wrong tries the link locks); everything else is
 * recorded and compared for staff, who verify the ID.
 */
export async function submitCardAuthorization(token: string, input: AuthorizationSubmission, meta: SubmitMeta): Promise<{ status: 'SIGNED'; signedAt: string; emailed: boolean }> {
  const limits = [CARD_AUTH_IP(meta.ip)];
  await assertWithinLimits(limits, 'Too many attempts from this network. Please wait a while and try again.');
  await recordAttempt(limits, true);

  const row = await findByToken(token);
  if (!row) throw notFound('Authorization link');
  const status = effectiveStatus(row);
  if (status !== 'PENDING') throw new DomainError(410, 'LINK_CLOSED', CLOSED_MESSAGE[status]);
  const text = textFor(row);
  const textHash = hashPolicy(CARD_AUTH_VERSION, text);
  if (input.textHash !== textHash) throw conflict('The hotel changed this request after you opened it. Reload the page to see the current version.');

  const name = input.name.replace(/\s+/g, ' ').trim();
  const last4 = digits4(input.card.last4);
  if (last4.length !== 4) throw badRequest('Enter the last four digits of the card.');
  if (!row.cardLast4 && !input.card.brand) throw badRequest('Choose the type of card.');
  if (!cardDigitsMatch(row.cardLast4, last4)) {
    const after = await prisma.cardAuthorization.update({ where: { id: row.id }, data: { failedAttempts: { increment: 1 } }, select: { failedAttempts: true } });
    const left = MAX_CARD_ATTEMPTS - after.failedAttempts;
    if (left <= 0) {
      await prisma.cardAuthorization.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'LOCKED' } });
      await systemAudit(row, 'CARD_AUTH_LOCKED', `Card authorization link to ${row.cardholderName} locked: card digits didn’t match the card that paid ${MAX_CARD_ATTEMPTS} times`, { authorizationId: row.id });
      throw new DomainError(410, 'LINK_LOCKED', CLOSED_MESSAGE.LOCKED);
    }
    throw badRequest(`Those aren’t the last four digits of the ${cardBrandLabel(row.cardBrand)} card that paid for this reservation. ${left} ${left === 1 ? 'try' : 'tries'} left.`, { attemptsLeft: left });
  }

  const photoRequired = vaultAvailable();
  if (photoRequired && !input.id.photo) throw badRequest('Add a photo of your ID.');
  const photo = photoRequired && input.id.photo ? parseImageDataUrl(input.id.photo, ['image/jpeg', 'image/png', 'image/webp'], MAX_ID_PHOTO_BYTES, 'The ID photo') : null;
  let signatureImage: string | null = null;
  let signatureDigest: string;
  if (input.signature.method === 'DRAWN') {
    const sig = parseImageDataUrl(input.signature.image, ['image/png'], MAX_SIGNATURE_BYTES, 'The signature');
    signatureImage = input.signature.image;
    signatureDigest = sha256(sig.bytes.toString('base64'));
  } else {
    if (!typedSignatureMatches(input.signature.text, name)) throw badRequest('To sign by typing, type your full name exactly as you entered it above.');
    signatureDigest = sha256(input.signature.text.trim());
  }

  const payment = row.paymentId
    ? await prisma.payment.findUnique({ where: { id: row.paymentId }, select: { cardholderName: true, billingCountry: true, billingEmail: true } })
    : null;
  const signerCardBrand = row.cardBrand ?? input.card.brand ?? null;
  const billing: BillingAddress = {
    line1: input.billing.line1.trim(),
    city: input.billing.city.trim(),
    postalCode: input.billing.postalCode.trim().toUpperCase(),
    country: input.billing.country.toUpperCase(),
  };
  const checks = evaluateChecks({
    expected: { cardholderName: row.cardholderName, cardBrand: row.cardBrand, cardLast4: row.cardLast4 },
    payment,
    signed: { name, email: input.email, cardBrand: signerCardBrand, cardLast4: last4, billingCountry: billing.country },
  });
  const signedAt = new Date();
  const signer = {
    name,
    email: input.email.trim().toLowerCase(),
    phone: input.phone?.trim() || null,
    billing,
    card: { brand: signerCardBrand, last4 },
    id: { type: input.id.type, country: input.id.country.toUpperCase(), last4: input.id.last4.trim().toUpperCase() },
  };
  const photoDigest = photo ? sha256(photo.bytes.toString('base64')) : null;
  // Everything that was signed, in a fixed order: any later change to the record would change this hash.
  const documentHash = sha256(
    JSON.stringify({
      v: 1,
      authorizationId: row.id,
      textVersion: CARD_AUTH_VERSION,
      textHash,
      signer,
      idPhotoSha256: photoDigest,
      signature: { method: input.signature.method, sha256: signatureDigest },
      signedAt: signedAt.toISOString(),
      ip: meta.ip,
    }),
  );

  await prisma.$transaction(async (tx) => {
    const done = await tx.cardAuthorization.updateMany({
      where: { id: row.id, status: 'PENDING', expiresAt: { gt: signedAt } },
      data: {
        status: 'SIGNED',
        signerName: signer.name,
        signerEmail: signer.email,
        signerPhone: signer.phone,
        billingAddress: billing as unknown as Prisma.InputJsonValue,
        signerCardBrand,
        signerCardLast4: last4,
        idType: signer.id.type,
        idCountry: signer.id.country,
        idLast4: signer.id.last4,
        signatureMethod: input.signature.method,
        signatureImage,
        textVersion: CARD_AUTH_VERSION,
        text,
        textHash,
        documentHash,
        checks: checks as unknown as Prisma.InputJsonValue,
        signedAt,
        signedIp: meta.ip,
        signedUserAgent: meta.userAgent?.slice(0, 400) ?? null,
      },
    });
    if (!done.count) throw conflict('This form was just signed or closed. Reload the page.');
    if (photo) {
      await tx.cardAuthorizationIdPhoto.create({
        data: { authorizationId: row.id, mime: photo.mime, sha256: photoDigest!, cipher: seal(photo.bytes.toString('base64'), photoAad(row.id)) },
      });
    }
  });

  const outcome = checksOutcome(checks);
  await systemAudit(
    row,
    'CARD_AUTH_SIGNED',
    `${signer.name} signed the card authorization (${cardBrandLabel(signerCardBrand)} ending ${last4})${outcome === 'REVIEW' ? ' — some details don’t match, check before check-in' : ''}`,
    { authorizationId: row.id, outcome },
  );
  const emailed = await sendCardAuthorizationReceipt({
    to: signer.email,
    signerName: signer.name,
    propertyName: row.property.name,
    bookingCode: row.booking.code ?? row.booking.id.slice(-8).toUpperCase(),
    guestNames: joinNames(row.guestNames),
    checkIn: toISODate(row.booking.checkIn),
    checkOut: toISODate(row.booking.checkOut),
    card: `${cardBrandLabel(signerCardBrand)} ending ${last4}`,
    text,
    signedAt: signedAt.toUTCString(),
    documentHash,
  });
  return { status: 'SIGNED', signedAt: signedAt.toISOString(), emailed };
}
