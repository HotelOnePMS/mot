import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { diffDays, isISODate } from '@/server/dates';
import { badRequest, notFound } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { propertyAvailability } from '@/server/services/inventory';
import { LISTED_PROPERTY } from '@/server/concierge/facts';

type Params = { params: Promise<{ propertyId: string }> };

const query = z.object({
  checkIn: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
  checkOut: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
  guests: z.coerce.number().int().min(1).max(40).default(2),
  rooms: z.coerce.number().int().min(1).max(9).default(1),
});

/**
 * GET — live availability and the exact price for every room type at a
 * property for the requested stay. Prices match what checkout charges.
 */
export const GET = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const q = parseQuery(request, query);
  if (q.checkOut <= q.checkIn) throw badRequest('Check-out must be after check-in.');
  if (diffDays(q.checkIn, q.checkOut) > 30) throw badRequest('Stays are limited to 30 nights online.');
  const property = await prisma.property.findFirst({ where: { id: propertyId, ...LISTED_PROPERTY }, select: { id: true } });
  if (!property) throw notFound('Property');
  const roomTypes = await propertyAvailability({ propertyId, ...q });
  return json(
    {
      propertyId,
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      guests: q.guests,
      rooms: q.rooms,
      roomTypes: roomTypes.map((rt) => ({
        ...rt,
        // Room types that cannot sleep this party in the requested rooms are flagged, not hidden.
        fitsParty: rt.capacity * q.rooms >= q.guests,
        isAvailable: rt.available >= q.rooms,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
