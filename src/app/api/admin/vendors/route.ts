import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { addVendor, listVendors, vendorAccess, vendorFields } from '@/server/services/vendors';

// No permission on requireStaff: the owner can give vendors.view / vendors.manage to other roles at their hotel,
// so the service checks it per hotel (canAtProperty).

/** GET ?propertyId — the hotel's vendors, and whether this person may change them. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff();
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const vendors = await listVendors(actor, propertyId);
  const access = await vendorAccess(actor, propertyId);
  return json({ vendors, canManage: access.manage });
});

/** POST { propertyId?, name, category, ...contact } — add a vendor. Owners, or managers the owner allowed. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff();
  const body = await parseJson(request, z.object({ propertyId: z.string().optional(), ...vendorFields }));
  const { propertyId: requested, ...input } = body;
  const propertyId = await resolvePropertyId(actor, requested);
  return json(await addVendor({ actor, source: 'classic' }, propertyId, input), { status: 201 });
});
