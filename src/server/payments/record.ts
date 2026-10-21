/**
 * Writes what Stripe tells us about a payment onto our records: the Payment
 * (cardholder, billing and card country, 3D Secure result, Stripe's risk
 * outcome, amounts), the booking's status, and refunds. Everything here is
 * idempotent: Stripe may deliver an event twice or out of order, and several
 * events (checkout.session.completed, payment_intent.succeeded) describe the
 * same payment.
 *
 * Several room types booked together (one booking row each, sharing
 * `groupCode`) are paid with one payment, recorded on the lead row (the one
 * whose code the guest has). Its totals and status are the reservation's, and
 * every row is confirmed, held or released with it.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe';
import { bookingPaymentStatus, fromCents, reservationShares, toCents } from '@/lib/payments';
import { toDateString } from '@/lib/date-utils';
import { sendBookingConfirmation } from '../email';
import { nightlyInventory } from '../services/inventory';
import { PAYMENT_CURRENCY } from './config';

const PAID_STATUSES = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
/** Paid toward the stay: everything collected except security deposits, which are held against incidentals. */
const TOWARD_STAY = { status: { in: PAID_STATUSES }, kind: { not: 'SECURITY_DEPOSIT' } };

const opts = (account?: string | null) => (account ? { stripeAccount: account } : undefined);

/** Totals collected and refunded across the payments of these bookings (one reservation), in cents. */
async function totalsFor(bookingIds: string[]) {
  const payments = await prisma.payment.findMany({ where: { bookingId: { in: bookingIds }, ...TOWARD_STAY }, select: { amount: true, amountRefunded: true } });
  return {
    paidCents: payments.reduce((s, p) => s + toCents(Number(p.amount)), 0),
    refundedCents: payments.reduce((s, p) => s + toCents(Number(p.amountRefunded)), 0),
  };
}

const lineSelect = {
  id: true,
  code: true,
  groupCode: true,
  status: true,
  paymentStatus: true,
  totalPrice: true,
  paymentDue: true,
  roomTypeId: true,
  rooms: true,
  guests: true,
  checkIn: true,
  checkOut: true,
  roomType: { select: { name: true } },
  // Allowances in force lower what the line costs (folio allowances; a removed one is voided).
  allowances: { where: { voidedAt: null }, select: { amount: true } },
} as const;

/**
 * Every booking row a payment covers: the booking itself, or all room types of
 * its reservation, lead (the code the guest was given) first.
 */
export async function paymentLines(booking: { id: string; groupCode: string | null }) {
  const rows = await prisma.booking.findMany({ where: booking.groupCode ? { groupCode: booking.groupCode } : { id: booking.id }, select: lineSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return rows.sort((a, b) => Number(b.code === b.groupCode) - Number(a.code === a.groupCode));
}

const sumCents = (rows: { totalPrice: unknown }[]) => rows.reduce((s, r) => s + toCents(Number(r.totalPrice)), 0);
/** What a line costs after its allowances, in cents. */
const owedCents = (l: { totalPrice: unknown; allowances: { amount: unknown }[] }) => Math.max(0, toCents(Number(l.totalPrice)) - l.allowances.reduce((s, a) => s + toCents(Number(a.amount)), 0));

/**
 * Each line's payment status from its share of the reservation's payments
 * (refunds count against cancelled room types first, so the room types the
 * guest kept stay paid). A single booking's status is its own.
 */
async function lineStatuses(lines: Awaited<ReturnType<typeof paymentLines>>): Promise<Map<string, string>> {
  const totals = await totalsFor(lines.map((l) => l.id));
  if (lines.length < 2) return new Map(lines.map((l) => [l.id, bookingPaymentStatus({ totalCents: owedCents(l), ...totals })]));
  // The same order as the per-line amounts shown to staff (mappers.ts), so a cent of rounding lands on the same line.
  const ordered = [...lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shares = reservationShares({
    ...totals,
    lines: ordered.map((l) => ({ dueCents: toCents(Number(l.paymentDue ?? l.totalPrice)), cancelled: l.status === 'CANCELLED' || l.status === 'NO_SHOW', owedCents: owedCents(l) })),
  });
  return new Map(ordered.map((l, i) => [l.id, bookingPaymentStatus({ totalCents: owedCents(l), ...shares[i] })]));
}

function cardDetails(charge: Stripe.Charge | null) {
  const card = charge?.payment_method_details?.card;
  return {
    cardholderName: charge?.billing_details?.name || null,
    billingEmail: charge?.billing_details?.email || null,
    billingCountry: charge?.billing_details?.address?.country || null,
    cardCountry: card?.country || null,
    cardBrand: card?.brand || null,
    cardLast4: card?.last4 || null,
    // No 3D Secure data on the charge means it was not attempted.
    threeDSecure: card ? (card.three_d_secure?.result ?? 'not_attempted') : null,
    riskLevel: charge?.outcome?.risk_level || null,
    riskScore: typeof charge?.outcome?.risk_score === 'number' ? charge.outcome.risk_score : null,
  };
}

/** The booking a payment intent belongs to, only if the event came from that hotel's own Stripe account. */
async function bookingForIntent(intent: Pick<Stripe.PaymentIntent, 'id' | 'metadata'>, account?: string | null) {
  const bookingId = intent.metadata?.bookingId;
  if (!bookingId) return null;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: { select: { email: true, firstName: true, lastName: true } },
      property: { select: { id: true, name: true, stripeAccountId: true } },
      roomType: { select: { name: true } },
    },
  });
  if (!booking) return null;
  // A hotel's payments arrive on its own account; ignore an event that names someone else's booking.
  if (account && booking.property.stripeAccountId !== account) {
    console.error(`[payments] Ignoring ${intent.id}: account ${account} does not own booking ${booking.id}`);
    return null;
  }
  return booking;
}

