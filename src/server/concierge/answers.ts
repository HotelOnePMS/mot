/**
 * Answers to guests' questions about one hotel, from the hotel's own ANSWER
 * skills (generated from its FAQs, amenities, policies, rooms and contact
 * details, plus any a person added). Whatever a hotel configures becomes
 * answerable here without code changes, and the answers used most rank first
 * next time (useSkill counts each use).
 */
import { prisma } from '@/lib/prisma';
import { badRequest } from '../errors';
// Aliased: useSkill is not a React hook, but the hooks lint rule goes by the name.
import { ensureConfigSkills, listSkills, useSkill as runSkill, type AnswerBody, type Skill } from '../skills';
import { findListedHotel } from './hotel';
import { conciergeSchemas, type AskHotelInput } from './schemas';

/** One saved answer. */
export interface HotelAnswer {
  /** Skill key, usable as `topic` next time. */
  key: string;
  title: string;
  answer: string;
}

/** What `askHotel` returns. */
export interface AskHotelResult {
  hotel: { id: string; name: string; phone: string; email: string | null };
  /** Best matches first (at most 3); empty when nothing the hotel saved covers the question. */
  answers: HotelAnswer[];
  /** Every topic the hotel has answers for (only when nothing matched), so the model can pick one or ask. */
  topics?: { key: string; title: string }[];
  /** Guidance for the model when nothing matched. */
  note?: string;
}

const QUESTION_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'be', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'i', 'im', 'me', 'my', 'we', 'us', 'our', 'you', 'your',
  'it', 'its', 'there', 'their', 'they', 'this', 'that', 'what', 'whats', 'when', 'where', 'which', 'who', 'how', 'any', 'some', 'have', 'has', 'get', 'got', 'of', 'for',
  'to', 'in', 'on', 'at', 'by', 'with', 'about', 'and', 'or', 'if', 'hotel', 'please', 'tell', 'know', 'want', 'need', 'like', 'just', 'much', 'many', 'also', 'stay', 'guest',
  'guests', 'use', 'asks', 'ask', 'faq',
]);

/** Everyday words (singular, as `stem` leaves them) that should find the hotel's own wording. */
const SYNONYMS: Record<string, string[]> = {
  dog: ['pet'], cat: ['pet'], puppy: ['pet'], puppie: ['pet'], animal: ['pet'],
  internet: ['wifi'], wireless: ['wifi'], car: ['parking'], park: ['parking'], garage: ['parking'], ev: ['parking', 'charger'],
  cancel: ['cancellation'], refund: ['cancellation'], change: ['cancellation'], arrive: ['check'], arrival: ['check'], leave: ['check'], depart: ['check'],
  early: ['check'], late: ['check'], address: ['contact'], phone: ['contact'], call: ['contact'], email: ['contact'], direction: ['contact', 'address'], located: ['contact', 'address'],
  price: ['room'], cost: ['room', 'price'], rate: ['room', 'price'], bed: ['room'], sleep: ['room'],
  swim: ['pool'], swimming: ['pool'], gym: ['fitness'], eat: ['breakfast', 'restaurant'], food: ['breakfast', 'restaurant'], coffee: ['breakfast'],
};

function words(text: string | null | undefined): string[] {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/wi-?fi/g, 'wifi')
    .replace(/check-(in|out)/g, 'check $1')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Plural to singular, roughly ("pets" → "pet", "rooms" → "room"; "pass", "bus" and "this" stay). */
const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);
const stems = (text: string | null | undefined) => new Set(words(text).map(stem));

function questionTokens(question: string): string[] {
  const base = words(question)
    .filter((w) => !QUESTION_STOPWORDS.has(w))
    .map(stem);
  return [...new Set(base.flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]))];
}

/** Whole words, or a prefix of 4+ letters ("break" → "breakfast"). */
const hit = (token: string, hay: Set<string>) => hay.has(token) || (token.length >= 4 && [...hay].some((w) => w.length >= 4 && (w.startsWith(token) || token.startsWith(w))));

/** Title and key words count most, then the description (FAQs carry the question there), then the answer. */
function score(tokens: string[], s: Skill & { kind: 'ANSWER' }): number {
  const title = new Set([...stems(s.title), ...stems(s.key.replace(/-/g, ' '))]);
  const description = stems(s.description);
  const answer = stems(s.body.answer);
  return tokens.reduce((sum, t) => sum + (hit(t, title) ? 3 : hit(t, description) ? 2 : hit(t, answer) ? 1 : 0), 0);
}

const toAnswer = (s: Skill & { kind: 'ANSWER' }): HotelAnswer => ({ key: s.key, title: s.title, answer: (s.body as AnswerBody).answer });

/**
 * Answers a guest's question about a listed hotel from its active guest
 * ANSWER skills (the hotel's own, then platform-wide ones). Pass `topic` (a
 * skill key) for that answer, or `question` in the guest's words for the best
 * matches. The top answer's use is counted, so popular answers rank first.
 * When nothing matches, `topics` lists what the hotel has answers for and
 * `note` tells the model to offer the hotel's contact details instead of
 * guessing. DomainError 404 for unknown or unlisted hotels; 400 when neither
 * `question` nor `topic` is given.
 */
export async function askHotel(input: AskHotelInput): Promise<AskHotelResult> {
  const a = conciergeSchemas.askHotel.parse(input);
  if (!a.question && !a.topic) throw badRequest('Give the guest’s question, or a topic from the hotel’s list.');
  await findListedHotel(a.propertyId);
  await ensureConfigSkills(a.propertyId);
  const [hotel, skills] = await Promise.all([
    prisma.property.findUniqueOrThrow({ where: { id: a.propertyId }, select: { id: true, name: true, phone: true, email: true } }),
    listSkills(a.propertyId, { audience: 'GUEST', status: ['ACTIVE'], kinds: ['ANSWER'], includePlatform: true }),
  ]);
  const answers = skills.filter((s): s is Skill & { kind: 'ANSWER' } => s.kind === 'ANSWER');

  let picked: (Skill & { kind: 'ANSWER' })[] = [];
  const byTopic = a.topic ? answers.find((s) => s.key === a.topic?.trim().toLowerCase()) : undefined;
  if (byTopic) {
    picked = [byTopic];
  } else if (a.question || a.topic) {
    const tokens = questionTokens(`${a.question ?? ''} ${a.topic?.replace(/-/g, ' ') ?? ''}`);
    const ranked = answers
      .map((s) => ({ s, score: score(tokens, s) }))
      .filter((r) => r.score >= 2)
      .sort((x, y) => y.score - x.score || y.s.uses - x.s.uses);
    const best = ranked[0]?.score ?? 0;
    picked = ranked.filter((r) => r.score >= best * 0.5).slice(0, 3).map((r) => r.s);
  }

  if (picked[0]) {
    // Count the use (most-used answers are offered first next time); never fail the answer over it.
    await runSkill(a.propertyId, picked[0].key, {}, { audience: 'GUEST' }).catch(() => undefined);
    return { hotel, answers: picked.map(toAnswer) };
  }
  return {
    hotel,
    answers: [],
    topics: answers.slice(0, 40).map((s) => ({ key: s.key, title: s.title })),
    note: `${hotel.name} hasn’t saved an answer to that. Say you’re not sure rather than guessing, and offer the hotel’s phone (${hotel.phone})${hotel.email ? ` or email (${hotel.email})` : ''} — or pick one of these topics if it fits.`,
  };
}
