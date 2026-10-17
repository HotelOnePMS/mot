import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { UserRole } from '@prisma/client';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseQuery } from '@/server/http';
import { listTeam } from '@/server/services/team';

const ROLES: UserRole[] = ['OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'];

/** GET — staff assigned to a property (e.g. ?role=HOUSEKEEPER for assignment pickers). */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('housekeeping.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional(), role: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const roles = q.role ? (q.role.split(',').filter((r) => (ROLES as string[]).includes(r)) as UserRole[]) : undefined;
  return json(await listTeam(actor, propertyId, roles));
});
