/**
 * PMS recipes: what the bridge operator learns from finished tasks.
 *
 * While a task runs, each operator step is logged in the task's payload in
 * generic form (which screen, click / type the guest name / press Enter —
 * never the typed text, URLs' query strings or ids). When a task finishes
 * successfully, a RECIPE skill is recorded (or refreshed) for (hotel, PMS,
 * intent) — intent being the normalised instruction, e.g. "check in guest".
 * The next task with the same intent gets the recipe in its instructions
 * ("Last time this worked: …"). Outcomes are counted, and a recipe that
 * fails 3 times in a row switches itself off (skills core). Recipes are
 * internal (audience STAFF) and shown on the Skills page.
 */
import type { BridgeTask, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hotelToday } from '../dates';
import { extractName, parseMessage, type Intent } from '../agent/nlu';
import { getSkill, promptSafe, recordLearnedSkill, recordRecipeOutcome, skillKey, upsertSkill, type RecipeBody, type Skill } from '../skills';
import type { OperatorAction, OperatorRecipe } from './operator';

/** One logged stretch of work on one screen. */
export interface RecipeLogEntry {
  /** Generic screen path ("/reservations/:id"), or null when unknown. */
  screen: string | null;
  /** Generic actions in order ("click", "type the guest name", "press Enter"). */
  acts: string[];
}

/** What we keep in BridgeTask.payload (alongside the step count the step route keeps). */
export interface BridgePayload {
  steps?: number;
  log?: RecipeLogEntry[];
  /** The recipe given to the operator for this task. */
  recipeKey?: string;
  /** The generic STEPS line the model reported at the end. */
  reportedSteps?: string[];
  /** Stopped at the step limit (counts as a failure for the recipe). */
  stepLimit?: boolean;
  /** Key of the recipe this task taught (set once learned). */
  learned?: string;
  [k: string]: unknown;
}

const MAX_LOG = 40;
const MAX_ACTS = 12;
const MAX_RECIPE_STEPS = 12;

// ---------------------------------------------------------------------------
// Intent: "Check in Jordan Smith into 204" → "check in guest"
// ---------------------------------------------------------------------------

const INTENT_PHRASE: Partial<Record<Intent['kind'], string>> = {
  checkIn: 'check in guest',
  checkOut: 'check out guest',
  assignRoom: 'assign room',
  note: 'add note',
  confirm: 'confirm reservation',
  cancel: 'cancel reservation',
  noShow: 'mark no-show',
  roomStatus: 'update room status',
  outOfOrder: 'take room out of order',
  backInService: 'return room to service',
  assignCleaning: 'assign housekeeping',
  autoAssignCleaning: 'assign housekeeping',
  assignArrivals: 'assign rooms to arrivals',
  adjustRates: 'change rates',
  arrivals: 'look up arrivals',
  departures: 'look up departures',
  inHouse: 'look up in-house guests',
  find: 'look up reservation',
  availability: 'check availability',
  occupancy: 'look up occupancy',
  weekendForecast: 'look up occupancy',
  rooms: 'look up rooms',
  housekeeping: 'look up housekeeping',
  overview: 'look up today',
  activity: 'look up activity',
  property: 'look up hotel details',
  suggestRooms: 'look up room options',
};

const FILLER = new Set('a an the to for of in on at into from with and or please now today tonight tomorrow is are be me my our his her their them this that it'.split(' '));

