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
// Refunds recorded for one room type of a reservation (payments/record.ts recordRefundShares).
export const refundShares = { select: { amount: true } } satisfies Prisma.Booking$refundSharesArgs;

export const bookingInclude = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, country: true } },
  payments: collected,
  allowances: activeAllowances,
  // Several room types booked together share one payment, recorded on the lead line.
  reservationLead: {
    select: { payments: collected, reservationLines: { select: { id: true, status: true, paymentDue: true, totalPrice: true, allowances: activeAllowances, refundShares }, orderBy: { id: 'asc' } } },
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
  // What the stay costs after allowances (never below nothing, even if the stay was repriced lower since), less what was
  // paid toward it.
  const lineBalance = roundMoney(fromCents(owedAfterAllowances(b.totalPrice, b.allowances)) - fromCents(pay.heldCents), b.currency);
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
    checkOutDue: checkOutDue(lineBalance, pay.reservationBalanceCents === null ? null : Math.max(0, pay.reservationBalanceCents), b.currency),
    reservationBalance: pay.reservationBalanceCents === null ? null : fromCents(pay.reservationBalanceCents),
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
    return { payments: b.payments, heldCents: Math.max(0, held), totalCents: toCents(Number(b.totalPrice)), reservationBalanceCents: null };
  }
  const account = reservationAccount({
    paidCents: lead.payments.reduce((sum, p) => sum + toCents(Number(p.amount)), 0),
    refundedCents: lead.payments.reduce((sum, p) => sum + toCents(Number(p.amountRefunded)), 0),
    lines: lead.reservationLines,
  });
  const share = account.shares.get(b.id);
  return {
    payments: lead.payments,
    heldCents: share ? share.paidCents - share.refundedCents : 0,
    totalCents: lead.reservationLines.reduce((sum, l) => sum + toCents(Number(l.totalPrice)), 0),
    reservationBalanceCents: account.balanceCents,
  };
}

/**
 * A reservation of several room types as one account, the same for the summaries, the desk (payments/desk.ts) and the
 * payment statuses (payments/record.ts): each line's share of the payments (reservationShares, lines in id order so a
 * cent of rounding always lands on the same line), and what the reservation still owes: its room types going ahead,
 * after allowances, less what was paid toward them. Money a cancelled room type holds (a deposit the hotel kept, say)
 * stays with it, like a cancellation fee: it doesn't pay for the others, and a room type cancelled before paying holds
 * nothing. Once every room type has ended, the reservation is judged as a whole. Refunds recorded for a room type
 * (`refundShares`) count against it first.
 */
export function reservationAccount(input: {
  paidCents: number;
  refundedCents: number;
  lines: readonly { id: string; status: string; paymentDue: unknown; totalPrice: unknown; allowances: readonly { amount: unknown }[]; refundShares?: readonly { amount: unknown }[] }[];
}): {
  shares: Map<string, { paidCents: number; refundedCents: number }>;
  /** Each line, in id order: whether it has ended, what it costs now and what it holds of the payments. */
  lines: { id: string; cancelled: boolean; owedCents: number; heldCents: number }[];
  owedCents: number;
  paidCents: number;
  balanceCents: number;
} {
  const ordered = [...input.lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const going = ordered.some((l) => !ENDED.includes(l.status));
  const rows = ordered.map((l) => {
    const cancelled = ENDED.includes(l.status);
    return {
      cancelled,
      owedCents: owedAfterAllowances(l.totalPrice, l.allowances),
      dueCents: toCents(Number(l.paymentDue ?? (cancelled && going ? 0 : l.totalPrice))),
      refundFirstCents: (l.refundShares ?? []).reduce((sum, r) => sum + toCents(Number(r.amount)), 0),
    };
  });
  const shares = reservationShares({ paidCents: input.paidCents, refundedCents: input.refundedCents, lines: rows });
  const owedCents = rows.reduce((sum, r) => sum + (going && r.cancelled ? 0 : r.owedCents), 0);
  const keptByEnded = going ? rows.reduce((sum, r, i) => sum + (r.cancelled ? shares[i].paidCents - shares[i].refundedCents : 0), 0) : 0;
  const paidCents = input.paidCents - input.refundedCents - keptByEnded;
  return {
    shares: new Map(ordered.map((l, i) => [l.id, shares[i]])),
    lines: ordered.map((l, i) => ({ id: l.id, cancelled: rows[i].cancelled, owedCents: rows[i].owedCents, heldCents: shares[i].paidCents - shares[i].refundedCents })),
    owedCents,
    paidCents,
    balanceCents: owedCents - paidCents,
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

/** What a booking costs after its allowances, in cents: never below nothing (a stay repriced lower keeps its allowances). */
export function owedAfterAllowances(totalPrice: unknown, allowances: readonly { amount: unknown }[]): number {
  return Math.max(0, toCents(Number(totalPrice)) - allowanceCents(allowances));
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
