import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { autoAssign, planAutoAssign } from '@/server/services/housekeeping';

/** GET — preview the balanced assignment without changing anything. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('housekeeping.assign');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json(await planAutoAssign(actor, propertyId));
});

/** POST — apply the balanced assignment of every dirty, unassigned room. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('housekeeping.assign');
  const body = await parseJson(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  const plan = await autoAssign({ actor, source: 'classic' }, propertyId);
  return json({ assigned: plan.length, plan });
});
