import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { diffDays, isISODate } from '@/server/dates';
import { badRequest, notFound } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { readSelection, selectionError } from '@/lib/room-selection';
import { quoteRooms, quoteStay } from '@/server/services/inventory';

const query = z.object({
  // Required unless the stay mixes room types (repeated room=<roomTypeId>:<count>).
  roomTypeId: z.string().min(1).optional(),
  checkIn: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
  checkOut: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
  rooms: z.coerce.number().int().min(1).max(9).default(1),
  guests: z.coerce.number().int().min(1).max(40).default(1),
});

/**
 * GET /api/quote — public, authoritative price + availability for a stay.
 * The booking endpoint charges exactly this amount. One room type returns a
 * StayQuote; a mix (room=<roomTypeId>:<count>, repeated) returns a RoomsQuote.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const q = parseQuery(request, query);
  if (q.checkOut <= q.checkIn) throw badRequest('Check-out must be after check-in.');
  if (diffDays(q.checkIn, q.checkOut) > 30) throw badRequest('Stays are limited to 30 nights online.');
  const items = readSelection(request.nextUrl.searchParams);
  const problem = selectionError(items);
  if (problem) throw badRequest(problem);
  const found = await prisma.roomType.findMany({
    where: { id: { in: items.map((i) => i.roomTypeId) }, isActive: true, property: { isActive: true } },
    select: { id: true, propertyId: true },
  });
  if (found.length !== items.length) throw notFound('Room type');
  if (new Set(found.map((r) => r.propertyId)).size > 1) throw badRequest('All rooms in a booking must be at the same hotel.');
  const headers = { 'Cache-Control': 'no-store' };
  if (request.nextUrl.searchParams.getAll('room').length) {
    return json(await quoteRooms(prisma, { items, checkIn: q.checkIn, checkOut: q.checkOut, guests: q.guests }), { headers });
  }
  return json(await quoteStay(prisma, { ...q, roomTypeId: items[0].roomTypeId, rooms: items[0].rooms }), { headers });
});
