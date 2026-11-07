import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { addDoNotRent, listDoNotRent } from '@/server/services/doNotRent';

/** GET ?propertyId — the hotel's Do Not Rent list, newest first. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('dnr.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  return json(await listDoNotRent(actor, await resolvePropertyId(actor, q.propertyId)));
});

const addSchema = z.object({
  propertyId: z.string().optional(),
  guestName: z.string().min(1).max(120),
  email: z.string().max(200).nullish(),
  phone: z.string().max(40).nullish(),
  reason: z.string().min(1).max(1000),
  bookingId: z.string().nullish(),
});

/** POST { guestName, email?, phone?, reason } — add a guest to the list, with a note saying why. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('dnr.manage');
  const body = await parseJson(request, addSchema);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  return json(await addDoNotRent({ actor, source: 'classic' }, { ...body, propertyId }), { status: 201 });
});
