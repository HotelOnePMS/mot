import type { Prisma } from '@prisma/client';
import type { BookingStatus, BookingSummary } from '@/lib/dto';
import { computeRiskFlags } from '@/lib/risk';
import { roundMoney } from '@/lib/currency';
import { fromCents, reservationShares, toCents } from '@/lib/payments';
import { highAmountThreshold } from '../payments/config';
import { diffDays, toISODate } from '../dates';

// Money actually collected, online or at the desk (refunded payments included, so the history shows), for the balance
// and the risk flags. Security deposits are held against incidentals, not paid toward the stay, so they don't count.
const collected = {
  where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, kind: { not: 'SECURITY_DEPOSIT' } },
  select: { method: true, amount: true, amountRefunded: true, cardholderName: true, cardCountry: true, billingCountry: true, threeDSecure: true, riskLevel: true },
  orderBy: { createdAt: 'asc' },
} satisfies Prisma.Booking$paymentsArgs;

// Allowances in force: they lower what the stay costs (a removed one stays on record, voided).
const activeAllowances = { where: { voidedAt: null }, select: { amount: true } } satisfies Prisma.Booking$allowancesArgs;

export const bookingInclude = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, country: true } },
  payments: collected,
  allowances: activeAllowances,
  // Several room types booked together share one payment, recorded on the lead line.
  reservationLead: {
    select: { payments: collected, reservationLines: { select: { id: true, status: true, paymentDue: true, totalPrice: true, allowances: activeAllowances }, orderBy: { id: 'asc' } } },
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
  const pay = reservationPayment(b);
  const allowances = fromCents(allowanceCents(b.allowances));
  // What the stay costs after allowances, less what was paid toward it.
  const lineBalance = roundMoney(Number(b.totalPrice) - allowances - fromCents(pay.heldCents), b.currency);
  // The first online payment carries the card details the flags are about; desk payments are taken in person.
  const first = pay.payments.find((p) => p.method === 'ONLINE');
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
    allowances,
    // Check-out needs this at zero (bookings.ts checkTransition).
    balance: lineBalance,
    checkOutDue: checkOutDue(lineBalance, pay.reservationDueCents, b.currency),
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
 * reservation gets its share of the reservation's one payment
 * (`reservationShares`: refunds come off cancelled room types first), so each
 * line's balance at the desk is right and the lines add up to the payment.
 */
const ENDED: string[] = ['CANCELLED', 'NO_SHOW'];

function reservationPayment(b: BookingWithRelations) {
  const lead = b.reservationLead;
  if (!lead || lead.reservationLines.length < 2) {
    const held = b.payments.reduce((sum, p) => sum + toCents(Number(p.amount)) - toCents(Number(p.amountRefunded)), 0);
    return { payments: b.payments, heldCents: Math.max(0, held), totalCents: toCents(Number(b.totalPrice)), reservationDueCents: null };
  }
  const shares = reservationShares({
    paidCents: lead.payments.reduce((sum, p) => sum + toCents(Number(p.amount)), 0),
    refundedCents: lead.payments.reduce((sum, p) => sum + toCents(Number(p.amountRefunded)), 0),
    lines: lead.reservationLines.map((l) => ({ dueCents: toCents(Number(l.paymentDue ?? l.totalPrice)), cancelled: ENDED.includes(l.status) })),
  });
  const share = shares[lead.reservationLines.findIndex((l) => l.id === b.id)];
  // What the reservation still owes, as the desk counts it (server/payments/desk.ts): its room types still going ahead
  // (after their allowances), less everything paid toward the stay.
  const active = lead.reservationLines.filter((l) => !ENDED.includes(l.status));
  const dueCents = (active.length ? active : lead.reservationLines).reduce((sum, l) => sum + toCents(Number(l.totalPrice)) - allowanceCents(l.allowances), 0);
  const netCents = lead.payments.reduce((sum, p) => sum + toCents(Number(p.amount)) - toCents(Number(p.amountRefunded)), 0);
  return {
    payments: lead.payments,
    heldCents: share ? share.paidCents - share.refundedCents : 0,
    totalCents: lead.reservationLines.reduce((sum, l) => sum + toCents(Number(l.totalPrice)), 0),
    reservationDueCents: Math.max(0, dueCents - netCents),
  };
}

/**
 * What must be paid before check-out. A line of a shared reservation is clear once its share is covered, or once the
 * whole reservation is paid (its share can lag behind when a room type was cancelled or prepaid differently);
 * until then the desk collects the reservation's balance, and a part payment is spread over every room type.
 */
function checkOutDue(lineBalance: number, reservationDueCents: number | null, currency: string): number {
  if (lineBalance <= 0.004) return 0;
  return reservationDueCents === null ? roundMoney(lineBalance, currency) : fromCents(reservationDueCents);
}

/** The allowances in force on a booking, in cents. */
export function allowanceCents(rows: readonly { amount: unknown }[]): number {
  return rows.reduce((sum, a) => sum + toCents(Number(a.amount)), 0);
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
