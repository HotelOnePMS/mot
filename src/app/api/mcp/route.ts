import { preflight } from '@/server/agent-api/http';
import { MCP_METHODS, handleMcpPost, mcpMethodNotAllowed } from '@/server/agent-api/mcp';

/**
 * HotelOne's MCP server for every listed hotel (Streamable HTTP, stateless
 * JSON). Add https://<site>/api/mcp to Claude, ChatGPT, Grok, Le Chat or any
 * MCP client. See src/server/agent-api/mcp.ts.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function POST(request: Request) {
  return handleMcpPost(request);
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
