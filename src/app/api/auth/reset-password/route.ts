import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp, handleRoute, json, parseJson } from '@/server/http';
import { consumeRateLimit } from '@/server/concierge/rateLimit';
import { resetPassword } from '@/server/services/password-reset';

export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, 'must be at least 8 characters').max(200),
});

/** POST /api/auth/reset-password — sets a new password from a valid, unused, unexpired link. */
export const POST = handleRoute(async (request: NextRequest) => {
  await consumeRateLimit(`pwreset-use:ip:${clientIp(request)}`, 20, 3_600_000, 'Too many attempts. Please try again later.');
  const body = await parseJson(request, schema);
  await resetPassword(body.token, body.password);
  return json({ message: 'Password updated. You can sign in now.' });
});
