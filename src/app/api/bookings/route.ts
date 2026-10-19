import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { toDateString } from '@/lib/date-utils';
import { sendBookingConfirmation } from '@/server/email';
import { clientIp, handleRoute, parseJson } from '@/server/http';
import { badRequest, conflict, unauthorized } from '@/server/errors';
import { confirmationEmailAllowed, confirmPayAtProperty, createBooking } from '@/server/services/bookings';
import { createCheckoutSession } from '@/server/payments/checkout';
import { getPaymentTerms } from '@/server/payments/policy';
import { publicSiteUrl } from '@/server/public-url';

const createBookingSchema = z.object({
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  checkIn: z.string().transform((v) => toDateString(v)),
  checkOut: z.string().transform((v) => toDateString(v)),
  guests: z.coerce.number().int().min(1).max(40),
  rooms: z.coerce.number().int().min(1).max(9).default(1),
  notes: z.string().max(1000).optional().nullable(),
  // The guest ticked the cancellation/refund policy shown on the booking page; `policyHash` says which one.
  // Any client-sent price or payment method is ignored: the total comes from the rate calendar and
  // whether (and how much) to pay online comes from the hotel's payment policy.
  acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'Please accept the cancellation policy to book.' }) }),
  policyHash: z.string().min(1),
});

export const POST = handleRoute(async (request: NextRequest) => {
  const session = await auth();
  if (!session?.user?.id) throw unauthorized('Please sign in to complete your booking.');

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.isActive) throw unauthorized('Your session has expired. Please sign in again.');

  const input = await parseJson(request, createBookingSchema);

  // NOTE: raw card numbers / CVVs are never accepted or stored (PCI compliance).
  // Online card payment happens on Stripe's hosted Checkout, on the hotel's own Stripe account.
  const terms = await getPaymentTerms(input.propertyId);
  if (input.policyHash !== terms.hash) {
    throw conflict('The booking terms for this hotel just changed. Please review them and accept again.');
  }

  const booking = await createBooking({
    userId: user.id,
    propertyId: input.propertyId,
    roomTypeId: input.roomTypeId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms: input.rooms,
    notes: input.notes,
    paymentStatus: 'PAY_AT_PROPERTY',
    createdVia: 'Booked online — pay at property',
    onlinePayment: terms.onlinePayment ? { policy: terms.policy, depositNights: terms.depositNights } : undefined,
    source: 'WEB',
    policyAcceptance: { version: terms.version, hash: terms.hash, text: terms.text, ip: clientIp(request), userAgent: request.headers.get('user-agent') },
  });

  // Online payment: the booking holds its rooms until Stripe confirms the payment (webhook).
  if (booking.paymentStatus === 'AWAITING_PAYMENT') {
    if (!terms.stripeAccountId || booking.paymentDue === null) throw badRequest('Online payment is not available for this hotel right now.');
    const checkout = await createCheckoutSession({
      booking: {
        id: booking.id,
        code: booking.code,
        propertyId: booking.propertyId,
        propertyName: booking.property.name,
        roomTypeName: booking.roomType.name,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        rooms: booking.rooms,
        guests: booking.guests,
        paymentDue: Number(booking.paymentDue),
        totalPrice: Number(booking.totalPrice),
        currency: booking.currency,
      },
      stripeAccountId: terms.stripeAccountId,
      guestEmail: user.email,
      // Return to the host the guest booked on (also right for preview deployments).
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || publicSiteUrl() || request.nextUrl.origin,
    });
    return NextResponse.json({
      success: true,
      requiresPayment: true,
      checkoutUrl: checkout.url,
      amountDue: Number(booking.paymentDue),
      booking: { id: booking.id, code: booking.code, status: booking.status },
    });
  }

  // Pay-at-property bookings are confirmed instantly — the guest is told so.
  // A repeat of a booking made moments ago is already confirmed and emailed.
  const confirmed = booking.duplicate ? booking : await confirmPayAtProperty(booking.id);

  // Accounts aren't email-verified: a handful of confirmations per hour is plenty for a real guest.
  if (!booking.duplicate && (await confirmationEmailAllowed(user.id))) await sendBookingConfirmation({
    to: user.email,
    guestName: `${user.firstName} ${user.lastName}`.trim() || user.email,
    propertyName: booking.property.name,
    roomTypeName: booking.roomType.name,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms: input.rooms,
    totalPrice: Number(booking.totalPrice).toFixed(2),
    currency: booking.currency,
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
      currency: booking.currency,
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
