/**
 * Saved charges: the extras a hotel adds to folios often, with their usual price ("Pet fee", $50 per stay). Staff
 * pick them when adding a charge by hand, and the agent uses them when someone asks for one by name ("add pet fee to
 * Patel"). Client-safe, no server imports.
 */
import { roundMoney } from './currency';
import { formatMoney } from './format';

export const SAVED_CHARGE_UNITS = ['STAY', 'NIGHT', 'ITEM'] as const;
export type SavedChargeUnit = (typeof SAVED_CHARGE_UNITS)[number];

export const UNIT_LABEL: Record<SavedChargeUnit, string> = { STAY: 'per stay', NIGHT: 'per night', ITEM: 'each' };

export interface SavedChargeView {
  id: string;
  name: string;
  amount: number;
  unit: SavedChargeUnit;
  note: string | null;
}

export const isSavedChargeUnit = (u: unknown): u is SavedChargeUnit => typeof u === 'string' && (SAVED_CHARGE_UNITS as readonly string[]).includes(u);

/** Words that don't tell charges apart ("pet" and "pet fee" are the same charge). */
const FILLER = new Set(['fee', 'fees', 'charge', 'charges', 'the', 'a', 'an', 'for', 'of', 'cost', 'price', 'surcharge']);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    // "pets" is "pet", "late checkouts" is "late checkout"
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

const key = (s: string) => words(s).join(' ');
const core = (s: string) => words(s).filter((w) => !FILLER.has(w)).join(' ');

/**
 * The saved charge with this name: the same words ignoring case, punctuation and plurals, or the same apart from words
 * like "fee" and "charge" ("pets" → "Pet fee"). Null when none or several match. Strict: "pet deposit" isn't "Pet fee".
 */
export function findSavedCharge<T extends { name: string }>(list: readonly T[], query: string): T | null {
  const q = key(query);
  if (!q) return null;
  const exact = list.filter((c) => key(c.name) === q);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const qc = core(query);
  const same = qc ? list.filter((c) => core(c.name) === qc) : [];
  return same.length === 1 ? same[0] : null;
}

/**
 * The saved charge a name means: findSavedCharge, then the one charge whose name contains it ("rollaway" → "Rollaway
 * bed"). Null when none or several match.
 */
export function matchSavedCharge<T extends { name: string }>(list: readonly T[], query: string): T | null {
  const found = findSavedCharge(list, query);
  if (found) return found;
  const qc = core(query);
  if (qc) {
    const containing = list.filter((c) => {
      const n = core(c.name);
      return !!n && (` ${n} `.includes(` ${qc} `) || ` ${qc} `.includes(` ${n} `));
    });
    if (containing.length === 1) return containing[0];
  }
  return null;
}

/** What a saved charge comes to on a stay: its price once (per stay, or each) or for every night, times how many. */
export function savedChargeTotal(c: { amount: number; unit: SavedChargeUnit }, stay: { nights: number }, quantity = 1, currency = 'USD'): number {
  const times = (c.unit === 'NIGHT' ? Math.max(1, stay.nights) : 1) * Math.max(1, Math.floor(quantity));
  return roundMoney(c.amount * times, currency);
}

/** "$50.00 per stay" */
export function describeSavedCharge(c: { amount: number; unit: SavedChargeUnit }, currency: string): string {
  return `${formatMoney(c.amount, currency, { cents: true })} ${UNIT_LABEL[c.unit]}`;
}
