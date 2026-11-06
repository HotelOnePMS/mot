/**
 * Skills in the staff agent:
 *
 *  • Saved answers — hotel questions ("is parking free?") are answered from
 *    the hotel's ANSWER skills (FAQs, amenities, policies… from settings,
 *    plus answers people added).
 *  • Shortcuts — "save that as a shortcut called late checkout" turns the
 *    last command(s) into a MACRO skill (guest names, room numbers and dates
 *    become {placeholders}); "late checkout for Smith" runs it again through
 *    the normal pipeline, so changes still wait for a person to confirm.
 *  • Suggestions — a command shape that worked 3+ times in 14 days becomes a
 *    SUGGESTED shortcut for a manager to approve on the Skills page. Counted
 *    from the audit log ("okShape" in COMMAND / PLAN_EXECUTED entries).
 */
import { prisma } from '@/lib/prisma';
import type { AgentBlock } from '@/lib/agent/blocks';
import type { ISODate } from '@/lib/dto';
import type { Actor } from '../authz';
import { can } from '../authz';
import { todayAt } from '../services/hotels';
import { hotelToday } from '../dates';
import { DomainError } from '../errors';
import { recordAudit } from '../services/audit';
import {
  cleanSkillText,
  ensureConfigSkills,
  inputNames,
  listSkills,
  looksLikeQuestion,
  parametersFor,
  rankAnswerSkills,
  recordLearnedSkill,
  skillKey,
  upsertSkill,
  useSkill as runSkill,
  type MacroBody,
  type Skill,
  type SkillParameters,
} from '../skills';
import { codeRef, parseMessage, WRITE_KINDS, type Intent } from './nlu';
import { logError } from '@/server/log';

/** How many successful runs of the same command shape (within SUGGEST_WINDOW_DAYS) make a suggestion. */
export const SUGGEST_AFTER = 3;
export const SUGGEST_WINDOW_DAYS = 14;
const MAX_SAVED_COMMANDS = 5;

type MacroSkill = Extract<Skill, { kind: 'MACRO' }>;

// ---------------------------------------------------------------------------
// Recognising skill commands
// ---------------------------------------------------------------------------

export type SkillCommand =
  | { kind: 'save'; name: string; count: number }
  | { kind: 'list' }
  /** `explicit`: "run …" / "shortcut …" — say so when nothing matches. */
  | { kind: 'run'; text: string; explicit: boolean };

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const countOf = (pronoun?: string, n?: string) => {
  if (n) return Math.min(MAX_SAVED_COMMANDS, Math.max(1, COUNT_WORDS[n.toLowerCase()] ?? Number(n) ?? 1));
  return pronoun && /^(these|those|them)$/i.test(pronoun) ? 2 : 1;
};

const SAVE_RE =
  /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:save|store|keep|make|turn|add|create)\s+(?:(that|this|it|these|those|them)\s+|the\s+last\s+(\d|one|two|three|four|five|six)(?:\s+(?:commands?|steps?|things?|requests?|messages?))?\s+|the\s+last\s+(?:command|step|thing|one|request)\s+)?(?:as|into|to|in)?\s*(?:a|an|my|our|the)?\s*(?:new\s+)?(?:shortcut|macro|routine)s?\b(?:\s+(?:called|named|titled|for))?\s*[:\-–—]?\s*(.*)$/i;
const REMEMBER_RE = /^(?:please\s+)?(?:remember|save|store|call)\s+(that|this|it|these|those|them|the\s+last\s+(\d|two|three|four|five|six)(?:\s+(?:commands?|steps?|things?))?)\s+as\s+(?!a\s+note\b)(.+)$/i;
const LIST_RE = /^(?:(?:please\s+)?(?:list|show|see|view|open)\s+(?:me\s+)?(?:my|our|the|all|your)?\s*(?:saved\s+)?(?:shortcuts|macros|routines)|(?:my|our|saved)?\s*(?:shortcuts|macros)|what\s+shortcuts\b.*|which\s+shortcuts\b.*|what\s+are\s+(?:my|our|the)\s+shortcuts.*)\s*\??$/i;
const RUN_RE = /^(?:please\s+)?(run|execute|trigger|use|start|do|play)\s+(?:the\s+|my\s+|our\s+)?(shortcut|macro|routine)?\s*[:\-]?\s*(.+)$/i;
const SHORTCUT_RE = /^(?:shortcut|macro)\s*[:\-]?\s+(.+)$/i;

