/**
 * The PMS bridge: HotelOne operates a hotel's existing PMS for them, so they
 * get the agent (and voice) without migrating.
 *
 *  • DESKTOP — the HotelOne Connector runs on a front-desk computer and drives
 *    a browser that is already signed in to their PMS. Logins never leave
 *    the hotel.
 *  • CLOUD — our isolated cloud browser signs in with credentials sealed in
 *    the vault (AES-256-GCM). The model never sees them: it asks for a
 *    credential and the worker types it.
 *
 * The agent never acts in the PMS on its own: reads are queued as lookups,
 * changes go through the usual signed plan → confirm before being queued.
 *
 * Tasks that finish well teach a RECIPE skill (bridge/recipes.ts) that the
 * operator gets for the next task of the same kind.
 *
 *  • MCP — the PMS vendor's own MCP server (src/server/pms). Set up through
 *    /api/admin/pms, not upsertConnection. Its tasks run on our server right
 *    after they're queued (no browser), with the same look-up / confirmed-
 *    change rules.
 */
import { randomInt } from 'crypto';
import { PRODUCT_NAME } from '@/config/product';
import { prisma } from '@/lib/prisma';
import { Prisma, type BridgeTask, type PmsConnection } from '@prisma/client';
import type { OperatorAction } from '../bridge/operator';
import { appendLog, describeActions, learnFromTask, screenOf, type BridgePayload } from '../bridge/recipes';
import { requirePermission, type Actor } from '../authz';
import { badRequest, conflict, DomainError, forbidden, notFound } from '../errors';
import { open, randomToken, seal, sha256, vaultAvailable } from '../vault';
import { scheduleMcpTask } from '../pms/run';
import { deleteCachedTools } from '../pms/tools';
import { displayUrl } from '../pms/url-guard';
import { recordAudit, type OpContext } from './audit';

export const PMS_SYSTEMS = ['Cloudbeds', 'Mews', 'Oracle OPERA Cloud', 'Little Hotelier', 'RoomRaccoon', 'eZee Absolute', 'innRoad', 'WebRezPro', 'SkyTouch', 'Hotelogix', 'Other'] as const;
export const TERMINAL = ['DONE', 'FAILED', 'CANCELLED'] as const;
const PAIRING_TTL_MS = 15 * 60 * 1000;
const STALE_RUNNING_MS = 10 * 60 * 1000;

export interface Credentials {
  username: string;
  password: string;
  totpSecret?: string | null;
}

export function connectionView(c: PmsConnection | null) {
  if (!c) return null;
  const pairingLive = !!c.pairingCode && !!c.pairingExpiresAt && c.pairingExpiresAt > new Date();
  return {
    id: c.id,
    system: c.system,
    mode: c.mode,
    status: c.status,
    // An MCP address can carry a key in its query: shown without query values.
    loginUrl: c.mode === 'MCP' ? displayUrl(c.loginUrl) : c.loginUrl,
    hasCredentials: !!c.credentialsCipher,
    deviceName: c.deviceName,
    devicePaired: !!c.deviceTokenHash,
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    online: !!c.lastSeenAt && Date.now() - c.lastSeenAt.getTime() < 2 * 60 * 1000,
    lastError: c.lastError,
    pairing: pairingLive ? { code: c.pairingCode!, expiresAt: c.pairingExpiresAt!.toISOString() } : null,
  };
}
export type ConnectionView = NonNullable<ReturnType<typeof connectionView>>;

export async function getConnection(propertyId: string) {
  return prisma.pmsConnection.findUnique({ where: { propertyId } });
}

export async function upsertConnection(ctx: OpContext, propertyId: string, input: { system: string; mode: 'DESKTOP' | 'CLOUD'; loginUrl?: string | null }) {
  requirePermission(ctx.actor, 'bridge.manage');
  const existing = await getConnection(propertyId);
  const modeChanged = existing && existing.mode !== input.mode;
  const c = await prisma.pmsConnection.upsert({
    where: { propertyId },
    create: { propertyId, system: input.system, mode: input.mode, loginUrl: input.loginUrl || null },
    update: {
      system: input.system,
      mode: input.mode,
      loginUrl: input.loginUrl || null,
      // Switching how we connect invalidates the old way in.
      ...(modeChanged ? { status: 'PENDING', credentialsCipher: null, deviceTokenHash: null, deviceName: null, pairingCode: null, pairingExpiresAt: null, lastError: null } : {}),
    },
  });
  // Leaving MCP: the PMS's cached tools no longer apply.
  if (existing?.mode === 'MCP') await deleteCachedTools(propertyId);
  await prisma.property.update({ where: { id: propertyId }, data: { setupPath: 'BRIDGE' } });
  await recordAudit(ctx, propertyId, 'BRIDGE_SETUP', `${existing ? 'Updated' : 'Connected'} ${input.system} (${input.mode === 'CLOUD' ? 'cloud browser' : 'desktop connector'})`);
  return c;
}

