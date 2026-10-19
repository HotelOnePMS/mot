import { DEFAULT_HIGH_AMOUNT } from '@/lib/risk';

/** Bookings worth at least this much (in dollars) get the "High amount" flag. PAYMENTS_HIGH_AMOUNT_THRESHOLD overrides it. */
export function highAmountThreshold(): number {
  const n = Number(process.env.PAYMENTS_HIGH_AMOUNT_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HIGH_AMOUNT;
}

/** Minutes an unpaid online booking holds its rooms. Stripe Checkout sessions last at least 30 minutes, so the hold outlasts the session. */
export const HOLD_MINUTES = 35;
/** Checkout session lifetime in seconds (Stripe's minimum is 30 minutes; a little extra absorbs request latency). */
export const CHECKOUT_SESSION_SECONDS = 30 * 60 + 30;

/** The only currency online payments use today (the app prices in USD). */
export const PAYMENT_CURRENCY = 'usd';
