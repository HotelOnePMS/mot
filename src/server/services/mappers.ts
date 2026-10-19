import type { Prisma } from '@prisma/client';
import type { BookingStatus, BookingSummary } from '@/lib/dto';
import { diffDays, toISODate } from '../dates';

export const bookingInclude = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  roomType: { select: { id: true, name: true } },
  room: { select: { id: true, roomNumber: true, floor: true } },
  property: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export function toBookingSummary(b: BookingWithRelations): BookingSummary {
  const checkIn = toISODate(b.checkIn);
  const checkOut = toISODate(b.checkOut);
  return {
    id: b.id,
    code: b.code ?? b.id.slice(-8).toUpperCase(),
    groupCode: b.groupCode,
    status: b.status as BookingStatus,
    propertyId: b.property.id,
    propertyName: b.property.name,
    guest: {
      id: b.user.id,
      name: `${b.user.firstName} ${b.user.lastName}`.trim(),
      // Direct bookings by API key belong to a per-booking guest record; show the contact email the integration sent.
      email: b.guestEmail ?? b.user.email,
      phone: b.user.phone,
    },
    checkIn,
    checkOut,
    nights: Math.max(1, diffDays(checkIn, checkOut)),
    guests: b.guests,
    rooms: b.rooms,
    roomType: { id: b.roomType.id, name: b.roomType.name },
    room: b.room ? { id: b.room.id, number: b.room.roomNumber, floor: b.room.floor } : null,
    totalPrice: Number(b.totalPrice),
    paymentStatus: b.paymentStatus ?? 'UNPAID',
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
  };
}

export function personName(u: { firstName: string; lastName: string }): string {
  return `${u.firstName} ${u.lastName}`.trim();
}

/** Floors are free text ("3", "Ground", "2nd"); extract a sortable number. */
export function floorNumber(floor: string | null | undefined): number {
  if (!floor) return 0;
  if (/ground|lobby|^g$/i.test(floor.trim())) return 0;
  const m = floor.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}
