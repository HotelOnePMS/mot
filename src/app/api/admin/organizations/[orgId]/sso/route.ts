import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertCanManageOrg, requireStaff } from '@/server/authz';
import { testIssuer } from '@/server/auth/sso';
import { handleRoute, json, parseJson } from '@/server/http';
import { getOrganization, updateSso } from '@/server/services/organizations';

type Params = { params: Promise<{ orgId: string }> };

const schema = z.object({
  enabled: z.boolean(),
  enforced: z.boolean().default(false),
  issuer: z.string().trim().max(300).nullable(),
  clientId: z.string().trim().max(300).nullable(),
  /** Leave out to keep the stored secret. */
  clientSecret: z.string().trim().max(500).nullable().optional(),
  domains: z.array(z.string().trim().max(120)).max(20),
});

/** PUT — single sign-on settings (OpenID Connect). */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  const body = await parseJson(request, schema);
  await updateSso({ actor, source: 'classic' }, orgId, body);
  return json(await getOrganization(actor, orgId));
});

/** POST { issuer } — check the identity provider's discovery document. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  assertCanManageOrg(actor, orgId);
  const { issuer } = await parseJson(request, z.object({ issuer: z.string().trim().min(8).max(300) }));
  return json(await testIssuer(issuer));
});
