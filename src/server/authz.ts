/**
 * Authorization: who is calling, what they may do, and which properties
 * they may touch. Every staff API route and every agent tool goes through
 * here, so the classic UI and the agent enforce identical rules.
 *
 * Tenancy: ADMIN (platform operator) sees every property. Every other staff
 * role is scoped to the properties in their UserPropertyAssignment rows.
 */
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isStaffRole, type AppRole, type StaffRole } from '@/lib/routes';
import { forbidden, unauthorized } from './errors';

export interface Actor {
  userId: string;
  role: AppRole;
  name: string;
  email: string;
  /** 'ALL' for platform admins, otherwise the assigned property ids. */
  propertyIds: string[] | 'ALL';
}

export const PERMISSIONS = {
  'frontdesk.view': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.view': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.checkin': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.checkout': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.assignRoom': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.note': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.confirm': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.noShow': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.cancel': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'booking.reinstate': ['ADMIN', 'OWNER', 'MANAGER'],
  'booking.payment.view': ['ADMIN', 'OWNER', 'MANAGER'],
  'room.view': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'],
  'room.status': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'],
  'room.outOfOrder': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'room.manage': ['ADMIN', 'OWNER', 'MANAGER'],
  'housekeeping.view': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'],
  'housekeeping.assign': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'housekeeping.update': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'],
  'housekeeping.delete': ['ADMIN', 'OWNER', 'MANAGER'],
  'rates.view': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'rates.write': ['ADMIN', 'OWNER', 'MANAGER'],
  'inventory.write': ['ADMIN', 'OWNER', 'MANAGER'],
  'property.write': ['ADMIN', 'OWNER'],
  'property.create': ['ADMIN', 'OWNER'],
  'property.delete': ['ADMIN'],
  'users.view': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'users.write': ['ADMIN', 'OWNER'],
  'analytics.view': ['ADMIN', 'OWNER', 'MANAGER'],
  'activity.view': ['ADMIN', 'OWNER', 'MANAGER'],
  'agent.use': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'mode.setDefault': ['ADMIN', 'OWNER', 'MANAGER'],
  'voice.use': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'voice.manage': ['ADMIN', 'OWNER', 'MANAGER'],
  'phone.manage': ['ADMIN', 'OWNER'],
  // Agent platform: what agents know and learned, and keys for outside AI assistants.
  'skills.view': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'skills.manage': ['ADMIN', 'OWNER', 'MANAGER'],
  'agentkeys.manage': ['ADMIN', 'OWNER'],
  'requests.view': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'bridge.use': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'bridge.manage': ['ADMIN', 'OWNER'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(actor: Pick<Actor, 'role'>, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly string[]).includes(actor.role);
}

export function requirePermission(actor: Actor, perm: Permission): void {
  if (!can(actor, perm)) throw forbidden(permissionMessage(perm));
}

function permissionMessage(perm: Permission): string {
  const roles = (PERMISSIONS[perm] as readonly string[]).map((r) => r.replace('_', ' ').toLowerCase());
  return `This action needs one of these roles: ${roles.join(', ')}.`;
}

/** Resolve the signed-in user, or null. Never throws. */
export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      firstName: true,
      lastName: true,
      email: true,
      isActive: true,
      assignedProperties: { select: { propertyId: true } },
    },
  });
  if (!user || !user.isActive) return null;
  return {
    userId: user.id,
    role: user.role as AppRole,
    name: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
    propertyIds: user.role === 'ADMIN' ? 'ALL' : user.assignedProperties.map((a) => a.propertyId),
  };
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw unauthorized();
  return actor;
}

/** Signed-in staff member, optionally holding a specific permission. */
export async function requireStaff(perm?: Permission): Promise<Actor> {
  const actor = await requireActor();
  if (!isStaffRole(actor.role)) throw forbidden('This area is for hotel staff.');
  if (perm) requirePermission(actor, perm);
  return actor;
}

export function hasPropertyAccess(actor: Actor, propertyId: string): boolean {
  return actor.propertyIds === 'ALL' || actor.propertyIds.includes(propertyId);
}

export function assertPropertyAccess(actor: Actor, propertyId: string | null | undefined): void {
  if (!propertyId || !hasPropertyAccess(actor, propertyId)) {
    throw forbidden("You don't have access to this property.");
  }
}

/** Prisma `where` fragment restricting a model with a `propertyId` column. */
export function scopeByProperty(actor: Actor): { propertyId?: { in: string[] } } {
  return actor.propertyIds === 'ALL' ? {} : { propertyId: { in: actor.propertyIds } };
}

/** Prisma `where` fragment for the Property model itself. */
export function scopeProperties(actor: Actor): { id?: { in: string[] } } {
  return actor.propertyIds === 'ALL' ? {} : { id: { in: actor.propertyIds } };
}

/**
 * Resolve which property a request targets: the explicit one (checked), or
 * the actor's first accessible property.
 */
export async function resolvePropertyId(actor: Actor, requested?: string | null): Promise<string> {
  if (requested) {
    assertPropertyAccess(actor, requested);
    return requested;
  }
  const first = await prisma.property.findFirst({
    where: scopeProperties(actor),
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!first) throw forbidden('No property is assigned to your account yet.');
  return first.id;
}
