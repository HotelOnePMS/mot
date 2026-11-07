/**
 * Agent engine: message in → stream of UI blocks out.
 *
 * Reads are answered immediately from live data. Writes from the whole
 * message are gathered into ONE signed plan the person confirms. Every
 * command is audit-logged. Hotel questions are answered from the hotel's
 * saved answers, and shortcuts (skills.ts) expand into ordinary commands
 * that go through the same pipeline — a shortcut never skips confirmation. A language-model engine can be plugged in via
 * llm.ts; it must use the same tools and the same plan/confirm contract.
 */
import { PRODUCT_NAME } from '@/config/product';
import { prisma } from '@/lib/prisma';
import type { AgentBlock, AgentContextState, AgentEvent } from '@/lib/agent/blocks';
import type { Actor } from '../authz';
import { assertPropertyAccess, can } from '../authz';
import { todayAt } from '../services/hotels';
import { recordAudit } from '../services/audit';
import { logError } from '../log';
import { enqueueTask, getConnection } from '../services/bridge';
import { runMcpTaskInline } from '../pms/run';
import { bookingInclude, toBookingSummary } from '../services/mappers';
import { looksLikeQuestion } from '../skills';
import { llmConfigured, runHarness } from './llm';
import { parseMessage, WRITE_KINDS, type Intent } from './nlu';
import { claimPlan, signPlan, verifyPlan, type PlanStep } from './plan';
import {
  answerFromSkills,
  expandShortcut,
  hasWrites,
  hintFor,
  loadShortcuts,
  matchShortcut,
  maybeSuggestShortcut,
  parseSkillCommand,
  recentCommandsFromAudit,
  saveShortcut,
  shortcutListBlocks,
  suggestionBlocks,
  trackableShape,
} from './skills';
import { bookingActions, executeStep, followUps, maxRisk, planWrite, runRead, statusLine, type PlanOutput, type ToolCtx } from './tools';

export interface AgentRunInput {
  actor: Actor;
  propertyId: string;
  message: string;
  memory: AgentContextState;
  /** Earlier messages in this conversation, oldest first ("save that as a shortcut"). */
  recent?: string[];
}

/** What a run gathers while it works through intents: memory, planned changes, and whether anything needed a person. */
interface RunState {
  memory: AgentContextState;
  steps: PlanStep[];
  warnings: string[];
  risk: PlanOutput['risk'];
  aborted: boolean;
  /** An error or clarifying question came back (the command didn't simply work). */
  problem: boolean;
}

const newState = (memory: AgentContextState): RunState => ({ memory: { ...memory }, steps: [], warnings: [], risk: 'low', aborted: false, problem: false });

/** Reads answer right away; writes are gathered into the state for one signed plan. */
async function* runIntents(ctx: ToolCtx, intents: Intent[], state: RunState, opts: { extraSuggestions?: string[] } = {}): AsyncGenerator<AgentEvent> {
  for (const intent of intents) {
    yield { type: 'status', text: statusLine(intent) };
    if (WRITE_KINDS.has(intent.kind)) {
      if (state.aborted) continue;
      const out = await planWrite({ ...ctx, memory: state.memory }, intent);
      for (const b of out.blocks ?? []) {
        if (b.type === 'error' || b.type === 'clarify') state.problem = true;
        yield { type: 'block', block: b };
      }
      Object.assign(state.memory, out.memory ?? {});
      if (out.abort) {
        state.aborted = true;
        continue;
      }
      state.steps.push(...out.steps);
      state.warnings.push(...out.warnings);
      state.risk = maxRisk(state.risk, out.risk);
    } else {
      const out = await runRead({ ...ctx, memory: state.memory }, intent);
      for (const b of out.blocks) {
        if (b.type === 'error' || b.type === 'clarify') state.problem = true;
        const block = b.type === 'suggestions' && opts.extraSuggestions?.length ? { ...b, items: [...new Set([...b.items.slice(0, 3), ...opts.extraSuggestions])].slice(0, 6) } : b;
        yield { type: 'block', block };
      }
      Object.assign(state.memory, out.memory ?? {});
    }
  }
}

/**
 * Signs the gathered writes into one plan (or says they were held back).
 * Returns the plan title, which only ever describes the real steps — never a
 * shortcut's name, which anyone who saved it chose.
 */
