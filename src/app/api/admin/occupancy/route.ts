import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { addDaysISO, diffDays, hotelToday, isISODate } from '@/server/dates';
import { badRequest } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { occupancyForActor } from '@/server/services/frontdesk';

const query = z.object({
  propertyId: z.string().optional(),
  from: z.string().refine(isISODate).optional(),
  to: z.string().refine(isISODate).optional(),
});

/** GET — nightly occupancy, revenue and ADR for a date range (max 92 nights). */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('frontdesk.view');
  const q = parseQuery(request, query);
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const from = q.from ?? hotelToday();
  const to = q.to ?? addDaysISO(from, 14);
  if (to <= from) throw badRequest('`to` must be after `from`.');
  if (diffDays(from, to) > 92) throw badRequest('Ranges are limited to 92 nights.');
  return json(await occupancyForActor(actor, propertyId, from, to));
});
