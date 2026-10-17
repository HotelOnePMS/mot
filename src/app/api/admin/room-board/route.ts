import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { isISODate } from '@/server/dates';
import { handleRoute, json, parseQuery } from '@/server/http';
import { roomBoard } from '@/server/services/rooms';

const query = z.object({
  propertyId: z.string().optional(),
  date: z.string().refine(isISODate, 'must be YYYY-MM-DD').optional(),
});

/** GET /api/admin/room-board — every room with status, occupancy and cleaning task. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('room.view');
  const q = parseQuery(request, query);
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json(await roomBoard(actor, propertyId, q.date));
});
