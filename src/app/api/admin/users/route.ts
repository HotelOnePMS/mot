import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/server/authz';
import { badRequest, conflict } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { ROLES, assertAssignable, assertCanGrant, userSelect, visibleUsersWhere } from '@/server/services/users';

/** GET ?role=HOUSEKEEPER — team members and guests visible to the caller. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('users.view');
  const q = parseQuery(request, z.object({ role: z.enum(ROLES).optional() }));
  const users = await prisma.user.findMany({
    where: { AND: [visibleUsersWhere(actor), q.role ? { role: q.role } : {}] },
    select: userSelect,
    orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
  });
  return json(users);
});

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'must be at least 8 characters'),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(40).optional().nullable(),
  role: z.enum(ROLES),
  isActive: z.boolean().optional(),
  assignedPropertyIds: z.array(z.string()).max(50).optional(),
});

/** POST — invite a team member (owners: to their own properties only). */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('users.write');
  const body = await parseJson(request, createSchema);
  assertCanGrant(actor, body.role);
  const propertyIds = body.assignedPropertyIds ?? [];
  assertAssignable(actor, propertyIds);
  if (actor.role !== 'ADMIN' && propertyIds.length === 0) {
    throw badRequest('Choose at least one property for this team member.');
  }
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw conflict('An account with this email already exists.');
  }
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: body.email,
        password: await bcrypt.hash(body.password, 12),
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone || null,
        role: body.role,
        isActive: body.isActive ?? true,
      },
    });
    if (propertyIds.length) {
      await tx.userPropertyAssignment.createMany({ data: propertyIds.map((propertyId) => ({ userId: u.id, propertyId })) });
    }
    return u;
  });
  for (const pid of propertyIds) {
    await recordAudit({ actor, source: 'classic' }, pid, 'TEAM_ADD', `Added ${user.firstName} ${user.lastName} as ${body.role.replace('_', ' ').toLowerCase()}`, {
      userId: user.id,
    });
  }
  return json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, { status: 201 });
});
