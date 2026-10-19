import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { toDateString } from '@/lib/date-utils';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { sendBookingConfirmation } from '@/server/email';
import { handleRoute, parseJson } from '@/server/http';
import { badRequest, unauthorized } from '@/server/errors';
import { bookingTotals, confirmationEmailAllowed, confirmPayAtProperty, createBookings } from '@/server/services/bookings';
import { MAX_ROOM_TYPES_PER_BOOKING, MAX_ROOMS_PER_BOOKING } from '@/lib/room-selection';

const createBookingSchema = z
  .object({
    propertyId: z.string().min(1),
    // One room type (roomTypeId + rooms), or a mix of types in `items` ("1 King and 2 Doubles").
    roomTypeId: z.string().min(1).optional(),
    rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_BOOKING).default(1),
    items: z
      .array(z.object({ roomTypeId: z.string().min(1), rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_BOOKING) }))
      .min(1)
      .max(MAX_ROOM_TYPES_PER_BOOKING)
      .optional(),
    checkIn: z.string().transform((v) => toDateString(v)),
    checkOut: z.string().transform((v) => toDateString(v)),
    guests: z.coerce.number().int().min(1).max(40),
    notes: z.string().max(1000).optional().nullable(),
    // 'pay_at_property' (default) or 'stripe'. Any client-sent price is ignored:
    // the total is always computed on the server from the rate calendar.
    paymentMethod: z.enum(['pay_at_property', 'stripe']).default('pay_at_property'),
  })
  .refine((v) => v.items?.length || v.roomTypeId, { message: 'Choose a room.', path: ['roomTypeId'] });

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
  const bookings = await createBookings({
    userId: user.id,
    propertyId: input.propertyId,
    items: input.items ?? [{ roomTypeId: input.roomTypeId!, rooms: input.rooms }],
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    notes: input.notes,
    paymentStatus: isStripe ? 'AWAITING_PAYMENT' : 'PAY_AT_PROPERTY',
    createdVia: isStripe ? 'Booked online — awaiting card payment' : 'Booked online — pay at property',
  });
  const booking = bookings[0];
  const totals = bookingTotals(bookings);

  if (isStripe) {
    const stripe = getStripe();
    // Return to the host the guest booked on (also right for preview deployments).
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
    // One payment for the whole booking: a line per room type.
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: bookings.map((b) => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${b.property.name} — ${b.roomType.name}`,
            description: `${input.checkIn} → ${input.checkOut}, ${b.rooms} room(s), ${b.guests} guest(s)`,
          },
          unit_amount: Math.round(Number(b.totalPrice) * 100),
        },
        quantity: 1,
      })),
      // bookingIds (comma-separated) covers every room type; bookingId stays for the lead reservation.
      metadata: { bookingId: booking.id, bookingIds: bookings.map((b) => b.id).join(',') },
      success_url: `${siteUrl}/bookings/${booking.id}?payment=success`,
      cancel_url: `${siteUrl}/bookings/${booking.id}?payment=cancelled`,
    });
    await prisma.booking.updateMany({ where: { id: { in: bookings.map((b) => b.id) } }, data: { stripeCheckoutSessionId: checkoutSession.id } });
    return NextResponse.json({
      success: true,
      requiresPayment: true,
      checkoutUrl: checkoutSession.url,
      booking: { id: booking.id, code: totals.code, status: booking.status },
    });
  }

  // Pay-at-property bookings are confirmed instantly — the guest is told so.
  let status = booking.status;
  for (const b of bookings) status = (await confirmPayAtProperty(b.id)).status;

  // Accounts aren't email-verified: a handful of confirmations per hour is plenty for a real guest.
  if (await confirmationEmailAllowed(user.id)) await sendBookingConfirmation({
    to: user.email,
    guestName: `${user.firstName} ${user.lastName}`.trim() || user.email,
    propertyName: booking.property.name,
    roomTypeName: totals.roomTypeName,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms: totals.rooms,
    roomsLabel: totals.roomsLabel,
    totalPrice: totals.total.toFixed(2),
    bookingId: totals.code,
    paymentStatus: 'PAY_AT_PROPERTY',
  });

  return NextResponse.json({
    success: true,
    requiresPayment: false,
    booking: {
      id: booking.id,
      code: totals.code,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      status,
      totalPrice: totals.total,
      paymentStatus: 'PAY_AT_PROPERTY',
    },
    // Every reservation in the booking (one per room type).
    bookings: bookings.map((b) => ({ id: b.id, code: b.code, roomTypeId: b.roomTypeId, roomTypeName: b.roomType.name, rooms: b.rooms, guests: b.guests, totalPrice: Number(b.totalPrice) })),
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