async function* finishPlan(
  ctx: ToolCtx,
  state: RunState,
  intents: Intent[],
  opts: { shape?: { shape: string; template: string } } = {}
): AsyncGenerator<AgentEvent, string | undefined> {
  if (state.steps.length && !state.aborted) {
    const planTitle = state.steps.length === 1 ? state.steps[0].summary : titleFor(intents, state.steps);
    const { token, expiresAt } = signPlan({ userId: ctx.actor.userId, propertyId: ctx.propertyId, title: planTitle, steps: state.steps, shape: opts.shape });
    const block: AgentBlock = {
      type: 'plan',
      plan: {
        token,
        title: planTitle,
        steps: state.steps.map((s) => ({ summary: s.summary, detail: s.detail })),
        warnings: [...new Set(state.warnings)],
        risk: state.risk,
        confirmLabel: state.steps.length === 1 ? 'Confirm' : `Confirm ${state.steps.length} changes`,
        expiresAt,
      },
    };
    yield { type: 'block', block };
    return planTitle;
  }
  if (state.steps.length && state.aborted) {
    yield { type: 'block', block: { type: 'text', text: 'I’ve held off on the other changes until that’s sorted.' } };
  }
  return undefined;
}

/** The model reads whole pasted tables; the phrase parser only ever needed a sentence. */
export const MAX_MODEL_MESSAGE = 6000;

/**
 * Runs the message through the model harness and signs its writes into one
 * plan. Returns false (nothing shown yet) when the model is unavailable, so
 * the deterministic engine can answer instead.
 */
async function* runModel(
  ctx: ToolCtx,
  input: AgentRunInput,
  message: string,
  audit: (summary: string, data: Record<string, unknown>) => Promise<unknown>,
  started: number
): AsyncGenerator<AgentEvent, boolean> {
  const gen = runHarness({ ...ctx, message }, { recent: input.recent });
  let shown = false;
  let result: Awaited<ReturnType<typeof gen.next>>;
  try {
    for (;;) {
      result = await gen.next();
      if (result.done) break;
      if (result.value.type === 'block') shown = true;
      yield result.value;
    }
  } catch (e) {
    logError('agent/engine', 'Model engine failed:', e);
    if (!shown) return false;
    yield { type: 'block', block: { type: 'error', text: 'I lost my connection partway through. Nothing was changed — please ask again.' } };
    yield { type: 'done', engine: 'llm', ms: Date.now() - started };
    return true;
  }
  const r = result.value;
  let planTitle: string | undefined;
  if (r.steps.length) {
    const tools = new Set(r.steps.map((s) => s.tool));
    planTitle =
      r.steps.length === 1
        ? r.steps[0].summary
        : tools.size === 1 && tools.has('set_rates')
          ? `Update rates (${r.steps.length} changes)`
          : `${r.steps.length} changes`;
    const { token, expiresAt } = signPlan({ userId: ctx.actor.userId, propertyId: ctx.propertyId, title: planTitle, steps: r.steps });
    yield {
      type: 'block',
      block: {
        type: 'plan',
        plan: {
          token,
          title: planTitle,
          steps: r.steps.map((s) => ({ summary: s.summary, detail: s.detail })),
          warnings: [...new Set(r.warnings)],
          risk: r.risk,
          confirmLabel: r.steps.length === 1 ? 'Confirm' : `Confirm ${r.steps.length} changes`,
          expiresAt,
        },
      },
    };
  }
  yield { type: 'context', context: r.memory };
  await audit(planTitle ? `Asked: “${message.slice(0, 120)}” → proposed ${planTitle}` : `Asked: “${message.slice(0, 160)}”`, { tools: r.toolsUsed, engine: 'llm' });
  yield { type: 'done', engine: 'llm', ms: Date.now() - started };
  return true;
}

const onlyUnknown = (intents: Intent[]) => intents.length > 0 && intents.every((i) => i.kind === 'unknown');

