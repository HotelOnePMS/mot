/**
 * Team/user management rules: visibility and what an actor may grant.
 */
import { isDemoEmail } from '@/config/product';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { duplicateEmailMessage, editBlockReason, propertiesLeftWithoutOwner, type TeamChange } from '@/lib/team-rules';
import type { Actor } from '../authz';
import { badRequest, conflict, forbidden } from '../errors';

export const ROLES = ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

export const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  assignedProperties: { include: { property: { select: { id: true, name: true } } } },
  _count: { select: { bookings: true } },
} satisfies Prisma.UserSelect;

/** Users the actor may see: everyone for admins; otherwise staff on, and guests of, their properties. */
export function visibleUsersWhere(actor: Actor): Prisma.UserWhereInput {
  if (actor.propertyIds === 'ALL') return {};
  const ids = actor.propertyIds;
  return {
    OR: [
      { assignedProperties: { some: { propertyId: { in: ids } } } },
      { role: 'CUSTOMER', bookings: { some: { propertyId: { in: ids } } } },
    ],
  };
}

/** Roles the actor may grant. Only platform admins can create admins. */
export function assertCanGrant(actor: Actor, role: Role) {
  if (actor.role === 'ADMIN') return;
  if (role === 'ADMIN') throw forbidden('Only platform admins can grant admin access.');
  if (role === 'CUSTOMER') throw forbidden('Guest accounts are created by guests themselves.');
}

/**
 * Public demo: the shared @hotelone.demo logins are listed on /login, so their
 * sign-in (email, password), role and active status can't be changed there —
 * otherwise one visitor could lock everyone else out.
 */
export function assertDemoLoginUnchanged(
  user: { email: string; role: string; isActive: boolean; assignedProperties?: { property: { id: string } }[] },
  change: { email?: string; password?: string; role?: string; isActive?: boolean; assignedPropertyIds?: string[]; remove?: boolean },
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true' || !isDemoEmail(user.email)) return;
  const current = (user.assignedProperties ?? []).map((a) => a.property.id).sort().join();
  const touches =
    change.remove ||
    !!change.password ||
    (change.email !== undefined && change.email.toLowerCase() !== user.email.toLowerCase()) ||
    (change.role !== undefined && change.role !== user.role) ||
    (change.isActive !== undefined && change.isActive !== user.isActive) ||
    (change.assignedPropertyIds !== undefined && [...change.assignedPropertyIds].sort().join() !== current);
  if (touches) throw forbidden('This is a shared demo login, so its sign-in, role and status stay as they are. Add a team member of your own to try this.');
}

export function assertAssignable(actor: Actor, propertyIds: string[]) {
  if (actor.propertyIds === 'ALL') return;
  const own = actor.propertyIds;
  const foreign = propertyIds.filter((id) => !own.includes(id));
  if (foreign.length) throw forbidden('You can only assign people to your own properties.');
}


/** Throws unless the actor may edit this person at all (see editBlockReason). */
export function assertMayEdit(actor: Actor, target: { id: string; role: string }) {
  const reason = editBlockReason({ userId: actor.userId, role: actor.role }, target);
  if (reason) throw forbidden(reason);
}

/**
 * Keeps at least one active owner on every hotel: blocks a demotion, deactivation, deletion or
 * unassignment that would leave a property with none. Platform admins can override (e.g. to
 * wind down an abandoned hotel).
 */
export async function assertKeepsAnOwner(
  actor: Actor,
  target: { id: string; role: string; isActive: boolean; email: string; propertyIds: string[] },
  change: TeamChange,
) {
  if (actor.role === 'ADMIN' || target.role !== 'OWNER' || !target.isActive || target.propertyIds.length === 0) return;
  const others = await prisma.userPropertyAssignment.groupBy({
    by: ['propertyId'],
    where: { propertyId: { in: target.propertyIds }, userId: { not: target.id }, user: { role: 'OWNER', isActive: true } },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(others.map((o) => [o.propertyId, o._count._all]));
  const orphaned = propertiesLeftWithoutOwner(target, change, counts);
  if (orphaned.length) {
    throw badRequest('Every hotel needs at least one active owner. Add another owner first, or contact a platform admin.');
  }
}

/** Duplicate-email error that only tells platform admins an account exists (others could otherwise probe for accounts). */
export function duplicateEmailError(actor: Actor) {
  return actor.role === 'ADMIN' ? conflict(duplicateEmailMessage(true)) : conflict(duplicateEmailMessage(false));
}
