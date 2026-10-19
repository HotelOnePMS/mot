import { agentCard } from '@/server/agent-api/discovery';
import { publicDocHeaders, publicOrigin } from '@/server/agent-api/http';

/** GET /.well-known/agent-card.json — A2A-style agent card pointing at the MCP server and REST API. */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(JSON.stringify(agentCard(publicOrigin()), null, 2), { headers: publicDocHeaders('application/json; charset=utf-8') });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: publicDocHeaders('text/plain') });
}