export async function setCredentials(ctx: OpContext, propertyId: string, creds: Credentials) {
  requirePermission(ctx.actor, 'bridge.manage');
  if (!vaultAvailable()) throw new DomainError(503, 'VAULT_DISABLED', 'Secure login storage isn’t set up on this server yet (platform admin: set HOTELONE_VAULT_KEY; the older STAYOS_VAULT_KEY also works).');
  const c = await getConnection(propertyId);
  if (!c) throw notFound('PMS connection');
  if (c.mode !== 'CLOUD') throw badRequest('Logins are only stored for the cloud browser. The desktop connector uses the browser already signed in on your computer.');
  await prisma.pmsConnection.update({
    where: { id: c.id },
    data: { credentialsCipher: seal({ username: creds.username, password: creds.password, totpSecret: creds.totpSecret || null }, c.id), status: 'CONNECTED', lastError: null },
  });
  await recordAudit(ctx, propertyId, 'BRIDGE_CREDENTIALS', `Stored ${c.system} login for the cloud browser`);
}

export async function clearCredentials(ctx: OpContext, propertyId: string) {
  requirePermission(ctx.actor, 'bridge.manage');
  const c = await getConnection(propertyId);
  if (!c) return;
  await prisma.pmsConnection.update({ where: { id: c.id }, data: { credentialsCipher: null, status: 'PENDING' } });
  await recordAudit(ctx, propertyId, 'BRIDGE_CREDENTIALS', `Removed the stored ${c.system} login`);
}

/** Server-side only: the cloud worker types these; they are never sent to a model or a browser user. */
export function readCredentials(c: PmsConnection): Credentials | null {
  return c.credentialsCipher ? open<Credentials>(c.credentialsCipher, c.id) : null;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export async function createPairingCode(ctx: OpContext, propertyId: string) {
  requirePermission(ctx.actor, 'bridge.manage');
  const c = await getConnection(propertyId);
  if (!c) throw notFound('PMS connection');
  if (c.mode !== 'DESKTOP') throw badRequest('Pairing is for the desktop connector.');
  const pairing = { pairingCode: code(), pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS) };
  await prisma.pmsConnection.update({ where: { id: c.id }, data: pairing });
  return { code: pairing.pairingCode, expiresAt: pairing.pairingExpiresAt.toISOString() };
}

export async function revokeDevice(ctx: OpContext, propertyId: string) {
  requirePermission(ctx.actor, 'bridge.manage');
  const c = await getConnection(propertyId);
  if (!c) return;
  await prisma.pmsConnection.update({ where: { id: c.id }, data: { deviceTokenHash: null, deviceName: null, status: 'PENDING' } });
  await recordAudit(ctx, propertyId, 'BRIDGE_DEVICE', `Disconnected the desktop connector${c.deviceName ? ` on ${c.deviceName}` : ''}`);
}

/** Exchange a one-time pairing code for a long-lived device token (shown to the connector once). */
export async function pairDevice(pairingCode: string, deviceName: string) {
  const normalized = pairingCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const c = await prisma.pmsConnection.findUnique({ where: { pairingCode: normalized }, include: { property: { select: { name: true } } } });
  if (!c || !c.pairingExpiresAt || c.pairingExpiresAt < new Date()) throw forbidden(`That pairing code is wrong or has expired. Create a new one in the ${PRODUCT_NAME} console.`);
  const token = `sco_${randomToken(32)}`;
  await prisma.pmsConnection.update({
    where: { id: c.id },
    data: { deviceTokenHash: sha256(token), deviceName: deviceName.slice(0, 80), pairingCode: null, pairingExpiresAt: null, status: 'CONNECTED', lastSeenAt: new Date(), lastError: null },
  });
  return { token, property: c.property.name, system: c.system, loginUrl: c.loginUrl };
}

