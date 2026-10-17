import { agentJson, agentRoute, preflight } from '@/server/agent-api/http';
import { bodyArgs, restToolContext } from '@/server/agent-api/rest';
import { callTool } from '@/server/agent-api/tools';

export const dynamic = 'force-dynamic';
const METHODS = 'POST, OPTIONS';

/** POST /api/agents/v1/booking-requests — a request the hotel team confirms (operationId requestBooking). 201 when saved. */
export const POST = agentRoute(METHODS, async (request, ctx) => agentJson(await callTool('request_booking', await bodyArgs(request), restToolContext(ctx)), { status: 201 }));

export const OPTIONS = (request: Request) => preflight(request, METHODS);
