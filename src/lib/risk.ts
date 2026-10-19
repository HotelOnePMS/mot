/**
 * Booking risk flags. Computed on the server from what Stripe reports about
 * the card and what the guest told us; shown to staff as badges and, for
 * flagged bookings, as a front-desk check-in checklist.
 *
 * A flag is a reason to look twice, never a verdict: people book and pay for
 * family, colleagues and clients all the time. Pure functions (no imports).
 */

export type RiskFlag =
  | 'CARDHOLDER_DIFFERS'
  | 'COUNTRY_MISMATCH'
  | 'HIGH_AMOUNT'
  | 'RISK_ELEVATED'
  | 'RISK_HIGHEST'
  | 'THREE_DS_NOT_COMPLETED';

export const RISK_FLAG_INFO: Record<RiskFlag, { label: string; description: string }> = {
  CARDHOLDER_DIFFERS: {
    label: 'Cardholder differs',
    description: 'The name on the card is not the guest’s name. Common when someone else pays; check the ID and, if needed, the card.',
  },
  COUNTRY_MISMATCH: {
    label: 'Country mismatch',
    description: 'The card was issued in a different country than the billing address or the guest’s country.',
  },
  HIGH_AMOUNT: {
    label: 'High amount',
    description: 'The stay is worth more than the hotel’s high-amount threshold.',
  },
  RISK_ELEVATED: { label: 'Elevated risk', description: 'Stripe’s fraud screening rated this payment as elevated risk.' },
  RISK_HIGHEST: { label: 'Highest risk', description: 'Stripe’s fraud screening rated this payment as highest risk.' },
  THREE_DS_NOT_COMPLETED: {
    label: '3D Secure not completed',
    description: '3D Secure bank verification did not complete or was not available for this card, so the bank may not cover a fraud dispute.',
  },
};

export const DEFAULT_HIGH_AMOUNT = 1000;

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (s: string | null | undefined): string[] => (s ? strip(s).split(' ').filter(Boolean) : []);

/** Two tokens match when equal, or when one is an initial ("j") of the other ("jamie"). */
const tokenMatch = (a: string, b: string) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));

/**
 * True when two names plausibly belong to the same person: any order, accents
 * and punctuation ignored, middle names and initials allowed ("Jamie Smith"
 * matches "Smith, Jamie Lee" and "J. Smith"). A single word only matches a name containing it.
 * An empty name never matches (unknown is handled by the caller).
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const pool = [...long];
  for (const t of short) {
    const i = pool.findIndex((p) => tokenMatch(t, p));
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return true;
}

const COUNTRY_ALIASES: Record<string, string> = {
  'united states': 'US',
  usa: 'US',
  'united states of america': 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  canada: 'CA',
  india: 'IN',
  australia: 'AU',
  germany: 'DE',
  france: 'FR',
  spain: 'ES',
  italy: 'IT',
  mexico: 'MX',
};

/** "us", "US", "United States" → "US"; anything else two letters long is upper-cased; otherwise null. */
export function normalizeCountry(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^[a-z]{2}$/i.test(v)) return v.toUpperCase();
  return COUNTRY_ALIASES[v.toLowerCase()] ?? null;
}

export interface RiskInput {
  /** The guest's name on the booking. */
  guestName: string;
  /** Online payments only; omit for pay-at-property bookings. */
  payment?: {
    cardholderName?: string | null;
    cardCountry?: string | null;
    billingCountry?: string | null;
    /** Stripe's 3D Secure result, if any. */
    threeDSecure?: string | null;
    /** Stripe Radar's risk level for the charge. */
    riskLevel?: string | null;
  } | null;
  /** Country on the guest's profile, if they gave one. */
  guestCountry?: string | null;
  /** Booking total in dollars. */
  totalAmount: number;
  highAmountThreshold?: number;
}

/** 3D Secure results that moved fraud liability to the bank. */
const THREE_DS_OK = new Set(['authenticated', 'attempt_acknowledged']);

export function computeRiskFlags(input: RiskInput): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const threshold = input.highAmountThreshold ?? DEFAULT_HIGH_AMOUNT;
  const p = input.payment;

  if (p) {
    // Only compare when Stripe gave us a cardholder name (wallets and some cards omit it).
    if (p.cardholderName && tokens(p.cardholderName).length && !namesMatch(p.cardholderName, input.guestName)) flags.push('CARDHOLDER_DIFFERS');

    const card = normalizeCountry(p.cardCountry);
    const others = [normalizeCountry(p.billingCountry), normalizeCountry(input.guestCountry)].filter((c): c is string => !!c);
    if (card && others.some((c) => c !== card)) flags.push('COUNTRY_MISMATCH');
  }

  if (input.totalAmount >= threshold && threshold > 0) flags.push('HIGH_AMOUNT');

  if (p) {
    if (p.riskLevel === 'highest') flags.push('RISK_HIGHEST');
    else if (p.riskLevel === 'elevated') flags.push('RISK_ELEVATED');
    if (!p.threeDSecure || !THREE_DS_OK.has(p.threeDSecure)) flags.push('THREE_DS_NOT_COMPLETED');
  }
  return flags;
}

export interface ChecklistRequirements {
  /** The guest's ID matches the booking name. */
  idMatched: true;
  /** Ask to see the card used to pay. Required when the card, the amount or Stripe's screening raised a flag. */
  cardShown: boolean;
  /** A registration card is signed. */
  registrationSigned: true;
}

const CARD_CHECK_FLAGS: readonly RiskFlag[] = ['CARDHOLDER_DIFFERS', 'HIGH_AMOUNT', 'RISK_ELEVATED', 'RISK_HIGHEST', 'COUNTRY_MISMATCH'];

/** Checklist for flagged bookings; null when nothing was flagged. */
export function checklistRequirements(flags: readonly RiskFlag[]): ChecklistRequirements | null {
  if (!flags.length) return null;
  return { idMatched: true, cardShown: flags.some((f) => CARD_CHECK_FLAGS.includes(f)), registrationSigned: true };
}

export type ChecklistItem = 'idMatched' | 'cardShown' | 'registrationSigned';

/** Items still open for a booking, given what is required and what staff ticked. */
export function openChecklistItems(req: ChecklistRequirements | null, done: Partial<Record<ChecklistItem, boolean>>): ChecklistItem[] {
  if (!req) return [];
  const items: ChecklistItem[] = ['idMatched', ...(req.cardShown ? (['cardShown'] as const) : []), 'registrationSigned'];
  return items.filter((i) => !done[i]);
}
