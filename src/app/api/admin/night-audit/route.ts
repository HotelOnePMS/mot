import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { isISODate } from '@/server/dates';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { closeBusinessDay, nightAuditPreview } from '@/server/services/nightAudit';

const day = z.string().refine(isISODate, 'must be YYYY-MM-DD');

/** GET ?propertyId&date — what the night audit would close (default: today at the hotel). */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('audit.run');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional(), date: day.optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json(await nightAuditPreview(actor, propertyId, q.date));
});

/** POST — close the business day and save the report. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('audit.run');
  const body = await parseJson(
    request,
    z.object({
      propertyId: z.string().min(1),
      businessDate: day,
      noShowBookingIds: z.array(z.string()).max(200).default([]),
      flagOccupiedRooms: z.boolean().default(false),
      notes: z.string().trim().max(2000).nullable().optional(),
    })
  );
  const record = await closeBusinessDay({ actor, source: 'classic' }, body.propertyId, body);
  return json(record, { status: 201 });
});
