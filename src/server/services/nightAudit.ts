/**
 * Night audit: the front desk's end-of-day close, usually run overnight
 * (before noon it opens on yesterday). For one business day at
 * one hotel it gathers what is still open — guests due who never arrived,
 * guests past their check-out still in house, balances not yet settled,
 * rooms not ready — and the day's numbers (rooms sold, occupancy, room
 * revenue, ADR). Closing the day marks the chosen no-shows, optionally
 * flags occupied rooms for stayover cleaning, and saves the report. A day
 * closes once; the report stays in the history.
 */
import type { Prisma } from '@prisma/client';
import type { BookingSummary, ISODate } from '@/lib/dto';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { addDaysISO, atNoonUTC, dayBounds, hourIn, isISODate } from '../dates';
import { badRequest, conflict } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { transitionBooking } from './bookings';
import { occupancySeries } from './frontdesk';
import { hotelLocale, todayAt } from './hotels';
import { bookingInclude, personName, toBookingSummary } from './mappers';

export interface NightAuditPreview {
  propertyId: string;
  businessDate: ISODate;
  /** Today on the hotel's clock (the latest day that can be closed). */
  today: ISODate;
  currency: string;
  closed: NightAuditRecord | null;
  /** Due on or before this day, never checked in: candidates for no-show. */
  noShows: BookingSummary[];
  /** Past their check-out, still checked in. */
  overdueDepartures: BookingSummary[];
  /** In house with something left to pay on their folio. */
  unpaidInHouse: BookingSummary[];
  rooms: { total: number; occupied: number; dirty: number; outOfOrder: number; ready: number };
  numbers: { roomsSold: number; totalRooms: number; occupancyPct: number; roomRevenue: number; adr: number; arrivals: number; departures: number };
  openRequests: number;
  /** The last few closed days. */
  history: NightAuditRecord[];
}

export interface NightAuditRecord {
  id: string;
  businessDate: ISODate;
  closedAt: string;
  closedBy: string;
  notes: string | null;
  summary: NightAuditSummary;
}

export interface NightAuditSummary {
  numbers: NightAuditPreview['numbers'];
  rooms: NightAuditPreview['rooms'];
  noShowsMarked: { code: string; guest: string }[];
  stillOpen: { overdueDepartures: number; unpaidInHouse: number; arrivalsLeft: number; openRequests: number };
  roomsFlaggedForCleaning: number;
  currency: string;
}

function toRecord(a: { id: string; businessDate: Date; closedAt: Date; notes: string | null; summary: Prisma.JsonValue }, names: Map<string, string>, closedById: string): NightAuditRecord {
  return {
    id: a.id,
    businessDate: a.businessDate.toISOString().slice(0, 10),
    closedAt: a.closedAt.toISOString(),
    closedBy: names.get(closedById) ?? 'Someone',
    notes: a.notes,
    summary: a.summary as unknown as NightAuditSummary,
  };
}

async function auditHistory(propertyId: string, take = 7): Promise<NightAuditRecord[]> {
  const rows = await prisma.nightAudit.findMany({ where: { propertyId }, orderBy: { businessDate: 'desc' }, take });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.closedById))] } }, select: { id: true, firstName: true, lastName: true } });
  const names = new Map(users.map((u) => [u.id, personName(u)]));
  return rows.map((r) => toRecord(r, names, r.closedById));
}

