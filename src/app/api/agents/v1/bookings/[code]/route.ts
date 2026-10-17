import { agentJson, agentRoute, preflight } from '@/server/agent-api/http';
import { queryArgs, restToolContext } from '@/server/agent-api/rest';
import { callTool } from '@/server/agent-api/tools';

export const dynamic = 'force-dynamic';
const METHODS = 'GET, OPTIONS';
type Route = { params: Promise<{ code: string }> };

/** GET /api/agents/v1/bookings/{code}?lastName= — find a booking (operationId findBooking). 404 when code and name don't match. */
export const GET = agentRoute(METHODS, async (request, ctx, { params }: Route) => {
  const { code } = await params;
  const result = await callTool('find_booking', queryArgs(request, { code }), restToolContext(ctx));
  if (result.found === false) {
    const message = String(result.message);
    return agentJson({ found: false, error: message, message, code: 'NOT_FOUND' }, { status: 404 });
  }
  return agentJson(result);
});

export const OPTIONS = (request: Request) => preflight(request, METHODS);
