/**
 * Team/user management rules: visibility and what an actor may grant.
 */
import { isDemoEmail } from '@/config/product';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../authz';
import { forbidden } from '../errors';

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

