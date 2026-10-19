/**
 * Authorization: who is calling, what they may do, and which properties
 * they may touch. Every staff API route and every agent tool goes through
 * here, so the classic UI and the agent enforce identical rules.
 *
 * Tenancy: ADMIN (platform operator) sees every property. Every other staff
 * role is scoped to the properties in their UserPropertyAssignment rows, plus
 * every hotel of the organizations (hotel groups) they administer.
 *
 * Organizations that require two-step sign-in: staff who signed in with a
 * password and haven't set it up can reach nothing but their own account
 * security page until they do (requireStaff throws MFA_SETUP_REQUIRED).
 */
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isStaffRole, type AppRole, type StaffRole } from '@/lib/routes';
import { DomainError, forbidden, unauthorized } from './errors';

export interface Actor {
  userId: string;
  role: AppRole;
  name: string;
  email: string;
  /** 'ALL' for platform admins, otherwise the assigned property ids and every hotel of the organizations they administer. */
  propertyIds: string[] | 'ALL';
  /** Someone else chose this person's password: it must be changed before anything else. */
  mustChangePassword?: boolean;
  /** Organizations this person administers (OrganizationMember role ADMIN). */
  orgAdminOf: string[];
  /** Organizations this person belongs to. */
  orgIds: string[];
  mfaEnabled: boolean;
  emailVerified: boolean;
  /** Their organization requires two-step sign-in and they haven't set it up (password sessions only). */
  mfaSetupRequired: boolean;
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
  // Online payments (Stripe Connect): who sees and changes them, refunds and disputes.
  'payments.view': ['ADMIN', 'OWNER', 'MANAGER'],
  'payments.manage': ['ADMIN', 'OWNER'],
  'payments.refund': ['ADMIN', 'OWNER', 'MANAGER'],
  'disputes.view': ['ADMIN', 'OWNER', 'MANAGER'],
  'disputes.manage': ['ADMIN', 'OWNER'],
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
  // Team and guest lists with emails and phone numbers. Front desk uses /api/admin/team (names only, housekeeping.view) instead.
  'users.view': ['ADMIN', 'OWNER', 'MANAGER'],
  'users.write': ['ADMIN', 'OWNER'],
  'analytics.view': ['ADMIN', 'OWNER', 'MANAGER'],
  'activity.view': ['ADMIN', 'OWNER', 'MANAGER'],
  // AI business advisor: portfolio-wide revenue and performance, read-only.
  'advisor.use': ['ADMIN', 'OWNER'],
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
  // Free-text instructions to the hotel's own PMS (a browser or MCP session acting with the hotel's login):
  // manager/owner by default, because it bypasses HotelOne's per-action roles. Grant to a front-desk
  // person only deliberately (see docs in README "Roles and access").
  'bridge.use': ['ADMIN', 'OWNER', 'MANAGER'],
  'bridge.manage': ['ADMIN', 'OWNER'],
  // Front desk: new reservations at the desk, and the end-of-day close.
  'booking.create': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  'audit.run': ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'],
  // Hotel settings that change prices: currency, time zone, taxes and fees.
  'charges.manage': ['ADMIN', 'OWNER', 'MANAGER'],
  // Hotel groups: owners who administer an organization (see canManageOrg), and platform admins.
  'org.manage': ['ADMIN', 'OWNER'],
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
      mustChangePassword: true,
      mfaEnabled: true,
      emailVerifiedAt: true,
      sessionVersion: true,
      assignedProperties: { select: { propertyId: true } },
      organizations: {
        select: { role: true, organizationId: true, organization: { select: { requireMfa: true, properties: { select: { id: true } } } } },
      },
    },
  });
  if (!user || !user.isActive) return null;
  // A newer session version means this session was signed out everywhere.
  if ((session.user.sessionVersion ?? 0) !== user.sessionVersion) return null;
  return actorFromUser(user, session.user.authMethod ?? 'password');
}

export interface ActorSource {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string;
  mfaEnabled: boolean;
  emailVerifiedAt: Date | null;
  mustChangePassword?: boolean;
  assignedProperties: { propertyId: string }[];
  organizations: { role: string; organizationId: string; organization: { requireMfa: boolean; properties: { id: string }[] } }[];
}

/** Who someone is and what they can reach: assigned hotels plus every hotel of the organizations they administer. */
export function actorFromUser(user: ActorSource, authMethod: 'password' | 'sso' | 'google'): Actor {
  const adminOf = user.organizations.filter((m) => m.role === 'ADMIN');
  const propertyIds =
    user.role === 'ADMIN'
      ? ('ALL' as const)
      : [...new Set([...user.assignedProperties.map((a) => a.propertyId), ...adminOf.flatMap((m) => m.organization.properties.map((p) => p.id))])];
  return {
    userId: user.id,
    role: user.role as AppRole,
    name: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
    mustChangePassword: user.mustChangePassword ?? false,
    propertyIds,
    orgAdminOf: adminOf.map((m) => m.organizationId),
    orgIds: user.organizations.map((m) => m.organizationId),
    mfaEnabled: user.mfaEnabled,
    emailVerified: !!user.emailVerifiedAt,
    mfaSetupRequired: isStaffRole(user.role) && !user.mfaEnabled && authMethod !== 'sso' && user.organizations.some((m) => m.organization.requireMfa),
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
  if (actor.mustChangePassword) {
    throw new DomainError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before you continue.');
  }
  if (actor.mfaSetupRequired) {
    throw new DomainError(403, 'MFA_SETUP_REQUIRED', 'Your organization requires two-step sign-in. Set it up under Account → Security to continue.');
  }
  if (perm) requirePermission(actor, perm);
  return actor;
}

/** Platform admins manage every organization; owners manage the ones they administer. */
export function canManageOrg(actor: Actor, organizationId: string): boolean {
  if (actor.role === 'ADMIN') return true;
  return can(actor, 'org.manage') && actor.orgAdminOf.includes(organizationId);
}

export function assertCanManageOrg(actor: Actor, organizationId: string): void {
  if (!canManageOrg(actor, organizationId)) throw forbidden('Only this organization’s administrators can change it.');
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
