import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { confirmPlan } from '@/server/agent/engine';
import { handleRoute, json, parseJson } from '@/server/http';

/** Confirmed PMS changes through an MCP server run inside this request (and may finish after it). */
export const maxDuration = 60;

/**
 * POST /api/agent/confirm { token } — carry out a plan the agent proposed.
 * The token is HMAC-signed for this user, expires after 10 minutes and can
 * only run once; each step re-checks permissions and domain rules.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('agent.use');
  const { token } = await parseJson(request, z.object({ token: z.string().min(20).max(20000) }));
  return json(await confirmPlan(actor, token));
});
