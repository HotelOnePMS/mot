/**
 * ARI (availability, rates, inventory) calculation.
 *
 * Channel price for a date = channel override price, otherwise
 *   PMS daily rate (room_type_rates, falling back to the base price) + markup.
 * Availability = total rooms - rooms booked that night (any source),
 *   capped by the mapping's channel allocation.
 */
import type { ChannelConnection, ChannelRoomMapping, RoomType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { atNoonUTC, eachNight } from '../dates';
import { OCCUPYING_STATUSES } from '../services/inventory';
import { addDays, eachDate, toDbDate, toISODate } from './dates';
import type { AriUpdate } from './types';

export type MappingWithRoomType = ChannelRoomMapping & { roomType: Pick<RoomType, 'id' | 'name' | 'basePrice' | 'totalRooms'> };
export type ConnectionWithMappings = ChannelConnection & { roomMappings: MappingWithRoomType[] };

export interface ChannelDay {
  date: string;
  roomTypeId: string;
  pmsRate: number;
  markupPercent: number;
  overridePrice: number | null;
  channelRate: number;
  totalRooms: number;
  booked: number;
  available: number;
  closed: boolean;
  minStay: number | null;
}

export function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

export function effectiveMarkup(connection: ChannelConnection, mapping: ChannelRoomMapping): number {
  return Number(mapping.markupPercent ?? connection.defaultMarkupPercent);
}

export async function loadConnection(connectionId: string): Promise<ConnectionWithMappings | null> {
  return prisma.channelConnection.findUnique({
    where: { id: connectionId },
    include: {
      roomMappings: {
        where: { isActive: true },
        include: { roomType: { select: { id: true, name: true, basePrice: true, totalRooms: true } } },
      },
    },
  });
}

/** PMS daily rate per room type and date (base price when no custom rate exists) */
export async function getPmsRates(
  roomTypes: Pick<RoomType, 'id' | 'basePrice'>[],
  from: string,
  to: string
): Promise<Map<string, Map<string, number>>> {
  const rates = await prisma.roomTypeRate.findMany({
    where: {
      roomTypeId: { in: roomTypes.map((rt) => rt.id) },
      date: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    select: { roomTypeId: true, date: true, price: true },
  });
  const custom = new Map<string, number>();
  for (const rate of rates) {
    custom.set(`${rate.roomTypeId}|${toISODate(rate.date)}`, Number(rate.price));
  }

  const result = new Map<string, Map<string, number>>();
  for (const roomType of roomTypes) {
    const byDate = new Map<string, number>();
    for (const date of eachDate(from, to)) {
      byDate.set(date, custom.get(`${roomType.id}|${date}`) ?? Number(roomType.basePrice));
    }
    result.set(roomType.id, byDate);
  }
  return result;
}

/** Rooms booked per room type and night, across every booking source */
export async function getBookedRooms(
  roomTypeIds: string[],
  from: string,
  to: string
): Promise<Map<string, Map<string, number>>> {
  const bookings = await prisma.booking.findMany({
    where: {
      roomTypeId: { in: roomTypeIds },
      status: { in: [...OCCUPYING_STATUSES] },
      checkIn: { lt: atNoonUTC(addDays(to, 1)) },
      checkOut: { gt: atNoonUTC(from) },
    },
    select: { roomTypeId: true, checkIn: true, checkOut: true, rooms: true },
  });

  const result = new Map<string, Map<string, number>>();
  for (const id of roomTypeIds) result.set(id, new Map());
  for (const booking of bookings) {
    const byDate = result.get(booking.roomTypeId)!;
    for (const night of eachNight(toISODate(booking.checkIn), toISODate(booking.checkOut))) {
      if (night < from || night > to) continue;
      byDate.set(night, (byDate.get(night) ?? 0) + (booking.rooms || 1));
    }
  }
  return result;
}

/** Day-by-day channel view for the connection's mapped room types */
export async function computeChannelDays(
  connection: ConnectionWithMappings,
  from: string,
  to: string,
  roomTypeIds?: string[]
): Promise<ChannelDay[]> {
  const mappings = connection.roomMappings.filter(
    (m) => !roomTypeIds || roomTypeIds.length === 0 || roomTypeIds.includes(m.roomTypeId)
  );
  if (mappings.length === 0) return [];

  const ids = mappings.map((m) => m.roomTypeId);
  const [pmsRates, booked, overrides] = await Promise.all([
    getPmsRates(mappings.map((m) => m.roomType), from, to),
    getBookedRooms(ids, from, to),
    prisma.channelRateOverride.findMany({
      where: {
        connectionId: connection.id,
        roomTypeId: { in: ids },
        date: { gte: toDbDate(from), lte: toDbDate(to) },
      },
    }),
  ]);
  const overrideMap = new Map(overrides.map((o) => [`${o.roomTypeId}|${toISODate(o.date)}`, o]));

  const days: ChannelDay[] = [];
  for (const mapping of mappings) {
    const markup = effectiveMarkup(connection, mapping);
    for (const date of eachDate(from, to)) {
      const pmsRate = pmsRates.get(mapping.roomTypeId)!.get(date)!;
      const override = overrideMap.get(`${mapping.roomTypeId}|${date}`);
      const overridePrice = override?.price != null ? Number(override.price) : null;
      const bookedRooms = booked.get(mapping.roomTypeId)!.get(date) ?? 0;
      const free = Math.max(0, mapping.roomType.totalRooms - bookedRooms);
      days.push({
        date,
        roomTypeId: mapping.roomTypeId,
        pmsRate,
        markupPercent: markup,
        overridePrice,
        channelRate: overridePrice ?? roundPrice(pmsRate * (1 + markup / 100)),
        totalRooms: mapping.roomType.totalRooms,
        booked: bookedRooms,
        available: mapping.inventoryAllocation != null ? Math.min(free, mapping.inventoryAllocation) : free,
        closed: override?.closed ?? false,
        minStay: override?.minStay ?? null,
      });
    }
  }
  return days;
}

/**
 * Collapses consecutive days with identical values into date-range updates,
 * keeping OTA payloads small (a flat-priced year becomes one update).
 */
export function buildAriUpdates(connection: ConnectionWithMappings, days: ChannelDay[]): AriUpdate[] {
  const mappingByRoomType = new Map(connection.roomMappings.map((m) => [m.roomTypeId, m]));
  const updates: AriUpdate[] = [];

  const byRoomType = new Map<string, ChannelDay[]>();
  for (const day of days) {
    byRoomType.set(day.roomTypeId, [...(byRoomType.get(day.roomTypeId) ?? []), day]);
  }

  for (const [roomTypeId, roomDays] of byRoomType) {
    const mapping = mappingByRoomType.get(roomTypeId);
    if (!mapping) continue;
    roomDays.sort((a, b) => a.date.localeCompare(b.date));

    let current: AriUpdate | null = null;
    for (const day of roomDays) {
      const values = {
        price: connection.syncRates ? day.channelRate : null,
        available: connection.syncAvailability ? day.available : null,
        closed: connection.syncAvailability ? day.closed : null,
        // Always send a min stay so a cleared restriction resets on the OTA
        minStay: connection.syncAvailability ? (day.minStay ?? 1) : null,
      };
      const continues =
        current !== null &&
        addDays(current.to, 1) === day.date &&
        current.price === values.price &&
        current.available === values.available &&
        current.closed === values.closed &&
        current.minStay === values.minStay;

      if (continues) {
        current!.to = day.date;
      } else {
        current = {
          otaRoomTypeId: mapping.otaRoomTypeId,
          otaRatePlanId: mapping.otaRatePlanId,
          from: day.date,
          to: day.date,
          ...values,
        };
        updates.push(current);
      }
    }
  }
  return updates;
}
