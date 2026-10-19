import { mcpManifest } from '@/server/agent-api/discovery';
import { publicDocHeaders, publicOrigin } from '@/server/agent-api/http';

/** GET /.well-known/mcp.json — where HotelOne's MCP servers are and how to connect. */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(JSON.stringify(mcpManifest(publicOrigin()), null, 2), { headers: publicDocHeaders('application/json; charset=utf-8') });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: publicDocHeaders('text/plain') });
}
