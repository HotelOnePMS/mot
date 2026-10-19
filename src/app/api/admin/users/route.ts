import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/server/authz';
import { badRequest } from '@/server/errors';
import { hashPassword, passwordProblem } from '@/server/auth/passwords';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordTeamAudit } from '@/server/services/team-audit';
import { ROLES, assertAssignable, assertCanGrant, duplicateEmailError, userSelect, visibleUsersWhere } from '@/server/services/users';

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
  password: z.string().max(200),
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
    throw duplicateEmailError(actor);
  }
  const problem = passwordProblem(body.password, { email: body.email });
  if (problem) throw badRequest(`Password: ${problem}`);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: body.email,
        password: await hashPassword(body.password),
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone || null,
        role: body.role,
        isActive: body.isActive ?? true,
        // The password was chosen by the person adding them, so it is temporary.
        mustChangePassword: true,
      },
    });
    if (propertyIds.length) {
      await tx.userPropertyAssignment.createMany({ data: propertyIds.map((propertyId) => ({ userId: u.id, propertyId })) });
    }
    return u;
  });
  await recordTeamAudit(
    { actorUserId: actor.userId, source: 'classic', targetUserId: user.id, propertyIds },
    [
      {
        action: 'TEAM_ADD',
        summary: `Added ${user.firstName} ${user.lastName} as ${body.role.replace('_', ' ').toLowerCase()} (temporary password, must change at first sign-in)`,
        before: {},
        after: { email: user.email, role: body.role, isActive: user.isActive, propertyIds, mustChangePassword: true },
      },
    ],
  );
  return json({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, { status: 201 });
});
