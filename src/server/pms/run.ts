/**
 * Runs queued bridge tasks for MCP connections and records the outcome on
 * the BridgeTask exactly like a connector's /finish does (status, result
 * { summary, … }, error, finishedAt), so the agent's live task card and the
 * Your PMS page show it without changes.
 *
 * Nobody else claims MCP tasks: connectors only claim their own connection
 * and the cloud worker only claims CLOUD ones (services/bridge.ts).
 */
import { after } from 'next/server';
import { Prisma, type BridgeTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { executeMcpTask, isChangeKind, type ExecuteOptions, type McpTaskResult } from './executor';

const STALE_RUNNING_MS = 5 * 60 * 1000;

const logFailure = (taskId: string) => (e: unknown) => console.error(`[pms-mcp] task ${taskId} failed to run:`, e);

/**
 * Run an MCP task after the current response is sent (Next.js `after`), or
 * right away outside a request. Safe to call more than once: the task is
 * claimed atomically, so only one run happens.
 */
export function scheduleMcpTask(taskId: string): void {
  const run = () => runMcpBridgeTask(taskId).then(() => undefined, logFailure(taskId));
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Run an MCP task now and wait up to `waitMs` for it, so the caller can show
 * a finished result. If it takes longer it keeps running after the response
 * (kept alive with `after`). Returns true when it finished in time.
 */
export async function runMcpTaskInline(taskId: string, waitMs = 15_000): Promise<boolean> {
  const run = runMcpBridgeTask(taskId).then(() => true, (e) => (logFailure(taskId)(e), true));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finished = await Promise.race([run, new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), waitMs)))]);
  clearTimeout(timer);
  if (!finished) {
    try {
      after(run);
    } catch {
      /* outside a request: the promise keeps running */
    }
  }
  return finished;
}

/**
 * Claim one QUEUED task on an MCP connection, execute it and persist the
 * result. Returns null when the task isn't (or is no longer) runnable here.
 * Never throws for PMS problems.
 */
export async function runMcpBridgeTask(taskId: string, opts: ExecuteOptions = {}): Promise<{ task: BridgeTask; result: McpTaskResult } | null> {
  const { count } = await prisma.bridgeTask.updateMany({
    where: { id: taskId, status: 'QUEUED', connection: { mode: 'MCP' } },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (!count) return null;
  const task = await prisma.bridgeTask.findUniqueOrThrow({ where: { id: taskId }, include: { connection: true, property: { select: { name: true } } } });

  let result: McpTaskResult;
  try {
    result = await executeMcpTask(
      { id: task.id, propertyId: task.propertyId, kind: task.kind, instruction: task.instruction, payload: task.payload },
      { connection: task.connection, propertyName: task.property.name, ...opts },
    );
  } catch (e) {
    console.error('[pms-mcp] executor crashed:', e);
    result = { status: 'FAILED', summary: 'Something went wrong talking to the PMS.', calls: [], engine: 'none', error: 'Internal error' };
  }

  const persisted = await persistResult(task, result);
  return { task: persisted, result };
}

/** Write an executor result onto its BridgeTask (only while it is RUNNING). */
export async function persistResult(task: Pick<BridgeTask, 'id' | 'connectionId' | 'propertyId' | 'kind' | 'instruction' | 'requestedById'>, result: McpTaskResult): Promise<BridgeTask> {
  const resultJson = {
    summary: result.summary,
    engine: result.engine,
    via: 'mcp',
    ...(result.error ? { error: result.error } : {}),
    calls: result.calls.map((c) => ({ tool: c.tool, ok: c.ok, ...(c.refused ? { refused: true } : {}), ...(c.error ? { error: c.error } : {}), args: c.args })),
    ...(result.data !== undefined ? { data: result.data } : {}),
  };
  const updated = await prisma.bridgeTask.updateMany({
    where: { id: task.id, status: 'RUNNING' },
    data: {
      status: result.status,
      result: JSON.parse(JSON.stringify(resultJson)) as Prisma.InputJsonValue,
      // The summary already explains a failure to staff; the technical reason stays in result.error.
      error: null,
      finishedAt: new Date(),
    },
  });
  const transportFailure = result.status === 'FAILED' && !!result.error && /^(NETWORK|TIMEOUT|AUTH|HTTP|TOO_LARGE|PROTOCOL|BLOCKED_URL)\b/.test(result.error);
  await prisma.pmsConnection
    .update({
      where: { id: task.connectionId },
      data: transportFailure ? { lastError: result.error!.replace(/^[A-Z_]+:\s*/, '').slice(0, 300) } : { lastSeenAt: new Date(), ...(result.status === 'DONE' ? { lastError: null } : {}) },
    })
    .catch(() => undefined);
  // Changes made in the PMS go to the activity log, like changes made in HotelOne.
  if (result.status === 'DONE' && isChangeKind(task.kind) && result.calls.some((c) => c.ok)) {
    await prisma.agentAuditLog
      .create({
        data: {
          propertyId: task.propertyId,
          userId: task.requestedById,
          action: 'PMS_MCP_CHANGE',
          detail: JSON.stringify({ source: 'agent', summary: result.summary.slice(0, 300), taskId: task.id, tools: result.calls.filter((c) => c.ok).map((c) => c.tool) }).slice(0, 4000),
        },
      })
      .catch((e) => console.error('[pms-mcp] audit write failed:', e));
  }
  if (!updated.count) console.warn(`[pms-mcp] task ${task.id} was no longer running when it finished (cancelled?)`);
  return prisma.bridgeTask.findUniqueOrThrow({ where: { id: task.id } });
}

/**
 * Run what is waiting on a hotel's MCP connection (oldest first, up to
 * `max`), after failing tasks stuck in RUNNING (a crashed function). Use it
 * after a retry, or from a cron as a safety net.
 */
export async function runQueuedMcpTasks(propertyId: string, max = 5): Promise<number> {
  const c = await prisma.pmsConnection.findUnique({ where: { propertyId } });
  if (!c || (c.mode as string) !== 'MCP') return 0;
  await prisma.bridgeTask.updateMany({
    where: { connectionId: c.id, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) } },
    data: { status: 'FAILED', error: 'Timed out talking to the PMS.', finishedAt: new Date() },
  });
  const queued = await prisma.bridgeTask.findMany({ where: { connectionId: c.id, status: 'QUEUED' }, orderBy: { createdAt: 'asc' }, take: max, select: { id: true } });
  let n = 0;
  for (const t of queued) if (await runMcpBridgeTask(t.id)) n++;
  return n;
}
