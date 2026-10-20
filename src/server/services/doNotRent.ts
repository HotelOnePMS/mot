/**
 * Do Not Rent: each hotel's own list of guests the front desk shouldn't
 * rent to again, with the reason and who added them. Guests are matched on
 * email or phone, so a returning guest is flagged on any new booking, and
 * every booking the front desk sees carries the match (attachDoNotRent).
 *
 * Lists are per hotel: a guest barred at one hotel is not flagged at another,
 * even in the same group.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { BookingSummary, DoNotRentEntry, DoNotRentMatch } from '@/lib/dto';
import { emailKey, phoneKey } from '@/lib/doNotRent';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { badRequest, conflict, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { personName } from './mappers';

const entrySelect = {
  id: true,
  propertyId: true,
  guestName: true,
  email: true,
  phone: true,
  reason: true,
  createdAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DoNotRentSelect;

type EntryRow = Prisma.DoNotRentGetPayload<{ select: typeof entrySelect }>;

function toEntry(r: EntryRow): DoNotRentEntry {
  return {
    id: r.id,
    propertyId: r.propertyId,
    guestName: r.guestName,
    email: r.email,
    phone: r.phone,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    createdBy: { id: r.createdBy.id, name: personName(r.createdBy) },
  };
}

function toMatch(e: DoNotRentEntry): DoNotRentMatch {
  return { id: e.id, guestName: e.guestName, reason: e.reason, createdAt: e.createdAt, createdBy: e.createdBy };
}

export async function listDoNotRent(actor: Actor, propertyId: string): Promise<DoNotRentEntry[]> {
  requirePermission(actor, 'dnr.view');
  assertPropertyAccess(actor, propertyId);
  const rows = await prisma.doNotRent.findMany({ where: { propertyId }, select: entrySelect, orderBy: { createdAt: 'desc' } });
  return rows.map(toEntry);
}

export interface AddDoNotRentInput {
  propertyId: string;
  guestName: string;
  email?: string | null;
  phone?: string | null;
  reason: string;
  /** The reservation it was added from, for its history. */
  bookingId?: string | null;
}

export async function addDoNotRent(ctx: OpContext, input: AddDoNotRentInput): Promise<DoNotRentEntry> {
  requirePermission(ctx.actor, 'dnr.manage');
  assertPropertyAccess(ctx.actor, input.propertyId);
  const guestName = input.guestName.trim();
  const reason = input.reason.trim();
  const email = emailKey(input.email);
  const phone = input.phone?.trim() || null;
  const key = phoneKey(phone);
  if (!guestName) throw badRequest('Enter the guest’s name.');
  if (!reason) throw badRequest('Add a note saying why, so the next shift knows.');
  if (reason.length > 1000) throw badRequest('Notes are limited to 1000 characters.');
  if (!email && !key) throw badRequest('Add the guest’s email or phone number, so we can recognise them next time.');

  const existing = await findMatches(input.propertyId, [{ email, phoneKey: key }]);
  if (existing[0]) throw conflict(`${existing[0].guestName} is already on the Do Not Rent list.`);

  const row = await prisma.doNotRent.create({
    data: { propertyId: input.propertyId, guestName, email, phone: key ? phone : null, phoneKey: key, reason, createdById: ctx.actor.userId },
    select: entrySelect,
  });
  await recordAudit(ctx, input.propertyId, 'DNR_ADD', `Added ${guestName} to the Do Not Rent list: “${reason.slice(0, 80)}”`, {
    dnrId: row.id,
    ...(input.bookingId ? { bookingId: input.bookingId } : {}),
  });
  return toEntry(row);
}

export async function removeDoNotRent(ctx: OpContext, id: string): Promise<{ id: string }> {
  requirePermission(ctx.actor, 'dnr.manage');
  const row = await prisma.doNotRent.findUnique({ where: { id }, select: { id: true, propertyId: true, guestName: true } });
  if (!row) throw notFound('Do Not Rent entry');
  assertPropertyAccess(ctx.actor, row.propertyId);
  await prisma.doNotRent.delete({ where: { id } });
  await recordAudit(ctx, row.propertyId, 'DNR_REMOVE', `Removed ${row.guestName} from the Do Not Rent list`, { dnrId: id });
  return { id };
}

/** Is this guest on the hotel's list? For the New reservation form, before the booking exists. */
export async function checkDoNotRent(actor: Actor, propertyId: string, guest: { email?: string | null; phone?: string | null }): Promise<DoNotRentMatch | null> {
  requirePermission(actor, 'dnr.view');
  assertPropertyAccess(actor, propertyId);
  const [match] = await findMatches(propertyId, [{ email: emailKey(guest.email), phoneKey: phoneKey(guest.phone) }]);
  return match ? toMatch(match) : null;
}

/** Entries matching any of these guests, oldest first. */
async function findMatches(propertyId: string, guests: { email: string | null; phoneKey: string | null }[]): Promise<DoNotRentEntry[]> {
  const emails = [...new Set(guests.map((g) => g.email).filter((e): e is string => !!e))];
  const phones = [...new Set(guests.map((g) => g.phoneKey).filter((p): p is string => !!p))];
  if (!emails.length && !phones.length) return [];
  const rows = await prisma.doNotRent.findMany({
    where: {
      propertyId,
      OR: [...(emails.length ? [{ email: { in: emails } }] : []), ...(phones.length ? [{ phoneKey: { in: phones } }] : [])],
    },
    select: entrySelect,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toEntry);
}

/** Fill `doNotRent` on each booking whose guest is on its hotel's list. One query per hotel. */
export async function attachDoNotRent<T extends BookingSummary>(bookings: T[]): Promise<T[]> {
  const byProperty = new Map<string, T[]>();
  for (const b of bookings) byProperty.set(b.propertyId, [...(byProperty.get(b.propertyId) ?? []), b]);
  const matched = new Map<string, DoNotRentMatch>();
  await Promise.all(
    [...byProperty].map(async ([propertyId, list]) => {
      const entries = await findMatches(
        propertyId,
        list.map((b) => ({ email: emailKey(b.guest.email), phoneKey: phoneKey(b.guest.phone) })),
      );
      if (!entries.length) return;
      for (const b of list) {
        const email = emailKey(b.guest.email);
        const phone = phoneKey(b.guest.phone);
        const hit = entries.find((e) => (email && emailKey(e.email) === email) || (phone && phoneKey(e.phone) === phone));
        if (hit) matched.set(b.id, toMatch(hit));
      }
    }),
  );
  return bookings.map((b) => (matched.has(b.id) ? { ...b, doNotRent: matched.get(b.id)! } : b));
}

export async function attachDoNotRentOne<T extends BookingSummary>(booking: T): Promise<T> {
  const [b] = await attachDoNotRent([booking]);
  return b;
}