/** The normalised intent of a task instruction, e.g. "check in guest" or "look up arrivals". */
export function taskIntent(instruction: string): string {
  const intents = parseMessage(instruction.slice(0, 600), hotelToday());
  const phrases = [...new Set(intents.map((i) => INTENT_PHRASE[i.kind]).filter((p): p is string => !!p))];
  if (phrases.length) return phrases.slice(0, 2).join(' and ');
  // Unknown wording: keep the plain words, minus names, codes, numbers and dates.
  const pii = piiTokens(instruction);
  const words = instruction
    .replace(/\b\S+@\S+\b/g, ' ')
    .replace(/\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,12}\b/g, ' ')
    .replace(/[0-9]+/g, ' ')
    .toLowerCase()
    .split(/[^a-z'-]+/)
    .filter((w) => w.length > 1 && !FILLER.has(w) && !pii.has(w));
  return words.slice(0, 5).join(' ') || 'pms task';
}

/** The recipe key for a hotel's PMS and intent ("recipe-cloudbeds-check-in-guest"). */
export function recipeKey(system: string, intent: string): string {
  return `recipe-${skillKey(system, 20)}-${skillKey(intent, 50)}`.slice(0, 80).replace(/-+$/, '');
}

// ---------------------------------------------------------------------------
// Logging steps (generic, no personal data)
// ---------------------------------------------------------------------------

/** A URL's path in generic form: ids, codes and tokens become ":id"; query and hash dropped. Null when unusable. */
export function screenOf(url: string | null | undefined): string | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url).split(/[?#]/)[0];
  }
  const segs = path
    .split('/')
    .filter(Boolean)
    .slice(0, 6)
    .map((seg) => {
      let s: string;
      try {
        s = decodeURIComponent(seg);
      } catch {
        s = seg;
      }
      if (/@/.test(s) || /\d/.test(s) || s.length > 32 || /^[A-Za-z0-9_-]{20,}$/.test(s)) return ':id';
      return s.toLowerCase().replace(/[^a-z_-]/g, '').slice(0, 32) || ':id';
    });
  const out = `/${segs.join('/')}`.replace(/(\/:id)+/g, '/:id');
  return out.length > 1 ? out : '/';
}

/** "/front-desk/arrivals/:id" → "Front desk › Arrivals › (record)". */
export function screenLabel(screen: string | null): string {
  if (!screen || screen === '/') return 'the start screen';
  const parts = screen
    .split('/')
    .filter((p) => p && p !== ':id')
    .map((p) => p.replace(/[-_]+/g, ' '))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.length ? parts.slice(-3).join(' › ') : 'the start screen';
}

const MONTHS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;

