/**
 * Skill inputs: checking arguments against a skill's parameters and filling
 * {param} placeholders in MACRO/RECIPE steps.
 */
import { badRequest } from '../errors';
import type { SkillBody, SkillKind, SkillParameters } from './types';

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** Longest value put into a step, so one argument can't turn into a paragraph of instructions. */
const MAX_VALUE = 200;

export type SkillArgs = Record<string, string | number | boolean>;

/** The {param} names used in a body's text (MACRO commands; RECIPE intent and steps). */
export function placeholdersIn(kind: SkillKind, body: SkillBody): string[] {
  const texts = kind === 'MACRO' ? (body as { steps: { command: string }[] }).steps.map((s) => s.command) : kind === 'RECIPE' ? [(body as { intent: string }).intent, ...(body as { steps: string[] }).steps] : [];
  return [...new Set(texts.flatMap((t) => [...t.matchAll(PLACEHOLDER)].map((m) => m[1])))];
}

/**
 * Checks `args` against the skill's parameters: required inputs present,
 * types (numbers and booleans may arrive as strings), enum, bounds and
 * length. Applies defaults and drops undeclared keys. DomainError 400 lists
 * every problem.
 */
export function validateSkillArgs(key: string, parameters: SkillParameters | null, args: unknown): SkillArgs {
  if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) throw badRequest(`Arguments for skill ${key} must be an object.`);
  const given = (args ?? {}) as Record<string, unknown>;
  const out: SkillArgs = {};
  const problems: string[] = [];
  const required = new Set(parameters?.required ?? []);
  for (const [name, p] of Object.entries(parameters?.properties ?? {})) {
    const raw = given[name] ?? p.default;
    if (raw === undefined || raw === null || raw === '') {
      if (required.has(name)) problems.push(`${name} is required`);
      continue;
    }
    let value: string | number | boolean;
    if (p.type === 'number' || p.type === 'integer') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || (p.type === 'integer' && !Number.isInteger(n))) {
        problems.push(`${name} must be ${p.type === 'integer' ? 'a whole number' : 'a number'}`);
        continue;
      }
      if (p.minimum !== undefined && n < p.minimum) problems.push(`${name} must be at least ${p.minimum}`);
      if (p.maximum !== undefined && n > p.maximum) problems.push(`${name} must be at most ${p.maximum}`);
      value = n;
    } else if (p.type === 'boolean') {
      if (typeof raw === 'boolean') value = raw;
      else if (raw === 'true' || raw === 'false') value = raw === 'true';
      else {
        problems.push(`${name} must be true or false`);
        continue;
      }
    } else {
      if (typeof raw === 'object') {
        problems.push(`${name} must be text`);
        continue;
      }
      const s = String(raw).replace(/\s+/g, ' ').trim();
      if (p.minLength !== undefined && s.length < p.minLength) problems.push(`${name} must be at least ${p.minLength} characters`);
      if (s.length > (p.maxLength ?? MAX_VALUE)) problems.push(`${name} must be at most ${p.maxLength ?? MAX_VALUE} characters`);
      value = s;
    }
    if (p.enum && !p.enum.some((e) => String(e) === String(value))) problems.push(`${name} must be one of ${p.enum.join(', ')}`);
    out[name] = value;
  }
  if (problems.length) throw badRequest(`Invalid arguments for skill ${key}: ${problems.join('; ')}.`);
  return out;
}

/**
 * A skill's input names in the order its steps use them (JSONB doesn't keep
 * the parameters' key order), then any declared but unused ones.
 */
export function inputNames(kind: SkillKind, body: SkillBody, parameters: SkillParameters | null): string[] {
  const declared = Object.keys(parameters?.properties ?? {});
  const used = (kind === 'MACRO' || kind === 'RECIPE') ? placeholdersIn(kind, body).filter((n) => declared.includes(n)) : [];
  return [...used, ...declared.filter((n) => !used.includes(n)).sort()];
}

/**
 * Parameters for a MACRO/RECIPE body: one required text input per {param}
 * it uses, keeping `previous` definitions for names still in use. Null when
 * the body has no placeholders (or for ANSWER skills).
 */
export function parametersFor(kind: SkillKind, body: SkillBody, previous?: SkillParameters | null): SkillParameters | null {
  const names = placeholdersIn(kind, body);
  if (!names.length) return null;
  const properties: SkillParameters['properties'] = {};
  for (const n of names.slice(0, 20)) properties[n] = previous?.properties?.[n] ?? { type: 'string', description: PARAM_HINTS[n] ?? PARAM_HINTS[n.replace(/\d+$/, '')] ?? `Value for {${n}}` };
  const keptRequired = (previous?.required ?? []).filter((r) => r in properties);
  const fresh = names.filter((n) => n in properties && !previous?.properties?.[n]);
  return { type: 'object', properties, required: [...new Set([...keptRequired, ...fresh])] };
}

/** Plain descriptions for the placeholders agents create most. */
export const PARAM_HINTS: Record<string, string> = {
  guest: 'The guest: name, room number or confirmation code',
  room: 'Room number',
  date: 'A date, like 2026-10-20 or “tomorrow”',
};

/** Replaces {param} placeholders with argument values; a placeholder without a value is a DomainError 400. */
export function fillPlaceholders(key: string, text: string, args: SkillArgs): string {
  return text.replace(PLACEHOLDER, (_m, name: string) => {
    const v = args[name];
    if (v === undefined) throw badRequest(`Skill ${key} needs a value for {${name}}.`);
    return String(v).replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE);
  });
}