/**
 * A card payment succeeded: store it, confirm the booking (once), send the
 * confirmation. Safe to call repeatedly for the same payment intent.
 */
export async function recordPaymentSucceeded(paymentIntentId: string, opts_: { account?: string | null; sessionId?: string | null } = {}): Promise<void> {
  const { account, sessionId } = opts_;
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] }, opts(account));
  if (intent.status !== 'succeeded') return;
  const booking = await bookingForIntent(intent, account);
  if (!booking) {
    console.error(`[payments] Payment ${intent.id} succeeded but matches no booking (metadata.bookingId missing or unknown)`);
    return;
  }
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const amountCents = intent.amount_received || intent.amount;
  const details = cardDetails(charge);
  const lines = await paymentLines(booking);
  const ids = lines.map((l) => l.id);
  const totalCents = sumCents(lines);
  const dueCents = lines.reduce((s, l) => s + toCents(Number(l.paymentDue ?? l.totalPrice)), 0);
  const kind = dueCents < totalCents ? 'DEPOSIT' : 'FULL';
  const data = {
    bookingId: booking.id,
    propertyId: booking.propertyId,
    stripeChargeId: charge?.id ?? null,
    stripeCheckoutSessionId: sessionId ?? booking.stripeCheckoutSessionId,
    kind,
    status: 'SUCCEEDED',
    amount: fromCents(amountCents),
    currency: intent.currency || PAYMENT_CURRENCY,
    applicationFee: charge?.application_fee_amount != null ? fromCents(charge.application_fee_amount) : null,
    failureMessage: null,
    paidAt: new Date(),
    ...details,
  };
  const existing = await prisma.payment.findUnique({ where: { stripePaymentIntentId: intent.id }, select: { status: true, amountRefunded: true } });
  if (existing && existing.status !== 'FAILED' && existing.status !== 'PENDING') {
    // Already recorded (the other event got here first); refunds and statuses are owned by the refund handler.
    await prisma.payment.update({ where: { stripePaymentIntentId: intent.id }, data: { ...details, stripeChargeId: charge?.id ?? undefined } });
  } else {
    await prisma.payment.upsert({ where: { stripePaymentIntentId: intent.id }, create: { stripePaymentIntentId: intent.id, ...data }, update: data });
  }

  const { paidCents, refundedCents } = await totalsFor(ids);
  const paymentStatus = bookingPaymentStatus({ totalCents, paidCents, refundedCents });
  const money = (cents: number) => fromCents(cents).toFixed(2);
  const shown = (cents: number) => `${money(cents)} ${booking.currency}`;
  const forReservation = lines.length > 1 ? ` for reservation ${booking.code ?? booking.id} (${lines.length} room types)` : '';

  // PENDING → CONFIRMED happens exactly once, whichever event arrives first (for every room type of a reservation at once).
  const pending = lines.filter((l) => l.status === 'PENDING').map((l) => l.id);
  const confirmed = pending.length
    ? await prisma.booking.updateMany({ where: { id: { in: pending }, status: 'PENDING' }, data: { status: 'CONFIRMED', paymentStatus, stripePaymentIntentId: intent.id, expiresAt: null } })
    : { count: 0 };
  if (confirmed.count) {
    const note = `Confirmed · ${kind === 'DEPOSIT' ? 'Deposit' : 'Payment'} of ${shown(amountCents)}${forReservation} received by card (3D Secure: ${details.threeDSecure ?? 'n/a'})`;
    await prisma.bookingStatusHistory.createMany({ data: pending.map((bookingId) => ({ bookingId, status: 'CONFIRMED' as const, notes: note })) });
    const guestName = `${booking.user.firstName} ${booking.user.lastName}`.trim();
    await sendBookingConfirmation({
      to: booking.user.email,
      guestName: guestName || booking.user.email,
      propertyName: booking.property.name,
      roomTypeName: booking.roomType.name,
      lines: lines.map((l) => ({ roomTypeName: l.roomType.name, rooms: l.rooms })),
      checkIn: toDateString(booking.checkIn),
      checkOut: toDateString(booking.checkOut),
      guests: lines.reduce((s, l) => s + l.guests, 0),
      rooms: lines.reduce((s, l) => s + l.rooms, 0),
      totalPrice: money(totalCents),
      bookingId: booking.code ?? booking.id,
      paymentStatus,
      amountPaid: money(paidCents - refundedCents),
      currency: booking.currency,
    });
    return;
  }

  // The hold ran out before the webhook arrived: take the reservation back if all its rooms are still free.
  // Read the lines again: the hold may have been released while this payment was being recorded.
  const expired = (await paymentLines(booking)).filter((l) => l.status === 'CANCELLED' && l.paymentStatus === 'EXPIRED');
  if (expired.length) {
    let free = true;
    for (const l of expired) {
      const inv = await nightlyInventory(prisma, l.roomTypeId, toDateString(l.checkIn), toDateString(l.checkOut), { excludeBookingId: l.id });
      if (inv.minAvailable < l.rooms) free = false;
    }
    const note = free
      ? `Confirmed · ${shown(amountCents)}${forReservation} arrived after the hold expired and the rooms were still free`
      : `${shown(amountCents)}${forReservation} arrived after the hold expired and ${expired.length > 1 ? 'not all the rooms are free' : 'the rooms are gone'} — refund this payment`;
    for (const l of expired) {
      await prisma.booking.update({
        where: { id: l.id },
        data: {
          paymentStatus,
          stripePaymentIntentId: intent.id,
          ...(free ? { status: 'CONFIRMED', expiresAt: null } : {}),
          statusHistory: { create: { status: free ? 'CONFIRMED' : 'CANCELLED', notes: note } },
        },
      });
    }
    return;
  }

  // Repeat delivery: only fill in what is still unset, never overwrite refund or dispute states.
  await prisma.booking.updateMany({
    where: { id: { in: ids }, paymentStatus: { in: ['AWAITING_PAYMENT', 'UNPAID', 'EXPIRED'] } },
    data: { paymentStatus, stripePaymentIntentId: intent.id },
  });
}

