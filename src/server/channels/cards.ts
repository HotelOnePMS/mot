/**
 * Cards that arrive with OTA reservations: Booking.com and Expedia virtual
 * cards (VCCs) the OTA pays the hotel with, or the guest's own card on a
 * hotel-collect booking. Pure functions, no imports, so the parsers and the
 * unit tests share them.
 *
 * HotelOne never keeps a card number or security code: the reservation's raw
 * payload is stored with them removed (`redactCardData`), and only what the
 * desk needs to find and charge the card is kept (`extractPaymentCard`):
 * brand, last four, expiry, and for a virtual card the date it can be charged
 * from and its balance. Staff charge it by typing the number from the OTA's
 * extranet into Stripe's payment page, so the card goes straight to Stripe.
 */

export interface OtaPaymentCard {
  /** VIRTUAL: the OTA's virtual card (it pays the hotel). GUEST: the guest's own card (hotel collect). */
  type: 'VIRTUAL' | 'GUEST';
  brand: string | null;
  last4: string | null;
  /** MM/YY as printed on the card. */
  expiry: string | null;
  holderName: string | null;
  /** Virtual cards: the first day the card can be charged (YYYY-MM-DD). */
  chargeableFrom: string | null;
  /** Virtual cards: the last day the card can be charged (YYYY-MM-DD). */
  chargeableUntil: string | null;
  /** Virtual cards: what can be charged on the card, in `currency`. */
  balance: number | null;
  currency: string | null;
}

const BRANDS: Record<string, string> = {
  VI: 'Visa',
  MC: 'Mastercard',
  CA: 'Mastercard',
  AX: 'American Express',
  DS: 'Discover',
  DC: 'Diners Club',
  JC: 'JCB',
  CU: 'UnionPay',
};

/** Attribute names (fast-xml-parser prefix and case removed) that hold a card number or a security code. */
const NUMBER_KEYS = new Set(['cardnumber', 'pan', 'accountnumber']);
const SECRET_KEYS = new Set(['seriescode', 'cvc', 'cvv', 'cvv2', 'cardsecuritycode', 'securitycode', 'cardcvc', 'cardcvv', 'token']);

const keyName = (k: string) => k.replace(/^@_/, '').toLowerCase();

function textOf(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if ('#text' in o) return String(o['#text']);
    // <CardNumber><PlainText>…</PlainText></CardNumber> and similar wrappers.
    for (const v of Object.values(o)) {
      const t = textOf(v);
      if (t) return t;
    }
  }
  return '';
}

/** "•••• 1234" for a card number (all zeros, Booking.com's "couldn't retrieve", gives null). */
function lastFour(value: unknown): string | null {
  const digits = textOf(value).replace(/\D/g, '');
  if (digits.length < 4 || /^0+$/.test(digits)) return null;
  return digits.slice(-4);
}

/**
 * A deep copy of an OTA payload with every card number replaced by its last
 * four digits and every security code removed. Safe to store and log.
 */
export function redactCardData<T>(raw: T): T {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const name = keyName(k);
      if (SECRET_KEYS.has(name)) continue;
      if (NUMBER_KEYS.has(name)) {
        const last4 = lastFour(v);
        out[k] = last4 ? `•••• ${last4}` : '••••';
        continue;
      }
      out[k] = walk(v);
    }
    return out;
  };
  return walk(raw) as T;
}

function attrCI(node: Record<string, unknown>, ...names: string[]): string | null {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@_') && wanted.has(keyName(k)) && v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  // Some feeds send these as child elements instead of attributes.
  for (const [k, v] of Object.entries(node)) {
    if (!k.startsWith('@_') && wanted.has(k.toLowerCase())) {
      const t = textOf(v).trim();
      if (t) return t;
    }
  }
  return null;
}

function findPaymentCards(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const n of node) findPaymentCards(n, found);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.toLowerCase() === 'paymentcard') {
        for (const card of Array.isArray(v) ? v : [v]) if (card && typeof card === 'object') found.push(card as Record<string, unknown>);
      } else {
        findPaymentCards(v, found);
      }
    }
  }
  return found;
}

