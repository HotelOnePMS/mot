import type { UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { TeamMember } from '@/lib/dto';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { personName } from './mappers';

/** Active staff assigned to a property, optionally filtered by role. */
export async function listTeam(actor: Actor, propertyId: string, roles?: UserRole[]): Promise<TeamMember[]> {
  requirePermission(actor, 'housekeeping.view');
  assertPropertyAccess(actor, propertyId);
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: roles ? { in: roles } : { not: 'CUSTOMER' },
      assignedProperties: { some: { propertyId } },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      _count: { select: { housekeepingTasks: { where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } } } },
    },
    orderBy: [{ firstName: 'asc' }],
  });
  return users.map((u) => ({ id: u.id, name: personName(u), email: u.email, role: u.role, openTasks: u._count.housekeepingTasks }));
}
