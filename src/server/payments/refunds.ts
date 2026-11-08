/**
 * Refunds, issued by hotel staff from the booking page, back to the original
 * card on the hotel's connected account. The cancellation policy suggests an
 * amount; staff decide.
 */
import { prisma } from '@/lib/prisma';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { CARD_NUMBER_REFUSED, containsCardNumber } from '@/lib/desk-payments';
import { fromCents, refundableCents, suggestedRefundCents, toCents } from '@/lib/payments';
import { requirePermission, requireStaff, type Actor } from '../authz';
import { badRequest } from '../errors';
import { toISODate } from '../dates';
import { recordAudit, type OpContext } from '../services/audit';
import { getBookingForStaff } from '../services/bookings';
import { addAllowance, stayBalance } from '../services/folio';
import { policyFor } from '../services/guest';
import { hotelLocale } from '../services/hotels';
import { toBookingSummary } from '../services/mappers';
import { applyRefundState, lineAccount, paymentLines, planRefundShares, recordRefundShares, refreshPaymentStatus } from './record';

/**
 * Card payments refunded here, back to the card. Cash is handed back at the
 * desk, and security deposits are returned with the desk's deposit actions
 * (desk.ts), so neither is listed.
 */
const REFUNDABLE = { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] }, stripePaymentIntentId: { not: null }, kind: { not: 'SECURITY_DEPOSIT' } };

export interface RefundInfo {
  /** Card payments on this booking that can be refunded, newest first. */
  payments: { id: string; amount: number; refunded: number; refundable: number; cardLast4: string | null; cardBrand: string | null; paidAt: string | null }[];
  totalRefundable: number;
  /** What the cancellation policy suggests refunding now. */
  suggested: number;
  deadlinePassed: boolean;
  deadlineLabel: string;
  canRefund: boolean;
  /** Set when the payment covers every room type of a reservation booked together. */
  reservation: { code: string; roomTypes: number } | null;
  /** What the guest still owes for the stay (the reservation's, when shared); negative: a credit owed back to them. */
  balance: number;
}

export async function getRefundInfo(bookingId: string): Promise<RefundInfo> {
  return refundInfoFor(await requireStaff('payments.refund'), bookingId);
}

