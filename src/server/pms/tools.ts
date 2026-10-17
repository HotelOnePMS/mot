/**
 * PMS tools discovered over MCP, cached as reusable agent skills.
 *
 * Every tool a hotel's PMS exposes becomes an AgentSkill row (kind
 * 'PMS_TOOL', source 'CONFIG', audience 'STAFF', key 'pms-<tool>') so agents
 * and the console see what the PMS can do — and a hotel can switch a tool
 * off (status DISABLED survives refreshes; HotelOne then never calls it).
 *
 * Written with prisma directly: src/server/skills owns the other kinds.
 * Execution never depends on this cache (the executor lists tools live);
 * if the rows vanish they are re-created on the next refresh or task.
 */
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { PRODUCT_NAME as HOTELONE } from '@/config/product';
import { badRequest, notFound } from '../errors';
import { CONTRACT_BY_NAME, coverage, isForbiddenTool, isReadOnlyTool, matchContract, operationForTool, type ContractMapping, type ContractOperationName } from './contract';
import type { McpTool, McpToolAnnotations } from './mcp-client';

export const PMS_TOOL_KIND = 'PMS_TOOL';
export const PMS_TOOL_SOURCE = 'CONFIG';
export const PMS_TOOL_KEY_PREFIX = 'pms-';

export interface PmsToolBody {
  tool: string;
  annotations: McpToolAnnotations | null;
  readOnly: boolean;
  /** The contract operation this tool fulfils, if recognised. */
  contract: ContractOperationName | null;
  /** HotelOne never calls it (deletes, refunds, users, exports…). */
  blocked: boolean;
  connectionId: string;
  system: string;
  syncedAt: string;
}

export interface CachedPmsTool {
  id: string;
  key: string;
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  contract: ContractOperationName | null;
  blocked: boolean;
  status: string;
  parameters: unknown;
  uses: number;
  lastUsedAt: string | null;
  syncedAt: string | null;
}