/** "1227" or "12/27" or "2027-12" → "12/27". */
function expiryOf(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  let m = v.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[2]}/${m[1].slice(2)}`;
  m = v.replace(/\D/g, '').match(/^(\d{2})(\d{2})$/);
  if (m && m[1] !== '00') return `${m[1]}/${m[2]}`;
  return null;
}

function dateOf(value: string | null): string | null {
  const m = value?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * The card on an OTA reservation, without its number. `ratePlanId` helps spot
 * Booking.com virtual cards (rate plan codes ending in "VCC").
 */
export function extractPaymentCard(raw: unknown, opts: { channel: 'BOOKING_COM' | 'EXPEDIA' | string; ratePlanId?: string | null }): OtaPaymentCard | null {
  const card = findPaymentCards(raw)[0];
  if (!card) return null;
  const holder = attrCI(card, 'CardHolderName', 'name') ?? (card.CardHolder && typeof card.CardHolder === 'object' ? attrCI(card.CardHolder as Record<string, unknown>, 'name') : null);
  const holderName = holder && holder !== '-' ? holder : null;
  const code = attrCI(card, 'CardCode', 'CardType')?.toUpperCase() ?? null;
  const numberKey = Object.keys(card).find((k) => NUMBER_KEYS.has(keyName(k)));
  const last4 = numberKey ? lastFour(card[numberKey]) : null;
  const effective = dateOf(attrCI(card, 'EffectiveDate', 'ActivationDate'));
  const until = dateOf(attrCI(card, 'VCCExpirationDate', 'DeactivationDate'));
  const balanceRaw = attrCI(card, 'CurrentBalance', 'Balance', 'Amount');
  const decimals = Number(attrCI(card, 'DecimalPlaces') ?? 'NaN');
  let balance: number | null = null;
  if (balanceRaw !== null && Number.isFinite(Number(balanceRaw))) {
    // Booking.com sends minor units with DecimalPlaces (10599 + 2 = 105.99); others send a decimal amount.
    balance = Number.isInteger(decimals) && decimals >= 0 && /^\d+$/.test(balanceRaw) ? Number(balanceRaw) / 10 ** decimals : Number(balanceRaw);
  }
  const flagged = ['isvcc', 'isvirtual', 'virtualcard', 'vcc'].some((n) => /^(true|1|yes)$/i.test(attrCI(card, n) ?? ''));
  const virtual =
    flagged ||
    !!(effective || until || balance !== null) ||
    /VCC$/i.test(opts.ratePlanId ?? '') ||
    // Expedia Collect bookings carry Expedia's virtual card (EVC), issued in Expedia's name.
    (opts.channel === 'EXPEDIA' && /expedia|virtual/i.test(holderName ?? ''));
  return {
    type: virtual ? 'VIRTUAL' : 'GUEST',
    brand: code ? (BRANDS[code] ?? code) : null,
    last4,
    expiry: expiryOf(attrCI(card, 'ExpireDate', 'ExpiryDate', 'Expiration')),
    holderName,
    chargeableFrom: virtual ? effective : null,
    chargeableUntil: virtual ? until : null,
    balance: virtual && balance !== null ? Math.round(balance * 100) / 100 : null,
    currency: virtual ? (attrCI(card, 'CurrencyCode', 'Currency')?.toUpperCase() ?? null) : null,
  };
}

/** Whether a virtual card can be charged on `today` (YYYY-MM-DD), and if not, why. */
export function virtualCardWindow(card: Pick<OtaPaymentCard, 'type' | 'chargeableFrom' | 'chargeableUntil'>, today: string): { open: boolean; reason: string | null } {
  if (card.type !== 'VIRTUAL') return { open: true, reason: null };
  if (card.chargeableFrom && today < card.chargeableFrom) return { open: false, reason: `This virtual card can be charged from ${card.chargeableFrom}.` };
  if (card.chargeableUntil && today > card.chargeableUntil) return { open: false, reason: `This virtual card expired on ${card.chargeableUntil}. Ask the OTA for a new one.` };
  return { open: true, reason: null };
}
