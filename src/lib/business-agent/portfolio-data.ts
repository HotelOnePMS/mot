import { createHash } from 'crypto';
import type { BookingStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addDays, parseBookingDate, toDateString } from '@/lib/date-utils';
import type { AppRole } from '@/lib/routes';
import { scopeProperties, type Actor } from '@/server/authz';
import { HOTEL_TIMEZONE } from '@/server/dates';

/**
 * Read-only data access and hotel KPIs for the AI business advisor.
 *
 * Everything here is scoped to a PortfolioScope built from the signed-in actor:
 * admins see every property, owners see only the properties assigned to them.
 * Callers must never pass property IDs that did not come from the scope.
 */

// Statuses that hold inventory, matching the availability checks in the booking API.
export const ACTIVE_STATUSES: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
]);

const hotelDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOTEL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) of a moment in time, in hotel local time. */
export function toHotelDate(moment: Date): string {
  const parts = Object.fromEntries(hotelDateFormatter.formatToParts(moment).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days since the epoch for a YYYY-MM-DD string; differences give night counts. */
export function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export interface PortfolioScope {
  userId: string;
  role: AppRole;
  propertyIds: string[];
}

export interface RoomTypeInfo {
  id: string;
  propertyId: string;
  name: string;
  capacity: number;
  totalRooms: number;
  basePrice: number;
  isActive: boolean;
}

export interface PropertyInfo {
  id: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  roomTypes: RoomTypeInfo[];
}

export interface BookingRow {
  id: string;
  propertyId: string;
  roomTypeId: string;
  guestRef: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  guests: number;
  totalPrice: number;
  status: BookingStatus;
  createdDate: string;
  updatedDate: string;
}

/** The properties this actor may see; same tenancy rule as every other staff route. */
export async function resolvePortfolioScope(actor: Actor): Promise<PortfolioScope> {
  const properties = await prisma.property.findMany({ where: scopeProperties(actor), select: { id: true } });
  return { userId: actor.userId, role: actor.role, propertyIds: properties.map((p) => p.id) };
}

// A short stable pseudonym so the model can spot repeat guests without seeing who they are.
function guestRef(userId: string): string {
  return 'g-' + createHash('sha256').update(userId).digest('hex').slice(0, 8);
}

export class PortfolioData {
  readonly propertyById: Map<string, PropertyInfo>;
  readonly roomTypeById: Map<string, RoomTypeInfo>;
  private loaded: { from: string; to: string; rows: BookingRow[] } | null = null;

  private constructor(
    readonly scope: PortfolioScope,
    readonly properties: PropertyInfo[],
    readonly today: string,
  ) {
    this.propertyById = new Map(properties.map((p) => [p.id, p]));
    this.roomTypeById = new Map(properties.flatMap((p) => p.roomTypes.map((rt) => [rt.id, rt] as const)));
  }

  static async load(scope: PortfolioScope, now: Date = new Date()): Promise<PortfolioData> {
    const properties = scope.propertyIds.length
      ? await prisma.property.findMany({
          where: { id: { in: scope.propertyIds } },
          select: {
            id: true,
            name: true,
            city: true,
            state: true,
            isActive: true,
            roomTypes: {
              select: { id: true, propertyId: true, name: true, capacity: true, totalRooms: true, basePrice: true, isActive: true },
            },
          },
        })
      : [];

    const byName = <T extends { name: string; id: string }>(a: T, b: T) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

    return new PortfolioData(
      scope,
      properties
        .map((p) => ({
          ...p,
          roomTypes: p.roomTypes.map((rt) => ({ ...rt, basePrice: Number(rt.basePrice) })).sort(byName),
        }))
        .sort(byName),
      toHotelDate(now),
    );
  }

  /** Throws if any ID is outside this portfolio, so tools never widen access. */
  resolvePropertyIds(propertyIds?: string[]): string[] {
    if (!propertyIds || propertyIds.length === 0) {
      return this.properties.map((p) => p.id);
    }
    const unknown = propertyIds.filter((id) => !this.propertyById.has(id));
    if (unknown.length) {
      throw new Error(`Unknown property id(s): ${unknown.join(', ')}. Use the ids from the portfolio snapshot.`);
    }
    return [...new Set(propertyIds)];
  }

  resolveRoomTypeIds(roomTypeIds: string[]): string[] {
    const unknown = roomTypeIds.filter((id) => !this.roomTypeById.has(id));
    if (unknown.length) {
      throw new Error(`Unknown room type id(s): ${unknown.join(', ')}. Use the ids from the portfolio snapshot.`);
    }
    return [...new Set(roomTypeIds)];
  }

  /** Sellable rooms per night across active room types matching the filter. */
  roomsPerNight(filter: { propertyIds?: string[]; roomTypeIds?: string[] } = {}): number {
    let rooms = 0;
    for (const rt of this.roomTypeById.values()) {
      if (!rt.isActive) continue;
      if (filter.propertyIds && !filter.propertyIds.includes(rt.propertyId)) continue;
      if (filter.roomTypeIds && !filter.roomTypeIds.includes(rt.id)) continue;
      rooms += rt.totalRooms;
    }
    return rooms;
  }

  /** Bookings (any status) whose stay overlaps [from, to). Loads lazily and caches a growing window. */
  async bookingsOverlapping(from: string, to: string): Promise<BookingRow[]> {
    if (!this.loaded || from < this.loaded.from || to > this.loaded.to) {
      const windowFrom = this.loaded && this.loaded.from < from ? this.loaded.from : from;
      const windowTo = this.loaded && this.loaded.to > to ? this.loaded.to : to;
      this.loaded = { from: windowFrom, to: windowTo, rows: await this.fetchBookings({ stayFrom: windowFrom, stayTo: windowTo }) };
    }
    return this.loaded.rows.filter((b) => b.checkIn < to && b.checkOut > from);
  }

  /** Bookings (any status) created on hotel-local dates in [from, to). */
  async bookingsCreated(from: string, to: string): Promise<BookingRow[]> {
    const rows = await this.fetchBookings({ createdFrom: from, createdTo: to });
    return rows.filter((b) => b.createdDate >= from && b.createdDate < to);
  }

  private async fetchBookings(range: { stayFrom?: string; stayTo?: string; createdFrom?: string; createdTo?: string }): Promise<BookingRow[]> {
    if (this.properties.length === 0) {
      return [];
    }

    // Query a day wider than needed so stored times that are not exactly UTC noon
    // are still caught; callers filter precisely on calendar dates.
    const where = {
      propertyId: { in: this.properties.map((p) => p.id) },
      ...(range.stayFrom && range.stayTo
        ? {
            checkIn: { lt: parseBookingDate(addDays(range.stayTo, 1)) },
            checkOut: { gt: parseBookingDate(addDays(range.stayFrom, -1)) },
          }
        : {}),
      ...(range.createdFrom && range.createdTo
        ? {
            createdAt: {
              gte: parseBookingDate(addDays(range.createdFrom, -1)),
              lt: parseBookingDate(addDays(range.createdTo, 1)),
            },
          }
        : {}),
    };

    // Only fields needed for analysis: no guest names, contact details, or payment data.
    const bookings = await prisma.booking.findMany({
      where,
      select: {
        id: true,
        propertyId: true,
        roomTypeId: true,
        userId: true,
        checkIn: true,
        checkOut: true,
        rooms: true,
        guests: true,
        totalPrice: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return bookings.map((b) => {
      const checkIn = toDateString(b.checkIn);
      const checkOut = toDateString(b.checkOut);
      return {
        id: b.id,
        propertyId: b.propertyId,
        roomTypeId: b.roomTypeId,
        guestRef: guestRef(b.userId),
        checkIn,
        checkOut,
        nights: Math.max(1, daysBetween(checkIn, checkOut)),
        rooms: Math.max(1, b.rooms),
        guests: b.guests,
        totalPrice: Number(b.totalPrice),
        status: b.status,
        createdDate: toHotelDate(b.createdAt),
        updatedDate: toHotelDate(b.updatedAt),
      };
    });
  }
}

// ---------------------------------------------------------------------------
// KPI calculations (stay-date basis: revenue is spread evenly over each night)
// ---------------------------------------------------------------------------

export interface Kpis {
  nights: number;
  roomsPerNight: number;
  roomNightsAvailable: number;
  roomNightsSold: number;
  occupancyPct: number | null;
  roomRevenue: number;
  adr: number | null;
  revpar: number | null;
  arrivals: number;
  pendingArrivals: number;
  avgLengthOfStay: number | null;
  avgLeadTimeDays: number | null;
  cancelledArrivals: number;
  cancellationRatePct: number | null;
  noShows: number;
}

function overlapNights(b: BookingRow, fromDay: number, toDay: number): number {
  return Math.max(0, Math.min(dayNumber(b.checkOut), toDay) - Math.max(dayNumber(b.checkIn), fromDay));
}

export function sumStays(bookings: BookingRow[], from: string, to: string, include: (b: BookingRow) => boolean) {
  const fromDay = dayNumber(from);
  const toDay = dayNumber(to);
  let roomNights = 0;
  let revenue = 0;
  for (const b of bookings) {
    if (!include(b)) continue;
    const nights = overlapNights(b, fromDay, toDay);
    if (nights <= 0) continue;
    roomNights += nights * b.rooms;
    revenue += (b.totalPrice * nights) / b.nights;
  }
  return { roomNights, revenue };
}

export function computeKpis(bookings: BookingRow[], roomsPerNight: number, from: string, to: string): Kpis {
  const nights = Math.max(0, daysBetween(from, to));
  const { roomNights, revenue } = sumStays(bookings, from, to, (b) => ACTIVE_STATUSES.has(b.status));
  const available = roomsPerNight * nights;

  const arrivalsAll = bookings.filter((b) => b.checkIn >= from && b.checkIn < to);
  const arrivals = arrivalsAll.filter((b) => ACTIVE_STATUSES.has(b.status));
  const cancelled = arrivalsAll.filter((b) => b.status === 'CANCELLED').length;

  return {
    nights,
    roomsPerNight,
    roomNightsAvailable: available,
    roomNightsSold: roomNights,
    occupancyPct: available > 0 ? (roomNights / available) * 100 : null,
    roomRevenue: revenue,
    adr: roomNights > 0 ? revenue / roomNights : null,
    revpar: available > 0 ? revenue / available : null,
    arrivals: arrivals.length,
    pendingArrivals: arrivals.filter((b) => b.status === 'PENDING').length,
    avgLengthOfStay: arrivals.length ? arrivals.reduce((s, b) => s + b.nights, 0) / arrivals.length : null,
    avgLeadTimeDays: arrivals.length
      ? arrivals.reduce((s, b) => s + Math.max(0, daysBetween(b.createdDate, b.checkIn)), 0) / arrivals.length
      : null,
    cancelledArrivals: cancelled,
    cancellationRatePct: arrivalsAll.length ? (cancelled / arrivalsAll.length) * 100 : null,
    noShows: arrivalsAll.filter((b) => b.status === 'NO_SHOW').length,
  };
}

/** Whether a booking was on the books at the end of `cutoff` (approximating cancel date by last update). */
export function onBooksAsOf(b: BookingRow, cutoff: string): boolean {
  if (b.createdDate > cutoff) return false;
  if (b.status === 'CANCELLED') return b.updatedDate > cutoff;
  return true;
}

// Comparisons against "last year" shift by 52 weeks so weekdays line up.
export const LAST_YEAR_OFFSET_DAYS = 364;

export interface PaceResult {
  onTheBooks: { roomNights: number; revenue: number; occupancyPct: number | null; adr: number | null };
  sameTimeLastYear: { roomNights: number; revenue: number; occupancyPct: number | null };
  lastYearFinal: { roomNights: number; revenue: number; occupancyPct: number | null };
  pickupLast7Days: { roomNights: number; revenue: number };
  pickupLast30Days: { roomNights: number; revenue: number };
}

/** On-the-books position for stays in [from, to), compared with the same point last year. */
export function computePace(current: BookingRow[], lastYear: BookingRow[], roomsPerNight: number, today: string, from: string, to: string): PaceResult {
  const available = roomsPerNight * Math.max(0, daysBetween(from, to));
  const occ = (roomNights: number) => (available > 0 ? (roomNights / available) * 100 : null);

  const otb = sumStays(current, from, to, (b) => onBooksAsOf(b, today) && b.status !== 'NO_SHOW');
  const lyFrom = addDays(from, -LAST_YEAR_OFFSET_DAYS);
  const lyTo = addDays(to, -LAST_YEAR_OFFSET_DAYS);
  const lyCutoff = addDays(today, -LAST_YEAR_OFFSET_DAYS);
  const stly = sumStays(lastYear, lyFrom, lyTo, (b) => onBooksAsOf(b, lyCutoff));
  const lyFinal = sumStays(lastYear, lyFrom, lyTo, (b) => ACTIVE_STATUSES.has(b.status));
  const pickup = (days: number) =>
    sumStays(current, from, to, (b) => ACTIVE_STATUSES.has(b.status) && b.createdDate > addDays(today, -days));

  return {
    onTheBooks: { ...otb, occupancyPct: occ(otb.roomNights), adr: otb.roomNights > 0 ? otb.revenue / otb.roomNights : null },
    sameTimeLastYear: { ...stly, occupancyPct: occ(stly.roomNights) },
    lastYearFinal: { ...lyFinal, occupancyPct: occ(lyFinal.roomNights) },
    pickupLast7Days: pickup(7),
    pickupLast30Days: pickup(30),
  };
}

export function inProperties(propertyIds: string[]) {
  const set = new Set(propertyIds);
  return (b: BookingRow) => set.has(b.propertyId);
}

export function inRoomTypes(roomTypeIds: string[]) {
  const set = new Set(roomTypeIds);
  return (b: BookingRow) => set.has(b.roomTypeId);
}

export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
