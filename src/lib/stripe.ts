import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

let stripe: Stripe | null = null;
if (stripeSecretKey) {
  stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2025-08-27.basil',
  });
} else {
  console.warn('STRIPE_SECRET_KEY is not set — online card payments are disabled; bookings use "pay at property".');
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
