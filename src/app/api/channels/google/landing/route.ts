import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { addDays, isDateString } from '@/server/channels/dates';

/**
 * GET /api/channels/google/landing?hotel=<Hotel Center ID>&checkin=YYYY-MM-DD&nights=N&adults=N
 *
 * Where Google free booking links land (see the Point of Sale file at
 * /api/channels/google/point-of-sale). Finds the hotel by the ID it has in Hotel
 * Center and opens its HotelOne booking page for the stay the guest picked on Google.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const hotel = (q.get('hotel') ?? '').slice(0, 50);
  const connection = hotel
    ? await prisma.channelConnection.findFirst({
        where: { channel: 'GOOGLE_HOTELS', otaPropertyId: hotel, status: { in: ['ACTIVE', 'ERROR', 'PAUSED', 'CONNECTED'] } },
        select: { propertyId: true },
        orderBy: { activatedAt: 'desc' },
      })
    : null;
  if (!connection) return Response.redirect(new URL('/properties', request.nextUrl.origin), 302);

  const target = new URL(`/properties/${encodeURIComponent(connection.propertyId)}`, request.nextUrl.origin);
  const checkIn = q.get('checkin');
  const nights = Number(q.get('nights'));
  if (isDateString(checkIn) && Number.isInteger(nights) && nights >= 1 && nights <= 30) {
    target.searchParams.set('checkIn', checkIn);
    target.searchParams.set('checkOut', addDays(checkIn, nights));
  }
  const adults = Number(q.get('adults'));
  if (Number.isInteger(adults) && adults >= 1 && adults <= 20) target.searchParams.set('guests', String(adults));
  target.searchParams.set('utm_source', 'google');
  target.searchParams.set('utm_medium', 'free_booking_link');
  return Response.redirect(target, 302);
}
