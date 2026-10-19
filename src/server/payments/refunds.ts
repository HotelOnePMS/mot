/**
 * Refunds, issued by hotel staff from the booking page, back to the original
 * card on the hotel's connected account. The cancellation policy suggests an
 * amount; staff decide.
 */
import { prisma } from '@/lib/prisma';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { fromCents, refundableCents, suggestedRefundCents, toCents } from '@/lib/payments';
import { requireStaff } from '../authz';
import { badRequest } from '../errors';
import { toISODate } from '../dates';
import { recordAudit } from '../services/audit';
import { getBookingForStaff } from '../services/bookings';
import { policyFor } from '../services/guest';
import { hotelLocale } from '../services/hotels';
import { applyRefundState } from './record';

export interface RefundInfo {
  /** Card payments on this booking that can be refunded, newest first. */
  payments: { id: string; amount: number; refunded: number; refundable: number; cardLast4: string | null; cardBrand: string | null; paidAt: string | null }[];
  totalRefundable: number;
  /** What the cancellation policy suggests refunding now. */
  suggested: number;
  deadlinePassed: boolean;
  deadlineLabel: string;
  canRefund: boolean;
}

export async function getRefundInfo(bookingId: string): Promise<RefundInfo> {
  const actor = await requireStaff('payments.refund');
  const booking = await getBookingForStaff(actor, bookingId);
  const payments = await prisma.payment.findMany({
    where: { bookingId: booking.id, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } },
    orderBy: { createdAt: 'desc' },
  });
  // A cancelled booking is judged at the moment it was cancelled; any other, today.
  const cancelledAt =
    booking.status === 'CANCELLED'
      ? (await prisma.bookingStatusHistory.findFirst({ where: { bookingId: booking.id, status: 'CANCELLED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt
      : undefined;
  const { timezone } = await hotelLocale(booking.propertyId);
  const policy = policyFor(toISODate(booking.checkIn), timezone, cancelledAt ?? new Date());
  const rows = payments.map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    refunded: Number(p.amountRefunded),
    refundable: fromCents(refundableCents(toCents(Number(p.amount)), toCents(Number(p.amountRefunded)))),
    cardLast4: p.cardLast4,
    cardBrand: p.cardBrand,
    paidAt: p.paidAt?.toISOString() ?? null,
  }));
  const totalRefundable = rows.reduce((s, r) => s + toCents(r.refundable), 0);
  const suggested = suggestedRefundCents({
    paidCents: rows.reduce((s, r) => s + toCents(r.amount), 0),
    refundedCents: rows.reduce((s, r) => s + toCents(r.refunded), 0),
    deadlinePassed: policy.passed,
  });
  return {
    payments: rows,
    totalRefundable: fromCents(totalRefundable),
    suggested: fromCents(suggested),
    deadlinePassed: policy.passed,
    deadlineLabel: policy.deadlineLabel,
    canRefund: totalRefundable > 0 && isStripeConfigured(),
  };
}

/** Refund part or all of one payment. `amount` is in the payment's currency; omit it to refund what is left. */
export async function refundPayment(bookingId: string, input: { paymentId: string; amount?: number; reason?: string }): Promise<{ refunded: number; remaining: number }> {
  const actor = await requireStaff('payments.refund');
  const booking = await getBookingForStaff(actor, bookingId);
  if (!isStripeConfigured()) throw badRequest('Online payments aren’t enabled on this deployment.');
  // The payment must belong to this booking, which getBookingForStaff already scoped to the actor's property.
  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, bookingId: booking.id, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } },
    include: { property: { select: { stripeAccountId: true } } },
  });
  if (!payment) throw badRequest('That payment can’t be refunded.');
  const paid = toCents(Number(payment.amount));
  const already = toCents(Number(payment.amountRefunded));
  const left = refundableCents(paid, already);
  const cents = input.amount === undefined ? left : toCents(input.amount);
  if (!Number.isFinite(cents) || cents <= 0) throw badRequest('Enter an amount to refund.');
  if (cents > left) throw badRequest(`Only ${fromCents(left).toFixed(2)} ${payment.currency.toUpperCase()} is left to refund on this payment.`);

  const stripe = getStripe();
  const account = payment.property.stripeAccountId ? { stripeAccount: payment.property.stripeAccountId } : undefined;
  await stripe.refunds.create(
    {
      payment_intent: payment.stripePaymentIntentId,
      amount: cents,
      reason: 'requested_by_customer',
      // Hand back the platform's cut of what is refunded too.
      refund_application_fee: !!payment.applicationFee,
      metadata: { bookingId: booking.id, refundedBy: actor.userId, ...(input.reason ? { note: input.reason.slice(0, 200) } : {}) },
    },
    // Same refund requested twice (double click, retry) is created once.
    { ...account, idempotencyKey: `refund-${payment.id}-${already}-${cents}` }
  );
  // Read the total back so the page is right immediately; the charge.refunded webhook sets the same value.
  const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, { expand: ['latest_charge'] }, account);
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const total = charge ? charge.amount_refunded : already + cents;
  await applyRefundState({ paymentIntentId: payment.stripePaymentIntentId, amountRefundedCents: total });
  await recordAudit({ actor, source: 'classic' }, booking.propertyId, 'PAYMENT_REFUND', `Refunded ${fromCents(cents).toFixed(2)} ${payment.currency.toUpperCase()} on ${booking.code ?? 'booking'}${input.reason ? ` (${input.reason.slice(0, 80)})` : ''}`, {
    bookingId: booking.id,
    paymentId: payment.id,
  });
  return { refunded: fromCents(cents), remaining: fromCents(refundableCents(paid, total)) };
}
