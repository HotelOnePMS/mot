import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { isDemoEmail } from '@/config/product';
import { requestOrigin } from '@/server/agent-api';
import { sendVerificationEmail } from '@/server/auth/account';
import { SIGNUP_IP, assertWithinLimits, recordAttempt } from '@/server/auth/limits';
import { hashPassword, passwordProblem } from '@/server/auth/passwords';
import { badRequest, conflict } from '@/server/errors';
import { clientIp, handleRoute, json, parseJson } from '@/server/http';
import { logError } from '@/server/log';

const schema = z.object({
  firstName: z.string().trim().min(1, 'is required').max(60),
  lastName: z.string().trim().min(1, 'is required').max(60),
  email: z.string().trim().toLowerCase().email('must be a valid email').refine((v) => !isDemoEmail(v), 'belongs to the public demo — use your own email'),
  phone: z.string().trim().max(40).optional().nullable(),
  password: z.string().max(200),
});

/**
 * POST — create a guest account. Staff accounts are created by their hotel.
 * Limited per network; the guest gets a link to verify their email.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const ip = clientIp(request);
  await assertWithinLimits([SIGNUP_IP(ip)], 'Too many new accounts from this network. Please try again later.');
  const body = await parseJson(request, schema);
  const problem = passwordProblem(body.password, { email: body.email, name: body.firstName });
  if (problem) throw badRequest(`Password: ${problem}`);
  await recordAttempt([SIGNUP_IP(ip)], true);
  if (await prisma.user.findFirst({ where: { email: { equals: body.email, mode: 'insensitive' } }, select: { id: true } })) {
    throw conflict('An account with this email already exists — sign in instead.');
  }
  const user = await prisma.user.create({
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone || null,
      password: await hashPassword(body.password),
      role: 'CUSTOMER',
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  // A failed email never blocks sign-up; they can ask for another link.
  await sendVerificationEmail(user.id, requestOrigin(request)).catch((e) => logError('register', 'verification email failed', e));
  return json({ message: 'Account created', user }, { status: 201 });
});
