import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { isDemoEmail } from '@/config/product';
import { conflict } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';

const schema = z.object({
  firstName: z.string().trim().min(1, 'is required').max(60),
  lastName: z.string().trim().min(1, 'is required').max(60),
  email: z.string().trim().toLowerCase().email('must be a valid email').refine((v) => !isDemoEmail(v), 'belongs to the public demo — use your own email'),
  phone: z.string().trim().max(40).optional().nullable(),
  password: z.string().min(8, 'must be at least 8 characters').max(200),
});

/** POST — create a guest account. Staff accounts are created by their hotel. */
export const POST = handleRoute(async (request: NextRequest) => {
  const body = await parseJson(request, schema);
  if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
    throw conflict('An account with this email already exists — sign in instead.');
  }
  const user = await prisma.user.create({
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone || null,
      password: await bcrypt.hash(body.password, 12),
      role: 'CUSTOMER',
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  return json({ message: 'Account created', user }, { status: 201 });
});