/** A payment attempt failed. Never overwrites a payment that already succeeded. */
export async function recordPaymentFailed(intent: Stripe.PaymentIntent, account?: string | null): Promise<void> {
  const booking = await bookingForIntent(intent, account);
  if (!booking) return;
  const existing = await prisma.payment.findUnique({ where: { stripePaymentIntentId: intent.id }, select: { status: true } });
  if (existing && existing.status !== 'FAILED' && existing.status !== 'PENDING') return;
  const message = intent.last_payment_error?.message ?? null;
  const data = {
    bookingId: booking.id,
    propertyId: booking.propertyId,
    status: 'FAILED',
    amount: fromCents(intent.amount),
    currency: intent.currency || PAYMENT_CURRENCY,
    failureMessage: message?.slice(0, 300) ?? null,
  };
  await prisma.payment.upsert({ where: { stripePaymentIntentId: intent.id }, create: { stripePaymentIntentId: intent.id, ...data }, update: data });
  // The booking stays held: the guest can retry on the same Checkout page until it expires.
}

/** Refund state from Stripe's charge (absolute amount, so repeats are harmless). */
export async function applyRefundState(input: { paymentIntentId: string; amountRefundedCents: number }): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { stripePaymentIntentId: input.paymentIntentId } });
  if (!payment) return;
  const paidCents = toCents(Number(payment.amount));
  const refundedCents = Math.min(paidCents, Math.max(0, input.amountRefundedCents));
  const status = refundedCents >= paidCents ? 'REFUNDED' : refundedCents > 0 ? 'PARTIALLY_REFUNDED' : 'SUCCEEDED';
  if (status === payment.status && refundedCents === toCents(Number(payment.amountRefunded))) return;
  await prisma.payment.update({ where: { id: payment.id }, data: { amountRefunded: fromCents(refundedCents), status } });

  const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId }, select: { id: true, groupCode: true, currency: true, paymentStatus: true } });
  if (!booking) return;
  // A dispute in progress keeps its own status until it closes.
  if (booking.paymentStatus === 'DISPUTED') return;
  const lines = await paymentLines(booking);
  const statuses = await lineStatuses(lines);
  const note = `Refund recorded: ${fromCents(refundedCents).toFixed(2)} of ${fromCents(paidCents).toFixed(2)} ${booking.currency} refunded to the card${lines.length > 1 ? ' (one payment for every room type in this reservation)' : ''}`;
  for (const line of lines) {
    const paymentStatus = statuses.get(line.id)!;
    if (paymentStatus === line.paymentStatus || line.paymentStatus === 'DISPUTED') continue;
    await prisma.booking.update({ where: { id: line.id }, data: { paymentStatus, statusHistory: { create: { status: line.status, notes: note } } } });
  }
}

