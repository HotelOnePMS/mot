import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff } from '@/server/authz';
import { notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { taskView, updateTaskByStaff } from '@/server/services/bridge';

/** Retried tasks for an MCP-connected PMS run right after this response. */
export const maxDuration = 60;

type Params = { params: Promise<{ taskId: string }> };

/** GET — one bridge task (the agent's live card polls this). */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { taskId } = await params;
  const actor = await requireStaff('bridge.use');
  const t = await prisma.bridgeTask.findUnique({ where: { id: taskId } });
  if (!t) throw notFound('Task');
  assertPropertyAccess(actor, t.propertyId);
  return json(taskView(t), { headers: { 'Cache-Control': 'no-store' } });
});

/** PATCH { action: cancel | retry } */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { taskId } = await params;
  const actor = await requireStaff('bridge.use');
  const { action } = await parseJson(request, z.object({ action: z.enum(['cancel', 'retry']) }));
  return json(taskView(await updateTaskByStaff(actor, taskId, action)));
});
