/**
 * The agent-native interface: how people's own AI assistants (ChatGPT,
 * Claude, Grok, Le Chat, Meta's assistants, any MCP client or agent) search
 * and book HotelOne hotels.
 *
 * - mcp.ts — the MCP server (Streamable HTTP, stateless JSON-RPC) for all
 *   hotels (/api/mcp) and per hotel (/api/mcp/hotels/{propertyId}).
 * - tools.ts — the tool registry both the MCP server and the REST API
 *   (/api/agents/v1, rest.ts) run, wrapping @/server/concierge.
 * - keys.ts — API keys ("ho_live_…", hashed) for integrations that book directly.
 * - http.ts — CORS, Origin checks, rate limits, the REST route wrapper.
 * - openapi.ts, discovery.ts — /openapi.json, /llms.txt, /llms-full.txt,
 *   /.well-known/agent-card.json and /.well-known/mcp.json.
 */
export * from './keys';
export { agentRoute, agentJson, preflight, publicDocHeaders, requestOrigin, clientIp, originAllowed, consumeAgentLimit, PUBLISHED_LIMITS, type AgentRequestContext, type RateCategory } from './http';
export { listTools, callTool, toolCatalog, isToolName, type ToolName, type ToolContext, type ListedTool, type ScopedHotel } from './tools';
export { handleMcpPost, mcpMethodNotAllowed, MCP_METHODS, MCP_PROTOCOL_VERSIONS, MCP_LATEST_VERSION, MCP_SERVER_VERSION } from './mcp';
export { openApiDocument, API_VERSION } from './openapi';
export { agentUrls, llmsTxt, llmsFullTxt, agentCard, mcpManifest } from './discovery';
export { REST_BASE, queryArgs, bodyArgs, restToolContext } from './rest';
