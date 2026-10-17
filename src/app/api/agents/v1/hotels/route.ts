import { agentJson, agentRoute, preflight } from '@/server/agent-api/http';
import { queryArgs, restToolContext } from '@/server/agent-api/rest';
import { callTool } from '@/server/agent-api/tools';

export const dynamic = 'force-dynamic';
const METHODS = 'GET, OPTIONS';

/** GET /api/agents/v1/hotels?location=&query=&checkIn=&checkOut=&guests=&rooms=&limit= — search hotels (operationId searchHotels). */
export const GET = agentRoute(METHODS, async (request, ctx) => agentJson(await callTool('search_hotels', queryArgs(request), restToolContext(ctx))));

export const OPTIONS = (request: Request) => preflight(request, METHODS);
