/**
 * Availability and pricing — the single implementation used by the guest
 * booking site, the staff console and the agent.
 *
 * Availability is derived from bookings (never a cached counter): for each
 * night, sold = sum(rooms) of bookings that occupy that night. A stay is
 * sellable when total - sold >= requested on every night.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ISODate, StayQuote } from '@/lib/dto';
import { atNoonUTC, eachNight, toISODate } from '../dates';
import { badRequest, notFound } from '../errors';

type Db = PrismaClient | Prisma.TransactionClient;

/** Statuses that consume inventory. */
export const OCCUPYING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] as const;

export interface NightlyInventory {
  total: number;
  soldByNight: Record<ISODate, number>;
  minAvailable: number;
}

export async function nightlyInventory(
  db: Db,
  roomTypeId: string,
  checkIn: ISODate,
  checkOut: ISODate,
  opts: { excludeBookingId?: string } = {}
): Promise<NightlyInventory> {
  const roomType = await db.roomType.findUnique({ where: { id: roomTypeId }, select: { totalRooms: true } });
  if (!roomType) throw notFound('Room type');

  const bookings = await db.booking.findMany({
    where: {
      roomTypeId,
      status: { in: [...OCCUPYING_STATUSES] },
      checkIn: { lt: atNoonUTC(checkOut) },
      checkOut: { gt: atNoonUTC(checkIn) },
      ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
    },
    select: { checkIn: true, checkOut: true, rooms: true },
  });

  const nights = eachNight(checkIn, checkOut);
  const soldByNight: Record<ISODate, number> = {};
  for (const night of nights) soldByNight[night] = 0;
  for (const b of bookings) {
    const bIn = toISODate(b.checkIn);
    const bOut = toISODate(b.checkOut);
    for (const night of nights) {
      if (night >= bIn && night < bOut) soldByNight[night] += b.rooms || 1;
    }
  }
  const maxSold = nights.reduce((m, n) => Math.max(m, soldByNight[n]), 0);
  return { total: roomType.totalRooms, soldByNight, minAvailable: Math.max(0, roomType.totalRooms - maxSold) };
}

/** Nightly prices from the rate calendar, falling back to the base price. */
export async function nightlyRates(
  db: Db,
  roomTypeId: string,
  checkIn: ISODate,
  checkOut: ISODate
): Promise<{ date: ISODate; price: number; isCustom: boolean }[]> {
  const roomType = await db.roomType.findUnique({ where: { id: roomTypeId }, select: { basePrice: true } });
  if (!roomType) throw notFound('Room type');
  const base = Number(roomType.basePrice);
  const nights = eachNight(checkIn, checkOut);
  if (nights.length === 0) return [];
  const rates = await db.roomTypeRate.findMany({
    where: {
      roomTypeId,
      date: { gte: new Date(`${checkIn}T00:00:00Z`), lt: new Date(`${checkOut}T00:00:00Z`) },
    },
    select: { date: true, price: true },
  });
  const byDay = new Map(rates.map((r) => [toISODate(r.date), Number(r.price)]));
  return nights.map((date) => {
    const custom = byDay.get(date);
    return { date, price: custom ?? base, isCustom: custom !== undefined };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function quoteStay(
  db: Db,
  input: { roomTypeId: string; checkIn: ISODate; checkOut: ISODate; rooms?: number; guests?: number }
): Promise<StayQuote> {
  const rooms = input.rooms ?? 1;
  const guests = input.guests ?? 1;
  if (input.checkIn >= input.checkOut) throw badRequest('Check-out must be after check-in.');
  const roomType = await db.roomType.findUnique({ where: { id: input.roomTypeId }, select: { id: true, name: true } });
  if (!roomType) throw notFound('Room type');
  const [nights, inventory] = await Promise.all([
    nightlyRates(db, input.roomTypeId, input.checkIn, input.checkOut),
    nightlyInventory(db, input.roomTypeId, input.checkIn, input.checkOut),
  ]);
  const perRoom = nights.reduce((s, n) => s + n.price, 0);
  const subtotal = round2(perRoom * rooms);
  return {
    roomTypeId: roomType.id,
    roomTypeName: roomType.name,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights: nights.map(({ date, price }) => ({ date, price })),
    rooms,
    guests,
    averageNightly: nights.length ? round2(perRoom / nights.length) : 0,
    subtotal,
    total: subtotal,
    currency: 'USD',
    available: inventory.minAvailable,
  };
}

export interface RoomTypeAvailability {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  totalRooms: number;
  available: number;
  amenities: string[];
  photo: string | null;
  quote: StayQuote | null;
}

/** Availability + quote for every active room type at a property. */
export async function propertyAvailability(input: {
  propertyId: string;
  checkIn: ISODate;
  checkOut: ISODate;
  guests?: number;
  rooms?: number;
}): Promise<RoomTypeAvailability[]> {
  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId: input.propertyId, isActive: true },
    orderBy: { basePrice: 'asc' },
    include: { photos: { orderBy: { isMain: 'desc' }, take: 1, select: { url: true } } },
  });
  return Promise.all(
    roomTypes.map(async (rt) => {
      const quote = await quoteStay(prisma, {
        roomTypeId: rt.id,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        rooms: input.rooms ?? 1,
        guests: input.guests ?? 1,
      });
      return {
        id: rt.id,
        name: rt.name,
        description: rt.description,
        capacity: rt.capacity,
        totalRooms: rt.totalRooms,
        available: quote.available,
        amenities: rt.amenities,
        photo: rt.photos[0]?.url ?? null,
        quote,
      };
    })
  );
}