export type BridgeCaller = { kind: 'device'; connection: PmsConnection } | { kind: 'worker' };

/** Authenticate a connector (device token) or our cloud worker (shared secret). */
export async function authenticateBridge(header: string | null): Promise<BridgeCaller> {
  const raw = header?.replace(/^Bearer\s+/i, '').trim();
  if (!raw) throw forbidden('Missing connector token.');
  if (raw.startsWith('worker:')) {
    const secret = process.env.BRIDGE_WORKER_SECRET;
    if (!secret || raw.slice(7) !== secret) throw forbidden('Invalid worker credentials.');
    return { kind: 'worker' };
  }
  const c = await prisma.pmsConnection.findUnique({ where: { deviceTokenHash: sha256(raw) } });
  if (!c) throw forbidden(`This connector has been disconnected. Pair it again from the ${PRODUCT_NAME} console.`);
  await prisma.pmsConnection.update({ where: { id: c.id }, data: { lastSeenAt: new Date() } });
  return { kind: 'device', connection: c };
}

export async function enqueueTask(ctx: OpContext, propertyId: string, input: { kind: string; instruction: string; payload?: Prisma.InputJsonValue }) {
  requirePermission(ctx.actor, 'bridge.use');
  const c = await getConnection(propertyId);
  if (!c) throw badRequest('Connect your PMS first (Your PMS → Connect).');
  if (c.status === 'PAUSED') throw conflict('The bridge is paused. Resume it on the Your PMS page.');
  // Browser tasks drive paid computer-use steps (≤ MAX_STEPS each); MCP tasks are a few API calls,
  // so they get a roomier hourly budget per property.
  const mcp = c.mode === 'MCP';
  const lastHour = await prisma.bridgeTask.count({ where: { propertyId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (lastHour >= Number((mcp ? process.env.PMS_MCP_MAX_TASKS_PER_HOUR : process.env.BRIDGE_MAX_TASKS_PER_HOUR) || (mcp ? 120 : 30))) {
    throw new DomainError(429, 'RATE_LIMITED', `That’s ${lastHour} PMS tasks in the last hour — the hourly limit. Try again shortly.`);
  }
  const task = await prisma.bridgeTask.create({
    data: { propertyId, connectionId: c.id, kind: input.kind, instruction: input.instruction.slice(0, 1000), payload: input.payload ?? {}, requestedById: ctx.actor.userId },
  });
  await recordAudit(ctx, propertyId, 'BRIDGE_TASK', `Sent to ${c.system}: “${input.instruction.slice(0, 120)}”`, { taskId: task.id });
  // MCP: run it on our server right after this response (callers may also run it inline first).
  if (mcp) scheduleMcpTask(task.id);
  return { task, connection: c };
}

/** Claim the next queued task for this caller (atomic; stale RUNNING tasks are retried once). */
export async function claimTask(caller: BridgeCaller) {
  const where: Prisma.BridgeTaskWhereInput =
    caller.kind === 'device' ? { connectionId: caller.connection.id } : { connection: { mode: 'CLOUD', status: 'CONNECTED' } };
  await prisma.bridgeTask.updateMany({
    where: { ...where, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) }, attempts: { lt: 2 } },
    data: { status: 'QUEUED' },
  });
  for (let i = 0; i < 3; i++) {
    const next = await prisma.bridgeTask.findFirst({ where: { ...where, status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
    if (!next) return null;
    const { count } = await prisma.bridgeTask.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } } });
    if (count) {
      const connection = await prisma.pmsConnection.findUniqueOrThrow({ where: { id: next.connectionId }, include: { property: { select: { name: true } } } });
      return { task: { ...next, status: 'RUNNING' as const }, connection };
    }
  }
  return null;
}

export async function loadTaskForCaller(caller: BridgeCaller, taskId: string) {
  const task = await prisma.bridgeTask.findUnique({ where: { id: taskId }, include: { connection: true } });
  if (!task) throw notFound('Task');
  if (caller.kind === 'device' && task.connectionId !== caller.connection.id) throw forbidden('This task belongs to another connection.');
  if (caller.kind === 'worker' && task.connection.mode !== 'CLOUD') throw forbidden('The cloud worker only runs cloud tasks.');
  return task;
}

