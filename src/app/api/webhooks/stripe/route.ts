import { NextRequest, NextResponse } from 'next/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { sendBookingConfirmation } from '@/server/email';
import { toDateString } from '@/lib/date-utils';

/**
 * Stripe webhook — confirms bookings after successful Checkout payment.
 * Configure STRIPE_WEBHOOK_SECRET from the Stripe dashboard webhook endpoint.
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const stripe = getStripe();
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const checkoutSession = event.data.object as {
      id: string;
      metadata?: { bookingId?: string };
      payment_intent?: string;
    };
    const bookingId = checkoutSession.metadata?.bookingId;
    if (!bookingId) {
      console.error('[stripe-webhook] checkout.session.completed without bookingId metadata');
      return NextResponse.json({ received: true });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: true,
        property: true,
        roomType: true,
      },
    });

    if (!booking) {
      console.error(`[stripe-webhook] Booking ${bookingId} not found`);
      return NextResponse.json({ received: true });
    }

    if (booking.paymentStatus !== 'PAID') {
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          stripePaymentIntentId:
            typeof checkoutSession.payment_intent === 'string'
              ? checkoutSession.payment_intent
              : null,
          statusHistory: {
            create: { status: 'CONFIRMED', notes: 'Paid via Stripe Checkout' },
          },
        },
      });

      const guestName = `${booking.user.firstName} ${booking.user.lastName}`.trim();
      await sendBookingConfirmation({
        to: booking.user.email,
        guestName: guestName || booking.user.email,
        propertyName: booking.property.name,
        roomTypeName: booking.roomType.name,
        checkIn: toDateString(booking.checkIn),
        checkOut: toDateString(booking.checkOut),
        guests: booking.guests,
        rooms: booking.rooms,
        totalPrice: booking.totalPrice.toString(),
        // The short code guests can say out loud, like the pay-at-hotel confirmation.
        bookingId: booking.code ?? booking.id,
        paymentStatus: 'PAID',
      });
    }
  }

  // Abandoned checkout: release the held rooms so they can be sold again.
  if (event.type === 'checkout.session.expired') {
    const expired = event.data.object as { metadata?: { bookingId?: string } };
    const bookingId = expired.metadata?.bookingId;
    if (bookingId) {
      const { count } = await prisma.booking.updateMany({
        where: { id: bookingId, status: 'PENDING', paymentStatus: 'AWAITING_PAYMENT' },
        data: { status: 'CANCELLED', paymentStatus: 'EXPIRED' },
      });
      if (count) {
        await prisma.bookingStatusHistory.create({ data: { bookingId, status: 'CANCELLED', notes: 'Online payment not completed — rooms released' } });
      }
    }
  }

  return NextResponse.json({ received: true });
}
