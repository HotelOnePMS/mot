import { agentCard } from '@/server/agent-api/discovery';
import { publicDocHeaders, requestOrigin } from '@/server/agent-api/http';

/** GET /.well-known/agent.json — the agent card at the path older A2A clients look for. */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new Response(JSON.stringify(agentCard(requestOrigin(request)), null, 2), { headers: publicDocHeaders('application/json; charset=utf-8') });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: publicDocHeaders('text/plain') });
}
