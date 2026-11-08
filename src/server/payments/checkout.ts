/**
 * Stripe Checkout (hosted) for a held booking. A direct charge on the hotel's
 * connected account, so the guest pays the hotel and HotelOne never holds the
 * money; an optional platform fee (STRIPE_PLATFORM_FEE_PERCENT) is taken as an
 * application fee. 3D Secure is requested on every card payment. Several room
 * types booked together are paid on one page with one payment.
 */
import { prisma } from '@/lib/prisma';
import { getStripe, platformFeePercent } from '@/lib/stripe';
import { platformFeeCents, toCents } from '@/lib/payments';
import { toDateString } from '@/lib/date-utils';
import { DomainError } from '../errors';
import { expireUnpaidBooking } from './expiry';
import { CHECKOUT_SESSION_SECONDS } from './config';

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
  /** The hotel's currency (ISO 4217); online payments are only offered for two-decimal currencies (policy.ts). */
  currency: string;
}

/**
 * One Checkout page for a reservation: a line item per booking (several room
 * types booked together are paid at once), charged in the hotel's currency.
 * The first booking is the lead: its id is the session's and the payment's
 * `bookingId`, and every booking's id is in `bookingIds`.
 */
export async function createCheckoutSession(input: { bookings: CheckoutBooking[]; stripeAccountId: string; guestEmail: string; siteUrl: string }): Promise<{ url: string; sessionId: string }> {
  const { bookings, stripeAccountId, guestEmail, siteUrl } = input;
  const [lead] = bookings;
  if (!lead) throw new Error('createCheckoutSession needs at least one booking');
  const amount = bookings.reduce((s, b) => s + toCents(b.paymentDue), 0);
  const isDeposit = amount < bookings.reduce((s, b) => s + toCents(b.totalPrice), 0);
  const fee = platformFeeCents(amount, platformFeePercent());
  const metadata = { bookingId: lead.id, bookingIds: bookings.map((b) => b.id).join(','), propertyId: lead.propertyId };
  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: guestEmail,
        // Name, email and country come back on the charge and are kept on the Payment record.
        billing_address_collection: 'required',
        client_reference_id: lead.id,
        line_items: bookings
          .filter((b) => toCents(b.paymentDue) > 0)
          .map((b) => {
            const label = `${b.propertyName}: ${b.roomTypeName}`;
            return {
              price_data: {
                currency: b.currency.toLowerCase(),
                product_data: {
                  name: isDeposit ? `Deposit: ${label}` : label,
                  description: `${toDateString(b.checkIn)} → ${toDateString(b.checkOut)}, ${b.rooms} room(s), ${b.guests} guest(s)`,
                },
                unit_amount: toCents(b.paymentDue),
              },
              quantity: 1,
            };
          }),
        // Ask the bank to verify the cardholder (3D Secure) on every payment.
        payment_method_options: { card: { request_three_d_secure: 'any' } },
        payment_intent_data: {
          description: `${lead.propertyName} booking ${lead.code ?? lead.id}`,
          metadata,
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
        },
        metadata,
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_SECONDS,
        success_url: `${siteUrl}/bookings/${lead.id}?payment=success`,
        cancel_url: `${siteUrl}/bookings/${lead.id}?payment=cancelled`,
      },
      { stripeAccount: stripeAccountId, idempotencyKey: `checkout-${lead.id}` }
    );
    if (!session.url) throw new Error('Stripe returned no checkout URL');
    await prisma.booking.updateMany({ where: { id: { in: bookings.map((b) => b.id) } }, data: { stripeCheckoutSessionId: session.id } });
    return { url: session.url, sessionId: session.id };
  } catch (error) {
    // No payment page means no way to pay: give the rooms back instead of holding them.
    console.error('[payments] Could not create the Checkout session:', error);
    await expireUnpaidBooking(lead.id);
    throw new DomainError(502, 'PAYMENT_UNAVAILABLE', 'We couldn’t open the secure payment page. Nothing was charged. Please try again, or contact the hotel.');
  }
}
