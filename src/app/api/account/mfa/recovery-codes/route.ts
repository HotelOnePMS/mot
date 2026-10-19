import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/server/authz';
import { regenerateRecoveryCodes } from '@/server/auth/account';
import { handleRoute, json, parseJson } from '@/server/http';

/** POST { password, code } — new recovery codes; the old ones stop working. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireActor();
  const body = await parseJson(request, z.object({ password: z.string().max(200).optional(), code: z.string().trim().max(10).optional() }));
  return json(await regenerateRecoveryCodes(actor, body), { headers: { 'Cache-Control': 'no-store' } });
});
