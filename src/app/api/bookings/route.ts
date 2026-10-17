import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { toDateString } from '@/lib/date-utils';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { sendBookingConfirmation } from '@/server/email';
import { handleRoute, parseJson } from '@/server/http';
import { badRequest, unauthorized } from '@/server/errors';
import { confirmationEmailAllowed, confirmPayAtProperty, createBooking } from '@/server/services/bookings';

const createBookingSchema = z.object({
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  checkIn: z.string().transform((v) => toDateString(v)),
  checkOut: z.string().transform((v) => toDateString(v)),
  guests: z.coerce.number().int().min(1).max(40),
  rooms: z.coerce.number().int().min(1).max(9).default(1),
  notes: z.string().max(1000).optional().nullable(),
  // 'pay_at_property' (default) or 'stripe'. Any client-sent price is ignored:
  // the total is always computed on the server from the rate calendar.
  paymentMethod: z.enum(['pay_at_property', 'stripe']).default('pay_at_property'),
});

export const POST = handleRoute(async (request: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw unauthorized('Please sign in to complete your booking.');

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.isActive) throw unauthorized('Your session has expired. Please sign in again.');

  const input = await parseJson(request, createBookingSchema);

  // NOTE: raw card numbers / CVVs are never accepted or stored (PCI compliance).
  // Online card payment goes through Stripe Checkout; otherwise pay at property.
  if (input.paymentMethod === 'stripe' && !isStripeConfigured()) {
    throw badRequest('Online card payment is not enabled. Please choose "Pay at property".');
  }

  const isStripe = input.paymentMethod === 'stripe';
  const booking = await createBooking({
    userId: user.id,
    propertyId: input.propertyId,
    roomTypeId: input.roomTypeId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms: input.rooms,
    notes: input.notes,
    paymentStatus: isStripe ? 'AWAITING_PAYMENT' : 'PAY_AT_PROPERTY',
    createdVia: isStripe ? 'Booked online — awaiting card payment' : 'Booked online — pay at property',
  });

  if (isStripe) {
    const stripe = getStripe();
    // Return to the host the guest booked on (also right for preview deployments).
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${booking.property.name} — ${booking.roomType.name}`,
              description: `${input.checkIn} → ${input.checkOut}, ${input.rooms} room(s), ${input.guests} guest(s)`,
            },
            unit_amount: Math.round(Number(booking.totalPrice) * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { bookingId: booking.id },
      success_url: `${siteUrl}/bookings/${booking.id}?payment=success`,
      cancel_url: `${siteUrl}/bookings/${booking.id}?payment=cancelled`,
    });
    await prisma.booking.update({ where: { id: booking.id }, data: { stripeCheckoutSessionId: checkoutSession.id } });
    return NextResponse.json({
      success: true,
      requiresPayment: true,
      checkoutUrl: checkoutSession.url,
      booking: { id: booking.id, code: booking.code, status: booking.status },
    });
  }

  // Pay-at-property bookings are confirmed instantly — the guest is told so.
  const confirmed = await confirmPayAtProperty(booking.id);

  // Accounts aren't email-verified: a handful of confirmations per hour is plenty for a real guest.
  if (await confirmationEmailAllowed(user.id)) await sendBookingConfirmation({
    to: user.email,
    guestName: `${user.firstName} ${user.lastName}`.trim() || user.email,
    propertyName: booking.property.name,
    roomTypeName: booking.roomType.name,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms: input.rooms,
    totalPrice: Number(booking.totalPrice).toFixed(2),
    bookingId: booking.code ?? booking.id,
    paymentStatus: 'PAY_AT_PROPERTY',
  });

  return NextResponse.json({
    success: true,
    requiresPayment: false,
    booking: {
      id: booking.id,
      code: booking.code,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      status: confirmed.status,
      totalPrice: Number(booking.totalPrice),
      paymentStatus: 'PAY_AT_PROPERTY',
    },
  });
});

/** The signed-in guest's own trips (staff use /api/admin/bookings). */
export const GET = handleRoute(async () => {
  const session = await auth();
  if (!session?.user?.id) throw unauthorized();

  const bookings = await prisma.booking.findMany({
    where: { userId: session.user.id },
    include: {
      property: {
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
          address: true,
          phone: true,
          primaryColor: true,
          photos: { where: { isMain: true }, take: 1 },
        },
      },
      roomType: {
        select: { name: true, capacity: true, photos: { orderBy: { isMain: 'desc' }, take: 1 } },
      },
      room: { select: { roomNumber: true } },
    },
    orderBy: { checkIn: 'desc' },
  });

  return NextResponse.json(
    bookings.map(({ stripeCheckoutSessionId: _s, stripePaymentIntentId: _p, ...b }) => ({
      ...b,
      checkIn: toDateString(b.checkIn),
      checkOut: toDateString(b.checkOut),
      totalPrice: Number(b.totalPrice),
    }))
  );
});
