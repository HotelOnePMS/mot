import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/server/authz';
import { confirmMfaSetup } from '@/server/auth/account';
import { handleRoute, json, parseJson } from '@/server/http';

/** POST { code } — turn two-step sign-in on; returns recovery codes once. Other sessions end. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireActor();
  const { code } = await parseJson(request, z.object({ code: z.string().trim().min(6).max(10) }));
  return json(await confirmMfaSetup(actor, code), { headers: { 'Cache-Control': 'no-store' } });
});
