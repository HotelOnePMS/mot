import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseQuery } from '@/server/http';
import { listGuestRequests } from '@/server/services/guestRequests';

/** GET — messages and callback requests guests left with the voice agent. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('requests.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional(), status: z.enum(['NEW', 'DONE', 'ALL']).default('ALL') }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const rows = await listGuestRequests(actor, propertyId, q.status);
  return json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })));
});
