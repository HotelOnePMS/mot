import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireStaff, type Actor } from '@/server/authz';
import { badRequest, forbidden, notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { assertAssignable, assertCanGrant, assertDemoLoginUnchanged, userSelect, visibleUsersWhere } from '@/server/services/users';

type Params = { params: Promise<{ userId: string }> };

async function loadVisible(actor: Actor, userId: string) {
  const user = await prisma.user.findFirst({ where: { AND: [{ id: userId }, visibleUsersWhere(actor)] }, select: userSelect });
  if (!user) throw notFound('User');
  return user;
}

/** Non-admins may only edit staff who work exclusively at their properties. */
function assertEditable(actor: Actor, user: Awaited<ReturnType<typeof loadVisible>>) {
  if (actor.role === 'ADMIN') return;
  if (user.role === 'ADMIN') throw forbidden('Platform admins can only be changed by another admin.');
  if (user.role === 'CUSTOMER') throw forbidden('Guest accounts are managed by the guest.');
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
  password: z.string().min(8).optional().or(z.literal('')),
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
  if (body.email && body.email !== user.email && (await prisma.user.findUnique({ where: { email: body.email } }))) {
    throw badRequest('That email is already in use.');
  }
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
        ...(body.password ? { password: await bcrypt.hash(body.password, 12) } : {}),
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
  return json({ id: updated.id, email: updated.email, firstName: updated.firstName, lastName: updated.lastName, role: updated.role });
});

export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { userId } = await params;
  const actor = await requireStaff('users.write');
  if (userId === actor.userId) throw badRequest("You can't delete your own account.");
  const user = await loadVisible(actor, userId);
  assertEditable(actor, user);
  assertDemoLoginUnchanged(user, { remove: true });
  const history = (await prisma.booking.count({ where: { userId } })) + (await prisma.agentAuditLog.count({ where: { userId } }));
  if (history > 0) {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    return json({ message: 'User deactivated (kept for booking and audit history).' });
  }
  await prisma.user.delete({ where: { id: userId } });
  return json({ message: 'User deleted successfully' });
});
