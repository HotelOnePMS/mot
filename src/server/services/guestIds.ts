/**
 * Guest ID photos taken at check-in. Images are encrypted with the vault key
 * and stored with the reservation; they are never public and are only served
 * through /api/admin/guest-ids/[docId], which checks the role and property
 * and records who looked. Each hotel chooses whether check-in needs one and
 * how long they are kept after the stay (purgeExpiredGuestIds, run daily).
 */
import type { GuestIdSide, GuestIdType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addDaysISO, atNoonUTC, toISODate } from '../dates';
import { assertPropertyAccess, can, requirePermission, type Actor } from '../authz';
import { badRequest, notFound } from '../errors';
import { openBytes, sealBytes, vaultAvailable } from '../vault';
import { recordAudit, type OpContext } from './audit';
import { getBookingForStaff } from './bookings';
import { todayAt } from './hotels';

export const MAX_GUEST_ID_BYTES = 2_500_000;
export const MAX_GUEST_IDS_PER_BOOKING = 10;
export const MAX_GUEST_ID_RETENTION_DAYS = 365;

const TYPE_LABEL: Record<GuestIdType, string> = {
  DRIVERS_LICENSE: 'Driver’s licence',
  PASSPORT: 'Passport',
  NATIONAL_ID: 'National ID card',
  OTHER: 'Other ID',
};

export interface GuestIdDoc {
  id: string;
  type: GuestIdType;
  typeLabel: string;
  side: GuestIdSide;
  nameOnId: string | null;
  numberLast4: string | null;
  expiresOn: string | null;
  sizeBytes: number;
  createdAt: string;
  capturedBy: string | null;
}

export interface GuestIdState {
  documents: GuestIdDoc[];
  /** The hotel refuses check-in until an ID is on the reservation. */
  required: boolean;
  retentionDays: number;
  /** ISO day the photos will be deleted (null while the stay hasn't ended or is still checked in). */
  deletesOn: string | null;
  /** Photos can be stored on this deployment (the vault key is set). */
  available: boolean;
  canCapture: boolean;
  canDelete: boolean;
}

export interface GuestIdSettings {
  requireGuestId: boolean;
  guestIdRetentionDays: number;
}

const aad = (bookingId: string) => `guest-id:${bookingId}`;

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** A data URL from the browser to bytes, accepting only JPEG, PNG and WebP whose contents match. */
export function decodeIdImage(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw badRequest('Send the ID as a JPEG, PNG or WebP photo.');
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) throw badRequest('The photo is empty.');
  if (bytes.length > MAX_GUEST_ID_BYTES) throw badRequest('That photo is too large. Retake it, or upload one under 2.5 MB.');
  if (!MAGIC[m[1]](bytes)) throw badRequest('That file isn’t a readable image.');
  return { mimeType: m[1], bytes };
}

async function names(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
}

function deletesOn(booking: { status: string; checkOut: Date }, retentionDays: number): string | null {
  if (booking.status === 'CHECKED_IN') return null;
  return addDaysISO(toISODate(booking.checkOut), retentionDays + 1);
}

async function state(actor: Actor, bookingId: string): Promise<GuestIdState> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true, checkOut: true, property: { select: { requireGuestId: true, guestIdRetentionDays: true } } },
  });
  const docs = await prisma.guestIdDocument.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true, side: true, nameOnId: true, numberLast4: true, expiresOn: true, sizeBytes: true, createdAt: true, capturedById: true },
  });
  const who = await names(docs.map((d) => d.capturedById));
  return {
    documents: docs.map(({ capturedById, createdAt, ...d }) => ({
      ...d,
      typeLabel: TYPE_LABEL[d.type],
      createdAt: createdAt.toISOString(),
      capturedBy: capturedById ? (who.get(capturedById) ?? null) : null,
    })),
    required: booking.property.requireGuestId,
    retentionDays: booking.property.guestIdRetentionDays,
    deletesOn: deletesOn(booking, booking.property.guestIdRetentionDays),
    available: vaultAvailable(),
    canCapture: can(actor, 'guestid.capture'),
    canDelete: can(actor, 'guestid.delete'),
  };
}

export async function listGuestIds(actor: Actor, bookingIdOrCode: string): Promise<GuestIdState> {
  requirePermission(actor, 'guestid.view');
  const booking = await getBookingForStaff(actor, bookingIdOrCode);
  return state(actor, booking.id);
}

export interface AddGuestIdInput {
  image: string;
  type: GuestIdType;
  side: GuestIdSide;
  nameOnId?: string | null;
  numberLast4?: string | null;
  expiresOn?: string | null;
}

