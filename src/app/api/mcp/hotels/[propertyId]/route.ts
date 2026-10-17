import { preflight } from '@/server/agent-api/http';
import { MCP_METHODS, handleMcpPost, mcpMethodNotAllowed } from '@/server/agent-api/mcp';

/**
 * One hotel's own MCP server: the same tools without cross-hotel search, and
 * every call is about this hotel (no hotel id needed). Hotels share
 * https://<site>/api/mcp/hotels/<propertyId> with their guests.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Route = { params: Promise<{ propertyId: string }> };

export async function POST(request: Request, { params }: Route) {
  const { propertyId } = await params;
  return handleMcpPost(request, propertyId);
}

export function GET(request: Request) {
  return mcpMethodNotAllowed(request);
}

export function DELETE(request: Request) {
  return mcpMethodNotAllowed(request);
}

export function OPTIONS(request: Request) {
  return preflight(request, MCP_METHODS);
}
