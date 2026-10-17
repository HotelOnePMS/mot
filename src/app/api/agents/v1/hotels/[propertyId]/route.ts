import { agentJson, agentRoute, preflight } from '@/server/agent-api/http';
import { restToolContext } from '@/server/agent-api/rest';
import { callTool } from '@/server/agent-api/tools';

export const dynamic = 'force-dynamic';
const METHODS = 'GET, OPTIONS';
type Route = { params: Promise<{ propertyId: string }> };

/** GET /api/agents/v1/hotels/{propertyId} — hotel details (operationId getHotel). */
export const GET = agentRoute(METHODS, async (_request, ctx, { params }: Route) => {
  const { propertyId } = await params;
  return agentJson(await callTool('get_hotel', { propertyId }, restToolContext(ctx)));
});

export const OPTIONS = (request: Request) => preflight(request, METHODS);