function cleanName(raw: string): string {
  return cleanSkillText(raw)
    .replace(/^(?:called|named|titled)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .replace(/,?\s*please$/i, '')
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .trim()
    .slice(0, 60);
}

/** Recognises "save that as a shortcut called …", "list shortcuts" and "run …". Null for anything else. */
export function parseSkillCommand(message: string): SkillCommand | null {
  const m = message.trim();
  let x = m.match(SAVE_RE);
  if (x) return { kind: 'save', name: cleanName(x[3] ?? ''), count: countOf(x[1], x[2]) };
  x = m.match(REMEMBER_RE);
  if (x) return { kind: 'save', name: cleanName(x[3] ?? ''), count: countOf(x[1].split(/\s+/)[0], x[2]) };
  if (LIST_RE.test(m)) return { kind: 'list' };
  x = m.match(SHORTCUT_RE);
  if (x) return { kind: 'run', text: x[1], explicit: true };
  x = m.match(/^\/([a-z0-9][a-z0-9-]*)\b\s*(.*)$/i);
  if (x) return { kind: 'run', text: `${x[1].replace(/-/g, ' ')} ${x[2]}`.trim(), explicit: true };
  x = m.match(RUN_RE);
  if (x) return { kind: 'run', text: x[3], explicit: /^(run|execute|trigger)$/i.test(x[1]) || !!x[2] };
  return null;
}

// ---------------------------------------------------------------------------
// Finding shortcuts
// ---------------------------------------------------------------------------

/** The hotel's ACTIVE shortcuts staff can run, most used first. */
export async function loadShortcuts(propertyId: string): Promise<MacroSkill[]> {
  const rows = await listSkills(propertyId, { audience: 'STAFF', status: ['ACTIVE'], kinds: ['MACRO'], includePlatform: true });
  return rows.filter((s): s is MacroSkill => s.kind === 'MACRO' && Array.isArray(s.body?.steps) && s.body.steps.length > 0);
}

/** A word as names are compared: lowercase letters and digits of any script, accents dropped. */
const word = (w: string) =>
  w
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

/** Names that are commands the agent already understands, so a shortcut can't take them over. */
const RESERVED_NAMES = new Set(
  [
    'help', 'help me', 'what can you do', 'brief', 'brief me', 'briefing', 'morning brief', 'morning briefing', 'daily brief', 'daily briefing', 'good morning',
    'overview', 'summary', 'today', 'tonight', 'tomorrow', 'arrivals', 'arrivals today', 'departures', 'departures today', 'who is arriving', 'who is arriving today',
    'whos arriving', 'whos arriving today', 'who is leaving', 'who is leaving today', 'whos leaving', 'whos leaving today', 'who is checking in', 'who is checking out',
    'in house', 'who is in house', 'whos in house', 'occupancy', 'housekeeping', 'rooms', 'dirty rooms', 'activity', 'find', 'search', 'show', 'list', 'shortcuts',
    'list shortcuts', 'my shortcuts', 'yes', 'no', 'ok', 'okay', 'confirm', 'cancel', 'stop', 'undo', 'thanks', 'thank you',
  ].map((n) => n.split(' ').map(word).join(' ')),
);
/** First words of the agent's own commands ("check in…", "who is…", "show…"). */
const COMMAND_STARTS = new Set(
  `help brief who whos what whats which where when how is are do does can could show list find search look lookup pull open check checkin checkout cancel confirm
  assign auto move mark add note put set take block unblock return raise lower increase decrease adjust change update give have upgrade run execute save remember
  shortcut shortcuts macro today tonight tomorrow arrivals arriving departures departing leaving occupancy forecast housekeeping rates rooms in no yes undo stop`.split(/\s+/),
);
const reservedCache = new Map<string, boolean>();

/**
 * True for names a shortcut can't be called (or matched by, without "run"):
 * the agent's own commands ("help", "brief me", "arrivals", "who is
 * arriving today") and names that start like a command and read as one
 * ("check in vip", "add a note"). "Late checkout" or "VIP arrival" are fine:
 * nobody starts a built-in command with those words.
 */
export function reservedShortcutName(name: string): boolean {
  const words = name.split(/\s+/).map(word).filter(Boolean);
  if (!words.length) return false;
  const phrase = words.join(' ');
  if (RESERVED_NAMES.has(phrase)) return true;
  if (!COMMAND_STARTS.has(words[0])) return false;
  let reserved = reservedCache.get(phrase);
  if (reserved === undefined) {
    // It reads as a command by itself, or becomes a change once a guest is named ("add a note" + "K7Q2MD").
    const today = hotelToday();
    reserved = parseMessage(name, today).some((i) => i.kind !== 'unknown') || parseMessage(`${name} K7Q2MD`, today).some((i) => WRITE_KINDS.has(i.kind));
    if (reservedCache.size > 500) reservedCache.clear();
    reservedCache.set(phrase, reserved);
  }
  return reserved;
}

/**
 * The shortcut a message starts with (by title or key), and the words after
 * it. With `implicit`, a shortcut without inputs only matches when nothing
 * but "for/on/with …" follows, and names that are the agent's own commands
 * (`reservedShortcutName`) don't match, so ordinary commands aren't taken
 * over — "run …" still reaches them.
 */
export function matchShortcut(text: string, shortcuts: MacroSkill[], opts: { implicit?: boolean } = {}): { skill: MacroSkill; rest: string } | null {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ w: word(m[0]), end: (m.index ?? 0) + m[0].length })).filter((x) => x.w);
  let best: { skill: MacroSkill; rest: string; len: number } | null = null;
  for (const s of shortcuts) {
    for (const name of [s.title, s.key.replace(/-/g, ' ')]) {
      const tokens = name.split(/\s+/).map(word).filter(Boolean);
      if (!tokens.length || tokens.length > words.length) continue;
      if (!tokens.every((t, i) => words[i].w === t)) continue;
      if (opts.implicit && reservedShortcutName(name)) continue;
      const rest = text.slice(words[tokens.length - 1].end).trim();
      const hasInputs = !!Object.keys(s.parameters?.properties ?? {}).length;
      if (opts.implicit && rest && !hasInputs) continue;
      if (opts.implicit && rest && !/^(for|on|with|to|:|-)\b|^[:\-–—]/i.test(rest) && tokens.length < 2) continue;
      const len = tokens.join(' ').length;
      if (!best || len > best.len) best = { skill: s, rest, len };
    }
  }
  return best ? { skill: best.skill, rest: best.rest } : null;
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_RES = [
  /\b\d{4}-\d{2}-\d{2}\b/i,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i,
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'i'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?=\\s|$|[,.;])`, 'i'),
];
const RELATIVE_DAY = /\b(?:today|tonight|tomorrow|yesterday|(?:next|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|weekend)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

/**
 * Arguments for a shortcut from the words after its name: "for Smith",
 * "Smith room 204", "guest=Smith, room=204". One input takes all the text;
 * otherwise rooms and dates are picked out and the rest is the guest.
 */
export function parseShortcutArgs(rest: string, parameters: SkillParameters | null): Record<string, string> {
  const names = Object.keys(parameters?.properties ?? {}).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  let text = rest.trim().replace(/^[:\-–—,]\s*/, '').replace(/^(?:for|on|with|to)\s+/i, '').replace(/[.!?]+$/, '').trim();
  if (!names.length || !text) return {};
  const pairs = [...text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*("[^"]*"|[^,;]+)/g)].filter((m) => names.includes(m[1]));
  if (pairs.length) return Object.fromEntries(pairs.map((m) => [m[1], m[2].replace(/^"|"$/g, '').trim()]));
  if (names.length === 1) return { [names[0]]: text };
  const out: Record<string, string> = {};
  for (const n of names.filter((x) => /^date\d*$/.test(x))) {
    const re = [...DATE_RES, RELATIVE_DAY].find((r) => r.test(text));
    if (!re) break;
    const m = text.match(re)!;
    out[n] = m[0];
    text = text.replace(m[0], ' ');
  }
  for (const n of names.filter((x) => /^room\d*$/.test(x))) {
    const m = text.match(/\brooms?\s*#?\s*(\d{1,4}[a-z]?)\b/i) ?? text.match(/(?<![\d/:-])\b(\d{3,4}[a-z]?)\b/i);
    if (!m) break;
    out[n] = m[1];
    text = text.replace(m[0], ' ');
  }
  const guests = names.filter((x) => /^guest\d*$/.test(x));
  const left = text.replace(/\b(?:and|in|into|room|for|on|with)\b/gi, ' ').replace(/[,;&]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (guests.length === 1 && left) out[guests[0]] = left;
  else if (guests.length > 1 && left) {
    const parts = text.split(/\s*(?:,|;|&|\band\b)\s*/i).map((p) => p.replace(/\b(?:for|on|with)\b/gi, ' ').trim()).filter(Boolean);
    guests.forEach((g, i) => parts[i] && (out[g] = parts[i]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Turning commands into reusable templates
// ---------------------------------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words in a guest name that only say how the guest was given ("the guest with phone …"). */
const NOT_NAME = new Set(['phone', 'email', 'mail', 'number', 'mobile', 'cell', 'address', 'contact', 'telephone', 'tel']);
const EMAIL_RE = /[^\s@<>()[\]{},;:"]+@[^\s@<>()[\]{},;:"]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+\d[\d\s().-]{5,}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const CONTACT_RE = new RegExp(`${EMAIL_RE.source}|${PHONE_RE.source}`, 'g');
/** Capitalised words that aren't names. */
const NOT_A_NAME = new Set(['I', 'VIP', 'OK', 'AM', 'PM', 'ASAP', 'TV', 'ID']);
const NAME_WORD = /^[\p{Lu}][\p{L}\p{M}'’.-]*$/u;
const nameToken = (w: string) =>
  w
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[’']s$/, '');

/**
 * Where a guest is named in a command: runs of words that are all part of
 * the reference (its code and name words, e.g. "Jordan Smith 4NBEYC"), with
 * a leading "the" for names ("the Smiths"). The NLU may split one guest into
 * a code and a name ("JORDAN" + "Smith"), so they're matched together.
 */
function guestRuns(text: string, ref: { code?: string; name?: string }): { start: number; end: number; value: string; words: number }[] {
  // Emails and phone numbers are handled on their own (a name word inside "jordan.smith@…" isn't a mention).
  const skip = [...text.matchAll(EMAIL_RE), ...text.matchAll(PHONE_RE)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const tokens = new Set<string>();
  if (ref.code) tokens.add(ref.code.toLowerCase());
  if (ref.name && /^[\p{L}\p{M}'’ .-]{2,60}$/u.test(ref.name)) {
    for (const w of ref.name.split(/\s+/)) if (w && !NOT_NAME.has(nameToken(w))) tokens.add(nameToken(w));
  }
  if (!tokens.size) return [];
  const words = [...text.matchAll(/#?[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu)]
    .map((m) => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
    .filter((w) => !skip.some(([a, b]) => w.start < b && w.end > a));
  const runs: { start: number; end: number; value: string; words: number }[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (text[w.start - 1] === '{' || !tokens.has(nameToken(w.text))) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < words.length && tokens.has(nameToken(words[j + 1].text)) && /^[\s,]+$/.test(text.slice(words[j].end, words[j + 1].start))) j++;
    let start = w.start;
    const before = text.slice(0, start).match(/\bthe\s+$/i);
    if (before && ref.name) start -= before[0].length;
    runs.push({ start, end: words[j].end, value: text.slice(w.start, words[j].end), words: j - i + 1 });
    i = j + 1;
  }
  return runs;
}

/** Drops what's left of a name next to a {guest} placeholder: "{guest} Smith" → "{guest}", "Mr {guest}" → "{guest}". */
export function stripNameResidue(text: string): string {
  const parts = text.split(/(\s+)/);
  const isName = (t: string | undefined) => !!t && NAME_WORD.test(t) && !NOT_A_NAME.has(t.replace(/[.]+$/, ''));
  for (let i = 0; i < parts.length; i += 2) {
    if (!/^\{guest\d*\}/.test(parts[i])) continue;
    // Before: capitalised words (not the command's first word).
    while (i >= 2 && i - 2 > 0 && isName(parts[i - 2])) {
      parts.splice(i - 2, 2);
      i -= 2;
    }
    // After, while the placeholder isn't followed by punctuation: "{guest} Smith: VIP" → "{guest}: VIP".
    while (/^\{guest\d*\}$/.test(parts[i]) && i + 2 < parts.length) {
      const m = parts[i + 2].match(/^(.+?)([:,.;!?]*)$/u);
      if (!m || !isName(m[1])) break;
      parts[i] += m[2];
      parts.splice(i + 1, 2);
    }
  }
  return parts.join('');
}

interface Generalized {
  /** Commands with {placeholders}. */
  steps: string[];
  parameters: SkillParameters | null;
  /** Example values, by placeholder (what this run used). */
  examples: Record<string, string>;
  /** Commands that refer to "them"/"that room" rather than a named guest or room. */
  usesPronoun: boolean;
}

/**
 * Replaces the guests, rooms and explicit dates in commands with
 * {guest}/{room}/{date} placeholders (numbered when there are several), the
 * same value always getting the same placeholder. A guest named by code and
 * name together ("Jordan Smith 4NBEYC") is one {guest}; email addresses and
 * phone numbers become {guest} placeholders too, and capitalised words left
 * next to a {guest} ("{guest} Smith") are dropped — no personal details stay
 * in a saved shortcut.
 */
export function generalizeCommands(commands: string[], today: ISODate): Generalized {
  const names = new Map<string, string>();
  const examples: Record<string, string> = {};
  const counters: Record<string, number> = {};
  const placeholder = (kind: 'guest' | 'room' | 'date', value: string) => {
    const k = `${kind}:${value.toLowerCase()}`;
    let n = names.get(k);
    if (!n) {
      counters[kind] = (counters[kind] ?? 0) + 1;
      n = counters[kind] === 1 ? kind : `${kind}${counters[kind]}`;
      names.set(k, n);
      examples[n] = value;
    }
    return `{${n}}`;
  };
  let usesPronoun = false;
  const steps = commands.map((command) => {
    let text = command.trim();
    const intents = parseMessage(text, today);
    for (const re of DATE_RES) {
      for (let guard = 0; guard < 4; guard++) {
        const m = text.match(re);
        if (!m) break;
        text = text.replace(m[0], placeholder('date', m[0]));
      }
    }
    for (const intent of intents) {
      const ref = 'ref' in intent ? intent.ref : undefined;
      if (ref?.pronoun) usesPronoun = true;
      const runs = ref ? guestRuns(text, ref) : [];
      if (runs.length) {
        // The first mention is the guest; later ones are replaced too when they're clearly the same guest.
        const first = runs[0];
        const code = ref?.code?.toLowerCase();
        const ph = placeholder('guest', first.value);
        const same = runs.filter((r, i) => i === 0 || r.value.toLowerCase() === first.value.toLowerCase() || r.words > 1 || (!!code && nameToken(r.value) === code));
        for (const r of [...same].reverse()) text = `${text.slice(0, r.start)}${ph}${text.slice(r.end)}`;
      } else if (ref?.roomNumber) {
        const re = new RegExp(`\\brooms?\\s*#?\\s*${escape(ref.roomNumber)}\\b`, 'i');
        const hit = text.match(re);
        if (hit) text = text.replace(re, placeholder('guest', hit[0]));
      }
      const rooms = [...('roomNumbers' in intent ? intent.roomNumbers : []), ...('roomNumber' in intent && intent.roomNumber ? [intent.roomNumber] : [])];
      for (const r of rooms) {
        const re = new RegExp(`(?<![{\\w])${escape(r)}(?![\\w}])`, 'i');
        if (re.test(text)) text = text.replace(re, placeholder('room', r));
      }
    }
    // Contact details are always someone's: they never stay in a template.
    text = text.replace(CONTACT_RE, (m) => placeholder('guest', m));
    return stripNameResidue(text);
  });
  const body: MacroBody = { steps: steps.map((command) => ({ command })) };
  return { steps, parameters: parametersFor('MACRO', body), examples, usesPronoun };
}

