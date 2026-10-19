import { NextRequest } from 'next/server';
import { z } from 'zod';
import { resetPassword } from '@/server/auth/account';
import { handleRoute, json, parseJson } from '@/server/http';

/** POST { token, password } — set a new password from an emailed link. Every session ends. */
export const POST = handleRoute(async (request: NextRequest) => {
  const body = await parseJson(request, z.object({ token: z.string().min(20).max(200), password: z.string().max(200) }));
  await resetPassword(body);
  return json({ message: 'Password changed.' });
});
