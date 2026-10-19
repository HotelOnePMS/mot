import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/server/authz';
import { changePassword } from '@/server/auth/account';
import { handleRoute, json, parseJson } from '@/server/http';

/** POST { current, next } — change your password. Every session ends, this one included. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireActor();
  const body = await parseJson(request, z.object({ current: z.string().max(200).default(''), next: z.string().max(200) }));
  await changePassword(actor, body);
  return json({ message: 'Password changed. Sign in again with the new one.', email: actor.email });
});
