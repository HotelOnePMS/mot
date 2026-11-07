import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseQuery } from '@/server/http';
import { checkDoNotRent } from '@/server/services/doNotRent';

const query = z.object({ propertyId: z.string().optional(), email: z.string().max(200).optional(), phone: z.string().max(40).optional() });

/** GET ?propertyId&email&phone — the matching Do Not Rent entry, or null. Used while taking a booking at the desk. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('dnr.view');
  const q = parseQuery(request, query);
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json({ match: await checkDoNotRent(actor, propertyId, q) });
});
