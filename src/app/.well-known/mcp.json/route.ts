import { mcpManifest } from '@/server/agent-api/discovery';
import { publicDocHeaders, requestOrigin } from '@/server/agent-api/http';

/** GET /.well-known/mcp.json — where HotelOne's MCP servers are and how to connect. */
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new Response(JSON.stringify(mcpManifest(requestOrigin(request)), null, 2), { headers: publicDocHeaders('application/json; charset=utf-8') });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: publicDocHeaders('text/plain') });
}
