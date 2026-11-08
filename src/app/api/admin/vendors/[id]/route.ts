import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { removeVendor, updateVendor, vendorFields } from '@/server/services/vendors';

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object(vendorFields).partial();

/** PATCH — change a vendor's details (every change is logged with before and after). */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { id } = await params;
  const actor = await requireStaff();
  const body = await parseJson(request, patchSchema);
  return json(await updateVendor({ actor, source: 'classic' }, id, body));
});

/** DELETE — take the vendor off the list. The activity log keeps who added and removed it. */
export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const actor = await requireStaff();
  return json(await removeVendor({ actor, source: 'classic' }, id));
});
