/**
 * Agent skill types, validation and the row mapper.
 */
import type { AgentSkill } from '@prisma/client';
import { z } from 'zod';

export const SKILL_AUDIENCES = ['GUEST', 'STAFF', 'ALL'] as const;
export const SKILL_KINDS = ['ANSWER', 'MACRO', 'RECIPE'] as const;
export const SKILL_SOURCES = ['CONFIG', 'LEARNED', 'MANUAL'] as const;
export const SKILL_STATUSES = ['ACTIVE', 'SUGGESTED', 'DISABLED'] as const;

/** Who may use a skill. ALL matches either agent. */
export type SkillAudience = (typeof SKILL_AUDIENCES)[number];
/** The agent asking: guest-facing (voice, concierge, API) or staff. */
export type AgentAudience = Exclude<SkillAudience, 'ALL'>;
/** ANSWER: a fact to say · MACRO: staff-agent commands to run · RECIPE: steps an operator (e.g. the PMS bridge) follows. */
export type SkillKind = (typeof SKILL_KINDS)[number];
/** CONFIG: generated from hotel settings · LEARNED: recorded by an agent · MANUAL: written by a person. */
export type SkillSource = (typeof SKILL_SOURCES)[number];
/** Only ACTIVE skills are offered to and usable by agents. SUGGESTED await a person's approval. */
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export interface AnswerBody {
  answer: string;
}
export interface MacroBody {
  /** Staff-agent commands in order; may contain {param} placeholders. */
  steps: { command: string }[];
}
export interface RecipeBody {
  /** The system it operates, e.g. the PMS name ("Cloudbeds"). */
  system: string;
  /** What it achieves, e.g. "Check a guest in"; may contain {param} placeholders. */
  intent: string;
  /** Instructions in order; may contain {param} placeholders. */
  steps: string[];
  successes?: number;
  failures?: number;
  /** Failures in a row since the last success (RECIPE_MAX_FAIL_STREAK switches it off). */
  failStreak?: number;
  /** Set when it was switched off automatically after failing too often (ISO time). */
  autoDisabledAt?: string;
}
export type SkillBody = AnswerBody | MacroBody | RecipeBody;

/** One input of a MACRO/RECIPE (a JSON Schema property, simple types only). */
export interface SkillParam {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: string | number | boolean;
}

/** JSON Schema of a skill's inputs: `{ type: 'object', properties, required? }`. */
export interface SkillParameters {
  type: 'object';
  properties: Record<string, SkillParam>;
  required?: string[];
}

interface SkillBase {
  id: string;
  /** Null for platform-wide skills. */
  propertyId: string | null;
  key: string;
  audience: SkillAudience;
  title: string;
  /** When to use it — shown to models. */
  description: string;
  parameters: SkillParameters | null;
  source: SkillSource;
  status: SkillStatus;
  uses: number;
  lastUsedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A stored skill; `body` is typed by `kind`. */
export type Skill = SkillBase & ({ kind: 'ANSWER'; body: AnswerBody } | { kind: 'MACRO'; body: MacroBody } | { kind: 'RECIPE'; body: RecipeBody });

/** Maps a database row (JSON columns untyped) to a Skill. */
export function toSkill(row: AgentSkill): Skill {
  return { ...row, parameters: (row.parameters as unknown as SkillParameters | null) ?? null } as unknown as Skill;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A stable, readable slug for a skill key: "Is parking free?" → "is-parking-free". */
export function skillKey(text: string, maxLength = 60): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'skill';
}

export const skillKeySchema = z.string().trim().min(1).max(80).regex(KEY_PATTERN, 'must be a lowercase slug like "late-checkout"');

const paramSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean']).default('string'),
  description: z.string().trim().max(300).optional(),
  enum: z.array(z.union([z.string().max(100), z.number()])).min(1).max(50).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().min(0).max(1000).optional(),
  maxLength: z.number().int().min(1).max(1000).optional(),
  default: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
});

export const skillParametersSchema = z
  .object({
    type: z.literal('object').default('object'),
    properties: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/, 'parameter names are letters, digits and _'), paramSchema),
    required: z.array(z.string()).max(20).optional(),
  })
  .refine((p) => Object.keys(p.properties).length <= 20, 'at most 20 parameters')
  .refine((p) => (p.required ?? []).every((r) => r in p.properties), 'required names must be declared in properties');

export const skillBodySchemas = {
  ANSWER: z.object({ answer: z.string().trim().min(1).max(4000) }),
  MACRO: z.object({ steps: z.array(z.object({ command: z.string().trim().min(1).max(500) })).min(1).max(20) }),
  RECIPE: z.object({
    system: z.string().trim().min(1).max(120),
    intent: z.string().trim().min(1).max(1000),
    steps: z.array(z.string().trim().min(1).max(1000)).min(1).max(40),
    successes: z.number().int().min(0).optional(),
    failures: z.number().int().min(0).optional(),
    failStreak: z.number().int().min(0).optional(),
    autoDisabledAt: z.string().max(40).optional(),
  }),
} as const;

/** A recipe that fails this many times in a row is switched off automatically. */
export const RECIPE_MAX_FAIL_STREAK = 3;

/** True for the kinds this module can store and use (other modules keep their own kinds in the same table). */
export function isSkillKind(kind: string): kind is SkillKind {
  return (SKILL_KINDS as readonly string[]).includes(kind);
}

// Control characters (newline and tab handled separately), zero-width and bidirectional overrides.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * Cleans text stored in a skill: drops control, zero-width and bidi-override
 * characters and tidies whitespace. `multiline` keeps line breaks (at most
 * one blank line in a row); otherwise everything becomes one line.
 */
export function cleanSkillText(text: string, opts: { multiline?: boolean } = {}): string {
  const s = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROL, '');
  if (!opts.multiline) return s.replace(/\s+/g, ' ').trim();
  return s
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Text that goes into a model prompt (catalog lines): one line, no markdown
 * headings, code fences, HTML-ish tags or chat-role prefixes that could pose
 * as instructions, capped at `max` characters.
 */
export function promptSafe(text: string, max: number): string {
  let s = cleanSkillText(String(text ?? '').replace(/^\s{0,3}#{1,6}\s+/gm, ''))
    .replace(/`{3,}/g, ' ')
    .replace(/<\/?[a-z][^>]{0,80}>/gi, ' ')
    .replace(/\b(system|assistant|developer|user)\s*:/gi, '$1 -')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
  return s;
}

/** Applies `cleanSkillText` to every text field of a body of the given kind (unknown shapes pass through). */
export function cleanSkillBody(kind: string, body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, unknown>;
  const str = (v: unknown, multiline = false) => (typeof v === 'string' ? cleanSkillText(v, { multiline }) : v);
  if (kind === 'ANSWER') return { ...b, answer: str(b.answer, true) };
  if (kind === 'MACRO' && Array.isArray(b.steps)) return { ...b, steps: b.steps.map((s) => (s && typeof s === 'object' ? { ...(s as object), command: str((s as { command?: unknown }).command) } : s)) };
  if (kind === 'RECIPE') return { ...b, system: str(b.system), intent: str(b.intent), steps: Array.isArray(b.steps) ? b.steps.map((s) => str(s)) : b.steps };
  return body;
}

/** Fields every skill write validates (body is checked per kind). */
export const skillFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  kind: z.enum(SKILL_KINDS),
  audience: z.enum(SKILL_AUDIENCES).optional(),
  status: z.enum(SKILL_STATUSES).optional(),
  source: z.enum(SKILL_SOURCES).optional(),
});