export async function addGuestId(ctx: OpContext, bookingIdOrCode: string, input: AddGuestIdInput): Promise<GuestIdState> {
  requirePermission(ctx.actor, 'guestid.capture');
  const booking = await getBookingForStaff(ctx.actor, bookingIdOrCode);
  if (['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(booking.status)) {
    throw badRequest('IDs can be added only before or during the stay.');
  }
  if (!vaultAvailable()) throw badRequest('ID photos can’t be stored yet: the encryption key (HOTELONE_VAULT_KEY) isn’t set on this deployment.');
  const count = await prisma.guestIdDocument.count({ where: { bookingId: booking.id } });
  if (count >= MAX_GUEST_IDS_PER_BOOKING) throw badRequest(`A reservation can hold up to ${MAX_GUEST_IDS_PER_BOOKING} ID photos. Delete one first.`);
  const { mimeType, bytes } = decodeIdImage(input.image);
  const last4 = input.numberLast4?.replace(/\s/g, '').slice(-4) || null;
  const doc = await prisma.guestIdDocument.create({
    data: {
      bookingId: booking.id,
      propertyId: booking.propertyId,
      type: input.type,
      side: input.side,
      nameOnId: input.nameOnId?.trim().slice(0, 120) || null,
      numberLast4: last4,
      expiresOn: input.expiresOn || null,
      mimeType,
      sizeBytes: bytes.length,
      encrypted: new Uint8Array(sealBytes(bytes, aad(booking.id))),
      capturedById: ctx.actor.userId,
    },
    select: { id: true },
  });
  await recordAudit(ctx, booking.propertyId, 'GUEST_ID_ADDED', `Added ${TYPE_LABEL[input.type].toLowerCase()} (${input.side.toLowerCase()}) to ${booking.code ?? 'booking'}`, {
    bookingId: booking.id,
    documentId: doc.id,
  });
  return state(ctx.actor, booking.id);
}

async function loadDoc(actor: Actor, docId: string) {
  const doc = await prisma.guestIdDocument.findUnique({ where: { id: docId }, include: { booking: { select: { code: true } } } });
  if (!doc) throw notFound('ID photo');
  assertPropertyAccess(actor, doc.propertyId);
  return doc;
}

/** The decrypted image. Every view is written to the activity log. */
export async function readGuestIdImage(ctx: OpContext, docId: string): Promise<{ mimeType: string; bytes: Buffer }> {
  requirePermission(ctx.actor, 'guestid.view');
  const doc = await loadDoc(ctx.actor, docId);
  const bytes = openBytes(doc.encrypted, aad(doc.bookingId));
  await recordAudit(ctx, doc.propertyId, 'GUEST_ID_VIEWED', `Viewed ${TYPE_LABEL[doc.type].toLowerCase()} on ${doc.booking.code ?? 'booking'}`, {
    bookingId: doc.bookingId,
    documentId: doc.id,
  });
  return { mimeType: doc.mimeType, bytes };
}

export async function deleteGuestId(ctx: OpContext, docId: string): Promise<GuestIdState> {
  requirePermission(ctx.actor, 'guestid.delete');
  const doc = await loadDoc(ctx.actor, docId);
  await prisma.guestIdDocument.delete({ where: { id: doc.id } });
  await recordAudit(ctx, doc.propertyId, 'GUEST_ID_DELETED', `Deleted ${TYPE_LABEL[doc.type].toLowerCase()} from ${doc.booking.code ?? 'booking'}`, {
    bookingId: doc.bookingId,
    documentId: doc.id,
  });
  return state(ctx.actor, doc.bookingId);
}

export async function getGuestIdSettings(actor: Actor, propertyId: string): Promise<GuestIdSettings> {
  requirePermission(actor, 'guestid.view');
  assertPropertyAccess(actor, propertyId);
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { requireGuestId: true, guestIdRetentionDays: true } });
  if (!p) throw notFound('Property');
  return p;
}

export async function setGuestIdSettings(ctx: OpContext, propertyId: string, input: GuestIdSettings): Promise<GuestIdSettings> {
  requirePermission(ctx.actor, 'guestid.manage');
  assertPropertyAccess(ctx.actor, propertyId);
  const days = Math.trunc(input.guestIdRetentionDays);
  if (!(days >= 0 && days <= MAX_GUEST_ID_RETENTION_DAYS)) throw badRequest(`Keep ID photos between 0 and ${MAX_GUEST_ID_RETENTION_DAYS} days.`);
  const before = await prisma.property.findUnique({ where: { id: propertyId }, select: { requireGuestId: true, guestIdRetentionDays: true } });
  if (!before) throw notFound('Property');
  const after = await prisma.property.update({
    where: { id: propertyId },
    data: { requireGuestId: input.requireGuestId, guestIdRetentionDays: days },
    select: { requireGuestId: true, guestIdRetentionDays: true },
  });
  await recordAudit(ctx, propertyId, 'GUEST_ID_SETTINGS', `Guest ID photos: ${after.requireGuestId ? 'required' : 'optional'} at check-in, kept ${days} day${days === 1 ? '' : 's'} after the stay`, {
    from: before,
    to: after,
  });
  // A shorter retention takes effect now, not at the next daily run.
  await purgeExpiredGuestIds({ propertyIds: [propertyId] });
  return after;
}

/**
 * Deletes ID photos whose stay ended more than the hotel's retention days ago
 * (guests still checked in keep theirs). Returns how many were deleted.
 */
export async function purgeExpiredGuestIds(opts: { propertyIds?: string[] } = {}): Promise<number> {
  const properties = await prisma.property.findMany({
    where: { ...(opts.propertyIds ? { id: { in: opts.propertyIds } } : {}), guestIdDocuments: { some: {} } },
    select: { id: true, guestIdRetentionDays: true },
  });
  let deleted = 0;
  for (const p of properties) {
    const cutoff = addDaysISO(await todayAt(p.id), -p.guestIdRetentionDays);
    const r = await prisma.guestIdDocument.deleteMany({
      where: { propertyId: p.id, booking: { checkOut: { lt: atNoonUTC(cutoff) }, status: { not: 'CHECKED_IN' } } },
    });
    deleted += r.count;
  }
  return deleted;
}
