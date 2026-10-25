/**
 * Third-party card authorization: when the person who pays (online, at the
 * desk, or not there at all) isn't the guest who checks in, the cardholder
 * signs an authorization with their photo ID. This file holds the rules both
 * sides share: the wording the cardholder agrees to (what is stored and
 * hashed is exactly what the form shows), how their details are matched
 * against the card and the request, and labels. Client-safe, no server imports.
 *
 * Card numbers are never collected: only the last four digits, which are
 * checked against the card that paid online (PCI SAQ A stays intact).
 */
import { namesMatch, normalizeCountry } from './risk';
import { money } from './status';

/** Bump when the wording of {@link cardAuthorizationText} changes: every signature records it. */
export const CARD_AUTH_VERSION = '2026-10-v1';

/** A link works for this many days; staff can make a new one. */
export const LINK_TTL_DAYS = 7;

/** Wrong card digits allowed before the link locks (and staff are told). */
export const MAX_CARD_ATTEMPTS = 5;

export type CardAuthStatus = 'PENDING' | 'SIGNED' | 'VERIFIED' | 'REJECTED' | 'CANCELLED' | 'LOCKED';
/** What staff and the cardholder see: an unsigned link past its date reads as expired. */
export type CardAuthDisplayStatus = CardAuthStatus | 'EXPIRED';

export function effectiveStatus(row: { status: string; expiresAt: Date | string }, now = new Date()): CardAuthDisplayStatus {
  const status = row.status as CardAuthStatus;
  if (status === 'PENDING' && new Date(row.expiresAt).getTime() <= now.getTime()) return 'EXPIRED';
  return status;
}

export const CARD_AUTH_STATUS: Record<CardAuthDisplayStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  PENDING: { label: 'Waiting for signature', tone: 'info' },
  SIGNED: { label: 'Signed · check the ID', tone: 'warning' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  LOCKED: { label: 'Locked', tone: 'danger' },
  EXPIRED: { label: 'Link expired', tone: 'neutral' },
};

export const ID_TYPES = ['PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID', 'OTHER'] as const;
export type IdType = (typeof ID_TYPES)[number];
export const ID_TYPE_LABEL: Record<IdType, string> = {
  PASSPORT: 'Passport',
  DRIVERS_LICENSE: 'Driver’s license',
  NATIONAL_ID: 'National ID card',
  OTHER: 'Other government photo ID',
};

/** Card brands as Stripe reports them, plus what a cardholder can pick when no card was charged online. */
export const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover', 'jcb', 'unionpay', 'diners', 'other'] as const;
const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  diners: 'Diners Club',
  other: 'Other card',
  unknown: 'Card',
};
export const cardBrandLabel = (brand: string | null | undefined) => (brand ? (BRAND_LABEL[brand.toLowerCase()] ?? brand) : 'Card');

/** ISO 3166-1 alpha-2 codes for the country pickers (names come from Intl.DisplayNames). */
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH ' +
  'KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM ' +
  'PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ ' +
  'UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'
).split(' ');

let regionNames: Intl.DisplayNames | null | undefined;
/** "US" → "United States"; the code itself when the runtime has no region names. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "Ana Ruiz, Leo Ruiz" (or one per line) → ["Ana Ruiz", "Leo Ruiz"]: trimmed, duplicates dropped, at most 10. */
export function splitNames(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,;\n]/)) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.slice(0, 10);
}

/** "Ana Ruiz", "Ana Ruiz and Leo Ruiz", "Ana Ruiz, Leo Ruiz and Mia Ruiz". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface AuthorizationTextInput {
  hotelName: string;
  bookingCode: string;
  guestNames: readonly string[];
  /** Calendar days, YYYY-MM-DD. */
  checkIn: string;
  checkOut: string;
  amount: number;
  currency: string;
  coversIncidentals: boolean;
  incidentalsLimit: number | null;
  /** The card that paid online, if any (brand as Stripe reports it). */
  paidCard: { brand: string | null } | null;
}

/**
 * The authorization the cardholder signs. It names the guests, the stay, the
 * amount and what else may be charged, and never the cardholder's own details
 * (those are recorded beside it), so it is fixed before they start typing.
 * Draft wording: have it reviewed for your markets, like the cancellation policy.
 */
export function cardAuthorizationText(i: AuthorizationTextInput): string {
  const guests = joinNames(i.guestNames);
  const stay = `${i.checkIn} to ${i.checkOut}`;
  const card = i.paidCard ? `the ${cardBrandLabel(i.paidCard.brand)} card used to pay for this reservation` : 'the card whose details I entered on this form';
  const covers = i.coversIncidentals
    ? `room charges and taxes of ${money(i.amount, { currency: i.currency })}, plus incidental charges the guests make during the stay${i.incidentalsLimit != null ? ` of up to ${money(i.incidentalsLimit, { currency: i.currency })}` : ''} (for example food and drink, parking or damage)`
    : `room charges and taxes of ${money(i.amount, { currency: i.currency })}`;
  return [
    `I am the holder of ${card}, and I authorize ${i.hotelName} to charge it for the stay of ${guests} (reservation ${i.bookingCode}, ${stay}): ${covers}.`,
    ...(i.paidCard ? ['Any amount already charged to this card for the reservation is part of this total, not in addition to it.'] : []),
    `I understand that ${i.guestNames.length > 1 ? 'these guests' : 'this guest'}, not me, will be staying, and that I am responsible for the charges above.`,
    'If I have a question about a charge, I will contact the hotel first.',
    'This authorization lasts until the guests check out and the charges for the stay are settled. The hotel keeps this form, my photo ID and my signature as a record of it.',
    'I agree to sign electronically, and my electronic signature has the same effect as my handwritten one.',
  ].join(' ');
}

