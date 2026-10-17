/**
 * A hotel's PMS connected through the vendor's own MCP server — the
 * agent-native path, next to the desktop connector and the cloud browser.
 *
 * Stored on the hotel's single PmsConnection row (mode 'MCP'):
 *   loginUrl          = the MCP endpoint (Streamable HTTP)
 *   credentialsCipher = vault-sealed { type, token?, headerName?, server? } (AAD = connection id)
 * The token never leaves the server: not in views, logs, errors or prompts.
 */
import type { PmsConnection } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '../authz';
import { badRequest, conflict, DomainError, notFound } from '../errors';
import { recordAudit, type OpContext } from '../services/audit';
import { open, seal, vaultAvailable } from '../vault';
import { coverage, matchContract } from './contract';
import { toDomainError } from './errors';
import { eventsPath, eventsUrl } from './events';
import { authHeaderIssue, authTokenIssue, McpClient, type McpAuth, type McpClientOptions, type McpServerInfo, type McpTool } from './mcp-client';
import { cacheSummary, cacheTools, deleteCachedTools, listCachedTools } from './tools';
import { assertSafeMcpUrl, displayUrl } from './url-guard';

export type McpAuthInput = { type: 'none' | 'bearer' | 'header'; token?: string | null; headerName?: string | null };

/** What the vault holds for an MCP connection. */
interface SealedMcpAuth {
  type: 'none' | 'bearer' | 'header';
  token?: string | null;
  headerName?: string | null;
  server?: (McpServerInfo & { checkedAt: string }) | null;
}

export function isMcpConnection(c: Pick<PmsConnection, 'mode'> | null | undefined): boolean {
  return (c?.mode as string | undefined) === 'MCP';
}

function toClientAuth(a: SealedMcpAuth | McpAuthInput): McpAuth {
  if (a.type === 'bearer') return { type: 'bearer', token: a.token ?? '' };
  if (a.type === 'header') return { type: 'header', headerName: a.headerName ?? '', token: a.token ?? '' };
  return { type: 'none' };
}

function validateAuth(a: McpAuthInput): void {
  if (a.type === 'none') return;
  const tokenIssue = authTokenIssue(a.token ?? '');
  if (tokenIssue) throw badRequest(tokenIssue);
  if (a.type === 'header') {
    const headerIssue = authHeaderIssue(a.headerName ?? '');
    if (headerIssue) throw badRequest(headerIssue);
  }
}

function readSealed(c: PmsConnection): SealedMcpAuth | null {
  if (!c.credentialsCipher) return null;
  try {
    return open<SealedMcpAuth>(c.credentialsCipher, c.id);
  } catch {
    return null;
  }
}

function requireVault() {
  if (!vaultAvailable()) throw new DomainError(503, 'VAULT_DISABLED', 'Secure token storage isn’t set up on this server yet (platform admin: set HOTELONE_VAULT_KEY).');
}

export interface ProbeResult {
  server: McpServerInfo;
  tools: McpTool[];
  ms: number;
}

/** initialize + tools/list against a URL, without saving anything. Throws McpError. */
export async function probeMcp(url: string, auth: McpAuth, opts: McpClientOptions = {}): Promise<ProbeResult> {
  const started = Date.now();
  await assertSafeMcpUrl(url);
  const client = new McpClient(url, auth, { timeoutMs: 15_000, deadline: Date.now() + 30_000, ...opts });
  try {
    const server = await client.initialize();
    const tools = await client.listTools();
    return { server, tools, ms: Date.now() - started };
  } finally {
    void client.close();
  }
}

/** An initialised-on-demand client for a hotel's saved MCP connection. */
export function clientFor(c: PmsConnection, opts: McpClientOptions = {}): McpClient {
  if (!isMcpConnection(c) || !c.loginUrl) throw badRequest('This hotel’s PMS isn’t connected through MCP.');
  const sealed = readSealed(c);
  if (c.credentialsCipher && !sealed) throw new DomainError(500, 'VAULT_OPEN_FAILED', 'The stored PMS token can’t be opened (the vault key changed?). Reconnect the PMS.');
  return new McpClient(c.loginUrl, toClientAuth(sealed ?? { type: 'none' }), opts);
}

export interface ConnectMcpInput {
  system: string;
  url: string;
  auth: McpAuthInput;
}

/**
 * Connect (or reconnect) a hotel's PMS through its MCP server. Tests the
 * server first (initialize + tools/list) and saves nothing if that fails.
 * An empty token on a reconnect to the same address keeps the stored one.
 */