/** getRefundInfo for a given person (the console's signed-in staff member, or the agent's). */
export async function refundInfoFor(actor: Actor, bookingId: string): Promise<RefundInfo> {
  requirePermission(actor, 'payments.refund');
  const booking = await getBookingForStaff(actor, bookingId);
  // Several room types booked together were paid with one payment, on the lead line.
  const lines = await paymentLines(booking);
  const payments = await prisma.payment.findMany({
    where: { bookingId: { in: lines.map((l) => l.id) }, ...REFUNDABLE },
    orderBy: { createdAt: 'desc' },
  });
  // Only some room types of a reservation cancelled: the policy is about what was charged for those.
  const cancelledLines = lines.filter((l) => l.status === 'CANCELLED');
  const partial = lines.length > 1 && cancelledLines.length > 0 && cancelledLines.length < lines.length;
  // A cancellation is judged at the moment it happened; anything else, today.
  const judged = booking.status === 'CANCELLED' ? [booking.id] : partial ? cancelledLines.map((l) => l.id) : [];
  const cancelledAt = judged.length
    ? (await prisma.bookingStatusHistory.findFirst({ where: { bookingId: { in: judged }, status: 'CANCELLED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt
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
  const refundedCents = rows.reduce((s, r) => s + toCents(r.refunded), 0);
  let suggested = suggestedRefundCents({ paidCents: rows.reduce((s, r) => s + toCents(r.amount), 0), refundedCents, deadlinePassed: policy.passed });
  // Only what the cancelled room types still hold (refunds so far count against them first).
  if (partial) {
    const account = await lineAccount(booking);
    const cancelled = new Set(cancelledLines.map((l) => l.id));
    suggested = Math.min(suggested, (account?.lines ?? []).reduce((s, l) => s + (cancelled.has(l.id) ? Math.max(0, l.heldCents) : 0), 0));
  }
  return {
    payments: rows,
    totalRefundable: fromCents(totalRefundable),
    suggested: fromCents(suggested),
    deadlinePassed: policy.passed,
    deadlineLabel: policy.deadlineLabel,
    canRefund: totalRefundable > 0 && isStripeConfigured(),
    reservation: lines.length > 1 ? { code: lines[0].code ?? booking.code ?? booking.id, roomTypes: lines.length } : null,
    balance: stayBalance(booking),
  };
}

export interface RefundInput {
  paymentId: string;
  amount?: number;
  reason?: string;
  allowance?: boolean;
}

/** Refund part or all of one payment. `amount` is in the payment's currency; omit it to refund what is left. */
export async function refundPayment(bookingId: string, input: RefundInput): Promise<{ refunded: number; remaining: number; allowanceError?: string }> {
  const actor = await requireStaff('payments.refund');
  return refundPaymentAs({ actor, source: 'classic' }, bookingId, input);
}

/** refundPayment for a given person: the console's button, or a plan they confirmed in the agent. */
export async function refundPaymentAs(op: OpContext, bookingId: string, input: RefundInput): Promise<{ refunded: number; remaining: number; allowanceError?: string }> {
  const { actor } = op;
  requirePermission(actor, 'payments.refund');
  const booking = await getBookingForStaff(actor, bookingId);
  if (!isStripeConfigured()) throw badRequest('Online payments aren’t enabled on this deployment.');
  // The payment must belong to this booking (or its reservation), which getBookingForStaff already scoped to the actor's property.
  const lines = await paymentLines(booking);
  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, bookingId: { in: lines.map((l) => l.id) }, ...REFUNDABLE },
    include: { property: { select: { stripeAccountId: true } } },
  });
  if (!payment?.stripePaymentIntentId) throw badRequest('That payment can’t be refunded.');
  const intentId = payment.stripePaymentIntentId;
  const paid = toCents(Number(payment.amount));
  const already = toCents(Number(payment.amountRefunded));
  const left = refundableCents(paid, already);
  const cents = input.amount === undefined ? left : toCents(input.amount);
  if (!Number.isFinite(cents) || cents <= 0) throw badRequest('Enter an amount to refund.');
  if (cents > left) throw badRequest(`Only ${fromCents(left).toFixed(2)} ${payment.currency.toUpperCase()} is left to refund on this payment.`);
  // Goodwill or unused nights: the stay also costs that much less (an allowance), so the refund isn't owed again.
  // Checked before any money moves.
  const allowanceReason = input.reason?.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Refunded to the card';
  // The note goes to Stripe and the activity log: never a card number.
  if (containsCardNumber(input.reason)) throw badRequest(CARD_NUMBER_REFUSED);
  if (input.allowance) {
    requirePermission(actor, 'folio.adjust');
    if (allowanceReason.length < 3) throw badRequest('Say why the stay costs less (for example “air conditioning broken” or “left a night early”).');
    if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') throw badRequest('This reservation is closed, so there’s nothing to take off what it costs. Refund without an allowance.');
    const summary = toBookingSummary(booking);
    // Already in credit (an allowance lowered the charges after they were paid), on this stay or anywhere in its
    // reservation: refund that credit as it is; another allowance would take the same money off twice.
    const balance = stayBalance(booking);
    if (balance < -0.004) {
      throw badRequest(`The guest already has a credit of ${fromCents(toCents(-balance)).toFixed(2)} ${payment.currency.toUpperCase()} on this stay. Refund it without an allowance.`);
    }
    const leftCents = toCents(Number(booking.totalPrice)) - toCents(summary.allowances);
    if (cents > leftCents) throw badRequest(`An allowance can take off at most ${fromCents(Math.max(0, leftCents)).toFixed(2)} ${payment.currency.toUpperCase()}. Refund that much, or refund without an allowance.`);
  }

  // Which room types of a reservation booked together it comes off: this one first for an allowance on it, or when made
  // from a cancelled room type's page; otherwise a credit first (refundPlan).
  const ended = booking.status === 'CANCELLED' || booking.status === 'NO_SHOW';
  const shares = await planRefundShares(booking, cents, input.allowance || ended ? booking.id : undefined);
  const key = `refund-${payment.id}-${already}-${cents}`;

  const stripe = getStripe();
  const account = payment.property.stripeAccountId ? { stripeAccount: payment.property.stripeAccountId } : undefined;
  await stripe.refunds.create(
    {
      payment_intent: intentId,
      amount: cents,
      reason: 'requested_by_customer',
      // Hand back the platform's cut of what is refunded too.
      refund_application_fee: !!payment.applicationFee,
      metadata: { bookingId: booking.id, refundedBy: actor.userId, ...(input.reason ? { note: input.reason.slice(0, 200) } : {}) },
    },
    // Same refund requested twice (double click, retry) is created once.
    { ...account, idempotencyKey: key }
  );
  // Before the refund is counted (here or by the charge.refunded webhook, which may come first), so the statuses use it.
  await recordRefundShares(payment.id, key, shares);
  // Read the total back so the page is right immediately; the charge.refunded webhook sets the same value.
  const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] }, account);
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const total = charge ? charge.amount_refunded : already + cents;
  await applyRefundState({ paymentIntentId: intentId, amountRefundedCents: total });
  // The webhook got there between the two: its statuses were worked out before the room types were recorded.
  if (shares) await refreshPaymentStatus(booking);
  await recordAudit(op, booking.propertyId, 'PAYMENT_REFUND', `Refunded ${fromCents(cents).toFixed(2)} ${payment.currency.toUpperCase()} on ${booking.code ?? 'booking'}${input.reason ? ` (${input.reason.slice(0, 80)})` : ''}`, {
    bookingId: booking.id,
    paymentId: payment.id,
  });
  const result = { refunded: fromCents(cents), remaining: fromCents(refundableCents(paid, total)) };
  if (input.allowance) {
    // The money has moved: if the allowance can't be added now (another one took the charges off a moment ago), say so
    // instead of failing a refund that went through. One allowance per refund, even if the request is sent twice.
    try {
      await addAllowance(op, booking.id, { amount: fromCents(cents), reason: allowanceReason, id: `rf-${payment.id}-${already}-${cents}` });
    } catch (e) {
      return { ...result, allowanceError: `The refund went through, but the allowance wasn’t added: ${(e as Error).message}` };
    }
  }
  return result;
}
