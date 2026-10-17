import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { isISODate } from '@/server/dates';
import { handleRoute, json, parseQuery } from '@/server/http';
import { frontDeskSummary } from '@/server/services/frontdesk';

const query = z.object({
  propertyId: z.string().optional(),
  date: z.string().refine(isISODate, 'must be YYYY-MM-DD').optional(),
});

/** GET /api/admin/front-desk — today's arrivals, departures, in-house and alerts. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('frontdesk.view');
  const q = parseQuery(request, query);
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json(await frontDeskSummary(actor, propertyId, q.date));
});