export async function* runAgent(input: AgentRunInput): AsyncGenerator<AgentEvent> {
  const started = Date.now();
  const { actor, propertyId } = input;
  assertPropertyAccess(actor, propertyId);
  if (!can(actor, 'agent.use')) {
    yield { type: 'error', message: 'The agent is available to front desk, managers and owners.' };
    return;
  }
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true, setupPath: true } });
  if (!property) {
    yield { type: 'error', message: 'Property not found.' };
    return;
  }
  const fullMessage = input.message.trim().slice(0, MAX_MODEL_MESSAGE);
  const message = fullMessage.slice(0, 600);
  const today = await todayAt(propertyId);
  const ctx: ToolCtx = { actor, propertyId, propertyName: property.name, today, memory: { ...input.memory }, message };
  const bridged = property.setupPath === 'BRIDGE';
  const audit = (summary: string, data: Record<string, unknown>) => recordAudit({ actor, source: 'agent' }, propertyId, 'COMMAND', summary, { message: message.slice(0, 300), ...data });
  const done = (engine: 'deterministic' | 'llm' = 'deterministic'): AgentEvent => ({ type: 'done', engine, ms: Date.now() - started });

  // --- Skills: save, list and run shortcuts --------------------------------
  const skillCmd = parseSkillCommand(message);
  if (skillCmd?.kind === 'save') {
    yield { type: 'status', text: 'Saving the shortcut…' };
    const recent = input.recent?.length ? input.recent : await recentCommandsFromAudit(actor, propertyId);
    for (const block of await saveShortcut({ actor, propertyId, name: skillCmd.name, count: skillCmd.count, recent, today })) yield { type: 'block', block };
    yield { type: 'context', context: ctx.memory };
    await audit(`Asked: “${message.slice(0, 160)}”`, { intents: ['saveShortcut'], engine: 'skills' });
    yield done();
    return;
  }
  if (skillCmd?.kind === 'list') {
    yield { type: 'status', text: 'Looking up your shortcuts…' };
    for (const block of await shortcutListBlocks(actor, propertyId)) yield { type: 'block', block };
    yield { type: 'context', context: ctx.memory };
    await audit(`Asked: “${message.slice(0, 160)}”`, { intents: ['listShortcuts'], engine: 'skills' });
    yield done();
    return;
  }
  const shortcuts = await loadShortcuts(propertyId);
  const hit = !shortcuts.length ? null : skillCmd?.kind === 'run' ? matchShortcut(skillCmd.text, shortcuts) : matchShortcut(message, shortcuts, { implicit: true });
  if (skillCmd?.kind === 'run' && skillCmd.explicit && !hit) {
    yield { type: 'block', block: { type: 'text', text: `I don’t have a shortcut called “${skillCmd.text.slice(0, 60)}”.` } };
    for (const block of await shortcutListBlocks(actor, propertyId)) yield { type: 'block', block };
    yield { type: 'context', context: ctx.memory };
    await audit(`Asked: “${message.slice(0, 160)}”`, { intents: ['runShortcut'], engine: 'skills' });
    yield done();
    return;
  }
  if (hit) {
    yield { type: 'status', text: `Running “${hit.skill.title}”…` };
    const exp = await expandShortcut(propertyId, hit.skill, hit.rest);
    if (!exp.ok) {
      for (const block of exp.blocks) yield { type: 'block', block };
      yield { type: 'context', context: ctx.memory };
      await audit(`Asked: “${message.slice(0, 160)}”`, { intents: ['runShortcut'], shortcut: hit.skill.key, engine: 'skills' });
      yield done();
      return;
    }
    const n = exp.steps.length;
    yield {
      type: 'block',
      block: { type: 'text', text: `Running the shortcut **${hit.skill.title}**${n > 1 ? ` — ${n} steps` : ''}:${n === 1 ? ` “${exp.steps[0]}”` : ''}` },
    };
    if (bridged) {
      yield* runBridged(input, exp.steps.join(', then '), today);
      yield done();
      return;
    }
    const state = newState(input.memory);
    const all: Intent[] = [];
    for (const [i, step] of exp.steps.entries()) {
      if (parseSkillCommand(step)) {
        yield { type: 'block', block: { type: 'text', text: `Skipped step ${i + 1} (“${step}”) — a shortcut can’t run another shortcut.` } };
        continue;
      }
      const intents = parseMessage(step, today);
      all.push(...intents);
      if (n > 1) yield { type: 'block', block: { type: 'text', text: `**Step ${i + 1} of ${n}:** ${step}` } };
      if (onlyUnknown(intents)) {
        const ans = await answerFromSkills(actor, propertyId, step);
        if (ans) {
          for (const block of ans.blocks.filter((b) => b.type === 'text').slice(0, 1)) yield { type: 'block', block };
          continue;
        }
        state.problem = true;
        yield { type: 'block', block: { type: 'error', text: `I didn’t understand step ${i + 1} (“${step}”). Edit the shortcut on the Skills page.` } };
        continue;
      }
      yield* runIntents({ ...ctx, message: step }, intents, state);
    }
    const planTitle = yield* finishPlan(ctx, state, all);
    if (!state.steps.length) yield { type: 'block', block: { type: 'result', ok: !state.problem, title: state.problem ? `“${hit.skill.title}” needs a look` : `Ran “${hit.skill.title}”`, lines: exp.steps.map((s) => `${state.problem ? '○' : '✓'} ${s}`) } };
    yield { type: 'context', context: state.memory };
    await audit(planTitle ? `Ran the shortcut “${hit.skill.title}” → proposed ${planTitle}` : `Ran the shortcut “${hit.skill.title}”`, { intents: all.map((i) => i.kind), shortcut: hit.skill.key, engine: 'skills' });
    yield done();
    return;
  }

  // Hotels that kept their own PMS: the agent works it through the bridge (hotel questions come from saved answers).
  if (bridged) {
    const parsed = parseMessage(message, today);
    if (parsed.length && parsed.every((i) => i.kind === 'help')) {
      const connection = await getConnection(propertyId);
      const system = connection?.system ?? 'your PMS';
      yield {
        type: 'block',
        block: {
          type: 'text',
          text:
            `I work in **${system}** for you. Look-ups go straight through, and I **always ask before changing anything** there.\n` +
            '• **Look up:** “who’s arriving today?”, “find the reservation for Grace Okafor”, “which rooms are dirty?”\n' +
            '• **Change:** “check in Jordan Smith into room 204”, “add a note to Smith: late arrival”\n' +
            '• **Hotel questions:** “is parking free?” — answered from your saved answers',
        },
      };
      for (const block of await shortcutListBlocks(actor, propertyId, { forHelp: true })) if (block.type !== 'suggestions') yield { type: 'block', block };
      yield { type: 'block', block: { type: 'suggestions', items: [...new Set(['who’s arriving today?', 'is parking free?', ...shortcuts.slice(0, 2).map((s) => hintFor(s).command)])] } };
      await audit(`Asked: “${message.slice(0, 160)}”`, { intents: ['help'], engine: 'skills' });
      yield done();
      return;
    }
    const lookupOnly = parsed.every((i) => i.kind === 'find') && looksLikeQuestion(message);
    const ans = onlyUnknown(parsed) || lookupOnly ? await answerFromSkills(actor, propertyId, message, lookupOnly ? { minScore: 2 } : {}) : null;
    if (ans) {
      for (const block of ans.blocks) yield { type: 'block', block };
      await audit(`Asked: “${message.slice(0, 160)}”`, { intents: ['answer'], skill: ans.key, engine: 'skills' });
    } else {
      yield* runBridged(input, message, today);
    }
    yield done();
    return;
  }

  // The model-driven engine (same tools, same confirmation contract).
  if (llmConfigured()) {
    const shown = yield* runModel(ctx, input, fullMessage, audit, started);
    if (shown) return;
  }

  const intents = parseMessage(message, today);

  // Questions about the hotel: answered from its saved answers ("where is the hotel?" reads like a guest look-up, so it needs a strong match).
  const lookupOnly = intents.every((i) => i.kind === 'find') && looksLikeQuestion(message);
  if (onlyUnknown(intents) || lookupOnly) {
    const ans = await answerFromSkills(actor, propertyId, message, lookupOnly ? { minScore: 2 } : {});
    if (ans) {
      for (const block of ans.blocks) yield { type: 'block', block };
      yield { type: 'context', context: ctx.memory };
      await audit(`Asked: “${message.slice(0, 160)}”`, { intents: ['answer'], skill: ans.key, engine: 'skills' });
      yield done();
      return;
    }
  }

  const isHelp = intents.some((i) => i.kind === 'help');
  const hints = isHelp || onlyUnknown(intents) ? shortcuts.slice(0, 3).map(hintFor) : [];
  const state = newState(input.memory);
  yield* runIntents(ctx, intents, state, { extraSuggestions: hints.map((h) => h.command) });
  if (isHelp) for (const block of await shortcutListBlocks(actor, propertyId, { forHelp: true })) if (block.type !== 'suggestions') yield { type: 'block', block };

  const shape = trackableShape(message, intents, today);
  const writes = hasWrites(intents);
  const planTitle = yield* finishPlan(ctx, state, intents, { shape: writes && shape ? shape : undefined });

  if (!state.steps.length && !onlyUnknown(intents) && !isHelp) {
    yield { type: 'block', block: { type: 'suggestions', items: followUps(intents) } };
  }
  yield { type: 'context', context: state.memory };

  // A read that simply worked counts towards a shortcut suggestion now; a change counts once it's confirmed.
  const okShape = shape && !writes && !state.problem ? shape : null;
  await audit(planTitle ? `Asked: “${message.slice(0, 120)}” → proposed ${planTitle}` : `Asked: “${message.slice(0, 160)}”`, {
    ...(okShape ? { okShape: okShape.shape } : {}),
    intents: intents.map((i) => i.kind),
    engine: 'deterministic',
  });
  if (okShape) {
    const suggested = await maybeSuggestShortcut(actor, propertyId, okShape);
    if (suggested) for (const block of suggestionBlocks(actor, suggested)) yield { type: 'block', block };
  }
  yield done();
}

