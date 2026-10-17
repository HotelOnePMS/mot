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
import { cleanFaqs, hotelPolicy, runsOnHotelOne } from '../concierge/facts';
import { cleanSkillText, skillKey, type AnswerBody, type SkillAudience } from './types';

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
      setupPath: true,
      voiceAgent: { select: { faqs: true, checkInTime: true, checkOutTime: true, cancellationPolicy: true } },
    },
  });
  if (!p) return null;
  const policy = hotelPolicy(p.setupPath, p.voiceAgent);
  const out: ConfigSkill[] = [];

  const used = new Set<string>();
  for (const f of cleanFaqs(p.voiceAgent?.faqs)) {
    // FAQ text is typed by hotel staff and read by models: one-line questions, no control characters.
    const q = cleanSkillText(f.q);
    const a = cleanSkillText(f.a, { multiline: true });
    if (!q || !a) continue;
    const base = `faq-${skillKey(q, 52)}`;
    let key = base;
    for (let i = 2; used.has(key); i++) key = `${base}-${i}`;
    used.add(key);
    out.push({ key, title: clip(q, 120), description: clip(`Hotel FAQ. Use when a guest asks: "${q.replace(/"/g, '”')}"`, 500), audience: 'GUEST', kind: 'ANSWER', body: { answer: clip(a, 4000) } });
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
    body: {
      answer: runsOnHotelOne(p.setupPath)
        ? `Check-in is ${policy.checkIn} and check-out is ${policy.checkOut}. ${policy.cancellation}`
        : [`Check-in: ${policy.checkIn}`, `Check-out: ${policy.checkOut}`, `Cancellation: ${policy.cancellation}`].join('\n'),
    },
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
 * voice FAQ ("faq-<question-slug>"), plus "amenities" (when any are listed),
 * "policies", "rooms" (when it has active room types) and "contact".
 * Idempotent: unchanged skills aren't written, and a skill the hotel switched
 * off stays off. Removes CONFIG skills that no longer apply; never touches
 * LEARNED or MANUAL skills.
 */
export async function syncConfigSkills(propertyId: string): Promise<ConfigSyncResult> {
  const result: ConfigSyncResult = { created: 0, updated: 0, deleted: 0, unchanged: 0, skipped: 0, total: 0 };
  const [desired, existing] = await Promise.all([
    desiredSkills(propertyId),
    prisma.agentSkill.findMany({ where: { propertyId }, select: { id: true, key: true, source: true, title: true, description: true, audience: true, kind: true, body: true, parameters: true } }),
  ]);
  if (!desired) return result;
  const byKey = new Map(existing.map((s) => [s.key, s]));
  const wanted = new Set<string>();

  for (const d of desired) {
    const current = byKey.get(d.key);
    if (current && (current.source !== 'CONFIG' || current.kind === PMS_TOOL_KIND)) {
      result.skipped++;
      continue;
    }
    wanted.add(d.key);
    if (current) {
      const same = current.title === d.title && current.description === d.description && current.audience === d.audience && current.kind === d.kind && stable(current.body) === stable(d.body) && current.parameters === null;
      if (same) {
        result.unchanged++;
        continue;
      }
      await prisma.agentSkill.update({ where: { id: current.id }, data: { title: d.title, description: d.description, audience: d.audience, kind: d.kind, body: d.body as unknown as Prisma.InputJsonValue, parameters: Prisma.DbNull } });
      result.updated++;
      continue;
    }
    try {
      await prisma.agentSkill.create({ data: { propertyId, key: d.key, title: d.title, description: d.description, audience: d.audience, kind: d.kind, body: d.body as unknown as Prisma.InputJsonValue, source: 'CONFIG', status: 'ACTIVE' } });
      result.created++;
    } catch (e) {
      // A sync running at the same time created it first.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      result.unchanged++;
    }
  }

  // PMS_TOOL rows are CONFIG too (generated from the hotel's PMS, src/server/pms) but not ours to remove.
  const stale = existing.filter((s) => s.source === 'CONFIG' && s.kind !== PMS_TOOL_KIND && !wanted.has(s.key)).map((s) => s.id);
  if (stale.length) result.deleted = (await prisma.agentSkill.deleteMany({ where: { id: { in: stale }, source: 'CONFIG', kind: { not: PMS_TOOL_KIND } } })).count;
  result.total = wanted.size;
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