export async function connectMcp(ctx: OpContext, propertyId: string, input: ConnectMcpInput) {
  requirePermission(ctx.actor, 'bridge.manage');
  requireVault();
  const system = input.system.trim().slice(0, 60);
  const url = input.url.trim();
  const existing = await prisma.pmsConnection.findUnique({ where: { propertyId } });

  let auth: McpAuthInput = { type: input.auth.type, token: input.auth.token?.trim() || null, headerName: input.auth.headerName?.trim() || null };
  if (auth.type !== 'none' && !auth.token && existing && isMcpConnection(existing) && existing.loginUrl === url) {
    const prev = readSealed(existing);
    if (prev && prev.type === auth.type && prev.token) auth = { ...auth, token: prev.token, headerName: auth.headerName || prev.headerName || null };
  }
  validateAuth(auth);

  let probe: ProbeResult;
  try {
    probe = await probeMcp(url, toClientAuth(auth));
  } catch (e) {
    throw toDomainError(e);
  }
  if (!probe.tools.length) throw badRequest(`${system}’s MCP server answered but offers no tools yet. Ask ${system} to enable its tools for this account.`);

  const sealedValue: SealedMcpAuth = { ...auth, server: { ...probe.server, checkedAt: new Date().toISOString() } };
  const switching = existing && !isMcpConnection(existing);
  const connection = await prisma.$transaction(async (tx) => {
    if (switching) {
      // The old way in (connector / cloud browser) can't run what's waiting.
      await tx.bridgeTask.updateMany({ where: { connectionId: existing.id, status: { in: ['QUEUED', 'NEEDS_HELP'] } }, data: { status: 'CANCELLED', finishedAt: new Date(), error: 'The PMS connection was switched to MCP.' } });
    }
    const fields = {
      system,
      mode: 'MCP' as const,
      loginUrl: url,
      status: 'CONNECTED' as const,
      lastSeenAt: new Date(),
      lastError: null,
      pairingCode: null,
      pairingExpiresAt: null,
      deviceTokenHash: null,
      deviceName: null,
    };
    const c = await tx.pmsConnection.upsert({ where: { propertyId }, create: { propertyId, ...fields }, update: { ...fields, credentialsCipher: null } });
    return tx.pmsConnection.update({ where: { id: c.id }, data: { credentialsCipher: seal(sealedValue, c.id) } });
  });
  await prisma.property.update({ where: { id: propertyId }, data: { setupPath: 'BRIDGE' } });
  const { mapping } = await cacheTools(propertyId, connection, probe.tools);
  const cov = coverage(mapping);
  await recordAudit(
    ctx,
    propertyId,
    'PMS_MCP_CONNECT',
    `${existing && isMcpConnection(existing) ? 'Reconnected' : 'Connected'} ${system} through its MCP server (${probe.tools.length} tool${probe.tools.length === 1 ? '' : 's'}, ${cov.matched} of ${cov.total} recommended)`,
    { connectionId: connection.id, server: probe.server.name, authType: auth.type },
  );
  return getMcpStatus(propertyId);
}

/** Re-read the tool list from the saved connection and re-cache it. */
export async function refreshTools(propertyId: string, ctx?: OpContext) {
  if (ctx) requirePermission(ctx.actor, 'bridge.manage');
  const c = await prisma.pmsConnection.findUnique({ where: { propertyId } });
  if (!c || !isMcpConnection(c)) throw notFound('MCP connection');
  const client = clientFor(c, { timeoutMs: 15_000, deadline: Date.now() + 30_000 });
  let tools: McpTool[];
  try {
    tools = await client.listTools();
  } catch (e) {
    await prisma.pmsConnection.update({ where: { id: c.id }, data: { status: c.status === 'PAUSED' ? 'PAUSED' : 'ERROR', lastError: e instanceof Error ? e.message.slice(0, 300) : 'Tool refresh failed' } });
    throw toDomainError(e);
  } finally {
    void client.close();
  }
  await saveServerInfo(c, client.serverInfo);
  await prisma.pmsConnection.update({ where: { id: c.id }, data: { lastSeenAt: new Date(), lastError: null, ...(c.status === 'ERROR' || c.status === 'PENDING' ? { status: 'CONNECTED' } : {}) } });
  const { tools: cached, mapping } = await cacheTools(propertyId, c, tools);
  if (ctx) await recordAudit(ctx, propertyId, 'PMS_MCP_TOOLS', `Refreshed ${c.system}’s tools (${tools.length})`, { connectionId: c.id });
  return { tools: cached, contract: coverage(mapping) };
}

async function saveServerInfo(c: PmsConnection, server: McpServerInfo | null) {
  if (!server) return;
  const sealed = readSealed(c);
  if (!sealed && c.credentialsCipher) return;
  const next: SealedMcpAuth = { ...(sealed ?? { type: 'none' }), server: { ...server, checkedAt: new Date().toISOString() } };
  await prisma.pmsConnection.update({ where: { id: c.id }, data: { credentialsCipher: seal(next, c.id) } }).catch(() => undefined);
}

