import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requestOrigin } from '@/server/agent-api';
import { requestPasswordReset } from '@/server/auth/account';
import { clientIp, handleRoute, json, parseJson } from '@/server/http';

/** POST { email } — email a reset link. The answer is the same whether or not the account exists. */
export const POST = handleRoute(async (request: NextRequest) => {
  const { email } = await parseJson(request, z.object({ email: z.string().trim().email('must be a valid email').max(200) }));
  await requestPasswordReset({ email, ip: clientIp(request), origin: requestOrigin(request) });
  return json({ message: 'If that email belongs to an account with a password, a reset link is on its way.' });
});
