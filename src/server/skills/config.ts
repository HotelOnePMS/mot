/**
 * CONFIG skills: answers generated from what a hotel has set up (voice FAQs,
 * amenities, policy, room types, contact details), so every agent can use
 * them as tools. Regenerated whenever those settings are saved; LEARNED and
 * MANUAL skills are never touched (a manual skill with the same key wins).
 */
import { Prisma } from '@prisma/client';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { money } from '@/lib/status';
import { HOTEL_POLICY, cleanFaqs } from '../concierge/facts';
import { cleanSkillText, shortHash, skillKey, type AnswerBody, type SkillAudience } from './types';

/** Tools discovered on a hotel's PMS MCP server (src/server/pms/tools.ts) — CONFIG rows this sync leaves alone. */
const PMS_TOOL_KIND = 'PMS_TOOL';

/** A generated answer skill. */
interface ConfigSkill {
  key: string;
  title: string;
  description: string;
  audience: SkillAudience;
  kind: 'ANSWER';
  body: AnswerBody;
  /** FAQ answers: the question, normalised (`faqIdentity`), so a sync finds the same answer whatever its key was. */
  question?: string;
}

/** A question as FAQ syncs compare it: case, accents, spacing and punctuation don't count. */
export function faqIdentity(question: string): string {
  return cleanSkillText(question)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const FAQ_DESCRIPTION = /^Hotel FAQ\. Use when a guest asks: "([\s\S]*)"$/;

/** The question a stored FAQ answer is for: from its description (the title is clipped at 120 characters). */
function storedQuestion(row: { title: string; description: string }): string {
  return row.description.match(FAQ_DESCRIPTION)?.[1] ?? row.title;
}

/**
 * Keys for a hotel's FAQs, one per question and the same whatever order the
 * FAQs are in: "faq-<question slug>", or — when two different questions
 * share a slug (long questions are cut at 52 characters) — the slug plus a
 * hash of the question. The same question asked twice with another answer
 * gets a hash of that answer; an exact repeat is skipped (null).
 */
function faqKeys(faqs: { q: string; a: string }[]): (string | null)[] {
  const questionsBySlug = new Map<string, Set<string>>();
  for (const f of faqs) {
    const slug = skillKey(f.q, 52);
    questionsBySlug.set(slug, (questionsBySlug.get(slug) ?? new Set()).add(faqIdentity(f.q)));
  }
  const used = new Set<string>();
  const seen = new Set<string>();
  return faqs.map((f) => {
    const id = faqIdentity(f.q);
    const pair = `${id}\n${faqIdentity(f.a)}`;
    if (seen.has(pair)) return null; // the same question and answer again
    seen.add(pair);
    const slug = skillKey(f.q, 52);
    let key = (questionsBySlug.get(slug)?.size ?? 0) > 1 ? `faq-${skillKey(f.q, 43)}-${shortHash(id)}` : `faq-${slug}`;
    if (used.has(key)) key = `${key.slice(0, 70)}-${shortHash(faqIdentity(f.a))}`;
    if (used.has(key)) return null;
    used.add(key);
    return key;
  });
}

/** What `syncConfigSkills` did. */
export interface ConfigSyncResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  /** Generated keys held by a LEARNED or MANUAL skill (those win). */
  skipped: number;
  /** CONFIG skills the hotel has after the sync. */
  total: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const price = (n: number) => money(n, { cents: !Number.isInteger(n) });
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** JSON with sorted keys, so JSONB's key order never looks like a change. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

async function desiredSkills(propertyId: string): Promise<ConfigSkill[] | null> {
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      name: true,
      address: true,
      city: true,
      state: true,
      zipCode: true,
      phone: true,
      email: true,
      amenities: true,
      roomTypes: { where: { isActive: true }, orderBy: { basePrice: 'asc' }, select: { name: true, capacity: true, basePrice: true, amenities: true } },
      voiceAgent: { select: { faqs: true } },
    },
  });
  if (!p) return null;
  const out: ConfigSkill[] = [];

  // FAQ text is typed by hotel staff and read by models: one-line questions, no control characters.
  const faqs = cleanFaqs(p.voiceAgent?.faqs)
    .map((f) => ({ q: cleanSkillText(f.q), a: cleanSkillText(f.a, { multiline: true }) }))
    .filter((f) => f.q && f.a);
  const keys = faqKeys(faqs);
  for (const [i, { q, a }] of faqs.entries()) {
    const key = keys[i];
    if (!key) continue;
    out.push({
      key,
      title: clip(q, 120),
      description: clip(`Hotel FAQ. Use when a guest asks: "${q.replace(/"/g, '”')}"`, 500),
      audience: 'GUEST',
      kind: 'ANSWER',
      body: { answer: clip(a, 4000) },
      question: faqIdentity(q),
    });
  }

  const hotelAmenities = p.amenities.map((a) => a.trim()).filter(Boolean);
  const seen = new Set(hotelAmenities.map((a) => a.toLowerCase()));
  const roomAmenities = [...new Set(p.roomTypes.flatMap((rt) => rt.amenities.map((a) => a.trim()).filter(Boolean)))].filter((a) => !seen.has(a.toLowerCase()));
  if (hotelAmenities.length || roomAmenities.length) {
    const answer = [hotelAmenities.length ? `${p.name} offers ${list(hotelAmenities)}.` : '', roomAmenities.length ? `Rooms include ${list(roomAmenities)} (varies by room type).` : ''].filter(Boolean).join(' ');
    out.push({
      key: 'amenities',
      title: 'Amenities',
      description: 'What the hotel and its rooms offer (Wi-Fi, parking, pool, breakfast…). Use when a guest asks whether something is available. If it isn’t listed, say you’re not sure and offer to ask the team.',
      audience: 'GUEST',
      kind: 'ANSWER',
      body: { answer: clip(answer, 4000) },
    });
  }

  out.push({
    key: 'policies',
    title: 'Check-in, check-out and cancellation',
    description: 'Check-in and check-out times, and the free cancellation and date-change policy. Use when a guest asks when they can arrive or must leave, or about cancelling or changing dates.',
    audience: 'GUEST',
    kind: 'ANSWER',
    body: { answer: `Check-in is ${HOTEL_POLICY.checkIn} and check-out is ${HOTEL_POLICY.checkOut}. ${HOTEL_POLICY.cancellation}` },
  });

  if (p.roomTypes.length) {
    const rooms = p.roomTypes.map((rt) => {
      const extras = rt.amenities.slice(0, 4).join(', ');
      return `${rt.name} — sleeps ${rt.capacity}, from ${price(Number(rt.basePrice))} a night${extras ? ` (${extras})` : ''}`;
    });
    out.push({
      key: 'rooms',
      title: 'Rooms and prices',
      description: 'The room types, how many guests each sleeps and their starting nightly prices. Use for questions about room options or rough prices; check availability for exact prices on given dates.',
      audience: 'ALL',
      kind: 'ANSWER',
      body: { answer: clip(`${p.name} has ${rooms.length} room type${rooms.length > 1 ? 's' : ''}: ${rooms.join('; ')}. Prices change by date — check availability for the exact price of a stay.`, 4000) },
    });
  }

  out.push({
    key: 'contact',
    title: 'Getting here and contact',
    description: 'The hotel’s address, phone number and email. Use when a guest asks where the hotel is, how to get there or how to reach the team.',
    audience: 'GUEST',
    kind: 'ANSWER',
    body: { answer: `${p.name} is at ${p.address}, ${p.city}, ${p.state} ${p.zipCode}. Phone: ${p.phone}.${p.email ? ` Email: ${p.email}.` : ''}` },
  });
  return out;
}

