import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { SAVED_CHARGE_UNITS } from '@/lib/saved-charges';
import { deleteSavedCharge, listSavedCharges, mayManageSavedCharges, saveSavedCharge } from '@/server/services/saved-charges';

/** GET: the hotel's usual extra charges (folio.view), and whether the viewer can change them. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('folio.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const [charges, canManage] = await Promise.all([listSavedCharges(actor, propertyId), mayManageSavedCharges(actor, propertyId)]);
  return json({ charges, canManage });
});

const body = z.object({
  propertyId: z.string().optional(),
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(80),
  amount: z.number().positive().max(100_000),
  unit: z.enum(SAVED_CHARGE_UNITS).optional(),
  note: z.string().max(200).nullable().optional(),
});

/** POST: save a usual charge, or change one (by id, or the one with this name). */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('folio.view');
  const b = await parseJson(request, body);
  const propertyId = await resolvePropertyId(actor, b.propertyId);
  const { saved, before } = await saveSavedCharge({ actor, source: 'classic' }, propertyId, b);
  return json({ charge: saved, created: !before }, { status: before ? 200 : 201 });
});

/** DELETE ?id=: remove a usual charge (folios that have it keep it). */
export const DELETE = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('folio.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional(), id: z.string().min(1).max(64) }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json({ removed: await deleteSavedCharge({ actor, source: 'classic' }, propertyId, { id: q.id }) });
});
