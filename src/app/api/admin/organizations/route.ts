import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { createOrganization, listOrganizations } from '@/server/services/organizations';

/** GET — organizations you administer (platform admins: all). */
export const GET = handleRoute(async () => {
  const actor = await requireStaff();
  return json(await listOrganizations(actor));
});

/** POST { name, propertyIds } — start a hotel group from hotels you run; you become its administrator. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('org.manage');
  const body = await parseJson(request, z.object({ name: z.string().trim().min(2).max(120), propertyIds: z.array(z.string()).max(500).default([]) }));
  return json(await createOrganization({ actor, source: 'classic' }, body), { status: 201 });
});