/** Strip control characters and markup-ish noise; vendor text is untrusted. */
export function sanitiseText(s: string | undefined | null, max: number): string {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/<[^>]{0,200}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function humanise(name: string): string {
  const s = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slug(name: string): string {
  return (
    name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'tool'
  );
}

/** Stable skill keys; two tools that slug alike get a short hash suffix. */
export function toolKeys(names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const n of names) {
    let key = `${PMS_TOOL_KEY_PREFIX}${slug(n)}`;
    if (taken.has(key)) key = `${key.slice(0, 70)}-${createHash('sha256').update(n).digest('hex').slice(0, 6)}`;
    taken.add(key);
    out.set(n, key);
  }
  return out;
}

/** Input schemas are stored as-is unless absurdly large. */
function storableSchema(schema: unknown): Prisma.InputJsonValue {
  const json = JSON.stringify(schema ?? {});
  if (json.length > 20_000) return { type: 'object', description: 'Schema too large to store; the live tool list has it.' };
  return JSON.parse(json) as Prisma.InputJsonValue;
}

/**
 * Write the tool list to the skill cache: upsert every tool, keep a
 * hotel-set DISABLED status, remove PMS tools that disappeared.
 */
export async function cacheTools(propertyId: string, connection: { id: string; system: string }, tools: McpTool[]): Promise<{ mapping: ContractMapping; tools: CachedPmsTool[] }> {
  const mapping = matchContract(tools);
  const keys = toolKeys(tools.map((t) => t.name));
  const syncedAt = new Date().toISOString();
  const existing = await prisma.agentSkill.findMany({ where: { propertyId, kind: PMS_TOOL_KIND }, select: { id: true, key: true, status: true } });
  const byKey = new Map(existing.map((e) => [e.key, e]));

  for (const t of tools) {
    const key = keys.get(t.name)!;
    const op = operationForTool(mapping, t.name);
    const blocked = isForbiddenTool(t.name);
    const body: PmsToolBody = {
      tool: t.name,
      annotations: t.annotations ? (JSON.parse(JSON.stringify(t.annotations)) as McpToolAnnotations) : null,
      readOnly: isReadOnlyTool(t, op),
      contract: op,
      blocked,
      connectionId: connection.id,
      system: connection.system,
      syncedAt,
    };
    const title = sanitiseText(t.title || t.annotations?.title || humanise(t.name), 120) || t.name.slice(0, 120);
    const description =
      sanitiseText(t.description, 500) || (op ? `${CONTRACT_BY_NAME[op].description} (in ${connection.system})` : `${humanise(t.name)} in ${connection.system}.`);
    const data = {
      title,
      description: `${blocked ? '[Not used by HotelOne] ' : ''}${description}`.slice(0, 500),
      parameters: storableSchema(t.inputSchema),
      body: body as unknown as Prisma.InputJsonValue,
      audience: 'STAFF',
      source: PMS_TOOL_SOURCE,
    };
    const current = byKey.get(key);
    if (current) {
      // A tool the hotel switched off stays off; blocked tools are always off.
      await prisma.agentSkill.update({ where: { id: current.id }, data: { ...data, ...(blocked ? { status: 'DISABLED' } : {}) } });
    } else {
      try {
        await prisma.agentSkill.create({ data: { ...data, propertyId, key, kind: PMS_TOOL_KIND, status: blocked ? 'DISABLED' : 'ACTIVE' } });
      } catch (e) {
        // Same key held by a skill of another kind (unlikely: keys start with "pms-"), or a parallel refresh.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
  }

  const wanted = new Set(keys.values());
  const stale = existing.filter((e) => !wanted.has(e.key)).map((e) => e.id);
  if (stale.length) await prisma.agentSkill.deleteMany({ where: { id: { in: stale }, kind: PMS_TOOL_KIND } });
  return { mapping, tools: await listCachedTools(propertyId) };
}

export async function listCachedTools(propertyId: string): Promise<CachedPmsTool[]> {
  const rows = await prisma.agentSkill.findMany({ where: { propertyId, kind: PMS_TOOL_KIND }, orderBy: { key: 'asc' } });
  return rows.map((r) => {
    const b = (r.body ?? {}) as Partial<PmsToolBody>;
    return {
      id: r.id,
      key: r.key,
      name: b.tool ?? r.key.slice(PMS_TOOL_KEY_PREFIX.length),
      title: r.title,
      description: r.description,
      readOnly: !!b.readOnly,
      contract: b.contract ?? null,
      blocked: !!b.blocked,
      status: r.status,
      parameters: r.parameters,
      uses: r.uses,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      syncedAt: b.syncedAt ?? null,
    };
  });
}

/** The contract mapping as last cached ({ operation → tool }). */
export function mappingFromCache(tools: CachedPmsTool[]): ContractMapping {
  const m: ContractMapping = {};
  for (const t of tools) if (t.contract && !m[t.contract]) m[t.contract] = t.name;
  return m;
}

export function cacheSummary(tools: CachedPmsTool[]) {
  const mapping = mappingFromCache(tools);
  return {
    toolCount: tools.length,
    activeCount: tools.filter((t) => t.status === 'ACTIVE').length,
    lastToolsSyncAt: tools.reduce<string | null>((max, t) => (t.syncedAt && (!max || t.syncedAt > max) ? t.syncedAt : max), null),
    contract: coverage(mapping),
  };
}

/** Tool names the hotel switched off (or that are blocked). */
export async function disabledToolNames(propertyId: string): Promise<Set<string>> {
  const rows = await prisma.agentSkill.findMany({ where: { propertyId, kind: PMS_TOOL_KIND, status: { not: 'ACTIVE' } }, select: { body: true } });
  return new Set(rows.map((r) => (r.body as Partial<PmsToolBody> | null)?.tool).filter((n): n is string => !!n));
}

/** Count a use on the cached skills of tools a task called (best effort). */
export async function recordToolUse(propertyId: string, toolNames: string[]): Promise<void> {
  const names = [...new Set(toolNames)];
  if (!names.length) return;
  await prisma.agentSkill
    .updateMany({
      where: { propertyId, kind: PMS_TOOL_KIND, OR: names.map((n) => ({ body: { path: ['tool'], equals: n } })) },
      data: { uses: { increment: 1 }, lastUsedAt: new Date() },
    })
    .catch(() => undefined);
}

/**
 * Switch one PMS tool on or off for HotelOne (the executor never calls a
 * tool whose skill isn't ACTIVE). Blocked tools can't be switched on.
 */
export async function setToolEnabled(propertyId: string, toolName: string, enabled: boolean): Promise<CachedPmsTool> {
  const row = await prisma.agentSkill.findFirst({ where: { propertyId, kind: PMS_TOOL_KIND, body: { path: ['tool'], equals: toolName } } });
  if (!row) throw notFound('PMS tool');
  const body = (row.body ?? {}) as Partial<PmsToolBody>;
  if (enabled && body.blocked) throw badRequest(`${HOTELONE} never uses tools that delete, refund, export data or manage users.`);
  await prisma.agentSkill.update({ where: { id: row.id }, data: { status: enabled ? 'ACTIVE' : 'DISABLED' } });
  return (await listCachedTools(propertyId)).find((t) => t.id === row.id)!;
}

export async function deleteCachedTools(propertyId: string): Promise<number> {
  return (await prisma.agentSkill.deleteMany({ where: { propertyId, kind: PMS_TOOL_KIND } })).count;
}