/**
 * (Re)generates a hotel's CONFIG skills from its settings: one answer per
 * voice FAQ ("faq-<question-slug>", see `faqKeys`), plus "amenities" (when
 * any are listed), "policies", "rooms" (when it has active room types) and
 * "contact". Idempotent: unchanged skills aren't written, and a skill the
 * hotel switched off stays off. An FAQ answer follows its question, not its
 * place in the list: reordering or removing FAQs never moves an on/off switch
 * to another answer, and answers stored under older keys are re-keyed with
 * their status and use count. Removes CONFIG skills that no longer apply;
 * never touches LEARNED or MANUAL skills.
 */
export async function syncConfigSkills(propertyId: string): Promise<ConfigSyncResult> {
  const result: ConfigSyncResult = { created: 0, updated: 0, deleted: 0, unchanged: 0, skipped: 0, total: 0 };
  const [desired, existing] = await Promise.all([
    desiredSkills(propertyId),
    prisma.agentSkill.findMany({ where: { propertyId }, select: { id: true, key: true, source: true, title: true, description: true, audience: true, kind: true, body: true, parameters: true } }),
  ]);
  if (!desired) return result;
  type Row = (typeof existing)[number];
  const byKey = new Map(existing.map((s) => [s.key, s]));
  // PMS_TOOL rows are CONFIG too (generated from the hotel's PMS, src/server/pms) but not ours to change.
  const ours = (s: Row) => s.source === 'CONFIG' && s.kind !== PMS_TOOL_KIND;
  const faqRows = existing.filter((s) => ours(s) && s.kind === 'ANSWER' && s.key.startsWith('faq-'));
  const questionOf = new Map(faqRows.map((s) => [s.id, faqIdentity(storedQuestion(s))]));

  // The row each generated skill updates: the one with its key — for an FAQ, only if it answers the same question —
  // else the FAQ row that answers its question under another key (moved, or stored under an older key).
  const target = new Map<ConfigSkill, Row>();
  const taken = new Set<string>();
  const blocked = new Set<ConfigSkill>();
  // A question asked twice (with different answers): its rows are told apart by answer too.
  const asked = desired.map((d) => d.question).filter(Boolean);
  const twice = new Set(asked.filter((q, i) => asked.indexOf(q) !== i));
  for (const d of desired) {
    const current = byKey.get(d.key);
    if (current && !ours(current)) blocked.add(d); // a LEARNED or MANUAL skill with this key wins
    else if (current && (!d.question || (questionOf.get(current.id) === d.question && (!twice.has(d.question) || stable(current.body) === stable(d.body))))) {
      target.set(d, current);
      taken.add(current.id);
    }
  }
  for (const d of desired) {
    if (!d.question || blocked.has(d) || target.has(d)) continue;
    const candidates = faqRows.filter((s) => !taken.has(s.id) && questionOf.get(s.id) === d.question);
    const row = candidates.find((s) => stable(s.body) === stable(d.body)) ?? candidates[0];
    if (row) {
      target.set(d, row);
      taken.add(row.id);
    }
  }
  result.skipped = blocked.size;

  // Rows no generated skill uses go first, so their keys are free for the ones that move or are new.
  const stale = existing.filter((s) => ours(s) && !taken.has(s.id)).map((s) => s.id);
  if (stale.length) result.deleted = (await prisma.agentSkill.deleteMany({ where: { id: { in: stale }, source: 'CONFIG', kind: { not: PMS_TOOL_KIND } } })).count;

  // Re-key moved FAQ answers in one transaction, through temporary keys so two answers can swap keys.
  const moves = [...target].filter(([d, row]) => row.key !== d.key);
  if (moves.length) {
    try {
      await prisma.$transaction([
        ...moves.map(([, row]) => prisma.agentSkill.update({ where: { id: row.id }, data: { key: `moving-${row.id}` } })),
        ...moves.map(([d, row]) => prisma.agentSkill.update({ where: { id: row.id }, data: { key: d.key } })),
      ]);
    } catch (e) {
      // A sync running at the same time moved them first; the next sync tidies up.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2002' || e.code === 'P2025'))) throw e;
      console.warn('[skills] FAQ keys changed during a sync for', propertyId);
      for (const [d] of moves) target.delete(d);
    }
  }

  for (const d of desired) {
    if (blocked.has(d)) continue;
    const current = target.get(d);
    if (current) {
      const same = current.key === d.key && current.title === d.title && current.description === d.description && current.audience === d.audience && current.kind === d.kind && stable(current.body) === stable(d.body) && current.parameters === null;
      if (same) {
        result.unchanged++;
      } else {
        await prisma.agentSkill.update({ where: { id: current.id }, data: { title: d.title, description: d.description, audience: d.audience, kind: d.kind, body: d.body as unknown as Prisma.InputJsonValue, parameters: Prisma.DbNull } });
        result.updated++;
      }
    } else {
      try {
        await prisma.agentSkill.create({ data: { propertyId, key: d.key, title: d.title, description: d.description, audience: d.audience, kind: d.kind, body: d.body as unknown as Prisma.InputJsonValue, source: 'CONFIG', status: 'ACTIVE' } });
        result.created++;
      } catch (e) {
        // A sync running at the same time created it first.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        result.unchanged++;
      }
    }
    result.total++;
  }
  return result;
}

const ensured = new Set<string>();

/**
 * Generates a hotel's CONFIG skills the first time they're needed (hotels set
 * up before skills existed). Cheap after the first call per process; never
 * throws (failures are logged).
 */
export async function ensureConfigSkills(propertyId: string): Promise<void> {
  if (ensured.has(propertyId)) return;
  try {
    const n = await prisma.agentSkill.count({ where: { propertyId, source: 'CONFIG', kind: { not: PMS_TOOL_KIND } } });
    if (n === 0) await syncConfigSkills(propertyId);
    ensured.add(propertyId);
  } catch (e) {
    console.error('[skills] could not generate skills for', propertyId, e);
  }
}

/**
 * Re-syncs a hotel's CONFIG skills after its settings were saved, without
 * holding up or failing the save: runs after the response (Next.js `after`)
 * inside a request, right away otherwise. Errors are logged.
 */
export function scheduleConfigSkillSync(propertyId: string): void {
  const run = () =>
    syncConfigSkills(propertyId).then(
      () => undefined,
      (e) => console.error('[skills] config sync failed for', propertyId, e),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}
