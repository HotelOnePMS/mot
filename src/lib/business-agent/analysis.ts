import type { BookingStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addDays, toDateString } from '@/lib/date-utils';
import {
  ACTIVE_STATUSES,
  LAST_YEAR_OFFSET_DAYS,
  computeKpis,
  computePace,
  dayNumber,
  dayOfWeek,
  daysBetween,
  inProperties,
  inRoomTypes,
  percentChange,
  type BookingRow,
  type Kpis,
  type PaceResult,
  type PortfolioData,
} from './portfolio-data';

/**
 * Portfolio analyses shared by the advisor's snapshot and its tools.
 * Every function takes already-scoped property/room type IDs from PortfolioData.
 */

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type GroupBy = 'portfolio' | 'property' | 'room_type';

export interface Group {
  key: string;
  label: string;
  propertyId?: string;
  roomTypeId?: string;
  roomsPerNight: number;
  matches: (b: BookingRow) => boolean;
}

export function buildGroups(data: PortfolioData, propertyIds: string[], groupBy: GroupBy): Group[] {
  if (groupBy === 'portfolio') {
    return [
      {
        key: 'portfolio',
        label: propertyIds.length === data.properties.length ? 'Portfolio' : `Selected properties (${propertyIds.length})`,
        roomsPerNight: data.roomsPerNight({ propertyIds }),
        matches: inProperties(propertyIds),
      },
    ];
  }

  const properties = data.properties.filter((p) => propertyIds.includes(p.id));
  if (groupBy === 'property') {
    return properties.map((p) => ({
      key: p.id,
      label: p.name,
      propertyId: p.id,
      roomsPerNight: data.roomsPerNight({ propertyIds: [p.id] }),
      matches: inProperties([p.id]),
    }));
  }

  return properties.flatMap((p) =>
    p.roomTypes.map((rt) => ({
      key: rt.id,
      label: `${p.name} / ${rt.name}`,
      propertyId: p.id,
      roomTypeId: rt.id,
      roomsPerNight: rt.isActive ? rt.totalRooms : 0,
      matches: inRoomTypes([rt.id]),
    })),
  );
}