/**
 * The normalised shape of a command (entities as placeholders), used to spot
 * repeats. Null when it isn't a reusable template: what's left besides the
 * placeholders still has digits, an email address or capitalised words
 * (after the first) — usually someone's name, number or details.
 */
export function commandShape(command: string, today: ISODate): { shape: string; template: string } | null {
  const g = generalizeCommands([command], today);
  const template = g.steps[0].replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
  const shape = template.toLowerCase().replace(/[’]/g, "'");
  if (!/\p{L}/u.test(shape.replace(/\{[a-z]+\d*\}/g, ''))) return null;
  const leftover = template.replace(/\{[a-z]+\d*\}/g, ' ');
  if (/\d|@/.test(leftover)) return null;
  const words = leftover.split(/[\s:;,.!?()"“”]+/).filter(Boolean);
  if (words.slice(1).some((w) => /^\p{Lu}/u.test(w) && !NOT_A_NAME.has(w))) return null;
  return { shape, template };
}

/** Whether a repeated command is worth a shortcut: it has inputs, several parts, or is long. */
function worthAShortcut(shape: string, intents: Intent[]): boolean {
  const words = shape.split(/\s+/).filter(Boolean).length;
  if (words < 3) return false;
  return /\{[a-z]+\d*\}/.test(shape) || intents.length > 1 || words >= 5;
}

const normalizeStep = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();

// ---------------------------------------------------------------------------
// Saved answers
// ---------------------------------------------------------------------------

export interface SkillAnswer {
  blocks: AgentBlock[];
  key: string;
}

/**
 * Answers a hotel question from the hotel's saved answers (any audience —
 * guest answers are fine for staff). Null when nothing fits well enough.
 */
export async function answerFromSkills(actor: Actor, propertyId: string, message: string, opts: { minScore?: number } = {}): Promise<SkillAnswer | null> {
  await ensureConfigSkills(propertyId);
  const skills = await listSkills(propertyId, { status: ['ACTIVE'], kinds: ['ANSWER'], includePlatform: true });
  const ranked = rankAnswerSkills(message, skills, { limit: 4 });
  const threshold = Math.max(opts.minScore ?? 0, looksLikeQuestion(message) ? 1 : 2);
  const best = ranked[0];
  if (!best || best.score < threshold) return null;
  const used = await runSkill(propertyId, best.skill.key, {}, { audience: best.skill.audience === 'GUEST' ? 'GUEST' : 'STAFF' });
  if (used.kind !== 'ANSWER') return null;
  const blocks: AgentBlock[] = [
    { type: 'text', text: used.answer },
    { type: 'text', text: `From your saved answer: **${best.skill.title.replace(/[.!]+$/, '')}**${best.skill.source === 'CONFIG' ? ' (made from your settings)' : ''}` },
  ];
  const related = ranked.slice(1).filter((r) => r.score >= Math.max(threshold, best.score * 0.6)).map((r) => r.skill.title);
  if (related.length) blocks.push({ type: 'suggestions', items: related.slice(0, 3) });
  if (can(actor, 'skills.manage')) blocks.push({ type: 'navigate', label: 'Change saved answers', href: '/admin/skills' });
  return { blocks, key: best.skill.key };
}

// ---------------------------------------------------------------------------
// Shortcuts: hints, saving, running
// ---------------------------------------------------------------------------

const SAMPLE: Record<string, string> = { guest: 'Smith', guest2: 'Lee', guest3: 'Garcia', room: 'room 204', room2: 'room 205', date: 'tomorrow', date2: 'Friday' };

export interface ShortcutHint {
  key: string;
  title: string;
  /** How to say it, e.g. "late checkout for Smith". */
  example: string;
  /** What a one-tap chip sends (asks for missing inputs). */
  command: string;
  needsInput: boolean;
  steps: number;
  uses: number;
}

export function hintFor(s: MacroSkill): ShortcutHint {
  const params = inputNames('MACRO', s.body, s.parameters);
  const required = s.parameters?.required ?? [];
  const name = s.title.charAt(0).toLowerCase() + s.title.slice(1);
  const sample = params.map((p) => SAMPLE[p] ?? SAMPLE[p.replace(/\d+$/, '')] ?? p).slice(0, 3);
  return {
    key: s.key,
    title: s.title,
    example: params.length ? `${name} for ${sample.join(', ')}` : name,
    command: `run ${name}`,
    needsInput: required.length > 0,
    steps: s.body.steps.length,
    uses: s.uses,
  };
}

/** The hotel's most used shortcuts, for help and starter suggestions. */
export async function shortcutHints(propertyId: string, limit = 4): Promise<ShortcutHint[]> {
  return (await loadShortcuts(propertyId)).slice(0, limit).map(hintFor);
}

/** A list of the hotel's shortcuts and how to make one. */
export async function shortcutListBlocks(actor: Actor, propertyId: string, opts: { forHelp?: boolean } = {}): Promise<AgentBlock[]> {
  const all = await loadShortcuts(propertyId);
  const hints = all.slice(0, 8).map(hintFor);
  const blocks: AgentBlock[] = [];
  if (!hints.length) {
    if (opts.forHelp) {
      blocks.push({ type: 'text', text: '**Shortcuts:** do something once, then say “save that as a shortcut called late checkout”. Next time just say “late checkout for Smith”.' });
    } else {
      blocks.push({ type: 'text', text: 'There are no shortcuts here yet. Do something once — like “check out room 201” — then say “save that as a shortcut called quick checkout”. Next time just say “quick checkout for room 305”.' });
    }
  } else {
    blocks.push({
      type: 'text',
      text: [
        opts.forHelp ? '**Your shortcuts** — say the name, or tap one:' : `**${all.length} shortcut${all.length === 1 ? '' : 's'}** — say the name, or tap one:`,
        ...hints.map((h) => `• **${h.title}** — “${h.example}”${h.steps > 1 ? ` · ${h.steps} steps` : ''}`),
        ...(all.length > hints.length ? [`…and ${all.length - hints.length} more on the Skills page.`] : []),
        opts.forHelp ? 'Save a new one: do something, then say “save that as a shortcut called …”.' : 'Changes from a shortcut still wait for your OK.',
      ].join('\n'),
    });
    blocks.push({ type: 'suggestions', items: hints.slice(0, 4).map((h) => h.command) });
  }
  if (!opts.forHelp && can(actor, 'skills.view')) blocks.push({ type: 'navigate', label: 'Open the Skills page', href: '/admin/skills', description: 'Rename, edit or switch off shortcuts and saved answers' });
  return blocks;
}

const NOT_A_COMMAND = /^(?:yes|yeah|yep|ok|okay|sure|go ahead|confirm(?: it)?|do it|no|nope|cancel that|stop|thanks?|thank you)\b[.!]*$/i;

/** Which recent messages to save: the last `count` real commands (not questions about skills, not "yes"). */
export function pickCommands(recent: string[], count: number, today: ISODate): string[] {
  const out: string[] = [];
  for (let i = recent.length - 1; i >= 0 && out.length < count; i--) {
    const m = recent[i]?.trim();
    if (!m || m.length > 600 || NOT_A_COMMAND.test(m) || parseSkillCommand(m)) continue;
    const intents = parseMessage(m, today);
    if (intents.every((x) => x.kind === 'unknown' || x.kind === 'help')) continue;
    out.unshift(m);
  }
  return out;
}

/** Recent commands this person sent here (last 2 hours), oldest first — used when the client sends none. */
export async function recentCommandsFromAudit(actor: Actor, propertyId: string): Promise<string[]> {
  const rows = await prisma.agentAuditLog.findMany({
    where: { propertyId, userId: actor.userId, action: 'COMMAND', createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { detail: true },
  });
  const out: string[] = [];
  for (const r of rows) {
    try {
      const d = JSON.parse(r.detail ?? '{}') as { message?: string };
      if (d.message) out.unshift(d.message);
    } catch {
      /* skip unreadable rows */
    }
  }
  return out;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A shortcut name made from a command template, without its placeholders:
 * "add a note to {guest}: extra towels please" → "Add a note: extra towels
 * please", "check in {guest} to room {room}" → "Check in", "mark {room} and
 * {room2} clean" → "Mark clean".
 */
export function suggestionTitle(template: string): string {
  const P = '\u0001';
  const title = template
    .replace(/\{[A-Za-z_]+\d*\}/g, P)
    .replace(new RegExp(`${P}(?:\\s*(?:,|&|\\band\\b)\\s*${P})+`, 'gi'), P)
    // "to {guest}", "for room {room}", "from {date}" go; "check in {guest}" keeps its "in".
    .replace(new RegExp(`\\s*\\b(?:for|to|on|with|into|from|at|of|by|until|till)\\s+(?:the\\s+)?(?:(?:rooms?|guests?|reservation|booking|date)\\s+)?${P}`, 'gi'), '')
    .replace(new RegExp(`\\s*\\b(?:rooms?|guests?)\\s+${P}`, 'gi'), '')
    .replace(new RegExp(P, 'g'), '')
    .replace(/\s+([:;,.!?])/g, '$1')
    .replace(/([:;,])(?=[:;,.!?]|$)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.!?–—-]+|[\s:;,–—-]+$/g, '')
    .trim();
  return capitalize(title || 'Suggested shortcut').slice(0, 120);
}

/**
 * Saves the last command(s) as a shortcut (LEARNED) and says how to run it.
 * People who manage skills save it ACTIVE; anyone else saves it SUGGESTED,
 * for a manager to approve on the Skills page. It never overwrites a
 * shortcut someone else made, an ACTIVE one for someone who can't approve,
 * or a name that is one of the agent's own commands.
 */
export async function saveShortcut(input: { actor: Actor; propertyId: string; name: string; count: number; recent: string[]; today: ISODate }): Promise<AgentBlock[]> {
  const { actor, propertyId, today } = input;
  const commands = pickCommands(input.recent, input.count, today);
  if (!commands.length) {
    return [{ type: 'error', text: 'There’s nothing to save yet. Run a command first — like “check out room 201” — then say “save that as a shortcut called quick checkout”.' }];
  }
  if (!input.name) {
    return [{ type: 'error', text: `What should I call it? Say “save that as a shortcut called …” — for example “save that as a shortcut called ${commands.length > 1 ? 'morning routine' : 'late checkout'}”.` }];
  }
  const title = capitalize(input.name);
  if (reservedShortcutName(input.name)) {
    return [{ type: 'error', text: `“${title}” is already something I understand, so it can’t be a shortcut name — the shortcut would take it over. Pick a name that doesn’t start like a command, such as “morning routine” or “VIP checkout”.` }];
  }
  const manage = can(actor, 'skills.manage');
  const skillsLink: AgentBlock[] = can(actor, 'skills.view') ? [{ type: 'navigate', label: 'Open the Skills page', href: '/admin/skills' }] : [];
  const g = generalizeCommands(commands, today);
  const key = skillKey(input.name);
  const existing = await prisma.agentSkill.findFirst({ where: { propertyId, key }, select: { source: true, status: true, kind: true, title: true, createdById: true } });
  if (existing?.kind === 'MACRO') {
    const mine = existing.source === 'LEARNED' && !!existing.createdById && existing.createdById === actor.userId;
    if (!mine) {
      const owner = existing.createdById ? await prisma.user.findUnique({ where: { id: existing.createdById }, select: { firstName: true, lastName: true } }) : null;
      const by = owner ? ` (saved by ${`${owner.firstName} ${owner.lastName}`.trim()})` : '';
      return [
        { type: 'error', text: `There’s already a shortcut called “${existing.title}”${by}. Save this one with another name${manage ? ', or change that one on the Skills page' : ''}.` },
        ...skillsLink,
      ];
    }
    if (existing.status === 'DISABLED') {
      return [{ type: 'error', text: `A shortcut called “${title}” was switched off on the Skills page. Turn it back on there, or save this one with another name.` }, ...skillsLink];
    }
    if (existing.status === 'ACTIVE' && !manage) {
      return [{ type: 'error', text: `“${existing.title}” is already switched on for everyone, so a manager needs to change it on the Skills page. Or save this one with another name.` }, ...skillsLink];
    }
  }
  // Saving what was suggested approves the suggestion (for people who can) instead of making a twin.
  const wanted = g.steps.map(normalizeStep).join('\n');
  const suggested = (await listSkills(propertyId, { status: ['SUGGESTED'], kinds: ['MACRO'] })).find(
    (s) => s.kind === 'MACRO' && s.body.steps.map((x) => normalizeStep(x.command)).join('\n') === wanted,
  );
  if (suggested && !manage) {
    return [{ type: 'text', text: `That’s already waiting for a manager’s OK as the suggested shortcut “${suggested.title}”. Once it’s approved, anyone can run it by name.` }, ...skillsLink];
  }
  const fields = {
    propertyId,
    title,
    description: `Shortcut: ${g.steps.join(' → ')}`.slice(0, 500),
    kind: 'MACRO' as const,
    audience: 'STAFF' as const,
    parameters: g.parameters,
    body: { steps: g.steps.map((command) => ({ command })) },
  };
  let skill: Skill;
  try {
    skill =
      suggested && existing?.kind !== 'MACRO'
        ? await upsertSkill({ ...fields, key: suggested.key, source: 'LEARNED', status: 'ACTIVE' })
        : await recordLearnedSkill({ ...fields, key, status: manage ? 'ACTIVE' : 'SUGGESTED', createdById: actor.userId });
  } catch (e) {
    if (e instanceof DomainError) return [{ type: 'error', text: `I couldn’t save that: ${e.message}` }];
    throw e;
  }
  if (skill.kind !== 'MACRO') return [{ type: 'error', text: 'I couldn’t save that shortcut.' }];
  const pending = skill.status !== 'ACTIVE';
  const n = skill.body.steps.length;
  await recordAudit(
    { actor, source: 'agent' },
    propertyId,
    pending ? 'SKILL_SUGGEST' : 'SKILL_SAVE',
    `${pending ? 'Suggested' : 'Saved'} the shortcut “${skill.title}” (${n} step${n === 1 ? '' : 's'})${pending ? ' for a manager to approve' : ''}`,
    { skillKey: skill.key },
  );
  const hint = hintFor(skill);
  const inputs = inputNames('MACRO', skill.body, skill.parameters);
  const lines = [
    pending
      ? `Saved **${skill.title}** as a suggested shortcut. A manager needs to approve it on the Skills page before anyone can run it. It will run:`
      : `Saved **${skill.title}** as a shortcut. It runs:`,
    ...skill.body.steps.map((s, i) => `• ${n > 1 ? `${i + 1}. ` : ''}${s.command}`),
    inputs.length
      ? `${pending ? 'Once it’s approved, say' : 'Next time say'} “${hint.example}” — I’ll fill in ${inputs.map((p) => `{${p}}`).join(', ')}${Object.keys(g.examples).length ? ` (this time: ${Object.entries(g.examples).map(([k, v]) => `${k} = ${v}`).join(', ')})` : ''}.`
      : `${pending ? 'Once it’s approved, just say' : 'Next time just say'} “${hint.example}”.`,
    ...(g.usesPronoun ? ['It says “them” or “that”, so it acts on whoever we were just talking about.'] : []),
    'Changes it makes still wait for your OK.',
  ];
  const blocks: AgentBlock[] = [{ type: 'text', text: lines.join('\n') }];
  if (!inputs.length && !pending) blocks.push({ type: 'suggestions', items: [hint.command] });
  if (can(actor, 'skills.view')) blocks.push({ type: 'navigate', label: 'See it on the Skills page', href: pending ? '/admin/skills#suggested' : '/admin/skills' });
  return blocks;
}

export type ShortcutExpansion = { ok: true; skill: MacroSkill; steps: string[]; args: Record<string, string> } | { ok: false; blocks: AgentBlock[] };

/** Fills a shortcut's inputs from the words after its name; asks for missing ones (offering guests only to people who may see them). Counts the use. */
export async function expandShortcut(actor: Actor, propertyId: string, skill: MacroSkill, rest: string): Promise<ShortcutExpansion> {
  const args = parseShortcutArgs(rest, skill.parameters);
  const missing = (skill.parameters?.required ?? []).filter((p) => !args[p]);
  const name = skill.title.charAt(0).toLowerCase() + skill.title.slice(1);
  if (missing.length) {
    if (missing.length === 1 && /^guest\d*$/.test(missing[0]) && Object.keys(skill.parameters?.properties ?? {}).length === 1 && can(actor, 'frontdesk.view')) {
      const options = await guestOptions(propertyId, name);
      if (options.length) return { ok: false, blocks: [{ type: 'clarify', question: `Who should I run “${skill.title}” for?`, options }] };
    }
    const hint = hintFor(skill);
    return { ok: false, blocks: [{ type: 'error', text: `“${skill.title}” needs ${missing.map((p) => (/^guest/.test(p) ? 'a guest' : /^room/.test(p) ? 'a room number' : /^date/.test(p) ? 'a date' : p)).join(' and ')}. Try “${hint.example}”.` }] };
  }
  try {
    const used = await runSkill(propertyId, skill.key, args, { audience: 'STAFF' });
    if (used.kind !== 'MACRO') return { ok: false, blocks: [{ type: 'error', text: `“${skill.title}” isn’t a shortcut I can run.` }] };
    return { ok: true, skill, steps: used.steps.map((s) => s.command), args };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, blocks: [{ type: 'error', text: e.message }] };
    throw e;
  }
}

/** In-house guests and today's arrivals, as one-tap answers to "who for?". */
async function guestOptions(propertyId: string, shortcutName: string) {
  const start = new Date(`${await todayAt(propertyId)}T00:00:00Z`);
  const select = { code: true, id: true, status: true, user: { select: { firstName: true, lastName: true } }, room: { select: { roomNumber: true } } } as const;
  const [inHouse, arriving] = await Promise.all([
    prisma.booking.findMany({ where: { propertyId, status: 'CHECKED_IN' }, orderBy: { checkOut: 'asc' }, take: 6, select }),
    prisma.booking.findMany({ where: { propertyId, status: { in: ['CONFIRMED', 'PENDING'] }, checkIn: { gte: start, lt: new Date(start.getTime() + 86_400_000) } }, orderBy: { createdAt: 'asc' }, take: 6, select }),
  ]);
  return [...inHouse, ...arriving].slice(0, 6).map((b) => ({
    label: `${b.user.firstName} ${b.user.lastName}`.trim(),
    hint: `${b.code ?? ''}${b.room ? ` · room ${b.room.roomNumber}` : ''} · ${b.status === 'CHECKED_IN' ? 'in house' : 'arriving today'}`,
    command: `run ${shortcutName} for ${codeRef(b.code ?? b.id)}`,
  }));
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/** The `okShape` to log for a command that worked (or null when it isn't worth tracking). */
export function trackableShape(message: string, intents: Intent[], today: ISODate): { shape: string; template: string } | null {
  if (!intents.length || intents.some((i) => i.kind === 'unknown' || i.kind === 'help' || i.kind === 'howTo' || i.kind === 'atDesk')) return null;
  const s = commandShape(message, today);
  if (!s || !worthAShortcut(s.shape, intents)) return null;
  return s;
}

/** True when the intents include a change (so success is only known after confirmation). */
export const hasWrites = (intents: Intent[]) => intents.some((i) => WRITE_KINDS.has(i.kind));

/**
 * After a command shape worked: if it has worked SUGGEST_AFTER times in
 * SUGGEST_WINDOW_DAYS here and no shortcut covers it, records a SUGGESTED
 * shortcut and returns it (null otherwise, and on any failure).
 */
export async function maybeSuggestShortcut(actor: Actor, propertyId: string, shape: { shape: string; template: string }): Promise<Skill | null> {
  try {
    const count = await prisma.agentAuditLog.count({
      where: { propertyId, createdAt: { gte: new Date(Date.now() - SUGGEST_WINDOW_DAYS * 86_400_000) }, detail: { contains: `"okShape":${JSON.stringify(shape.shape)}` } },
    });
    if (count < SUGGEST_AFTER) return null;
    const key = skillKey(shape.template);
    const macros = await prisma.agentSkill.findMany({ where: { propertyId, kind: 'MACRO' }, select: { key: true, body: true } });
    const covered = macros.some((m) => m.key === key || ((m.body as unknown as MacroBody)?.steps ?? []).some((s) => normalizeStep(String(s?.command ?? '')) === shape.shape));
    if (covered || (await prisma.agentSkill.findFirst({ where: { propertyId, key }, select: { id: true } }))) return null;
    const body: MacroBody = { steps: [{ command: shape.template }] };
    const skill = await recordLearnedSkill({
      propertyId,
      key,
      title: suggestionTitle(shape.template),
      description: `Suggested because it was run ${count} times in the last ${SUGGEST_WINDOW_DAYS} days. Runs: ${shape.template}`.slice(0, 500),
      kind: 'MACRO',
      audience: 'STAFF',
      parameters: parametersFor('MACRO', body),
      body,
      status: 'SUGGESTED',
      createdById: actor.userId,
    });
    await recordAudit({ actor, source: 'system' }, propertyId, 'SKILL_SUGGEST', `Suggested a shortcut: “${shape.template}” (run ${count} times in ${SUGGEST_WINDOW_DAYS} days)`, { skillKey: skill.key });
    return skill;
  } catch (e) {
    logError('agent', 'shortcut suggestion failed:', e);
    return null;
  }
}

/** What the agent says when it has just suggested a shortcut. */
export function suggestionBlocks(actor: Actor, skill: Skill): AgentBlock[] {
  const steps = skill.kind === 'MACRO' ? skill.body.steps.map((s) => s.command) : [];
  const blocks: AgentBlock[] = [
    {
      type: 'text',
      text: `You often run “${steps[0] ?? skill.title}”. I’ve suggested it as a shortcut${can(actor, 'skills.manage') ? ' — approve it on the Skills page, or save it now with a name you like' : ' for a manager to approve'}.`,
    },
  ];
  if (can(actor, 'skills.view')) blocks.push({ type: 'navigate', label: 'Review suggested shortcuts', href: '/admin/skills#suggested' });
  return blocks;
}
