import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { BookingStatus } from '@/lib/dto';
import { requireStaff } from '@/server/authz';
import { isISODate } from '@/server/dates';
import { handleRoute, json, parseQuery } from '@/server/http';
import { searchBookings } from '@/server/services/bookings';

const STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW'] as const;

const query = z.object({
  propertyId: z.string().optional(),
  q: z.string().max(100).optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter((x): x is BookingStatus => (STATUSES as readonly string[]).includes(x)) : undefined)),
  from: z.string().refine(isISODate).optional(),
  to: z.string().refine(isISODate).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** GET /api/admin/bookings — reservations across the caller's properties. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('booking.view');
  const q = parseQuery(request, query);
  const bookings = await searchBookings(actor, {
    propertyId: q.propertyId,
    query: q.q,
    status: q.status,
    from: q.from,
    to: q.to,
    limit: q.limit ?? 100,
  });
  return json(bookings);
});
