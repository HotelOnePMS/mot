/**
 * The bridge operator: a computer-use model that works the hotel's own PMS
 * in a browser, one screenshot at a time. The model and API key live only
 * on our server — connectors send screenshots and execute the actions they
 * get back. Stored logins are typed by our worker when the model calls
 * fill_credential; they never enter the model's context.
 */
import OpenAI from 'openai';
import { createHmac } from 'crypto';
import type { BridgeTask, PmsConnection } from '@prisma/client';
import { PRODUCT_NAME } from '@/config/product';
import { DomainError } from '../errors';

export const OPERATOR_MODEL = process.env.BRIDGE_OPERATOR_MODEL || 'computer-use-preview';
const OPERATOR_TOOL = process.env.BRIDGE_OPERATOR_TOOL === 'computer' ? 'computer' : 'computer_use_preview';
export const DISPLAY = { width: 1280, height: 800 };
export const MAX_STEPS = 60;

export function operatorConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

let client: OpenAI | null = null;
const openai = () => {
  if (!operatorConfigured()) throw new DomainError(503, 'OPERATOR_DISABLED', `The PMS operator isn’t switched on for this ${PRODUCT_NAME} server yet (platform admin: add OPENAI_API_KEY).`);
  // Fail fast enough to report a clean error inside the serverless function's time limit.
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
  return client;
};

export type OperatorAction = Record<string, unknown> & { type: string };

export type OperatorNext =
  | { kind: 'actions'; responseId: string; callId: string; actions: OperatorAction[] }
  | { kind: 'credential'; responseId: string; callId: string; field: 'username' | 'password' | 'totp' }
  /** `steps`: the screens/buttons/fields the model says it used (kept server-side for recipes, never sent to the connector). */
  | { kind: 'done'; responseId: string | null; status: 'DONE' | 'FAILED' | 'NEEDS_HELP'; summary: string; steps?: string[] };

/** A recipe that worked before for the same kind of task (see recipes.ts), offered as guidance. */
export interface OperatorRecipe {
  intent: string;
  steps: string[];
}

export interface OperatorPending {
  callId: string;
  type: 'computer' | 'credential';
}

/** The operator's opening instructions for a task (exported for tests). */
export function operatorInstructions(task: BridgeTask, c: PmsConnection & { property?: { name: string } }, canLogIn: boolean, recipe?: OperatorRecipe | null) {
  const readOnly = task.kind === 'LOOKUP';
  return [
    `You operate ${c.system}, the property-management system of ${c.property?.name ?? 'a hotel'}, in a web browser on behalf of the hotel's staff.`,
    `Task: ${task.instruction}`,
    readOnly ? 'This is a LOOK-UP ONLY task. Do not create, edit, cancel or delete anything.' : 'Make only the change described. Do not touch any other reservation, rate or setting.',
    'Never delete reservations, issue refunds, change passwords or user permissions, or export guest data.',
    canLogIn
      ? 'If a login screen appears, click the username field and call fill_credential("username"), then the password field and fill_credential("password"); use fill_credential("totp") for a one-time code.'
      : `If you see a login screen, stop and reply NEEDS_HELP asking the staff to sign in to the ${PRODUCT_NAME} browser window.`,
    'If anything is ambiguous (two guests with the same name, a missing room, an unexpected warning), stop and reply NEEDS_HELP with the question.',
    ...(recipe?.steps.length
      ? [
          `Last time this worked for "${recipe.intent}" in ${c.system} (the screens may have changed — check each one, and follow the task and the rules above if they differ):`,
          ...recipe.steps.slice(0, 12).map((step, i) => `${i + 1}. ${step}`),
        ]
      : []),
    'When finished, reply with ONE short paragraph that starts with "DONE:", "NEEDS_HELP:" or "FAILED:" and states exactly what you saw or changed (names, dates, room numbers, amounts).',
    'Then add a last line that starts with "STEPS:" listing the screens, tabs, buttons and fields you used, in order, separated by " > ", in generic words only — no names, codes, dates, numbers or amounts (for example: "STEPS: Front desk > Arrivals tab > search box > guest row > Check in button > Save").',
  ].join('\n');
}

