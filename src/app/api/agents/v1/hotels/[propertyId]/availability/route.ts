import { agentJson, agentRoute, preflight } from '@/server/agent-api/http';
import { queryArgs, restToolContext } from '@/server/agent-api/rest';
import { callTool } from '@/server/agent-api/tools';

export const dynamic = 'force-dynamic';
const METHODS = 'GET, OPTIONS';
type Route = { params: Promise<{ propertyId: string }> };

/** GET /api/agents/v1/hotels/{propertyId}/availability?checkIn=&checkOut=&guests=&rooms= — live availability (operationId checkAvailability). */
export const GET = agentRoute(METHODS, async (request, ctx, { params }: Route) => {
  const { propertyId } = await params;
  return agentJson(await callTool('check_availability', queryArgs(request, { propertyId }), restToolContext(ctx)));
});

export const OPTIONS = (request: Request) => preflight(request, METHODS);
