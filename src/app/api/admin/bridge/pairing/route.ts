import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { createPairingCode, revokeDevice } from '@/server/services/bridge';

/** POST — a one-time code (15 min) to pair the desktop connector. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const body = await parseJson(request, z.object({ propertyId: z.string().min(1) }));
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  return json(await createPairingCode({ actor, source: 'classic' }, propertyId));
});

/** DELETE — disconnect the paired computer (its token stops working at once). */
export const DELETE = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const q = parseQuery(request, z.object({ propertyId: z.string().min(1) }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  await revokeDevice({ actor, source: 'classic' }, propertyId);
  return json({ ok: true });
});