export type CheckKey = 'CARD_DIGITS' | 'NAME_ON_CARD' | 'NAME_EXPECTED' | 'BILLING_COUNTRY' | 'BILLING_EMAIL';
export type CheckResult = 'MATCH' | 'MISMATCH' | 'UNVERIFIED';

export interface CardAuthCheck {
  key: CheckKey;
  result: CheckResult;
  label: string;
  detail: string;
}

export interface CheckInput {
  /** What staff asked for, and the card that paid online if there is one. */
  expected: { cardholderName: string; cardBrand: string | null; cardLast4: string | null };
  /** What Stripe reported about the online payment. */
  payment: { cardholderName: string | null; billingCountry: string | null; billingEmail: string | null } | null;
  /** What the cardholder entered. */
  signed: { name: string; email: string; cardBrand: string | null; cardLast4: string; billingCountry: string };
}

export const digits4 = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-4);

/** True when the cardholder's last four digits are the card that paid (or no card was charged online). */
export function cardDigitsMatch(expectedLast4: string | null | undefined, entered: string): boolean {
  return !expectedLast4 || digits4(expectedLast4) === digits4(entered);
}

/**
 * How the cardholder's details compare with the card and with whom staff
 * expected. A mismatch is a reason for staff to look closer, not a verdict;
 * the ID photo is checked by a person.
 */
export function evaluateChecks(i: CheckInput): CardAuthCheck[] {
  const checks: CardAuthCheck[] = [];
  const brand = cardBrandLabel(i.expected.cardBrand ?? i.signed.cardBrand);
  if (i.expected.cardLast4) {
    const ok = cardDigitsMatch(i.expected.cardLast4, i.signed.cardLast4);
    checks.push({
      key: 'CARD_DIGITS',
      result: ok ? 'MATCH' : 'MISMATCH',
      label: 'Card digits',
      detail: ok ? `The last four digits match the ${brand} ending ${i.expected.cardLast4} that paid.` : `They entered ${digits4(i.signed.cardLast4)}, but the ${brand} that paid ends ${i.expected.cardLast4}.`,
    });
  } else {
    checks.push({
      key: 'CARD_DIGITS',
      result: 'UNVERIFIED',
      label: 'Card digits',
      detail: `No card was charged online yet. When you charge it, check the ${brand} ends in ${digits4(i.signed.cardLast4)}.`,
    });
  }

  if (i.payment?.cardholderName) {
    const ok = namesMatch(i.signed.name, i.payment.cardholderName);
    checks.push({
      key: 'NAME_ON_CARD',
      result: ok ? 'MATCH' : 'MISMATCH',
      label: 'Name on the card',
      detail: ok ? `Matches the cardholder Stripe reported (${i.payment.cardholderName}).` : `The card is in the name of ${i.payment.cardholderName}.`,
    });
  }

  const expectedOk = namesMatch(i.signed.name, i.expected.cardholderName);
  checks.push({
    key: 'NAME_EXPECTED',
    result: expectedOk ? 'MATCH' : 'MISMATCH',
    label: 'Who you asked',
    detail: expectedOk ? `Signed by ${i.expected.cardholderName}, as requested.` : `You asked ${i.expected.cardholderName}; it was signed as ${i.signed.name}.`,
  });

  const paidCountry = normalizeCountry(i.payment?.billingCountry);
  if (paidCountry) {
    const entered = normalizeCountry(i.signed.billingCountry);
    const ok = entered === paidCountry;
    checks.push({
      key: 'BILLING_COUNTRY',
      result: ok ? 'MATCH' : 'MISMATCH',
      label: 'Billing country',
      detail: ok ? `Same as the card’s billing address (${paidCountry}).` : `They entered ${entered ?? 'another country'}; the card’s billing address is in ${paidCountry}.`,
    });
  }

  const paidEmail = i.payment?.billingEmail?.trim().toLowerCase();
  if (paidEmail) {
    const ok = paidEmail === i.signed.email.trim().toLowerCase();
    checks.push({
      key: 'BILLING_EMAIL',
      result: ok ? 'MATCH' : 'MISMATCH',
      label: 'Email',
      detail: ok ? 'Same email as the online payment.' : `The online payment used ${i.payment!.billingEmail}.`,
    });
  }
  return checks;
}

/** MATCH when nothing disagrees (unverified items are reminders), otherwise REVIEW. */
export function checksOutcome(checks: readonly CardAuthCheck[]): 'MATCH' | 'REVIEW' {
  return checks.some((c) => c.result === 'MISMATCH') ? 'REVIEW' : 'MATCH';
}

const signatureForm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** A typed signature must be the signer's full name, as they entered it. */
export function typedSignatureMatches(typed: string, fullName: string): boolean {
  const t = signatureForm(typed);
  return t.length > 1 && t === signatureForm(fullName);
}
