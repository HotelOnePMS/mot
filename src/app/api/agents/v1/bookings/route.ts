import { agentJson, agentRoute, preflight } from '@/server/agent-api/http';
import { bodyArgs, restToolContext } from '@/server/agent-api/rest';
import { callTool } from '@/server/agent-api/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const METHODS = 'POST, OPTIONS';

/**
 * POST /api/agents/v1/bookings — a confirmed pay-at-hotel booking (operationId
 * createBooking). Needs `Authorization: Bearer ho_live_…` with the "book"
 * scope for the hotel: 401 without a key, 403 when the key can't book there.
 */
export const POST = agentRoute(METHODS, async (request, ctx) => agentJson(await callTool('create_booking', await bodyArgs(request), restToolContext(ctx)), { status: 201 }));

export const OPTIONS = (request: Request) => preflight(request, METHODS);