export async function nightAuditPreview(actor: Actor, propertyId: string, requested?: ISODate): Promise<NightAuditPreview> {
  requirePermission(actor, 'audit.run');
  assertPropertyAccess(actor, propertyId);
  const [today, locale] = await Promise.all([todayAt(propertyId), hotelLocale(propertyId)]);
  // The audit runs overnight for the day that just ended: before noon at the hotel, that's yesterday.
  const businessDate = requested ?? (hourIn(locale.timezone) < 12 ? addDaysISO(today, -1) : today);
  if (!isISODate(businessDate)) throw badRequest('Choose a day as YYYY-MM-DD.');
  if (businessDate > today) throw badRequest('That day hasn’t happened yet at this hotel.');

  const next = addDaysISO(businessDate, 1);
  const [noShows, overdue, unpaid, rooms, occupiedRooms, series, arrivals, departures, openRequests, history] = await Promise.all([
    prisma.booking.findMany({
      where: { propertyId, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { lt: dayBounds(businessDate).lt } },
      include: bookingInclude,
      orderBy: { checkIn: 'asc' },
    }),
    prisma.booking.findMany({ where: { propertyId, status: 'CHECKED_IN', checkOut: { lt: dayBounds(next).gte } }, include: bookingInclude, orderBy: { checkOut: 'asc' } }),
    // Everyone in house; those with something left to pay are picked below from their folio balance.
    prisma.booking.findMany({ where: { propertyId, status: 'CHECKED_IN' }, include: bookingInclude, orderBy: { checkOut: 'asc' } }),
    prisma.room.findMany({ where: { propertyId }, select: { id: true, status: true, isOutOfOrder: true } }),
    prisma.booking.findMany({
      where: { propertyId, status: 'CHECKED_IN', roomId: { not: null }, checkIn: { lte: atNoonUTC(businessDate) }, checkOut: { gt: atNoonUTC(businessDate) } },
      select: { roomId: true },
    }),
    occupancySeries(propertyId, businessDate, next),
    prisma.booking.count({ where: { propertyId, checkIn: dayBounds(businessDate), status: 'CHECKED_IN' } }),
    prisma.booking.count({ where: { propertyId, checkOut: dayBounds(businessDate), status: 'CHECKED_OUT' } }),
    prisma.guestRequest.count({ where: { propertyId, status: 'NEW' } }),
    auditHistory(propertyId),
  ]);
  const occupied = new Set(occupiedRooms.map((b) => b.roomId));
  const night = series[0];
  const closed = history.find((h) => h.businessDate === businessDate) ?? null;
  return {
    propertyId,
    businessDate,
    today,
    currency: locale.currency,
    closed,
    noShows: noShows.map(toBookingSummary),
    overdueDepartures: overdue.map(toBookingSummary),
    unpaidInHouse: unpaid.map(toBookingSummary).filter((b) => b.balance > 0.004),
    rooms: {
      total: rooms.length,
      occupied: occupied.size,
      dirty: rooms.filter((r) => !r.isOutOfOrder && r.status === 'DIRTY').length,
      outOfOrder: rooms.filter((r) => r.isOutOfOrder).length,
      ready: rooms.filter((r) => !r.isOutOfOrder && (r.status === 'CLEAN' || r.status === 'INSPECTED') && !occupied.has(r.id)).length,
    },
    numbers: {
      roomsSold: night?.roomsSold ?? 0,
      totalRooms: night?.totalRooms ?? 0,
      occupancyPct: night?.occupancyPct ?? 0,
      roomRevenue: night?.revenue ?? 0,
      adr: night?.adr ?? 0,
      arrivals,
      departures,
    },
    openRequests,
    history,
  };
}

/**
 * Close the business day: mark the chosen reservations as no-shows, flag
 * occupied rooms for stayover cleaning if asked, and save the report.
 */
export async function closeBusinessDay(
  ctx: OpContext,
  propertyId: string,
  input: { businessDate: ISODate; noShowBookingIds: string[]; flagOccupiedRooms: boolean; notes?: string | null },
): Promise<NightAuditRecord> {
  const preview = await nightAuditPreview(ctx.actor, propertyId, input.businessDate);
  if (preview.closed) throw conflict(`${input.businessDate} was already closed by ${preview.closed.closedBy}.`);

  const candidates = new Map(preview.noShows.map((b) => [b.id, b]));
  const marked: { code: string; guest: string }[] = [];
  for (const id of new Set(input.noShowBookingIds)) {
    const b = candidates.get(id);
    if (!b) throw badRequest('One of the reservations isn’t an unresolved arrival any more. Refresh and try again.');
    await transitionBooking(ctx, b.id, 'NO_SHOW', { note: `Night audit ${input.businessDate}` });
    marked.push({ code: b.code, guest: b.guest.name });
  }

  let flagged = 0;
  if (input.flagOccupiedRooms) {
    const occupied = await prisma.booking.findMany({
      where: { propertyId, status: 'CHECKED_IN', roomId: { not: null }, checkOut: { gt: atNoonUTC(input.businessDate) } },
      select: { roomId: true },
    });
    const ids = [...new Set(occupied.map((b) => b.roomId!))];
    if (ids.length) {
      const r = await prisma.room.updateMany({ where: { id: { in: ids }, isOutOfOrder: false, status: { not: 'DIRTY' } }, data: { status: 'DIRTY' } });
      flagged = r.count;
    }
  }

  const after = await nightAuditPreview(ctx.actor, propertyId, input.businessDate);
  const summary: NightAuditSummary = {
    numbers: after.numbers,
    rooms: after.rooms,
    noShowsMarked: marked,
    stillOpen: {
      overdueDepartures: after.overdueDepartures.length,
      unpaidInHouse: after.unpaidInHouse.length,
      arrivalsLeft: after.noShows.length,
      openRequests: after.openRequests,
    },
    roomsFlaggedForCleaning: flagged,
    currency: after.currency,
  };
  let row;
  try {
    row = await prisma.nightAudit.create({
      data: { propertyId, businessDate: new Date(`${input.businessDate}T00:00:00Z`), closedById: ctx.actor.userId, summary: summary as unknown as Prisma.InputJsonValue, notes: input.notes?.trim() || null },
    });
  } catch {
    throw conflict(`${input.businessDate} was just closed by someone else.`);
  }
  await recordAudit(
    ctx,
    propertyId,
    'NIGHT_AUDIT',
    `Closed ${input.businessDate}: ${marked.length} no-show${marked.length === 1 ? '' : 's'}, ${summary.numbers.occupancyPct}% occupancy${flagged ? `, ${flagged} rooms flagged for stayover cleaning` : ''}`,
    { nightAuditId: row.id, businessDate: input.businessDate },
  );
  return toRecord(row, new Map([[ctx.actor.userId, ctx.actor.name]]), ctx.actor.userId);
}
