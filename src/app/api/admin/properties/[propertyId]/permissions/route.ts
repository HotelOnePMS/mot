import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { getPermissionSettings, setPermissionGrant } from '@/server/services/permissions';

type Params = { params: Promise<{ propertyId: string }> };

const bodySchema = z.object({
  permission: z.string().min(1).max(64),
  role: z.string().min(1).max(32),
  granted: z.boolean(),
});

/** GET — what the owner has allowed other roles at this hotel (owners). */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('permissions.manage');
  return json(await getPermissionSettings(actor, propertyId));
});

/** PUT — give a role a permission at this hotel, or take it back. Returns the settings. */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('permissions.manage');
  const body = await parseJson(request, bodySchema);
  return json(await setPermissionGrant({ actor, source: 'classic' }, propertyId, body));
});
