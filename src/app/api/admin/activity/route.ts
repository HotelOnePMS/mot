import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseQuery } from '@/server/http';
import { listActivity } from '@/server/services/audit';

/** GET — the property's audit trail: every action by people and by the agent. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('activity.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional(), limit: z.coerce.number().int().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json(await listActivity(propertyId, q.limit ?? 80));
});
