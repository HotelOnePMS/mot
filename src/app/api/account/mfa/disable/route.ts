import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/server/authz';
import { disableMfa } from '@/server/auth/account';
import { handleRoute, json, parseJson } from '@/server/http';

/** POST { password, code } — turn two-step sign-in off (not when your organization requires it). */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireActor();
  const body = await parseJson(request, z.object({ password: z.string().max(200).optional(), code: z.string().trim().max(10).optional() }));
  await disableMfa(actor, body);
  return json({ message: 'Two-step sign-in is off.' });
});