export async function finishTask(caller: BridgeCaller, taskId: string, input: { status: 'DONE' | 'FAILED' | 'NEEDS_HELP'; summary?: string; error?: string }) {
  const task = await loadTaskForCaller(caller, taskId);
  if (task.status !== 'RUNNING') throw conflict('This task is no longer running.');
  // The model's generic STEPS line is for recipes only; it never shows up in the task's result.
  const summary = input.summary?.split(/\n\s*STEPS\s*:/i)[0].trim() || null;
  const updated = await prisma.bridgeTask.update({
    where: { id: task.id },
    data: { status: input.status, result: { summary }, error: input.error ?? null, finishedAt: new Date() },
  });
  if (input.status === 'FAILED' && input.error) await prisma.pmsConnection.update({ where: { id: task.connectionId }, data: { lastError: input.error.slice(0, 300) } });
  // Learn (or count) the recipe for this kind of task. Never fails the report.
  await learnFromTask({ ...updated, connection: task.connection });
  return updated;
}

/**
 * Logs one operator step in the task's payload, in generic words only
 * (screen path without ids or query, "click", "type the guest name"…), and
 * keeps the model's final STEPS line — the raw material for a recipe.
 */
export async function logOperatorStep(
  task: Pick<BridgeTask, 'id' | 'instruction' | 'payload'>,
  input: { currentUrl?: string; next: { kind: 'actions'; actions: OperatorAction[] } | { kind: 'credential'; field: string } | { kind: 'done'; steps?: string[] } | { kind: 'limit' }; recipeKey?: string | null },
) {
  let payload = { ...((task.payload ?? {}) as BridgePayload) };
  if (input.recipeKey && !payload.recipeKey) payload.recipeKey = input.recipeKey;
  const screen = screenOf(input.currentUrl);
  if (input.next.kind === 'actions') payload = appendLog(payload, screen, describeActions(input.next.actions, task.instruction));
  else if (input.next.kind === 'credential') payload = appendLog(payload, screen, [input.next.field === 'totp' ? 'enter the one-time code' : `sign in (${input.next.field})`]);
  else if (input.next.kind === 'done' && input.next.steps?.length) payload.reportedSteps = input.next.steps.slice(0, 20).map((s) => s.slice(0, 200));
  else if (input.next.kind === 'limit') payload.stepLimit = true;
  await prisma.bridgeTask.update({ where: { id: task.id }, data: { payload: payload as Prisma.InputJsonValue } });
  return payload;
}

export async function listTasks(propertyId: string, limit = 30) {
  return prisma.bridgeTask.findMany({ where: { propertyId }, orderBy: { createdAt: 'desc' }, take: limit });
}

export function taskView(t: Awaited<ReturnType<typeof listTasks>>[number]) {
  const result = (t.result ?? {}) as { summary?: string | null; via?: string; calls?: unknown[] };
  return {
    id: t.id,
    kind: t.kind,
    instruction: t.instruction,
    status: t.status,
    summary: result.summary ?? null,
    /** 'mcp' when it ran through the PMS's MCP server, with how many PMS calls it made. */
    via: result.via ?? null,
    pmsCalls: Array.isArray(result.calls) ? result.calls.length : null,
    error: t.error,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt?.toISOString() ?? null,
    finishedAt: t.finishedAt?.toISOString() ?? null,
  };
}
export type BridgeTaskView = ReturnType<typeof taskView>;

export async function updateTaskByStaff(actor: Actor, taskId: string, action: 'cancel' | 'retry') {
  requirePermission(actor, 'bridge.use');
  const t = await prisma.bridgeTask.findUnique({ where: { id: taskId }, include: { connection: { select: { mode: true } } } });
  if (!t) throw notFound('Task');
  if (actor.propertyIds !== 'ALL' && !actor.propertyIds.includes(t.propertyId)) throw forbidden('Not your property.');
  if (action === 'cancel') {
    if (t.status !== 'QUEUED' && t.status !== 'NEEDS_HELP') throw conflict('Only waiting tasks can be cancelled.');
    return prisma.bridgeTask.update({ where: { id: t.id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
  }
  if (!['FAILED', 'NEEDS_HELP', 'CANCELLED'].includes(t.status)) throw conflict('Only finished tasks can be retried.');
  const retried = await prisma.bridgeTask.update({ where: { id: t.id }, data: { status: 'QUEUED', error: null, result: Prisma.JsonNull, startedAt: null, finishedAt: null } });
  if (t.connection.mode === 'MCP') scheduleMcpTask(t.id);
  return retried;
}
