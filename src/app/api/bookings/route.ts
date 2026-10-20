import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { toDateString } from '@/lib/date-utils';
import { MAX_RESERVATION_LINES, MAX_RESERVATION_ROOMS } from '@/lib/booking-lines';
import { fromCents, toCents } from '@/lib/payments';
import { sendBookingConfirmation } from '@/server/email';
import { clientIp, handleRoute, parseJson } from '@/server/http';
import { badRequest, conflict, unauthorized } from '@/server/errors';
import { confirmationEmailAllowed, confirmReservationPayAtProperty, createReservation } from '@/server/services/bookings';
import { createCheckoutSession } from '@/server/payments/checkout';
import { getPaymentTerms } from '@/server/payments/policy';
import { publicSiteUrl } from '@/server/public-url';
import { getPaymentConfig } from '@/lib/stripe';

const createBookingSchema = z
  .object({
    propertyId: z.string().min(1),
    // One room type (roomTypeId + rooms), or several for the same stay (lines).
    roomTypeId: z.string().min(1).optional(),
    rooms: z.coerce.number().int().min(1).max(MAX_RESERVATION_ROOMS).default(1),
    lines: z
      .array(z.object({ roomTypeId: z.string().min(1), rooms: z.coerce.number().int().min(1).max(MAX_RESERVATION_ROOMS) }))
      .min(1)
      .max(MAX_RESERVATION_LINES)
      .optional(),
    checkIn: z.string().transform((v) => toDateString(v)),
    checkOut: z.string().transform((v) => toDateString(v)),
    guests: z.coerce.number().int().min(1).max(40),
    notes: z.string().max(1000).optional().nullable(),
    // The guest ticked the cancellation/refund policy shown on the booking page; `policyHash` says which one.
    // Any client-sent price or payment method is ignored: the total comes from the rate calendar and
    // whether (and how much) to pay online comes from the hotel's payment policy.
    acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'Please accept the cancellation policy to book.' }) }),
    policyHash: z.string().min(1),
    // The page can show Stripe's embedded payment form (it stays on the site, so a voice call carries on).
    embeddedCheckout: z.boolean().optional(),
  })
  .refine((v) => v.lines || v.roomTypeId, { message: 'Choose a room.', path: ['roomTypeId'] });

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

  // Several room types for the same stay are one reservation: one code, one payment.
  const bookings = await createReservation({
    userId: user.id,
    propertyId: input.propertyId,
    lines: input.lines ?? [{ roomTypeId: input.roomTypeId!, rooms: input.rooms }],
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    notes: input.notes,
    paymentStatus: 'PAY_AT_PROPERTY',
    createdVia: 'Booked online — pay at property',
    onlinePayment: terms.onlinePayment ? { policy: terms.policy, depositNights: terms.depositNights } : undefined,
    source: 'WEB',
    policyAcceptance: { version: terms.version, hash: terms.hash, text: terms.text, ip: clientIp(request), userAgent: request.headers.get('user-agent') },
  });
  const [lead] = bookings;
  const rooms = bookings.reduce((s, b) => s + b.rooms, 0);
  const total = fromCents(bookings.reduce((s, b) => s + toCents(Number(b.totalPrice)), 0));
  const lines = bookings.map((b) => ({ id: b.id, code: b.code, roomTypeId: b.roomTypeId, roomTypeName: b.roomType.name, rooms: b.rooms, guests: b.guests, totalPrice: Number(b.totalPrice) }));

  // Online payment: the reservation holds its rooms until Stripe confirms the payment (webhook).
  if (lead.paymentStatus === 'AWAITING_PAYMENT') {
    if (!terms.stripeAccountId || bookings.some((b) => b.paymentDue === null)) throw badRequest('Online payment is not available for this hotel right now.');
    const { publishableKey } = getPaymentConfig();
    const embedded = !!input.embeddedCheckout && !!publishableKey;
    const checkout = await createCheckoutSession({
      embedded,
      bookings: bookings.map((b) => ({
        id: b.id,
        code: b.code,
        propertyId: b.propertyId,
        propertyName: b.property.name,
        roomTypeName: b.roomType.name,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        rooms: b.rooms,
        guests: b.guests,
        paymentDue: Number(b.paymentDue),
        totalPrice: Number(b.totalPrice),
        currency: b.currency,
      })),
      stripeAccountId: terms.stripeAccountId,
      guestEmail: user.email,
      // Return to the host the guest booked on (also right for preview deployments).
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || publicSiteUrl() || request.nextUrl.origin,
    });
    return NextResponse.json({
      success: true,
      requiresPayment: true,
      // Hosted page to open, or what Stripe.js needs to show the form on this page.
      checkoutUrl: checkout.url,
      ...(embedded && checkout.clientSecret
        ? { checkout: { clientSecret: checkout.clientSecret, publishableKey, stripeAccount: terms.stripeAccountId } }
        : {}),
      amountDue: fromCents(bookings.reduce((s, b) => s + toCents(Number(b.paymentDue)), 0)),
      booking: { id: lead.id, code: lead.code, status: lead.status },
      lines,
    });
  }

  // Pay-at-property bookings are confirmed instantly — the guest is told so.
  // A repeat of a booking made moments ago is already confirmed and emailed.
  const [confirmed] = lead.duplicate ? [lead] : await confirmReservationPayAtProperty(bookings.map((b) => b.id));

  // Accounts aren't email-verified: a handful of confirmations per hour is plenty for a real guest.
  if (!lead.duplicate && (await confirmationEmailAllowed(user.id))) await sendBookingConfirmation({
    to: user.email,
    guestName: `${user.firstName} ${user.lastName}`.trim() || user.email,
    propertyName: lead.property.name,
    roomTypeName: lead.roomType.name,
    lines: bookings.map((b) => ({ roomTypeName: b.roomType.name, rooms: b.rooms })),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms,
    totalPrice: total.toFixed(2),
    currency: lead.currency,
    bookingId: lead.code ?? lead.id,
    paymentStatus: 'PAY_AT_PROPERTY',
  });

  return NextResponse.json({
    success: true,
    requiresPayment: false,
    booking: {
      id: lead.id,
      code: lead.code,
      checkIn: lead.checkIn,
      checkOut: lead.checkOut,
      status: confirmed.status,
      totalPrice: total,
      currency: lead.currency,
      paymentStatus: 'PAY_AT_PROPERTY',
    },
    lines,
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

  // Several room types booked together are one trip, under the code the guest was given.
  const trips = new Map<string, typeof bookings>();
  for (const b of bookings) trips.set(b.groupCode ?? b.id, [...(trips.get(b.groupCode ?? b.id) ?? []), b]);

  return NextResponse.json(
    [...trips.values()].map((group) => {
      // Lead first, then in booking order, as the guest was shown them.
      const rows = [...group].sort((a, b) => Number(b.code === b.groupCode) - Number(a.code === a.groupCode) || a.createdAt.getTime() - b.createdAt.getTime());
      const live = rows.filter((r) => r.status !== 'CANCELLED' && r.status !== 'NO_SHOW');
      const counted = live.length ? live : rows;
      const lead = rows.find((r) => r.code === r.groupCode) ?? rows[0];
      const shown = live.length && !live.includes(lead) ? live[0] : lead;
      const { stripeCheckoutSessionId: _s, stripePaymentIntentId: _p, ...b } = shown;
      const several = rows.length > 1;
      return {
        ...b,
        code: lead.groupCode ?? b.code,
        checkIn: toDateString(b.checkIn),
        checkOut: toDateString(b.checkOut),
        guests: several ? counted.reduce((n, r) => n + r.guests, 0) : b.guests,
        rooms: several ? counted.reduce((n, r) => n + r.rooms, 0) : b.rooms,
        totalPrice: several ? fromCents(counted.reduce((n, r) => n + toCents(Number(r.totalPrice)), 0)) : Number(b.totalPrice),
        roomType: several ? { ...b.roomType, name: counted.map((r) => `${r.rooms} × ${r.roomType.name}`).join(', ') } : b.roomType,
        room: several ? null : b.room,
      };
    })
  );
});
