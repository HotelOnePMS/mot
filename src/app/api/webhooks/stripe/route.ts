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
      metadata?: { bookingId?: string; bookingIds?: string };
      payment_intent?: string;
    };
    const bookingIds = sessionBookingIds(checkoutSession.metadata);
    if (!bookingIds.length) {
      console.error('[stripe-webhook] checkout.session.completed without bookingId metadata');
      return NextResponse.json({ received: true });
    }

    // Every room type of the reservation, lead first (one payment covers them all).
    const bookings = (
      await prisma.booking.findMany({
        where: { id: { in: bookingIds } },
        include: { user: true, property: true, roomType: true },
      })
    ).sort((a, b) => bookingIds.indexOf(a.id) - bookingIds.indexOf(b.id));

    if (!bookings.length) {
      console.error(`[stripe-webhook] Booking ${bookingIds.join(', ')} not found`);
      return NextResponse.json({ received: true });
    }

    const unpaid = bookings.filter((b) => b.paymentStatus !== 'PAID');
    if (unpaid.length) {
      for (const b of unpaid) {
        await prisma.booking.update({
          where: { id: b.id },
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
      }

      const [lead] = bookings;
      const guestName = `${lead.user.firstName} ${lead.user.lastName}`.trim();
      await sendBookingConfirmation({
        to: lead.user.email,
        guestName: guestName || lead.user.email,
        propertyName: lead.property.name,
        roomTypeName: lead.roomType.name,
        lines: bookings.map((b) => ({ roomTypeName: b.roomType.name, rooms: b.rooms })),
        checkIn: toDateString(lead.checkIn),
        checkOut: toDateString(lead.checkOut),
        guests: bookings.reduce((s, b) => s + b.guests, 0),
        rooms: bookings.reduce((s, b) => s + b.rooms, 0),
        totalPrice: bookings.reduce((s, b) => s + Number(b.totalPrice), 0).toFixed(2),
        // The short code guests can say out loud, like the pay-at-hotel confirmation.
        bookingId: lead.code ?? lead.id,
        paymentStatus: 'PAID',
      });
    }
  }

  // Abandoned checkout: release the held rooms so they can be sold again.
  if (event.type === 'checkout.session.expired') {
    const expired = event.data.object as { metadata?: { bookingId?: string; bookingIds?: string } };
    for (const bookingId of sessionBookingIds(expired.metadata)) {
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

/** The bookings a Checkout session pays for: `bookingIds` (every room type of a reservation), else the single `bookingId`. */
function sessionBookingIds(metadata: { bookingId?: string; bookingIds?: string } | undefined): string[] {
  const ids = metadata?.bookingIds?.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids?.length) return ids;
  return metadata?.bookingId ? [metadata.bookingId] : [];
}
