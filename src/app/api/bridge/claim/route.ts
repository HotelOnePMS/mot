import { NextRequest } from 'next/server';
import { handleRoute, json } from '@/server/http';
import { authenticateBridge, claimTask } from '@/server/services/bridge';
import { DISPLAY, MAX_STEPS } from '@/server/bridge/operator';

/**
 * POST /api/bridge/claim — a connector (device token) or the cloud worker
 * asks for its next task. Also acts as the heartbeat.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const caller = await authenticateBridge(request.headers.get('authorization'));
  if (caller.kind === 'device' && caller.connection.status === 'PAUSED') return json({ task: null, paused: true });
  const next = await claimTask(caller);
  if (!next) return json({ task: null });
  return json({
    task: { id: next.task.id, kind: next.task.kind, instruction: next.task.instruction },
    connection: { system: next.connection.system, loginUrl: next.connection.loginUrl, mode: next.connection.mode, property: next.connection.property.name },
    display: DISPLAY,
    maxSteps: MAX_STEPS,
  });
});