/**
 * Test a URL + auth before saving (for the Connect form), or — with no
 * input — the saved connection (updates its status / lastError).
 */
export async function testMcp(ctx: OpContext, propertyId: string, input?: { url: string; auth: McpAuthInput }) {
  requirePermission(ctx.actor, 'bridge.manage');
  if (input) {
    validateAuth(input.auth);
    try {
      const p = await probeMcp(input.url.trim(), toClientAuth(input.auth));
      return { ok: true as const, server: publicServer(p.server), toolCount: p.tools.length, contract: coverage(matchContract(p.tools)), ms: p.ms };
    } catch (e) {
      throw toDomainError(e);
    }
  }
  const c = await prisma.pmsConnection.findUnique({ where: { propertyId } });
  if (!c || !isMcpConnection(c)) throw notFound('MCP connection');
  const started = Date.now();
  const client = clientFor(c, { timeoutMs: 15_000, deadline: Date.now() + 30_000 });
  try {
    const server = await client.initialize();
    const tools = await client.listTools();
    await saveServerInfo(c, server);
    await prisma.pmsConnection.update({ where: { id: c.id }, data: { lastSeenAt: new Date(), lastError: null, ...(c.status !== 'PAUSED' ? { status: 'CONNECTED' } : {}) } });
    return { ok: true as const, server: publicServer(server), toolCount: tools.length, contract: coverage(matchContract(tools)), ms: Date.now() - started };
  } catch (e) {
    await prisma.pmsConnection.update({ where: { id: c.id }, data: { lastError: e instanceof Error ? e.message.slice(0, 300) : 'Test failed', ...(c.status !== 'PAUSED' ? { status: 'ERROR' } : {}) } });
    throw toDomainError(e);
  } finally {
    void client.close();
  }
}

/** Disconnect an MCP connection (desktop / cloud connections are handled by the bridge's own routes). */
export async function disconnectMcp(ctx: OpContext, propertyId: string) {
  requirePermission(ctx.actor, 'bridge.manage');
  const c = await prisma.pmsConnection.findUnique({ where: { propertyId } });
  if (!c) return { ok: true };
  if (!isMcpConnection(c)) throw conflict('This PMS is connected through the desktop connector or cloud browser — disconnect it on the Your PMS page.');
  await prisma.$transaction([
    prisma.bridgeTask.updateMany({ where: { connectionId: c.id, status: { in: ['QUEUED', 'NEEDS_HELP'] } }, data: { status: 'CANCELLED', finishedAt: new Date() } }),
    prisma.pmsConnection.delete({ where: { id: c.id } }),
  ]);
  await deleteCachedTools(propertyId);
  await recordAudit(ctx, propertyId, 'PMS_MCP_DISCONNECT', `Disconnected ${c.system}’s MCP server`, { connectionId: c.id });
  return { ok: true };
}

const publicServer = (s: McpServerInfo) => ({ name: s.name, title: s.title ?? null, version: s.version ?? null, protocolVersion: s.protocolVersion });

/**
 * The console's view of the hotel's MCP connection: no secrets (the URL's
 * query values are masked too). `connection` is null when there is no
 * connection; `mcp` is null when the connection uses another mode.
 */
export async function getMcpStatus(propertyId: string) {
  const c = await prisma.pmsConnection.findUnique({ where: { propertyId } });
  if (!c) return { connection: null, mcp: null };
  const base = {
    id: c.id,
    system: c.system,
    mode: c.mode as string,
    status: c.status,
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    lastError: c.lastError,
    events: { url: eventsUrl(c.id), path: eventsPath(c.id) },
  };
  if (!isMcpConnection(c)) return { connection: base, mcp: null };
  const sealed = readSealed(c);
  const tools = await listCachedTools(propertyId);
  return {
    connection: base,
    mcp: {
      url: displayUrl(c.loginUrl),
      authType: sealed?.type ?? (c.credentialsCipher ? 'unknown' : 'none'),
      authHeaderName: sealed?.type === 'header' ? sealed.headerName ?? null : null,
      hasToken: !!sealed?.token,
      vaultReadable: !c.credentialsCipher || !!sealed,
      server: sealed?.server ? { ...publicServer(sealed.server), checkedAt: sealed.server.checkedAt } : null,
      ...cacheSummary(tools),
      tools: tools.map((t) => ({ key: t.key, name: t.name, title: t.title, description: t.description, readOnly: t.readOnly, contract: t.contract, blocked: t.blocked, status: t.status, uses: t.uses, lastUsedAt: t.lastUsedAt })),
      plannerReady: !!process.env.OPENAI_API_KEY,
    },
  };
}
export type McpStatusView = Awaited<ReturnType<typeof getMcpStatus>>;
