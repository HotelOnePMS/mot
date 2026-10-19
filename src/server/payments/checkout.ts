/**
 * Stripe Checkout (hosted) for a held booking. A direct charge on the hotel's
 * connected account, so the guest pays the hotel and HotelOne never holds the
 * money; an optional platform fee (STRIPE_PLATFORM_FEE_PERCENT) is taken as an
 * application fee. 3D Secure is requested on every card payment.
 */
import { prisma } from '@/lib/prisma';
import { getStripe, platformFeePercent } from '@/lib/stripe';
import { platformFeeCents, toCents } from '@/lib/payments';
import { toDateString } from '@/lib/date-utils';
import { DomainError } from '../errors';
import { expireUnpaidBooking } from './expiry';
import { CHECKOUT_SESSION_SECONDS, PAYMENT_CURRENCY } from './config';

export interface CheckoutBooking {
  id: string;
  code: string | null;
  propertyId: string;
  propertyName: string;
  roomTypeName: string;
  checkIn: Date;
  checkOut: Date;
  rooms: number;
  guests: number;
  paymentDue: number;
  totalPrice: number;
}

export async function createCheckoutSession(input: { booking: CheckoutBooking; stripeAccountId: string; guestEmail: string; siteUrl: string }): Promise<{ url: string; sessionId: string }> {
  const { booking, stripeAccountId, guestEmail, siteUrl } = input;
  const amount = toCents(booking.paymentDue);
  const isDeposit = booking.paymentDue < booking.totalPrice;
  const fee = platformFeeCents(amount, platformFeePercent());
  const label = `${booking.propertyName} — ${booking.roomTypeName}`;
  const dates = `${toDateString(booking.checkIn)} → ${toDateString(booking.checkOut)}, ${booking.rooms} room(s), ${booking.guests} guest(s)`;
  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: guestEmail,
        // Name, email and country come back on the charge and are kept on the Payment record.
        billing_address_collection: 'required',
        client_reference_id: booking.id,
        line_items: [
          {
            price_data: {
              currency: PAYMENT_CURRENCY,
              product_data: { name: isDeposit ? `Deposit — ${label}` : label, description: dates },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        // Ask the bank to verify the cardholder (3D Secure) on every payment.
        payment_method_options: { card: { request_three_d_secure: 'any' } },
        payment_intent_data: {
          description: `${booking.propertyName} booking ${booking.code ?? booking.id}`,
          metadata: { bookingId: booking.id, propertyId: booking.propertyId },
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
        },
        metadata: { bookingId: booking.id, propertyId: booking.propertyId },
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_SECONDS,
        success_url: `${siteUrl}/bookings/${booking.id}?payment=success`,
        cancel_url: `${siteUrl}/bookings/${booking.id}?payment=cancelled`,
      },
      { stripeAccount: stripeAccountId, idempotencyKey: `checkout-${booking.id}` }
    );
    if (!session.url) throw new Error('Stripe returned no checkout URL');
    await prisma.booking.update({ where: { id: booking.id }, data: { stripeCheckoutSessionId: session.id } });
    return { url: session.url, sessionId: session.id };
  } catch (error) {
    // No payment page means no way to pay: give the rooms back instead of holding them.
    console.error('[payments] Could not create the Checkout session:', error);
    await expireUnpaidBooking(booking.id);
    throw new DomainError(502, 'PAYMENT_UNAVAILABLE', 'We couldn’t open the secure payment page. Nothing was charged. Please try again, or contact the hotel.');
  }
}