async function* runBridged(input: AgentRunInput, message: string, today: string): AsyncGenerator<AgentEvent> {
  const { actor, propertyId } = input;
  const connection = await getConnection(propertyId);
  if (!connection) {
    yield { type: 'block', block: { type: 'text', text: 'Your hotel runs on its own PMS, and it isn’t connected yet. Connect it once and I can look things up and make changes there for you.' } };
    yield { type: 'block', block: { type: 'navigate', label: 'Connect your PMS', href: '/admin/connect', description: 'Your PMS’s MCP server, the desktop connector or a secure cloud browser' } };
    return;
  }
  if (!can(actor, 'bridge.use')) {
    yield { type: 'error', message: 'Your role can’t send work to the PMS. Ask a manager or the owner to do it, or to give you that access.' };
    return;
  }
  const intents = parseMessage(message, today);
  const isWrite = intents.some((i) => WRITE_KINDS.has(i.kind));
  yield { type: 'status', text: `Asking ${connection.system}…` };
  if (!isWrite) {
    // Look-ups are read-only for the operator, so they go straight through.
    const { task } = await enqueueTask({ actor, source: 'agent' }, propertyId, { kind: 'LOOKUP', instruction: message });
    // Through the PMS's MCP server a look-up takes seconds: wait for it so the card arrives finished.
    if (connection.mode === 'MCP') await runMcpTaskInline(task.id, 15_000);
    yield { type: 'block', block: { type: 'bridgeTask', taskId: task.id, system: connection.system, instruction: task.instruction, kind: task.kind, mode: connection.mode } };
    await recordAudit({ actor, source: 'agent' }, propertyId, 'COMMAND', `Asked ${connection.system}: “${message.slice(0, 140)}”`, { message: message.slice(0, 300), engine: 'bridge' });
    return;
  }
  const steps: PlanStep[] = [
    {
      tool: 'bridge_task',
      args: { propertyId, instruction: message, kind: 'ACTION' },
      summary: `In ${connection.system}: ${message}`,
      detail: connection.mode === 'MCP' ? `${PRODUCT_NAME} makes only this change through ${connection.system}’s MCP server and reports exactly what it did.` : 'The operator makes only this change and reports exactly what it did.',
    },
  ];
  const { token, expiresAt } = signPlan({ userId: actor.userId, propertyId, title: `Do this in ${connection.system}`, steps });
  yield {
    type: 'block',
    block: {
      type: 'plan',
      plan: {
        token,
        title: `Do this in ${connection.system}`,
        steps: steps.map((s) => ({ summary: s.summary, detail: s.detail })),
        warnings: [`This changes data in ${connection.system}, not in ${PRODUCT_NAME}.`],
        risk: 'medium',
        confirmLabel: 'Send to PMS',
        expiresAt,
      },
    },
  };
  await recordAudit({ actor, source: 'agent' }, propertyId, 'COMMAND', `Asked: “${message.slice(0, 120)}” → proposed a ${connection.system} change`, { message: message.slice(0, 300), engine: 'bridge' });
}

