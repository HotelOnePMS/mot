import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireActor } from '@/server/authz';
import { badRequest } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { assertDemoLoginUnchanged } from '@/server/services/users';

const select = {
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  zipCode: true,
  country: true,
  role: true,
  createdAt: true,
} as const;

/** GET — the signed-in person's profile. */
export const GET = handleRoute(async () => {
  const actor = await requireActor();
  return json(await prisma.user.findUnique({ where: { id: actor.userId }, select }));
});

const opt = (max: number) => z.string().trim().max(max).nullable().optional();
const schema = z.object({
  firstName: z.string().trim().min(1, 'is required').max(60).optional(),
  lastName: z.string().trim().min(1, 'is required').max(60).optional(),
  phone: opt(40),
  address: opt(200),
  city: opt(100),
  state: opt(100),
  zipCode: opt(20),
  country: opt(100),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'must be at least 8 characters').max(200).optional(),
});

/** PUT — update your details, and optionally your password (needs the current one). */
export const PUT = handleRoute(async (request: NextRequest) => {
  const actor = await requireActor();
  const { currentPassword, newPassword, ...details } = await parseJson(request, schema);
  let password: string | undefined;
  if (newPassword) {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { password: true, email: true, role: true, isActive: true } });
    if (!user?.password || !currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
      throw badRequest('Your current password isn’t right.');
    }
    assertDemoLoginUnchanged(user, { password: newPassword });
    password = await bcrypt.hash(newPassword, 12);
  }
  const clean = Object.fromEntries(Object.entries(details).map(([k, v]) => [k, typeof v === 'string' && v === '' && k !== 'firstName' && k !== 'lastName' ? null : v]));
  const updated = await prisma.user.update({ where: { id: actor.userId }, data: { ...clean, ...(password ? { password } : {}) }, select });
  return json(updated);
});
