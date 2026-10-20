import { describe, expect, it, vi } from 'vitest';

// No database in unit tests: every call is within its rate limit.
vi.mock('@/server/agent-api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/agent-api/http')>()),
  consumeAgentLimit: async () => ({ limit: 120, remaining: 119 }),
}));

const { handleMcpPost } = await import('@/server/agent-api/mcp');
const { toolCatalog } = await import('@/server/agent-api/tools');

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  handleMcpPost(new Request('https://hotelone.site/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));

describe('connector directory requirements', () => {
  it('gives every tool a short name, a title and explicit read-only and destructive hints', () => {
    for (const t of toolCatalog()) {
      expect(t.name.length).toBeLessThanOrEqual(64);
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.annotations.title).toBeTruthy();
      expect(typeof t.annotations.readOnlyHint).toBe('boolean');
      expect(typeof t.annotations.destructiveHint).toBe('boolean');
      expect(typeof t.annotations.openWorldHint).toBe('boolean');
    }
  });

  it('marks only the tools that change nothing as read-only', () => {
    const writes = toolCatalog()
      .filter((t) => !t.annotations.readOnlyHint)
      .map((t) => t.name)
      .sort();
    expect(writes).toEqual(['create_booking', 'request_booking']);
  });

  it('negotiates the 2025-11-25 protocol and reports its website and icons', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.protocolVersion).toBe('2025-11-25');
    expect(result.serverInfo.websiteUrl).toMatch(/^https:\/\/.+\/assistants$/);
    expect(result.serverInfo.icons.map((i: { mimeType: string }) => i.mimeType)).toEqual(['image/svg+xml', 'image/png']);
  });

  it('falls back to its newest version for one it does not know', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect((await res.json()).result.protocolVersion).toBe('2025-11-25');
  });

  it('accepts the 2025-11-25 protocol header on later requests', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'ping' }, { 'MCP-Protocol-Version': '2025-11-25' });
    expect(res.status).toBe(200);
    expect((await res.json()).result).toEqual({});
  });
});
