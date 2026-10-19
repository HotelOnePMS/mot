import type { Prisma } from '@prisma/client';
import type { BookingStatus, BookingSummary } from '@/lib/dto';
import { computeRiskFlags } from '@/lib/risk';
import { allocateCents, fromCents, toCents } from '@/lib/payments';
import { highAmountThreshold } from '../payments/config';
import { diffDays, toISODate } from '../dates';

// Money actually collected online (refunded payments included, so the history shows), for the balance and the risk flags.
const collected = {
  where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
  select: { amount: true, amountRefunded: true, cardholderName: true, cardCountry: true, billingCountry: true, threeDSecure: true, riskLevel: true },
  orderBy: { createdAt: 'asc' },
} satisfies Prisma.Booking$paymentsArgs;

export const bookingInclude = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, country: true } },
  payments: collected,
  // Several room types booked together share one payment, recorded on the lead line.
  reservationLead: { select: { payments: collected, reservationLines: { select: { id: true, paymentDue: true, totalPrice: true }, orderBy: { id: 'asc' } } } },
  roomType: { select: { id: true, name: true } },
  room: { select: { id: true, roomNumber: true, floor: true } },
  property: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export function toBookingSummary(b: BookingWithRelations): BookingSummary {
  const checkIn = toISODate(b.checkIn);
  const checkOut = toISODate(b.checkOut);
  const guestName = `${b.user.firstName} ${b.user.lastName}`.trim();
  const pay = reservationPayment(b);
  // The first successful payment carries the card details; later ones (rare) add nothing new to flag.
  const first = pay.payments[0];
  return {
    id: b.id,
    code: b.code ?? b.id.slice(-8).toUpperCase(),
    reservationCode: b.groupCode,
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
    currency: b.currency,
    paymentStatus: b.paymentStatus ?? 'UNPAID',
    amountPaid: fromCents(pay.heldCents),
    // Flags describe online payments; pay-at-property bookings have nothing to flag.
    riskFlags: first
      ? computeRiskFlags({
          guestName,
          payment: { cardholderName: first.cardholderName, cardCountry: first.cardCountry, billingCountry: first.billingCountry, threeDSecure: first.threeDSecure, riskLevel: first.riskLevel },
          guestCountry: b.user.country,
          totalAmount: fromCents(pay.totalCents),
          highAmountThreshold: highAmountThreshold(),
        })
      : [],
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
  };
}

/**
 * What was paid online for this booking. A line of a multi-room-type
 * reservation gets its share of the reservation's one payment, in proportion
 * to what was charged for it, so each line's balance at the desk is right and
 * the lines add up to the payment.
 */
function reservationPayment(b: BookingWithRelations) {
  const lead = b.reservationLead;
  if (!lead || lead.reservationLines.length < 2) {
    const held = b.payments.reduce((sum, p) => sum + toCents(Number(p.amount)) - toCents(Number(p.amountRefunded)), 0);
    return { payments: b.payments, heldCents: Math.max(0, held), totalCents: toCents(Number(b.totalPrice)) };
  }
  const held = Math.max(0, lead.payments.reduce((sum, p) => sum + toCents(Number(p.amount)) - toCents(Number(p.amountRefunded)), 0));
  const weights = lead.reservationLines.map((l) => toCents(Number(l.paymentDue ?? l.totalPrice)));
  const shares = allocateCents(held, weights);
  const i = lead.reservationLines.findIndex((l) => l.id === b.id);
  return {
    payments: lead.payments,
    heldCents: i >= 0 ? shares[i] : 0,
    totalCents: lead.reservationLines.reduce((sum, l) => sum + toCents(Number(l.totalPrice)), 0),
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