export function groupInfo(g: Group) {
  return {
    group: g.label,
    ...(g.propertyId ? { propertyId: g.propertyId } : {}),
    ...(g.roomTypeId ? { roomTypeId: g.roomTypeId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export type CompareTo = 'none' | 'previous_period' | 'last_year';

export function comparisonRange(from: string, to: string, compareTo: CompareTo): { from: string; to: string } | null {
  if (compareTo === 'previous_period') {
    const length = daysBetween(from, to);
    return { from: addDays(from, -length), to: from };
  }
  if (compareTo === 'last_year') {
    return { from: addDays(from, -LAST_YEAR_OFFSET_DAYS), to: addDays(to, -LAST_YEAR_OFFSET_DAYS) };
  }
  return null;
}

export function kpiChanges(current: Kpis, previous: Kpis) {
  return {
    occupancyPts:
      current.occupancyPct !== null && previous.occupancyPct !== null ? current.occupancyPct - previous.occupancyPct : null,
    adrPct: percentChange(current.adr, previous.adr),
    revparPct: percentChange(current.revpar, previous.revpar),
    roomRevenuePct: percentChange(current.roomRevenue, previous.roomRevenue),
    roomNightsPct: percentChange(current.roomNightsSold, previous.roomNightsSold),
  };
}

export interface PerformanceRow {
  group: Group;
  kpis: Kpis;
  comparison?: { from: string; to: string; kpis: Kpis; changes: ReturnType<typeof kpiChanges> };
}

export async function performance(
  data: PortfolioData,
  args: { from: string; to: string; propertyIds: string[]; groupBy: GroupBy; compareTo: CompareTo },
): Promise<PerformanceRow[]> {
  const bookings = await data.bookingsOverlapping(args.from, args.to);
  const compare = comparisonRange(args.from, args.to, args.compareTo);
  const compareBookings = compare ? await data.bookingsOverlapping(compare.from, compare.to) : [];

  return buildGroups(data, args.propertyIds, args.groupBy).map((group) => {
    const kpis = computeKpis(bookings.filter(group.matches), group.roomsPerNight, args.from, args.to);
    if (!compare) return { group, kpis };
    const previous = computeKpis(compareBookings.filter(group.matches), group.roomsPerNight, compare.from, compare.to);
    return { group, kpis, comparison: { ...compare, kpis: previous, changes: kpiChanges(kpis, previous) } };
  });
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export type Granularity = 'day' | 'week' | 'month';

export function buildBuckets(from: string, to: string, granularity: Granularity) {
  const buckets: { label: string; from: string; to: string }[] = [];
  let cursor = from;
  while (cursor < to) {
    let next: string;
    if (granularity === 'day') {
      next = addDays(cursor, 1);
    } else if (granularity === 'week') {
      // Weeks run Monday to Sunday.
      next = addDays(cursor, (8 - dayOfWeek(cursor)) % 7 || 7);
    } else {
      const [year, month] = cursor.split('-').map(Number);
      next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    }
    if (next > to) next = to;
    const label = granularity === 'month' ? cursor.slice(0, 7) : granularity === 'week' ? `week of ${cursor}` : `${cursor} ${WEEKDAYS[dayOfWeek(cursor)]}`;
    buckets.push({ label, from: cursor, to: next });
    cursor = next;
  }
  return buckets;
}

export async function trend(
  data: PortfolioData,
  args: { from: string; to: string; propertyIds: string[]; groupBy: 'portfolio' | 'property'; granularity: Granularity },
) {
  const bookings = await data.bookingsOverlapping(args.from, args.to);
  const buckets = buildBuckets(args.from, args.to, args.granularity);

  return buildGroups(data, args.propertyIds, args.groupBy).map((group) => {
    const groupBookings = bookings.filter(group.matches);
    return {
      group,
      buckets: buckets.map((bucket) => ({
        ...bucket,
        partial: bucket.to > data.today,
        kpis: computeKpis(groupBookings, group.roomsPerNight, bucket.from, bucket.to),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Booking pace
// ---------------------------------------------------------------------------

export async function pace(
  data: PortfolioData,
  args: { from: string; to: string; propertyIds: string[]; groupBy: 'portfolio' | 'property' },
): Promise<{ group: Group; pace: PaceResult }[]> {
  const current = await data.bookingsOverlapping(args.from, args.to);
  const lastYear = await data.bookingsOverlapping(addDays(args.from, -LAST_YEAR_OFFSET_DAYS), addDays(args.to, -LAST_YEAR_OFFSET_DAYS));

  return buildGroups(data, args.propertyIds, args.groupBy).map((group) => ({
    group,
    pace: computePace(current.filter(group.matches), lastYear.filter(group.matches), group.roomsPerNight, data.today, args.from, args.to),
  }));
}

// ---------------------------------------------------------------------------
// Demand patterns
// ---------------------------------------------------------------------------

function bucketize<T>(items: T[], buckets: { label: string; test: (item: T) => boolean }[]) {
  return buckets.map((bucket) => ({ label: bucket.label, items: items.filter(bucket.test) }));
}

function share(part: number, whole: number) {
  return whole > 0 ? (part / whole) * 100 : null;
}

function adrOf(bookings: BookingRow[]) {
  const nights = bookings.reduce((s, b) => s + b.nights * b.rooms, 0);
  return nights > 0 ? bookings.reduce((s, b) => s + b.totalPrice, 0) / nights : null;
}

export async function demandPatterns(data: PortfolioData, args: { from: string; to: string; propertyIds: string[] }) {
  const bookings = (await data.bookingsOverlapping(args.from, args.to)).filter(inProperties(args.propertyIds));
  const roomsPerNight = data.roomsPerNight({ propertyIds: args.propertyIds });

  // Day of week (by stay night).
  const byWeekday = WEEKDAYS.map(() => ({ nights: 0, roomNights: 0, revenue: 0 }));
  for (let day = dayNumber(args.from); day < dayNumber(args.to); day++) {
    byWeekday[new Date(day * 86400000).getUTCDay()].nights += 1;
  }
  const fromDay = dayNumber(args.from);
  const toDay = dayNumber(args.to);
  for (const b of bookings) {
    if (!ACTIVE_STATUSES.has(b.status)) continue;
    const start = Math.max(dayNumber(b.checkIn), fromDay);
    const end = Math.min(dayNumber(b.checkOut), toDay);
    for (let day = start; day < end; day++) {
      const slot = byWeekday[new Date(day * 86400000).getUTCDay()];
      slot.roomNights += b.rooms;
      slot.revenue += b.totalPrice / b.nights;
    }
  }

  // Booking-level patterns use arrivals in the range.
  const arrivalsAll = bookings.filter((b) => b.checkIn >= args.from && b.checkIn < args.to);
  const arrivals = arrivalsAll.filter((b) => ACTIVE_STATUSES.has(b.status));
  const leadTime = (b: BookingRow) => Math.max(0, daysBetween(b.createdDate, b.checkIn));

  const leadBuckets = bucketize(arrivalsAll, [
    { label: '0-1 days', test: (b) => leadTime(b) <= 1 },
    { label: '2-7 days', test: (b) => leadTime(b) >= 2 && leadTime(b) <= 7 },
    { label: '8-30 days', test: (b) => leadTime(b) >= 8 && leadTime(b) <= 30 },
    { label: '31-90 days', test: (b) => leadTime(b) >= 31 && leadTime(b) <= 90 },
    { label: '91+ days', test: (b) => leadTime(b) >= 91 },
  ]);

  const losBuckets = bucketize(arrivals, [
    { label: '1 night', test: (b) => b.nights === 1 },
    { label: '2 nights', test: (b) => b.nights === 2 },
    { label: '3-4 nights', test: (b) => b.nights >= 3 && b.nights <= 4 },
    { label: '5-7 nights', test: (b) => b.nights >= 5 && b.nights <= 7 },
    { label: '8+ nights', test: (b) => b.nights >= 8 },
  ]);

  const partyBuckets = bucketize(arrivals, [
    { label: '1 guest', test: (b) => b.guests <= 1 },
    { label: '2 guests', test: (b) => b.guests === 2 },
    { label: '3-4 guests', test: (b) => b.guests >= 3 && b.guests <= 4 },
    { label: '5+ guests', test: (b) => b.guests >= 5 },
  ]);

  const bookingsPerGuest = new Map<string, number>();
  for (const b of arrivals) bookingsPerGuest.set(b.guestRef, (bookingsPerGuest.get(b.guestRef) ?? 0) + 1);
  const repeatGuests = [...bookingsPerGuest.values()].filter((n) => n > 1);

  return {
    arrivals: arrivals.length,
    cancelledArrivals: arrivalsAll.filter((b) => b.status === 'CANCELLED').length,
    dayOfWeek: WEEKDAYS.map((label, i) => {
      const slot = byWeekday[i];
      const available = slot.nights * roomsPerNight;
      return {
        day: label,
        occupancyPct: available > 0 ? (slot.roomNights / available) * 100 : null,
        adr: slot.roomNights > 0 ? slot.revenue / slot.roomNights : null,
        roomRevenue: slot.revenue,
      };
    }),
    leadTime: leadBuckets.map(({ label, items }) => {
      const active = items.filter((b) => ACTIVE_STATUSES.has(b.status));
      return {
        bucket: label,
        bookings: items.length,
        sharePct: share(items.length, arrivalsAll.length),
        cancellationRatePct: share(items.filter((b) => b.status === 'CANCELLED').length, items.length),
        adr: adrOf(active),
      };
    }),
    lengthOfStay: losBuckets.map(({ label, items }) => ({
      bucket: label,
      bookings: items.length,
      sharePct: share(items.length, arrivals.length),
      adr: adrOf(items),
    })),
    partySize: partyBuckets.map(({ label, items }) => ({
      bucket: label,
      bookings: items.length,
      sharePct: share(items.length, arrivals.length),
    })),
    multiRoomBookingsPct: share(arrivals.filter((b) => b.rooms > 1).length, arrivals.length),
    distinctGuests: bookingsPerGuest.size,
    guestsWithRepeatStaysInPeriod: repeatGuests.length,
    bookingsFromRepeatGuestsPct: share(
      repeatGuests.reduce((s, n) => s + n, 0),
      arrivals.length,
    ),
  };
}

// ---------------------------------------------------------------------------
// Rates vs. demand
// ---------------------------------------------------------------------------

export async function rateCalendar(data: PortfolioData, args: { from: string; to: string; roomTypeIds: string[] }) {
  const [bookings, customRates] = await Promise.all([
    data.bookingsOverlapping(args.from, args.to),
    prisma.roomTypeRate.findMany({
      where: {
        roomTypeId: { in: args.roomTypeIds },
        date: { gte: new Date(`${args.from}T00:00:00Z`), lt: new Date(`${args.to}T00:00:00Z`) },
      },
      select: { roomTypeId: true, date: true, price: true },
    }),
  ]);

  const rateMap = new Map(customRates.map((r) => [`${r.roomTypeId}|${toDateString(r.date)}`, Number(r.price)]));
  const dates: string[] = [];
  for (let d = args.from; d < args.to; d = addDays(d, 1)) dates.push(d);

  return args.roomTypeIds.map((roomTypeId) => {
    const roomType = data.roomTypeById.get(roomTypeId)!;
    const property = data.propertyById.get(roomType.propertyId)!;
    const sold = new Map<string, number>();
    for (const b of bookings) {
      if (b.roomTypeId !== roomTypeId || !ACTIVE_STATUSES.has(b.status)) continue;
      for (let d = b.checkIn < args.from ? args.from : b.checkIn; d < b.checkOut && d < args.to; d = addDays(d, 1)) {
        sold.set(d, (sold.get(d) ?? 0) + b.rooms);
      }
    }
    return {
      property: property.name,
      propertyId: property.id,
      roomType: roomType.name,
      roomTypeId,
      rooms: roomType.totalRooms,
      basePrice: roomType.basePrice,
      nights: dates.map((date) => {
        const custom = rateMap.get(`${roomTypeId}|${date}`);
        const roomsSold = sold.get(date) ?? 0;
        return {
          date,
          day: WEEKDAYS[dayOfWeek(date)],
          rate: custom ?? roomType.basePrice,
          customRate: custom !== undefined,
          roomsSold,
          occupancyPct: roomType.totalRooms > 0 ? (roomsSold / roomType.totalRooms) * 100 : null,
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function operationsStatus(data: PortfolioData, propertyIds: string[]) {
  if (propertyIds.length === 0) return [];
  const [rooms, openTasks] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { propertyId: true, roomNumber: true, status: true, isOutOfOrder: true, outOfOrderReason: true, roomTypeId: true },
      orderBy: { roomNumber: 'asc' },
    }),
    prisma.roomHousekeeping.findMany({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, room: { propertyId: { in: propertyIds } } },
      select: { status: true, room: { select: { propertyId: true } } },
    }),
  ]);

  return data.properties
    .filter((p) => propertyIds.includes(p.id))
    .map((p) => {
      const propertyRooms = rooms.filter((r) => r.propertyId === p.id);
      const outOfOrder = propertyRooms.filter((r) => r.isOutOfOrder || r.status === 'OUT_OF_ORDER');
      const tasks = openTasks.filter((t) => t.room.propertyId === p.id);
      return {
        property: p.name,
        propertyId: p.id,
        sellableRoomsConfigured: data.roomsPerNight({ propertyIds: [p.id] }),
        physicalRoomsSetUp: propertyRooms.length,
        roomsByStatus: {
          clean: propertyRooms.filter((r) => r.status === 'CLEAN').length,
          dirty: propertyRooms.filter((r) => r.status === 'DIRTY').length,
          inspected: propertyRooms.filter((r) => r.status === 'INSPECTED').length,
          outOfOrder: outOfOrder.length,
        },
        outOfOrderRooms: outOfOrder.map((r) => ({
          room: r.roomNumber,
          roomType: data.roomTypeById.get(r.roomTypeId)?.name ?? null,
          reason: r.outOfOrderReason,
        })),
        openHousekeepingTasks: {
          pending: tasks.filter((t) => t.status === 'PENDING').length,
          inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
        },
      };
    });
}

// ---------------------------------------------------------------------------
// Booking drill-down
// ---------------------------------------------------------------------------

export async function listBookings(
  data: PortfolioData,
  args: {
    from: string;
    to: string;
    dateBasis: 'stay' | 'arrival' | 'created';
    propertyIds: string[];
    roomTypeIds?: string[];
    statuses?: BookingStatus[];
    sort: 'check_in' | 'newest' | 'highest_value';
    limit: number;
  },
) {
  const source =
    args.dateBasis === 'created' ? await data.bookingsCreated(args.from, args.to) : await data.bookingsOverlapping(args.from, args.to);

  const matchesProperty = inProperties(args.propertyIds);
  const matchesRoomType = args.roomTypeIds ? inRoomTypes(args.roomTypeIds) : () => true;
  const filtered = source.filter(
    (b) =>
      matchesProperty(b) &&
      matchesRoomType(b) &&
      (!args.statuses || args.statuses.includes(b.status)) &&
      (args.dateBasis !== 'arrival' || (b.checkIn >= args.from && b.checkIn < args.to)),
  );

  const sorted = [...filtered].sort((a, b) => {
    if (args.sort === 'newest') return b.createdDate.localeCompare(a.createdDate) || a.id.localeCompare(b.id);
    if (args.sort === 'highest_value') return b.totalPrice - a.totalPrice || a.id.localeCompare(b.id);
    return a.checkIn.localeCompare(b.checkIn) || a.id.localeCompare(b.id);
  });

  return {
    totalMatching: filtered.length,
    totalValue: filtered.reduce((s, b) => s + b.totalPrice, 0),
    bookings: sorted.slice(0, args.limit).map((b) => ({
      id: b.id,
      property: data.propertyById.get(b.propertyId)?.name,
      roomType: data.roomTypeById.get(b.roomTypeId)?.name,
      guest: b.guestRef,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      nights: b.nights,
      rooms: b.rooms,
      guests: b.guests,
      totalPrice: b.totalPrice,
      ratePerRoomNight: b.totalPrice / (b.nights * b.rooms),
      status: b.status,
      bookedOn: b.createdDate,
      leadTimeDays: Math.max(0, daysBetween(b.createdDate, b.checkIn)),
    })),
  };
}