/** Splits the model's final reply into status, summary and the generic STEPS line (if any). */
export function parseFinal(text: string): { status: 'DONE' | 'FAILED' | 'NEEDS_HELP'; summary: string; steps?: string[] } {
  let t = text.trim();
  let steps: string[] | undefined;
  const stepsAt = t.search(/(?:^|\n)\s*STEPS\s*:/i);
  if (stepsAt >= 0) {
    const raw = t.slice(stepsAt).replace(/^\s*STEPS\s*:\s*/i, '');
    steps = raw
      .split(/\s*(?:>|→|\n|;|\d+\.\s)\s*/)
      .map((x) => x.replace(/^[-•*]\s*/, '').trim())
      .filter((x) => x && x.length <= 200)
      .slice(0, 20);
    t = t.slice(0, stepsAt).trim();
  }
  const m = t.match(/^(DONE|FAILED|NEEDS_HELP)\s*:\s*/i);
  if (m) return { status: m[1].toUpperCase() as 'DONE' | 'FAILED' | 'NEEDS_HELP', summary: t.slice(m[0].length).slice(0, 1500), ...(steps?.length ? { steps } : {}) };
  return { status: 'NEEDS_HELP', summary: (t || 'The operator stopped without a result.').slice(0, 1500) };
}

/**
 * One operator turn: given the latest screenshot (and the result of the
 * previous action), ask the model what to do next.
 */
export async function operatorStep(input: {
  task: BridgeTask;
  connection: PmsConnection & { property?: { name: string } };
  screenshot: string; // data URL (image/png or image/jpeg)
  currentUrl?: string;
  previousResponseId?: string | null;
  pending?: OperatorPending | null;
  /** A recipe that worked before for this kind of task (first turn only). */
  recipe?: OperatorRecipe | null;
}): Promise<OperatorNext> {
  const canLogIn = input.connection.mode === 'CLOUD' && !!input.connection.credentialsCipher;
  const computerTool =
    OPERATOR_TOOL === 'computer'
      ? ({ type: 'computer' } as const)
      : ({ type: 'computer_use_preview', display_width: DISPLAY.width, display_height: DISPLAY.height, environment: 'browser' } as const);
  const tools = [
    computerTool,
    ...(canLogIn
      ? [
          {
            type: 'function' as const,
            name: 'fill_credential',
            description: 'Type the hotel’s stored login into the focused field. You never see the value.',
            parameters: { type: 'object', properties: { field: { type: 'string', enum: ['username', 'password', 'totp'] } }, required: ['field'], additionalProperties: false },
            strict: true,
          },
        ]
      : []),
  ];

  let inputItems: OpenAI.Responses.ResponseInput;
  if (!input.previousResponseId || !input.pending) {
    inputItems = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${operatorInstructions(input.task, input.connection, canLogIn, input.recipe)}${input.currentUrl ? `\nCurrent page: ${input.currentUrl}` : ''}` },
          { type: 'input_image', image_url: input.screenshot, detail: 'auto' },
        ],
      },
    ];
  } else if (input.pending.type === 'credential') {
    inputItems = [{ type: 'function_call_output', call_id: input.pending.callId, output: JSON.stringify({ filled: true }) }];
  } else {
    inputItems = [{ type: 'computer_call_output', call_id: input.pending.callId, output: { type: 'computer_screenshot', image_url: input.screenshot } }];
  }

  let res: OpenAI.Responses.Response;
  try {
    res = await openai().responses.create({
      model: OPERATOR_MODEL,
      tools,
      input: inputItems,
      truncation: 'auto',
      ...(input.previousResponseId ? { previous_response_id: input.previousResponseId } : {}),
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    console.error('Bridge operator step failed:', (e as Error).message);
    throw new DomainError(502, 'OPERATOR_UPSTREAM', 'The PMS operator couldn’t reach the model. It will retry.');
  }

  for (const item of res.output) {
    if (item.type === 'computer_call') {
      if (item.pending_safety_checks?.length) {
        return { kind: 'done', responseId: res.id, status: 'NEEDS_HELP', summary: `Paused for a safety check: ${item.pending_safety_checks.map((s) => s.message ?? s.code).join('; ')}` };
      }
      const actions = (item.actions as OperatorAction[] | undefined) ?? (item.action ? [item.action as OperatorAction] : [{ type: 'screenshot' }]);
      return { kind: 'actions', responseId: res.id, callId: item.call_id, actions };
    }
    if (item.type === 'function_call' && item.name === 'fill_credential') {
      const field = (JSON.parse(item.arguments || '{}') as { field?: string }).field;
      if (field !== 'username' && field !== 'password' && field !== 'totp') return { kind: 'done', responseId: res.id, status: 'FAILED', summary: 'Asked for an unknown credential field.' };
      return { kind: 'credential', responseId: res.id, callId: item.call_id, field };
    }
  }
  return { kind: 'done', responseId: res.id, ...parseFinal(res.output_text ?? '') };
}

/** RFC 6238 time-based one-time code (SHA-1, 30 s, 6 digits) from a base32 secret. */
export function totp(secretBase32: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac('sha1', bytes).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