/** What was typed, in generic words (the text itself is never stored). */
export function describeTyped(text: string, instruction: string): string {
  const t = String(text ?? '').trim();
  if (!t) return 'type';
  if (/@/.test(t)) return 'type an email address';
  if (/^\+?[\d\s().-]{7,}$/.test(t)) return 'type a phone number';
  if (/^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(t) || MONTHS.test(t)) return 'type a date';
  if (/^\$?\d+(?:[.,]\d{1,2})?$/.test(t) && /[.$,]/.test(t)) return 'type an amount';
  if (/^\d{1,4}[a-z]?$/i.test(t)) return /\broom\b/i.test(instruction) ? 'type the room number' : 'type a number';
  if (/^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,12}$/i.test(t)) return 'type the confirmation code';
  const pii = piiTokens(instruction);
  if (t.split(/\s+/).some((w) => pii.has(w.toLowerCase()))) return 'type the guest name';
  if (t.split(/\s+/).length <= 3 && /^[A-Za-zÀ-ÿ' -]+$/.test(t)) return 'type the search text';
  return 'type the details';
}

const KEY_NAMES: Record<string, string> = { ENTER: 'Enter', RETURN: 'Enter', TAB: 'Tab', ESC: 'Escape', ESCAPE: 'Escape', BACKSPACE: 'Backspace', DELETE: 'Delete', ARROWDOWN: 'Down', ARROWUP: 'Up', DOWN: 'Down', UP: 'Up', SPACE: 'Space' };

/** Generic words for one batch of computer-use actions. */
export function describeActions(actions: OperatorAction[], instruction: string): string[] {
  const out: string[] = [];
  for (const a of actions) {
    switch (a.type) {
      case 'click':
        out.push((a as { button?: string }).button === 'right' ? 'right-click' : 'click');
        break;
      case 'double_click':
        out.push('double-click');
        break;
      case 'type':
        out.push(describeTyped(String((a as { text?: unknown }).text ?? ''), instruction));
        break;
      case 'keypress': {
        const keys = ((a as { keys?: unknown }).keys as string[] | undefined) ?? [];
        const names = keys.map((k) => KEY_NAMES[String(k).toUpperCase()] ?? (String(k).length === 1 ? null : String(k).slice(0, 12))).filter(Boolean);
        out.push(names.length ? `press ${names.join('+')}` : 'press a key');
        break;
      }
      case 'scroll':
        out.push('scroll');
        break;
      case 'drag':
        out.push('drag');
        break;
      default:
        break; // screenshot, wait, move: nothing a person would call a step
    }
  }
  return out;
}

/** Adds one step's generic actions to the log (same screen → same entry). */
export function appendLog(payload: BridgePayload, screen: string | null, acts: string[]): BridgePayload {
  if (!acts.length) return payload;
  const log = [...(payload.log ?? [])];
  const last = log[log.length - 1];
  if (last && last.screen === screen) log[log.length - 1] = { screen, acts: [...last.acts, ...acts].slice(-MAX_ACTS) };
  else log.push({ screen, acts: acts.slice(0, MAX_ACTS) });
  return { ...payload, log: log.slice(-MAX_LOG) };
}

function collapse(acts: string[]): string {
  const out: string[] = [];
  for (const a of acts) {
    const prev = out[out.length - 1];
    const m = prev?.match(/^(.*) ×(\d+)$/);
    if (prev === a) out[out.length - 1] = `${a} ×2`;
    else if (m && m[1] === a) out[out.length - 1] = `${a} ×${Number(m[2]) + 1}`;
    else out.push(a);
  }
  return out.join(', ');
}

// ---------------------------------------------------------------------------
// Personal data
// ---------------------------------------------------------------------------

const COMMON = new Set(
  'check in out guest guests room rooms reservation reservations booking bookings front desk save search find look up open the a an and to for of on at into please today tomorrow mark clean dirty note add confirm cancel arrivals departures who what which show list new edit update done'.split(' '),
);

/** Lowercased words that are probably names (from the instruction and the summary). */
export function piiTokens(...texts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const name = extractName(text);
    for (const w of name?.split(/\s+/) ?? []) if (w.length > 1 && !COMMON.has(w.toLowerCase())) out.add(w.toLowerCase());
    // Capitalised words after the first word ("…for Jordan Smith").
    for (const m of text.matchAll(/(?<=\S\s+)([A-Z][a-zÀ-ÿ'’-]{1,30})/g)) if (!COMMON.has(m[1].toLowerCase())) out.add(m[1].toLowerCase().replace(/[’']s$/, ''));
  }
  return out;
}

/** A recipe step with personal data and anything URL- or code-like removed; null when nothing generic is left. */
export function genericStep(step: string, pii: Set<string>, system: string): string | null {
  const keep = new Set(system.toLowerCase().split(/\s+/));
  let s = String(step ?? '')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, 'the page')
    .replace(/\S+@\S+\.\S+/g, 'the email address')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, 'the phone number')
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, 'the date')
    .replace(new RegExp(MONTHS.source, 'gi'), 'the date')
    .replace(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g, 'the amount')
    .replace(/\brooms?\s*#?\s*\d+[a-z]?\b/gi, 'the room')
    .replace(/\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,}\b/g, 'the code')
    .replace(/\d+/g, '#');
  s = s.replace(/[A-Za-zÀ-ÿ'’-]+/g, (w) => (pii.has(w.toLowerCase().replace(/[’']s$/, '')) && !keep.has(w.toLowerCase()) ? 'the guest' : w));
  s = s.replace(/\bthe guest(?:[\s,]+the guest)+\b/gi, 'the guest').replace(/["“”]\s*the guest\s*["“”]/gi, 'the guest');
  s = promptSafe(s, 160);
  return /[a-z]{3,}/i.test(s) ? s : null;
}

/** The generic steps to save for a finished task: the model's own STEPS line if it gave one, else the action log. */
export function distillSteps(payload: BridgePayload, instruction: string, summary: string | null, system: string): string[] {
  const pii = piiTokens(instruction, summary);
  const reported = (payload.reportedSteps ?? []).map((s) => genericStep(s, pii, system)).filter((s): s is string => !!s);
  if (reported.length >= 2) return dedupe(reported).slice(0, MAX_RECIPE_STEPS);
  const fromLog = (payload.log ?? []).map((e) => genericStep(`On ${screenLabel(e.screen)}: ${collapse(e.acts)}`, pii, system)).filter((s): s is string => !!s);
  return dedupe(fromLog).slice(0, MAX_RECIPE_STEPS);
}

