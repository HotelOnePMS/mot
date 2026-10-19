import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp, handleRoute, json, parseJson } from '@/server/http';
import { consumeRateLimit } from '@/server/concierge/rateLimit';
import { requestPasswordReset } from '@/server/services/password-reset';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().trim().toLowerCase().email('must be a valid email').max(254) });

const HOUR = 3_600_000;

/**
 * POST /api/auth/forgot-password — emails a reset link when the address has a password account.
 * The answer is the same either way, so it can't be used to find out who has an account.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const { email } = await parseJson(request, schema);
  await consumeRateLimit(`pwreset:ip:${clientIp(request)}`, 10, HOUR, 'Too many reset requests. Please try again later.');
  await consumeRateLimit(`pwreset:email:${email}`, 3, HOUR, 'Too many reset requests for this address. Please try again later.');
  await requestPasswordReset(email, request.nextUrl.origin);
  return json({ message: 'If an account exists for that email, a reset link is on its way.' });
});
