import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, updateMany } = vi.hoisted(() => ({ create: vi.fn(), updateMany: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ checkout: { sessions: { create } } }), platformFeePercent: () => 0 }));
vi.mock('@/lib/prisma', () => ({ prisma: { booking: { updateMany } } }));
vi.mock('@/server/payments/expiry', () => ({ expireUnpaidBooking: vi.fn() }));

import { createCheckoutSession, type CheckoutBooking } from '@/server/payments/checkout';

const booking: CheckoutBooking = {
  id: 'b1',
  code: 'ABC123',
  propertyId: 'p1',
  propertyName: 'Saltwater Inn',
  roomTypeName: 'King',
  checkIn: new Date('2026-11-01T00:00:00Z'),
  checkOut: new Date('2026-11-03T00:00:00Z'),
  rooms: 1,
  guests: 2,
  paymentDue: 200,
  totalPrice: 200,
  currency: 'USD',
};
const input = { bookings: [booking], stripeAccountId: 'acct_1', guestEmail: 'g@example.com', siteUrl: 'https://hotelone.site' };

beforeEach(() => {
  create.mockReset();
  updateMany.mockReset();
});

describe('createCheckoutSession', () => {
  it('opens the hosted page by default', async () => {
    create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1', client_secret: null });
    const out = await createCheckoutSession(input);
    expect(out).toEqual({ url: 'https://checkout.stripe.com/c/cs_1', clientSecret: null, sessionId: 'cs_1' });
    const [params, opts] = create.mock.calls[0];
    expect(params.ui_mode).toBeUndefined();
    expect(params.success_url).toBe('https://hotelone.site/bookings/b1?payment=success');
    expect(params.cancel_url).toBe('https://hotelone.site/bookings/b1?payment=cancelled');
    expect(opts).toEqual({ stripeAccount: 'acct_1', idempotencyKey: 'checkout-b1' });
  });

  it('embeds the form in the page (no redirect for cards) when asked', async () => {
    create.mockResolvedValue({ id: 'cs_2', url: null, client_secret: 'cs_2_secret' });
    const out = await createCheckoutSession({ ...input, embedded: true });
    expect(out).toEqual({ url: null, clientSecret: 'cs_2_secret', sessionId: 'cs_2' });
    const [params, opts] = create.mock.calls[0];
    expect(params).toMatchObject({ ui_mode: 'embedded', redirect_on_completion: 'if_required', return_url: 'https://hotelone.site/bookings/b1?payment=success' });
    // Stripe refuses these with ui_mode embedded.
    expect(params.success_url).toBeUndefined();
    expect(params.cancel_url).toBeUndefined();
    // A different key, so it never replays a hosted session for the same booking.
    expect(opts.idempotencyKey).toBe('checkout-embedded-b1');
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['b1'] } }, data: { stripeCheckoutSessionId: 'cs_2' } });
  });
});
