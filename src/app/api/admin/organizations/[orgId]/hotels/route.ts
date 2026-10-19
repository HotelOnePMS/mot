import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { getOrganization, setOrganizationHotels } from '@/server/services/organizations';

type Params = { params: Promise<{ orgId: string }> };

/** PUT { propertyIds } — the organization's hotels. */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  const { propertyIds } = await parseJson(request, z.object({ propertyIds: z.array(z.string()).max(500) }));
  await setOrganizationHotels({ actor, source: 'classic' }, orgId, propertyIds);
  return json(await getOrganization(actor, orgId));
});
