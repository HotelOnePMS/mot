import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { diffDays, isISODate } from '@/server/dates';
import { handleRoute, json, parseQuery } from '@/server/http';
import { propertyAvailability } from '@/server/services/inventory';
import { LISTED_PROPERTY } from '@/server/concierge/facts';

const query = z.object({
  q: z.string().trim().max(100).optional(),
  checkIn: z.string().refine(isISODate).optional(),
  checkOut: z.string().refine(isISODate).optional(),
  guests: z.coerce.number().int().min(1).max(40).optional(),
});

/**
 * GET /api/properties — the public directory. With dates, each property
 * carries its lowest live nightly price for that stay and whether any room
 * type can host the party; without dates, its lowest base price.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const q = parseQuery(request, query);
  const hasDates = !!q.checkIn && !!q.checkOut && q.checkOut > q.checkIn && diffDays(q.checkIn, q.checkOut) <= 30;
  const text = q.q?.trim();

  const properties = await prisma.property.findMany({
    where: {
      ...LISTED_PROPERTY,
      ...(text
        ? {
            OR: [
              { name: { contains: text, mode: 'insensitive' } },
              { city: { contains: text, mode: 'insensitive' } },
              { state: { contains: text, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      photos: { orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }], take: 1, select: { url: true } },
      roomTypes: { where: { isActive: true }, select: { id: true, basePrice: true, capacity: true } },
    },
    orderBy: [{ isDemo: 'desc' }, { createdAt: 'asc' }],
  });

  const rows = await Promise.all(
    properties.map(async (p) => {
      const guests = q.guests ?? 1;
      let fromPrice: number | null = null;
      let available: boolean | null = null;
      if (hasDates) {
        const types = await propertyAvailability({ propertyId: p.id, checkIn: q.checkIn!, checkOut: q.checkOut!, guests });
        const fitting = types.filter((t) => t.capacity >= guests && t.available > 0 && t.quote);
        available = fitting.length > 0;
        fromPrice = fitting.length ? Math.min(...fitting.map((t) => t.quote!.averageNightly)) : null;
      } else {
        const fitting = p.roomTypes.filter((t) => t.capacity >= guests);
        fromPrice = fitting.length ? Math.min(...fitting.map((t) => Number(t.basePrice))) : null;
      }
      return {
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        type: p.type,
        description: p.description,
        city: p.city,
        state: p.state,
        primaryColor: p.primaryColor,
        amenities: p.amenities,
        mainPhoto: p.photos[0]?.url ?? null,
        roomTypeCount: p.roomTypes.length,
        maxCapacity: p.roomTypes.reduce((m, t) => Math.max(m, t.capacity), 0),
        fromPrice,
        available,
        isDemo: p.isDemo,
      };
    })
  );

  return json(rows, { headers: { 'Cache-Control': 'no-store' } });
});
