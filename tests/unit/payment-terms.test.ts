import { describe, expect, it, vi } from 'vitest';

// A configured Stripe account for the platform; no network calls are made.
vi.mock('@/lib/stripe', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const { termsFor } = await import('@/server/payments/policy');

const hotel = { paymentPolicy: 'DEPOSIT' as const, depositNights: 1, stripeChargesEnabled: true, stripeAccountId: 'acct_123' };

describe('online payment terms and the hotel currency', () => {
  it('offers card payment for two-decimal currencies', () => {
    expect(termsFor({ ...hotel, currency: 'USD' }).onlinePayment).toBe(true);
    expect(termsFor({ ...hotel, currency: 'EUR' }).onlinePayment).toBe(true);
    expect(termsFor(hotel).onlinePayment).toBe(true);
  });

  it('falls back to paying at the property for currencies without cents', () => {
    const jpy = termsFor({ ...hotel, currency: 'JPY' });
    expect(jpy.onlinePayment).toBe(false);
    expect(jpy.policy).toBe('PAY_AT_PROPERTY');
    expect(jpy.stripeAccountId).toBeNull();
    expect(termsFor({ ...hotel, currency: 'KWD' }).onlinePayment).toBe(false);
  });
});
