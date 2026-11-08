import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

let stripe: Stripe | null = null;
if (stripeSecretKey) {
  stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2025-08-27.basil',
  });
} else {
  console.warn('STRIPE_SECRET_KEY is not set. Online card payments are disabled; bookings use "pay at property".');
}

/** True when Stripe is configured and card checkout is available. */
export function isStripeConfigured(): boolean {
  return stripe !== null;
}

export function getStripe(): Stripe {
  if (!stripe) {
    throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).');
  }
  return stripe;
}

/** Public status for the frontend: which payment methods are available. */
export function getPaymentConfig() {
  return {
    stripeEnabled: isStripeConfigured(),
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
  };
}

/** Platform fee on online payments, as a percent of each charge (e.g. "2.5"). Unset or 0 = no fee. */
export function platformFeePercent(): number {
  const n = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 0;
}

/**
 * Webhook signing secrets. Stripe signs events for the platform account and
 * for connected accounts (the hotels) with different endpoint secrets; both
 * endpoints may point at /api/webhooks/stripe.
 */
export function webhookSecrets(): string[] {
  return [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((s): s is string => !!s);
}
