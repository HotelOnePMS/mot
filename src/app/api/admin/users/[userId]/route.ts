import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff, type Actor } from '@/server/authz';
import { badRequest, forbidden, notFound } from '@/server/errors';
import { hashPassword, passwordProblem } from '@/server/auth/passwords';
import { handleRoute, json, parseJson } from '@/server/http';
import { describeTeamChange, shouldEndSessions } from '@/lib/team-rules';
import { recordTeamAudit } from '@/server/services/team-audit';
import { assertAssignable, assertCanGrant, assertDemoLoginUnchanged, assertKeepsAnOwner, assertMayEdit, duplicateEmailError, userSelect, visibleUsersWhere } from '@/server/services/users';

type Params = { params: Promise<{ userId: string }> };

async function loadVisible(actor: Actor, userId: string) {
  const user = await prisma.user.findFirst({ where: { AND: [{ id: userId }, visibleUsersWhere(actor)] }, select: userSelect });
  if (!user) throw notFound('User');
  return user;
}

/** Non-admins may only edit staff who work exclusively at their properties. */
function assertEditable(actor: Actor, user: Awaited<ReturnType<typeof loadVisible>>) {
  // Admins, guests and other owners are off limits to non-admins (only an owner themselves or an admin changes an owner).
  assertMayEdit(actor, user);
  if (actor.role === 'ADMIN') return;
  const own = actor.propertyIds === 'ALL' ? [] : actor.propertyIds;
  if (user.assignedProperties.some((a) => !own.includes(a.property.id))) {
    throw forbidden('This person also works at a property you do not manage.');
  }
}

export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { userId } = await params;
  const actor = await requireStaff('users.view');
  return json(await loadVisible(actor, userId));
});

const patchSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().max(200).optional().or(z.literal('')),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  role: z.enum(['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER', 'CUSTOMER']).optional(),
  isActive: z.boolean().optional(),
  assignedPropertyIds: z.array(z.string()).max(50).optional(),
});

export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { userId } = await params;
  const actor = await requireStaff('users.write');
  const user = await loadVisible(actor, userId);
  assertEditable(actor, user);
  const body = await parseJson(request, patchSchema);
  assertDemoLoginUnchanged(user, body);
  if (body.role) assertCanGrant(actor, body.role);
  if (body.assignedPropertyIds) assertAssignable(actor, body.assignedPropertyIds);
  if (userId === actor.userId && (body.role || body.isActive === false)) {
    throw badRequest("You can't change your own role or deactivate yourself.");
  }
  if (body.email && body.email.toLowerCase() !== user.email.toLowerCase() && (await prisma.user.findUnique({ where: { email: body.email } }))) {
    throw duplicateEmailError(actor);
  }
  if (body.password) {
    const problem = passwordProblem(body.password, { email: body.email ?? user.email });
    if (problem) throw badRequest(`Password: ${problem}`);
  }

  // The property list the person ends up with (non-admins only replace assignments inside their own properties).
  const currentIds = user.assignedProperties.map((a) => a.property.id);
  const effectiveIds = body.assignedPropertyIds
    ? actor.propertyIds === 'ALL'
      ? [...new Set(body.assignedPropertyIds)]
      : [...currentIds.filter((id) => !(actor.propertyIds as string[]).includes(id)), ...new Set(body.assignedPropertyIds)]
    : undefined;
  const target = { id: user.id, role: user.role as string, isActive: user.isActive, email: user.email, propertyIds: currentIds };
  await assertKeepsAnOwner(actor, target, { ...body, assignedPropertyIds: effectiveIds });

  const entries = describeTeamChange(
    {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      phone: user.phone,
      propertyIds: currentIds,
      propertyNames: Object.fromEntries(user.assignedProperties.map((a) => [a.property.id, a.property.name])),
    },
    { ...body, assignedPropertyIds: effectiveIds },
  );
  const endSessions = shouldEndSessions(user, body);
  // A password chosen by someone else is temporary: the person must replace it at next sign-in.
  const passwordChosenByOther = !!body.password && userId !== actor.userId;

  const emailChanged = body.email !== undefined && body.email.toLowerCase() !== user.email.toLowerCase();

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: userId },
      data: {
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.password ? { password: await hashPassword(body.password), passwordChangedAt: new Date(), mustChangePassword: passwordChosenByOther } : {}),
        // Ends every existing session of this person (see the jwt callback in src/lib/auth.ts).
        ...(endSessions ? { sessionVersion: { increment: 1 } } : {}),
        // The new address hasn't been proven yet.
        ...(emailChanged ? { emailVerifiedAt: null } : {}),
      },
    });
    if (body.assignedPropertyIds) {
      // Non-admins only replace assignments within their own properties.
      const scope = actor.propertyIds === 'ALL' ? {} : { propertyId: { in: actor.propertyIds } };
      await tx.userPropertyAssignment.deleteMany({ where: { userId, ...scope } });
      if (body.assignedPropertyIds.length) {
        await tx.userPropertyAssignment.createMany({
          data: body.assignedPropertyIds.map((propertyId) => ({ userId, propertyId })),
          skipDuplicates: true,
        });
      }
    }
    return u;
  });
  await recordTeamAudit(
    { actorUserId: actor.userId, source: 'classic', targetUserId: userId, propertyIds: [...currentIds, ...(effectiveIds ?? [])] },
    entries,
  );
  return json({ id: updated.id, email: updated.email, firstName: updated.firstName, lastName: updated.lastName, role: updated.role });
});

export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { userId } = await params;
  const actor = await requireStaff('users.write');
  if (userId === actor.userId) throw badRequest("You can't delete your own account.");
  const user = await loadVisible(actor, userId);
  assertEditable(actor, user);
  assertDemoLoginUnchanged(user, { remove: true });
  const propertyIds = user.assignedProperties.map((a) => a.property.id);
  await assertKeepsAnOwner(actor, { id: user.id, role: user.role, isActive: user.isActive, email: user.email, propertyIds }, { remove: true });
  const who = `${user.firstName} ${user.lastName}`.trim() || user.email;
  const before = { email: user.email, role: user.role, isActive: user.isActive, propertyIds };
  const history = (await prisma.booking.count({ where: { userId } })) + (await prisma.agentAuditLog.count({ where: { userId } }));
  if (history > 0) {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false, sessionVersion: { increment: 1 } } });
    await recordTeamAudit(
      { actorUserId: actor.userId, source: 'classic', targetUserId: userId, propertyIds },
      [{ action: 'TEAM_DELETE', summary: `${who}: removed (kept deactivated for booking and audit history)`, before, after: { isActive: false, deactivatedInsteadOfDeleted: true } }],
    );
    return json({ message: 'User deactivated (kept for booking and audit history).' });
  }
  await prisma.user.delete({ where: { id: userId } });
  await recordTeamAudit(
    { actorUserId: actor.userId, source: 'classic', targetUserId: userId, propertyIds },
    [{ action: 'TEAM_DELETE', summary: `${who}: deleted`, before, after: { deleted: true } }],
  );
  return json({ message: 'User deleted successfully' });
});
