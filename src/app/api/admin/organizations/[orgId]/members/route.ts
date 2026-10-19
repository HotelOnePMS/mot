import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { getOrganization, removeMember, upsertMember } from '@/server/services/organizations';

type Params = { params: Promise<{ orgId: string }> };

/** POST { email, role } — add a staff member to the organization, or change their role (ADMIN sees every hotel). */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  const body = await parseJson(request, z.object({ email: z.string().trim().email(), role: z.enum(['ADMIN', 'MEMBER']) }));
  await upsertMember({ actor, source: 'classic' }, orgId, body);
  return json(await getOrganization(actor, orgId));
});

/** DELETE ?userId — remove someone from the organization (their hotel assignments stay). */
export const DELETE = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  const { userId } = parseQuery(request, z.object({ userId: z.string().min(1) }));
  await removeMember({ actor, source: 'classic' }, orgId, userId);
  return json(await getOrganization(actor, orgId));
});
