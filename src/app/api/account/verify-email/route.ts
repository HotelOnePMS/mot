import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyEmail } from '@/server/auth/account';
import { handleRoute, json, parseJson } from '@/server/http';

/** POST { token } — confirm an email address from the link we sent. */
export const POST = handleRoute(async (request: NextRequest) => {
  const { token } = await parseJson(request, z.object({ token: z.string().min(20).max(200) }));
  await verifyEmail(token);
  return json({ message: 'Email verified.' });
});
