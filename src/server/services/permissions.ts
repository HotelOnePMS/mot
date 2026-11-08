/**
 * Permissions an owner gives other staff roles at their hotel (RolePermissionGrant), beyond what each role has by
 * default (PERMISSIONS). Only GRANTABLE_PERMISSIONS can be given, and only to the roles listed for each. Every change is
 * written to the hotel's activity log.
 */
import type { UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PermissionSettings } from '@/lib/permissions';
import { roleLabel } from '@/lib/status';
import { GRANTABLE_PERMISSIONS, PERMISSIONS, assertPropertyAccess, canBeGranted, isGrantable, requirePermission, type Actor } from '../authz';
import { badRequest } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { personName } from './mappers';

export async function getPermissionSettings(actor: Actor, propertyId: string): Promise<PermissionSettings> {
  requirePermission(actor, 'permissions.manage');
  assertPropertyAccess(actor, propertyId);
  const grants = await prisma.rolePermissionGrant.findMany({ where: { propertyId } });
  const by = grants.length
    ? await prisma.user.findMany({ where: { id: { in: [...new Set(grants.map((g) => g.grantedById))] } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  return {
    propertyId,
    permissions: Object.entries(GRANTABLE_PERMISSIONS).map(([permission, def]) => ({
      permission,
      label: def.label,
      description: def.description,
      always: (PERMISSIONS[permission as keyof typeof PERMISSIONS] as readonly string[]).filter((r) => r !== 'ADMIN'),
      roles: def.roles.map((role) => {
        const g = grants.find((x) => x.permission === permission && x.role === role);
        const who = g ? by.find((u) => u.id === g.grantedById) : undefined;
        return { role, granted: !!g, grantedBy: who ? personName(who) : null, grantedAt: g?.createdAt.toISOString() ?? null };
      }),
    })),
  };
}

/** Give a role a permission at this hotel, or take it back. Owners (permissions.manage), at their own hotels. */
export async function setPermissionGrant(op: OpContext, propertyId: string, input: { permission: string; role: string; granted: boolean }): Promise<PermissionSettings> {
  requirePermission(op.actor, 'permissions.manage');
  assertPropertyAccess(op.actor, propertyId);
  const { permission, role, granted } = input;
  if (!isGrantable(permission)) throw badRequest('This permission can’t be given to other roles.');
  if (!canBeGranted(permission, role)) throw badRequest(`${roleLabel(role)} can’t be given “${GRANTABLE_PERMISSIONS[permission].label}”.`);
  const where = { propertyId_role_permission: { propertyId, role: role as UserRole, permission } };
  const label = GRANTABLE_PERMISSIONS[permission].label;
  if (granted) {
    const existing = await prisma.rolePermissionGrant.findUnique({ where, select: { id: true } });
    if (!existing) {
      await prisma.rolePermissionGrant.upsert({ where, create: { propertyId, role: role as UserRole, permission, grantedById: op.actor.userId }, update: {} });
      await recordAudit(op, propertyId, 'PERMISSION_GRANT', `Allowed ${roleLabel(role).toLowerCase()} to “${label.toLowerCase()}”`, { permission, role });
    }
  } else {
    const removed = await prisma.rolePermissionGrant.deleteMany({ where: { propertyId, role: role as UserRole, permission } });
    if (removed.count) await recordAudit(op, propertyId, 'PERMISSION_REVOKE', `Stopped ${roleLabel(role).toLowerCase()} from being able to “${label.toLowerCase()}”`, { permission, role });
  }
  return getPermissionSettings(op.actor, propertyId);
}
