import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { getOrganization, updateOrganization } from '@/server/services/organizations';

type Params = { params: Promise<{ orgId: string }> };

export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  return json(await getOrganization(actor, orgId));
});

const patch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  billingEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  requireMfa: z.boolean().optional(),
  defaultRole: z.enum(['OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER']).optional(),
});

/** PATCH — name, billing email, the two-step sign-in requirement, the role new SSO/SCIM people get. */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  const body = await parseJson(request, patch);
  await updateOrganization({ actor, source: 'classic' }, orgId, { ...body, billingEmail: body.billingEmail === '' ? null : body.billingEmail });
  return json(await getOrganization(actor, orgId));
});