/** Where a booking's payment status stands once a dispute no longer holds it (won, or no longer open). */
export async function restorePaymentStatus(bookingId: string, lost: boolean): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, groupCode: true } });
  if (!booking) return;
  const lines = await paymentLines(booking);
  if (lost) {
    await prisma.booking.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { paymentStatus: 'DISPUTE_LOST' } });
    return;
  }
  const statuses = await lineStatuses(lines);
  for (const line of lines) await prisma.booking.update({ where: { id: line.id }, data: { paymentStatus: statuses.get(line.id)! } });
}

/**
 * Recompute every line's payment status after money moved at the desk (a
 * payment on the card reader, a card typed in, cash). Nothing changes while
 * nothing has been paid toward the stay, or while a dispute holds the status.
 */
export async function refreshPaymentStatus(booking: { id: string; groupCode: string | null }, note?: string): Promise<void> {
  const lines = await paymentLines(booking);
  const { paidCents } = await totalsFor(lines.map((l) => l.id));
  const statuses = await lineStatuses(lines);
  for (const line of lines) {
    let paymentStatus = statuses.get(line.id)!;
    if (paidCents <= 0) {
      // Nothing paid yet: only a stay allowances took entirely off is paid; one put back (allowance removed) is to pay at
      // the hotel again. Others keep their status, and so does a hold awaiting an online payment, so it still expires.
      if (line.status === 'PENDING' && line.paymentStatus === 'AWAITING_PAYMENT') continue;
      if (paymentStatus !== 'PAID' && line.paymentStatus === 'PAID') paymentStatus = 'PAY_AT_PROPERTY';
      else if (paymentStatus !== 'PAID') continue;
    }
    if (paymentStatus === line.paymentStatus || line.paymentStatus === 'DISPUTED') continue;
    await prisma.booking.update({ where: { id: line.id }, data: { paymentStatus, ...(note ? { statusHistory: { create: { status: line.status, notes: note } } } : {}) } });
  }
}