function dedupe(steps: string[]): string[] {
  return steps.filter((s, i) => s !== steps[i - 1]);
}

// ---------------------------------------------------------------------------
// Using and learning recipes
// ---------------------------------------------------------------------------

/** The ACTIVE recipe for this task's intent at this hotel's PMS, as operator guidance. */
export async function recipeForTask(task: Pick<BridgeTask, 'propertyId' | 'instruction'>, system: string): Promise<{ key: string; recipe: OperatorRecipe } | null> {
  const intent = taskIntent(task.instruction);
  const skill = await getSkill(task.propertyId, recipeKey(system, intent));
  if (!skill || skill.kind !== 'RECIPE' || skill.status !== 'ACTIVE' || skill.audience === 'GUEST') return null;
  const steps = skill.body.steps.map((s) => promptSafe(s, 200)).filter(Boolean).slice(0, MAX_RECIPE_STEPS);
  return steps.length ? { key: skill.key, recipe: { intent: skill.body.intent, steps } } : null;
}

/**
 * After a task ends: counts the outcome for the recipe it was given, and on
 * success records or refreshes the recipe for its intent. Never throws.
 */
export async function learnFromTask(task: BridgeTask & { connection?: { system: string } | null }): Promise<Skill | null> {
  try {
    const payload = (task.payload ?? {}) as BridgePayload;
    const system = task.connection?.system ?? (await prisma.pmsConnection.findUnique({ where: { id: task.connectionId }, select: { system: true } }))?.system ?? 'PMS';
    const success = task.status === 'DONE';
    const failure = task.status === 'FAILED' || (task.status === 'NEEDS_HELP' && !!payload.stepLimit);
    if (!success) {
      if (failure && payload.recipeKey) await recordRecipeOutcome(task.propertyId, payload.recipeKey, false).catch(() => null);
      return null;
    }
    const summary = ((task.result ?? {}) as { summary?: string | null }).summary ?? null;
    const intent = taskIntent(task.instruction);
    const key = recipeKey(system, intent);
    const existing = await getSkill(task.propertyId, key);
    const prev = existing?.kind === 'RECIPE' && existing.propertyId === task.propertyId ? existing : null;
    // A run that followed the recipe and worked keeps its steps, unless the operator reported better ones.
    const keepSteps = !!prev && payload.recipeKey === key && (payload.reportedSteps?.length ?? 0) < 2;
    const steps = keepSteps ? [] : distillSteps(payload, task.instruction, summary, system);
    let learned: Skill | null = null;
    if (steps.length) {
      const revive = prev?.status === 'DISABLED' && !!prev.body.autoDisabledAt;
      const body: RecipeBody = {
        system,
        intent,
        steps,
        // A run guided by this recipe is counted by recordRecipeOutcome below.
        successes: prev ? (prev.body.successes ?? 0) + (payload.recipeKey === key ? 0 : 1) : 1,
        failures: prev?.body.failures ?? 0,
        failStreak: revive ? 0 : prev?.body.failStreak ?? 0,
      };
      const input = {
        propertyId: task.propertyId,
        key,
        title: `${intent.charAt(0).toUpperCase()}${intent.slice(1)} in ${system}`.slice(0, 120),
        description: `How the PMS operator did “${intent}” in ${system} the last time it worked. Given to the operator for the next task like it.`.slice(0, 500),
        kind: 'RECIPE' as const,
        audience: 'STAFF' as const,
        parameters: null,
        body,
      };
      // A recipe that switched itself off after failures comes back with the steps that just worked; one a person switched off stays off.
      learned = revive ? await upsertSkill({ ...input, source: 'LEARNED', status: 'ACTIVE' }) : await recordLearnedSkill({ ...input, status: 'ACTIVE' });
    }
    if (payload.recipeKey) learned = await recordRecipeOutcome(task.propertyId, payload.recipeKey, true).catch(() => learned);
    if (learned) await prisma.bridgeTask.update({ where: { id: task.id }, data: { payload: { ...payload, learned: learned.key } as unknown as Prisma.InputJsonValue } }).catch(() => null);
    return learned;
  } catch (e) {
    console.error('[bridge] learning a recipe failed for task', task.id, e);
    return null;
  }
}
