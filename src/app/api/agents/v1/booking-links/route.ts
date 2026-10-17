import { agentJson, agentRoute, preflight } from '@/server/agent-api/http';
import { bodyArgs, restToolContext } from '@/server/agent-api/rest';
import { callTool } from '@/server/agent-api/tools';

export const dynamic = 'force-dynamic';
const METHODS = 'POST, OPTIONS';

/** POST /api/agents/v1/booking-links — a pre-filled checkout link the guest confirms (operationId createBookingLink). */
export const POST = agentRoute(METHODS, async (request, ctx) => agentJson(await callTool('get_booking_link', await bodyArgs(request), restToolContext(ctx))));

export const OPTIONS = (request: Request) => preflight(request, METHODS);
