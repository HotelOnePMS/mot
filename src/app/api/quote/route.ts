import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { diffDays, isISODate } from '@/server/dates';
import { badRequest, notFound } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { quoteStay } from '@/server/services/inventory';

const query = z.object({
  roomTypeId: z.string().min(1),
  checkIn: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
  checkOut: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
  rooms: z.coerce.number().int().min(1).max(9).default(1),
  guests: z.coerce.number().int().min(1).max(40).default(1),
});

/**
 * GET /api/quote — public, authoritative price + availability for a stay.
 * The booking endpoint charges exactly this amount.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const q = parseQuery(request, query);
  if (q.checkOut <= q.checkIn) throw badRequest('Check-out must be after check-in.');
  if (diffDays(q.checkIn, q.checkOut) > 30) throw badRequest('Stays are limited to 30 nights online.');
  const rt = await prisma.roomType.findFirst({
    where: { id: q.roomTypeId, isActive: true, property: { isActive: true } },
    select: { id: true },
  });
  if (!rt) throw notFound('Room type');
  return json(await quoteStay(prisma, q), { headers: { 'Cache-Control': 'no-store' } });
});
