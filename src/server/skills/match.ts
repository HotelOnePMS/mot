/**
 * Matching a question to a hotel's ANSWER skills without a model: words in
 * the question are compared with each skill's title, key, description and
 * answer (title words count most). Cheap, deterministic and good enough for
 * "is parking free?" or "what's our cancellation policy?".
 */
import type { Skill } from './types';

const STOP = new Set(
  `a an the is are was were be been do does did can could would will shall should may might must i me my we us our you your they them their it its this that these those
  what whats which who whom whose when why how any some there here have has had of to for in on at by with from about into as or and but if then than so
  please tell know want like get got let s t d ll re ve hotel hotels guest guests use used when asks ask faq question answer say says yes no not also just`.split(/\s+/),
);

/** Words that mean the same thing for matching. */
const SYNONYMS: Record<string, string> = {
  internet: 'wifi',
  wireless: 'wifi',
  dog: 'pet',
  cat: 'pet',
  animal: 'pet',
  car: 'parking',
  park: 'parking',
  garage: 'parking',
  valet: 'parking',
  cancellation: 'cancel',
  cancelling: 'cancel',
  canceling: 'cancel',
  refund: 'cancel',
  swim: 'pool',
  swimming: 'pool',
  allowed: 'allow',
  permitted: 'allow',
  welcome: 'allow',
  arrive: 'checkin',
  arrival: 'checkin',
  leave: 'checkout',
  departure: 'checkout',
  phone: 'contact',
  email: 'contact',
  call: 'contact',
  address: 'contact',
  located: 'contact',
  location: 'contact',
  directions: 'contact',
  where: 'contact',
  price: 'rate',
  prices: 'rate',
  cost: 'rate',
  rates: 'rate',
  much: 'rate',
  morning: 'breakfast',
  times: 'time',
  hours: 'time',
  hour: 'time',
  early: 'early',
  late: 'late',
};

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Normalised content words of a text. */
export function matchTokens(text: string): string[] {
  const t = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/\bwi-?fi\b/g, 'wifi')
    .replace(/\bcheck[\s-]?in\b/g, 'checkin')
    .replace(/\bcheck[\s-]?out\b/g, 'checkout')
    .replace(/\bpolicies\b/g, 'policy');
  const out: string[] = [];
  for (const raw of t.split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    const syn = SYNONYMS[raw];
    const w = syn ?? stem(raw);
    if (STOP.has(w)) continue;
    out.push(SYNONYMS[w] ?? w);
  }
  return out;
}

const QUESTION = /^\s*(who|what|whats|what's|which|when|where|why|how|is|are|do|does|did|can|could|will|would|should|any|tell me|is there|are there)\b|\?\s*$/i;

/** True when a message reads like a question. */
export function looksLikeQuestion(message: string): boolean {
  return QUESTION.test(message.trim());
}

export interface SkillMatch {
  skill: Skill;
  /** Average weight per question word (title 3, key 2, description 1.5, answer 1). */
  score: number;
}

/**
 * Ranks ANSWER skills for a question, best first. Only skills where some
 * question word appears in the title, key or description are returned.
 */
export function rankAnswerSkills(question: string, skills: Skill[], opts: { limit?: number } = {}): SkillMatch[] {
  const q = [...new Set(matchTokens(question))];
  if (!q.length) return [];
  const out: SkillMatch[] = [];
  for (const s of skills) {
    if (s.kind !== 'ANSWER') continue;
    const title = new Set(matchTokens(s.title));
    const key = new Set(matchTokens(s.key.replace(/^faq-/, '').replace(/-/g, ' ')));
    const desc = new Set(matchTokens(s.description));
    const answer = new Set(matchTokens(s.body.answer));
    let total = 0;
    let strong = false;
    for (const w of q) {
      if (title.has(w)) {
        total += 3;
        strong = true;
      } else if (key.has(w)) {
        total += 2;
        strong = true;
      } else if (desc.has(w)) {
        total += 1.5;
        strong = true;
      } else if (answer.has(w)) total += 1;
    }
    if (strong && total > 0) out.push({ skill: s, score: Math.round((total / q.length) * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score || b.skill.uses - a.skill.uses).slice(0, opts.limit ?? 5);
}
