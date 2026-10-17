import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { assignRoomCleaning, listTasks } from '@/server/services/housekeeping';

const query = z.object({
  propertyId: z.string().optional(),
  mine: z.enum(['1', 'true']).optional(),
  includeDone: z.enum(['1', 'true']).optional(),
});

/** GET — open cleaning tasks (optionally only mine, optionally with today's done). */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('housekeeping.view');
  const q = parseQuery(request, query);
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json(await listTasks(actor, propertyId, { mine: !!q.mine || actor.role === 'HOUSEKEEPER', includeDone: !!q.includeDone }));
});

const assignSchema = z.object({
  roomId: z.string().min(1),
  assignedTo: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(3).optional(),
  notes: z.string().max(500).optional(),
});

/** POST — queue a room for cleaning and/or assign it to a housekeeper. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('housekeeping.assign');
  const body = await parseJson(request, assignSchema);
  const task = await assignRoomCleaning({ actor, source: 'classic' }, body.roomId, body.assignedTo ?? null, {
    priority: body.priority,
    notes: body.notes,
  });
  return json(task, { status: 201 });
});