function titleFor(intents: Intent[], steps: PlanStep[]): string {
  const primary = steps[0].summary;
  const kinds = new Set(intents.map((i) => i.kind));
  if (kinds.has('autoAssignCleaning')) return `Assign ${steps.length} rooms to housekeeping`;
  if (kinds.has('assignArrivals')) return `Assign rooms for ${steps.length} arrivals`;
  if (kinds.has('adjustRates')) return `Update rates (${steps.length} changes)`;
  if (kinds.has('roomStatus')) return `Update ${steps.length} rooms`;
  const short = (x: string) => x.replace(/ → .*$/, '').replace(/ \([A-Z0-9]+\)$/, '');
  if (steps.length === 2) {
    const second = short(steps[1].summary).replace(/ to .*$/, '').replace(/^Add note$/, 'add a note');
    return `${short(primary)} and ${second.charAt(0).toLowerCase()}${second.slice(1)}`;
  }
  return `${short(primary)} + ${steps.length - 1} more`;
}

export interface ConfirmResult {
  blocks: AgentBlock[];
  context: AgentContextState;
}

/** Execute a signed plan after the person confirms it. */
export async function confirmPlan(actor: Actor, token: string): Promise<ConfirmResult> {
  const plan = verifyPlan(token, actor.userId);
  assertPropertyAccess(actor, plan.pid);
  if (!(await claimPlan(plan.pid, plan.nonce, actor.userId))) {
    return { blocks: [{ type: 'result', ok: true, title: 'Already confirmed', lines: ['This plan was already confirmed, so nothing ran twice.'] }], context: {} };
  }
  const ctx = { actor, source: 'agent' as const };
  const lines: string[] = [];
  const touched = new Set<string>();
  const bridged: NonNullable<Awaited<ReturnType<typeof executeStep>>['bridgeTask']>[] = [];
  let failed = false;
  for (const [i, step] of plan.steps.entries()) {
    if (failed) {
      lines.push(`○ Not run: ${step.summary}`);
      continue;
    }
    const r = await executeStep(ctx, step);
    lines.push(`${r.ok ? '✓' : '✗'} ${r.line}`);
    if (r.bookingId) touched.add(r.bookingId);
    if (r.bridgeTask) bridged.push(r.bridgeTask);
    if (!r.ok) {
      failed = true;
      if (i < plan.steps.length - 1) lines.push('Stopped here so nothing half-finished goes through.');
    }
  }
  // Changes through a PMS's MCP server take seconds: run them now so their cards arrive finished.
  for (const t of bridged) if (t.mode === 'MCP') await runMcpTaskInline(t.id, 15_000);
  await recordAudit(ctx, plan.pid, 'PLAN_EXECUTED', `${failed ? 'Partly carried out' : 'Carried out'}: ${plan.title}`, {
    ...(!failed && plan.shape ? { okShape: plan.shape.shape } : {}),
    nonce: plan.nonce,
    steps: plan.steps.map((s) => s.summary),
    ok: !failed,
  });
  const suggested = !failed && plan.shape ? await maybeSuggestShortcut(actor, plan.pid, plan.shape) : null;

  const blocks: AgentBlock[] = [
    {
      type: 'result',
      ok: !failed,
      title: failed
        ? 'Some changes didn’t go through'
        : bridged.length === plan.steps.length
          ? bridged.every((t) => t.mode === 'MCP')
            ? `Sent to ${bridged[0].system} — the result is below`
            : `Sent to ${bridged[0].system} — the operator is on it`
          : plan.steps.length === 1
            ? 'Done'
            : `Done — ${plan.steps.length} changes made`,
      lines,
    },
  ];
  for (const t of bridged) blocks.push({ type: 'bridgeTask', taskId: t.id, system: t.system, instruction: t.instruction, kind: t.kind, mode: t.mode });
  const context: AgentContextState = {};
  const today = await todayAt(plan.pid);
  for (const id of [...touched].slice(0, 2)) {
    const b = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!b) continue;
    const summary = toBookingSummary(b);
    blocks.push({ type: 'booking', booking: summary, actions: bookingActions(summary, today) });
    Object.assign(context, { lastBookingId: summary.id, lastBookingCode: summary.code, lastGuestName: summary.guest.name, lastRoomNumber: summary.room?.number });
  }
  const tools = new Set(plan.steps.map((s) => s.tool));
  const next: string[] = [];
  if (tools.has('check_in')) next.push('who else is arriving today?');
  if (tools.has('check_out')) next.push('auto-assign housekeeping', 'who else is leaving today?');
  if (tools.has('assign_cleaning')) next.push('show the housekeeping board');
  if (tools.has('adjust_rates') || tools.has('set_rates')) next.push('forecast the next 3 weekends');
  if (tools.has('create_reservation')) next.push('who’s arriving today?');
  if (tools.has('set_out_of_order')) next.push('show out-of-order rooms');
  if (!next.length) next.push('brief me');
  blocks.push({ type: 'suggestions', items: [...new Set(next)].slice(0, 3) });
  if (suggested) blocks.push(...suggestionBlocks(actor, suggested));
  return { blocks, context };
}
