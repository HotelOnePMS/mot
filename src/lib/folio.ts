/**
 * The folio: a booking's running account of what the guest owes and what they
 * have paid. The room and its taxes are derived from the booking every time
 * (never stored), so a changed stay can't leave a stale room line behind;
 * payments (online, and at the desk: card reader, typed or virtual card, cash,
 * recorded another way) and their refunds are passed in. This file holds the
 * rules both sides share: the derived lines and the totals. Client-safe, no
 * server imports.
 *
 * Amounts are in the hotel's currency and summed in its minor unit, so the
 * lines always add up to the cent (or yen, or fils).
 */
import { currencyDigits, toMinorUnits } from './currency';

/** One line of the folio as staff and the guest see it. */
export interface FolioLine {
  /** Stable React key. */
  key: string;
  section: 'CHARGES' | 'PAYMENTS';
  kind: 'ROOM' | 'TAX' | 'PAYMENT' | 'REFUND';
  label: string;
  detail: string | null;
  /** Signed effect on the balance: charges and refunds to the guest positive, payments negative. */
  amount: number;
  /** ISO timestamp, payment lines only. */
  at: string | null;
}

const TAXES_AND_FEES = 'Taxes and fees';

/** Minor units back to an amount, never -0. */
const fromMinor = (minor: number, currency: string): number => (minor === 0 ? 0 : minor / 10 ** currencyDigits(currency));

const sumMinor = (taxes: readonly { minor: number }[]): number => taxes.reduce((s, t) => s + t.minor, 0);

/** The positive taxes and fees in Booking.charges, in minor units; whatever isn't one of them is skipped. */
function parseCharges(charges: unknown, currency: string): { name: string; minor: number }[] {
  if (!Array.isArray(charges)) return [];
  const out: { name: string; minor: number }[] = [];
  for (const c of charges) {
    if (!c || typeof c !== 'object') continue;
    const { name, amount } = c as { name?: unknown; amount?: unknown };
    if (typeof amount !== 'number' || !Number.isFinite(amount)) continue;
    const minor = toMinorUnits(amount, currency);
    if (minor <= 0) continue;
    out.push({ name: typeof name === 'string' && name.trim() ? name.trim() : TAXES_AND_FEES, minor });
  }
  return out;
}

/**
 * The stay's derived lines: one ROOM line plus one TAX line per tax/fee in `charges` (Booking.charges JSON: an array of { name: string; kind?: string; rate?: number; amount: number }, may be null or malformed).
 * They add up EXACTLY to totalPrice in the currency's minor unit: the room line absorbs any difference (OTA and legacy bookings whose charges JSON doesn't match total − subtotal).
 * If charges is missing/invalid/empty but subtotalPrice is set and below totalPrice, emit one TAX line 'Taxes and fees' = total − subtotal. Otherwise only the ROOM line = total.
 * Room line: label = roomTypeName, detail = '3 nights' / '1 night', plus ' × 2 rooms' when rooms > 1. Tax lines: label = charge name, detail null. Skip zero/negative tax amounts. keys 'room', 'tax-0', 'tax-1'…
 *
 * Taxes in the JSON that come to more than the whole stay are ignored as wrong, so the room line is never negative.
 */
export function stayLines(input: {
  totalPrice: number;
  subtotalPrice: number | null;
  charges: unknown;
  roomTypeName: string;
  nights: number;
  rooms: number;
  currency: string;
}): FolioLine[] {
  const { currency } = input;
  const total = toMinorUnits(input.totalPrice, currency) || 0;
  let taxes = parseCharges(input.charges, currency);
  if (sumMinor(taxes) > total) taxes = [];
  if (!taxes.length && input.subtotalPrice != null) {
    const subtotal = toMinorUnits(input.subtotalPrice, currency);
    if (subtotal >= 0 && subtotal < total) taxes = [{ name: TAXES_AND_FEES, minor: total - subtotal }];
  }
  const nights = `${input.nights} ${input.nights === 1 ? 'night' : 'nights'}`;
  const rooms = input.rooms > 1 ? ` × ${input.rooms} rooms` : '';
  const derived = { section: 'CHARGES', at: null } as const;
  return [
    { ...derived, key: 'room', kind: 'ROOM', label: input.roomTypeName, detail: nights + rooms, amount: fromMinor(total - sumMinor(taxes), currency) },
    ...taxes.map((t, i): FolioLine => ({ ...derived, key: `tax-${i}`, kind: 'TAX', label: t.name, detail: null, amount: fromMinor(t.minor, currency) })),
  ];
}

export interface FolioTotals {
  charges: number;
  paid: number;
  refunded: number;
  balance: number;
}

/** A security deposit on the folio: listed apart, never part of the balance. */
export interface FolioDeposit {
  id: string;
  method: string;
  methodLabel: string;
  /** HELD (on a card hold or charged/cash, not returned yet), SETTLED (returned, or kept for incidentals), RELEASED. */
  state: 'HELD' | 'SETTLED' | 'RELEASED';
  /** A hold on the card rather than money taken. */
  hold: boolean;
  amount: number;
  /** Kept for incidentals when it was settled. */
  kept: number;
  card: string | null;
  at: string;
  settledAt: string | null;
}

/** Everything on a booking's folio, as the server sends it (server/services/folio.ts). */
export interface FolioView {
  bookingId: string;
  code: string;
  currency: string;
  status: string;
  lines: FolioLine[];
  totals: FolioTotals;
  deposits: FolioDeposit[];
  /** Security deposit still held for the stay (not part of the balance). */
  depositHeld: number;
  /** Set when one set of payments covers several room types (this folio shows this room type's share). */
  reservation: { code: string; roomTypes: number } | null;
  /** Nothing left to pay: the guest can check out. */
  settled: boolean;
}

/** Sums lines in the currency's precision: charges = ROOM+TAX, paid = PAYMENT (positive), refunded = REFUND (positive), balance = sum of signed amounts (negative = the hotel owes the guest). */
export function folioTotals(lines: readonly FolioLine[], currency: string): FolioTotals {
  let charges = 0;
  let paid = 0;
  let refunded = 0;
  let balance = 0;
  for (const line of lines) {
    const minor = toMinorUnits(line.amount, currency);
    balance += minor;
    if (line.kind === 'ROOM' || line.kind === 'TAX') charges += minor;
    else if (line.kind === 'PAYMENT') paid -= minor;
    else refunded += minor;
  }
  return { charges: fromMinor(charges, currency), paid: fromMinor(paid, currency), refunded: fromMinor(refunded, currency), balance: fromMinor(balance, currency) };
}
