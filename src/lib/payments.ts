/**
 * Payment policy and amounts. Pure functions (no imports) so the booking page,
 * the API and the unit tests all use the same rules.
 *
 * Money is handled in integer cents; prices in the rest of the app are
 * dollars with two decimals.
 */

export type PaymentPolicy = 'PAY_AT_PROPERTY' | 'DEPOSIT' | 'FULL_PREPAYMENT';

export const PAYMENT_POLICIES: readonly PaymentPolicy[] = ['PAY_AT_PROPERTY', 'DEPOSIT', 'FULL_PREPAYMENT'];

/** Bump when the wording of {@link cancellationPolicyText} changes: every acceptance records it. */
export const POLICY_VERSION = '2026-10-v1';

export const MAX_DEPOSIT_NIGHTS = 14;

export const PAYMENT_POLICY_LABEL: Record<PaymentPolicy, string> = {
  PAY_AT_PROPERTY: 'Pay at the property',
  DEPOSIT: 'Deposit at booking',
  FULL_PREPAYMENT: 'Full prepayment',
};

export const toCents = (dollars: number): number => Math.round(dollars * 100);
export const fromCents = (cents: number): number => Math.round(cents) / 100;

/**
 * The policy that applies right now. A hotel that asks for payment but has no
 * working Stripe account (or Stripe is off on this deployment) falls back to
 * pay at the property, so a guest is never sent to a checkout that can't work.
 */
export function effectivePolicy(input: { policy: PaymentPolicy; stripeConfigured: boolean; chargesEnabled: boolean }): PaymentPolicy {
  return input.stripeConfigured && input.chargesEnabled ? input.policy : 'PAY_AT_PROPERTY';
}

export interface AmountDue {
  /** Charged at booking, in cents (0 when paying at the property). */
  dueNowCents: number;
  /** Left for the property to collect, in cents. */
  balanceCents: number;
  kind: 'NONE' | 'DEPOSIT' | 'FULL';
}

/**
 * What is charged at booking.
 * @param nightlyCents the room's price for each night of the stay, in cents, for ONE room, in stay order
 * @param totalCents the stay's total in cents (all rooms)
 */
export function paymentAmountDue(input: {
  policy: PaymentPolicy;
  depositNights: number;
  nightlyCents: readonly number[];
  rooms: number;
  totalCents: number;
}): AmountDue {
  const total = Math.max(0, Math.round(input.totalCents));
  if (input.policy === 'PAY_AT_PROPERTY' || total === 0) return { dueNowCents: 0, balanceCents: total, kind: 'NONE' };
  if (input.policy === 'FULL_PREPAYMENT') return { dueNowCents: total, balanceCents: 0, kind: 'FULL' };
  const nights = Math.min(Math.max(1, Math.floor(input.depositNights) || 1), MAX_DEPOSIT_NIGHTS);
  const deposit = input.nightlyCents.slice(0, nights).reduce((sum, n) => sum + n, 0) * Math.max(1, input.rooms);
  const due = Math.min(total, Math.max(0, deposit));
  return { dueNowCents: due, balanceCents: total - due, kind: due >= total ? 'FULL' : 'DEPOSIT' };
}

/** Platform fee on a charge, in cents. `percent` is e.g. 2.5 for 2.5%. */
export function platformFeeCents(amountCents: number, percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(amountCents, Math.round((amountCents * Math.min(percent, 100)) / 100));
}

/**
 * The cancellation and refund policy the guest accepts at booking. It carries
 * no amounts (those are on screen) so the recorded text and hash are the same
 * for every stay under the same policy.
 */
export function cancellationPolicyText(input: { policy: PaymentPolicy; depositNights: number }): string {
  const base =
    'Free changes and cancellation until 3:00 PM (hotel time) on the day before check-in. After that, contact the hotel; changes and refunds are at the hotel’s discretion.';
  if (input.policy === 'PAY_AT_PROPERTY') {
    return `${base} Nothing is charged online. You pay the hotel during your stay.`;
  }
  if (input.policy === 'FULL_PREPAYMENT') {
    return `${base} The full amount is charged by card when you book. If you cancel in time, the full payment is refunded to the original card. After the deadline, a refund is at the hotel’s discretion. No-shows are not refunded unless the hotel decides otherwise.`;
  }
  const n = Math.min(Math.max(1, Math.floor(input.depositNights) || 1), MAX_DEPOSIT_NIGHTS);
  return `${base} A deposit of ${n} ${n === 1 ? 'night' : 'nights'} is charged by card when you book, and the balance is paid at the hotel. If you cancel in time, the deposit is refunded to the original card. After the deadline, a refund is at the hotel’s discretion. No-shows are not refunded unless the hotel decides otherwise.`;
}

/** Money still refundable on a payment, in cents. */
export function refundableCents(paidCents: number, refundedCents: number): number {
  return Math.max(0, Math.round(paidCents) - Math.round(refundedCents));
}

/**
 * What the cancellation policy suggests refunding, in cents: everything that
 * is still refundable if the guest cancelled before the free-cancellation
 * deadline, otherwise nothing (the hotel may still choose to refund).
 */
export function suggestedRefundCents(input: { paidCents: number; refundedCents: number; deadlinePassed: boolean }): number {
  return input.deadlinePassed ? 0 : refundableCents(input.paidCents, input.refundedCents);
}

/**
 * Splits `cents` across parts in proportion to `weights`, in whole cents that
 * add up exactly (largest remainder). Equal parts when every weight is zero.
 * Used to show each room type of a reservation its share of the one payment.
 */
export function allocateCents(cents: number, weights: readonly number[]): number[] {
  if (!weights.length) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((s, x) => s + x, 0);
  const share = sum > 0 ? w.map((x) => (cents * x) / sum) : w.map(() => cents / w.length);
  const out = share.map(Math.floor);
  let left = cents - out.reduce((s, x) => s + x, 0);
  const order = share.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

/** Booking payment status once the money moves: PAID, DEPOSIT_PAID, or the refund states. */
export function bookingPaymentStatus(input: { totalCents: number; paidCents: number; refundedCents: number }): string {
  const { totalCents, paidCents, refundedCents } = input;
  if (paidCents <= 0) return 'AWAITING_PAYMENT';
  if (refundedCents >= paidCents) return 'REFUNDED';
  if (refundedCents > 0) return 'PARTIALLY_REFUNDED';
  return paidCents >= totalCents ? 'PAID' : 'DEPOSIT_PAID';
}
