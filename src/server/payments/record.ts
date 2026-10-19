/**
 * Writes what Stripe tells us about a payment onto our records: the Payment
 * (cardholder, billing and card country, 3D Secure result, Stripe's risk
 * outcome, amounts), the booking's status, and refunds. Everything here is
 * idempotent: Stripe may deliver an event twice or out of order, and several
 * events (checkout.session.completed, payment_intent.succeeded) describe the
 * same payment.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe';
import { bookingPaymentStatus, fromCents, toCents } from '@/lib/payments';
import { toDateString } from '@/lib/date-utils';
import { sendBookingConfirmation } from '../email';
import { nightlyInventory } from '../services/inventory';
import { PAYMENT_CURRENCY } from './config';

const PAID_STATUSES = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

const opts = (account?: string | null) => (account ? { stripeAccount: account } : undefined);

/** Totals collected and refunded across a booking's payments, in cents. */
async function totalsFor(bookingId: string) {
  const payments = await prisma.payment.findMany({ where: { bookingId, status: { in: PAID_STATUSES } }, select: { amount: true, amountRefunded: true } });
  return {
    paidCents: payments.reduce((s, p) => s + toCents(Number(p.amount)), 0),
    refundedCents: payments.reduce((s, p) => s + toCents(Number(p.amountRefunded)), 0),
  };
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
  const kind = toCents(Number(booking.paymentDue ?? booking.totalPrice)) < toCents(Number(booking.totalPrice)) ? 'DEPOSIT' : 'FULL';
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

  const { paidCents, refundedCents } = await totalsFor(booking.id);
  const paymentStatus = bookingPaymentStatus({ totalCents: toCents(Number(booking.totalPrice)), paidCents, refundedCents });
  const money = (cents: number) => fromCents(cents).toFixed(2);
  const shown = (cents: number) => `${money(cents)} ${booking.currency}`;

  // PENDING → CONFIRMED happens exactly once, whichever event arrives first.
  const confirmed = await prisma.booking.updateMany({ where: { id: booking.id, status: 'PENDING' }, data: { status: 'CONFIRMED', paymentStatus, stripePaymentIntentId: intent.id, expiresAt: null } });
  if (confirmed.count) {
    await prisma.bookingStatusHistory.create({
      data: { bookingId: booking.id, status: 'CONFIRMED', notes: `Confirmed · ${kind === 'DEPOSIT' ? 'Deposit' : 'Payment'} of ${shown(amountCents)} received by card (3D Secure: ${details.threeDSecure ?? 'n/a'})` },
    });
    const guestName = `${booking.user.firstName} ${booking.user.lastName}`.trim();
    await sendBookingConfirmation({
      to: booking.user.email,
      guestName: guestName || booking.user.email,
      propertyName: booking.property.name,
      roomTypeName: booking.roomType.name,
      checkIn: toDateString(booking.checkIn),
      checkOut: toDateString(booking.checkOut),
      guests: booking.guests,
      rooms: booking.rooms,
      totalPrice: Number(booking.totalPrice).toFixed(2),
      bookingId: booking.code ?? booking.id,
      paymentStatus,
      amountPaid: money(paidCents - refundedCents),
      currency: booking.currency,
    });
    return;
  }

  // The hold ran out before the webhook arrived: take the booking back if the rooms are still free.
  if (booking.status === 'CANCELLED' && booking.paymentStatus === 'EXPIRED') {
    const inv = await nightlyInventory(prisma, booking.roomTypeId, toDateString(booking.checkIn), toDateString(booking.checkOut), { excludeBookingId: booking.id });
    const free = inv.minAvailable >= booking.rooms;
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus,
        stripePaymentIntentId: intent.id,
        ...(free ? { status: 'CONFIRMED', expiresAt: null } : {}),
        statusHistory: {
          create: {
            status: free ? 'CONFIRMED' : 'CANCELLED',
            notes: free
              ? `Confirmed · ${shown(amountCents)} arrived after the hold expired and the rooms were still free`
              : `${shown(amountCents)} arrived after the hold expired and the rooms are gone — refund this payment`,
          },
        },
      },
    });
    return;
  }

  // Repeat delivery: only fill in what is still unset, never overwrite refund or dispute states.
  await prisma.booking.updateMany({
    where: { id: booking.id, paymentStatus: { in: ['AWAITING_PAYMENT', 'UNPAID', 'EXPIRED'] } },
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

  const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId }, select: { id: true, totalPrice: true, currency: true, status: true, paymentStatus: true } });
  if (!booking) return;
  // A dispute in progress keeps its own status until it closes.
  if (booking.paymentStatus === 'DISPUTED') return;
  const totals = await totalsFor(booking.id);
  const paymentStatus = bookingPaymentStatus({ totalCents: toCents(Number(booking.totalPrice)), paidCents: totals.paidCents, refundedCents: totals.refundedCents });
  if (paymentStatus !== booking.paymentStatus) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus,
        statusHistory: { create: { status: booking.status, notes: `Refund recorded: ${fromCents(refundedCents).toFixed(2)} of ${fromCents(paidCents).toFixed(2)} ${booking.currency} refunded to the card` } },
      },
    });
  }
}

/** Where a booking's payment status stands once a dispute no longer holds it (won, or no longer open). */
export async function restorePaymentStatus(bookingId: string, lost: boolean): Promise<void> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { totalPrice: true } });
  if (!booking) return;
  const totals = await totalsFor(bookingId);
  const paymentStatus = lost ? 'DISPUTE_LOST' : bookingPaymentStatus({ totalCents: toCents(Number(booking.totalPrice)), paidCents: totals.paidCents, refundedCents: totals.refundedCents });
  await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus } });
}
