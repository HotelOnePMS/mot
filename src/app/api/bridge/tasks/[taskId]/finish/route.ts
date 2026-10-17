import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleRoute, json, parseJson } from '@/server/http';
import { authenticateBridge, finishTask, taskView } from '@/server/services/bridge';

type Params = { params: Promise<{ taskId: string }> };

/** POST — the connector reports how a task ended. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { taskId } = await params;
  const caller = await authenticateBridge(request.headers.get('authorization'));
  const body = await parseJson(request, z.object({ status: z.enum(['DONE', 'FAILED', 'NEEDS_HELP']), summary: z.string().max(2000).optional(), error: z.string().max(1000).optional() }));
  return json(taskView(await finishTask(caller, taskId, body)));
});
