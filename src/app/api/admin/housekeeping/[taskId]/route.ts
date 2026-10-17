import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/server/authz';
import { notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { assignRoomCleaning, deleteTask, updateTaskStatus } from '@/server/services/housekeeping';

type Params = { params: Promise<{ taskId: string }> };

const patchSchema = z
  .object({
    status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'INSPECTED']).optional(),
    assignedTo: z.string().nullable().optional(),
    priority: z.number().int().min(1).max(3).optional(),
  })
  .refine((b) => b.status !== undefined || b.assignedTo !== undefined || b.priority !== undefined, 'Nothing to update');

/** PATCH — update status (start / done / inspected) or reassign. */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { taskId } = await params;
  const actor = await requireStaff('housekeeping.update');
  const body = await parseJson(request, patchSchema);
  const ctx = { actor, source: 'classic' as const };
  if (body.assignedTo !== undefined || body.priority !== undefined) {
    const task = await prisma.roomHousekeeping.findUnique({ where: { id: taskId }, select: { roomId: true, assignedTo: true } });
    if (!task) throw notFound('Task');
    await assignRoomCleaning(ctx, task.roomId, body.assignedTo !== undefined ? body.assignedTo : task.assignedTo, { priority: body.priority });
  }
  if (body.status) await updateTaskStatus(ctx, taskId, body.status);
  return json({ ok: true });
});

export const DELETE = handleRoute(async (_request: NextRequest, { params }: Params) => {
  const { taskId } = await params;
  const actor = await requireStaff('housekeeping.delete');
  await deleteTask({ actor, source: 'classic' }, taskId);
  return json({ ok: true });
});
