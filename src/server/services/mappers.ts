import type { Prisma } from '@prisma/client';
import type { BookingStatus, BookingSummary } from '@/lib/dto';
import { computeRiskFlags } from '@/lib/risk';
import { fromCents, toCents } from '@/lib/payments';
import { highAmountThreshold } from '../payments/config';
import { diffDays, toISODate } from '../dates';

export const bookingInclude = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, country: true } },
  // Money actually collected online (refunded payments included, so the history shows), for the balance and the risk flags.
  payments: {
    where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
    select: { amount: true, amountRefunded: true, cardholderName: true, cardCountry: true, billingCountry: true, threeDSecure: true, riskLevel: true },
    orderBy: { createdAt: 'asc' },
  },
  roomType: { select: { id: true, name: true } },
  room: { select: { id: true, roomNumber: true, floor: true } },
  property: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export function toBookingSummary(b: BookingWithRelations): BookingSummary {
  const checkIn = toISODate(b.checkIn);
  const checkOut = toISODate(b.checkOut);
  const guestName = `${b.user.firstName} ${b.user.lastName}`.trim();
  const held = b.payments.reduce((sum, p) => sum + toCents(Number(p.amount)) - toCents(Number(p.amountRefunded)), 0);
  // The first successful payment carries the card details; later ones (rare) add nothing new to flag.
  const first = b.payments[0];
  return {
    id: b.id,
    code: b.code ?? b.id.slice(-8).toUpperCase(),
    status: b.status as BookingStatus,
    propertyId: b.property.id,
    propertyName: b.property.name,
    guest: {
      id: b.user.id,
      name: guestName,
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
    amountPaid: fromCents(Math.max(0, held)),
    // Flags describe online payments; pay-at-property bookings have nothing to flag.
    riskFlags: first
      ? computeRiskFlags({
          guestName,
          payment: { cardholderName: first.cardholderName, cardCountry: first.cardCountry, billingCountry: first.billingCountry, threeDSecure: first.threeDSecure, riskLevel: first.riskLevel },
          guestCountry: b.user.country,
          totalAmount: Number(b.totalPrice),
          highAmountThreshold: highAmountThreshold(),
        })
      : [],
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
