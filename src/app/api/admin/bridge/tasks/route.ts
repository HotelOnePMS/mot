import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { enqueueTask, listTasks, taskView } from '@/server/services/bridge';

/** Tasks for an MCP-connected PMS run right after this response. */
export const maxDuration = 60;

export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.use');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json((await listTasks(propertyId, 50)).map(taskView));
});

/**
 * POST — send a task to the PMS operator directly (Your PMS page). Changes
 * from the agent arrive through the confirmed-plan path instead.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.use');
  const body = await parseJson(request, z.object({ propertyId: z.string().min(1), instruction: z.string().trim().min(4).max(1000), kind: z.enum(['LOOKUP', 'FREEFORM']).default('FREEFORM') }));
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  const { task } = await enqueueTask({ actor, source: 'classic' }, propertyId, { kind: body.kind, instruction: body.instruction });
  return json(taskView(task), { status: 201 });
});
