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
import type { SavedChargeView } from './saved-charges';

/** One line of the folio as staff and the guest see it. */
export interface FolioLine {
  /** Stable React key. */
  key: string;
  section: 'CHARGES' | 'PAYMENTS';
  /** ALLOWANCE: lowers the charges (a manager's, with a reason). CHARGE: an extra charge added on the folio (minibar, parking). */
  kind: 'ROOM' | 'TAX' | 'CHARGE' | 'ALLOWANCE' | 'PAYMENT' | 'REFUND';
  label: string;
  detail: string | null;
  /** Signed effect on the balance: charges and refunds to the guest positive, payments negative. */
  amount: number;
  /** ISO timestamp (or date, for extra charges): payment, allowance and extra charge lines only. */
  at: string | null;
  /** Which thing the line shows, for editing it (FolioView.edits): room, charge:<n>, allowance:<id>, payment:<id>. */
  ref?: string;
}

const TAXES_AND_FEES = 'Taxes and fees';
/** Booking.charges entries of this kind are extra charges added on the folio, not the hotel's taxes and fees. */
export const MANUAL_CHARGE = 'MANUAL';

/** Minor units back to an amount, never -0. */
const fromMinor = (minor: number, currency: string): number => (minor === 0 ? 0 : minor / 10 ** currencyDigits(currency));

const sumMinor = (taxes: readonly { minor: number }[]): number => taxes.reduce((s, t) => s + t.minor, 0);

/** A tax, fee or extra charge of the stay, as Booking.charges keeps it (amount in minor units here). */
export interface StayCharge {
  name: string;
  minor: number;
  /** PropertyCharge kind for taxes and fees, MANUAL for an extra charge, null when unknown. */
  kind: string | null;
  rate: number | null;
  /** Extra charges: the day it was for (YYYY-MM-DD). */
  date: string | null;
}

/** The positive taxes and fees in Booking.charges, in minor units; whatever isn't one of them is skipped. */
function parseCharges(charges: unknown, currency: string): StayCharge[] {
  if (!Array.isArray(charges)) return [];
  const out: StayCharge[] = [];
  for (const c of charges) {
    if (!c || typeof c !== 'object') continue;
    const { name, amount, kind, rate, date } = c as { name?: unknown; amount?: unknown; kind?: unknown; rate?: unknown; date?: unknown };
    if (typeof amount !== 'number' || !Number.isFinite(amount)) continue;
    const minor = toMinorUnits(amount, currency);
    if (minor <= 0) continue;
    out.push({
      name: typeof name === 'string' && name.trim() ? name.trim() : TAXES_AND_FEES,
      minor,
      kind: typeof kind === 'string' ? kind : null,
      rate: typeof rate === 'number' && Number.isFinite(rate) ? rate : null,
      date: typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    });
  }
  return out;
}

export interface StayInput {
  totalPrice: number;
  subtotalPrice: number | null;
  charges: unknown;
  roomTypeName: string;
  /** The room line's description when someone changed it on the folio (Booking.folioRoomLabel). */
  roomLabel?: string | null;
  nights: number;
  rooms: number;
  currency: string;
}

/**
 * What the stay's charges are made of: the room (minor units) and its taxes, fees and extra charges, as the folio shows
 * them. They add up EXACTLY to totalPrice: the room absorbs any difference. Editing the folio changes this and writes
 * it back to the booking (subtotal = room, total = room + charges), so every balance, report and check-out rule keeps
 * reading the booking's total.
 */
export function stayModel(input: StayInput): { roomLabel: string; roomMinor: number; charges: StayCharge[] } {
  const { currency } = input;
  const total = toMinorUnits(input.totalPrice, currency) || 0;
  let taxes = parseCharges(input.charges, currency);
  if (sumMinor(taxes) > total) taxes = [];
  if (!taxes.length && input.subtotalPrice != null) {
    const subtotal = toMinorUnits(input.subtotalPrice, currency);
    if (subtotal >= 0 && subtotal < total) taxes = [{ name: TAXES_AND_FEES, minor: total - subtotal, kind: null, rate: null, date: null }];
  }
  const roomLabel = input.roomLabel?.trim() || input.roomTypeName;
  return { roomLabel, roomMinor: total - sumMinor(taxes), charges: taxes };
}

/**
 * The stay's derived lines: one ROOM line plus one TAX line per tax/fee in `charges` (Booking.charges JSON: an array of { name: string; kind?: string; rate?: number; amount: number }, may be null or malformed).
 * They add up EXACTLY to totalPrice in the currency's minor unit: the room line absorbs any difference (OTA and legacy bookings whose charges JSON doesn't match total − subtotal).
 * If charges is missing/invalid/empty but subtotalPrice is set and below totalPrice, emit one TAX line 'Taxes and fees' = total − subtotal. Otherwise only the ROOM line = total.
 * Room line: label = roomTypeName (or the edited roomLabel), detail = '3 nights' / '1 night', plus ' × 2 rooms' when rooms > 1. Tax lines: label = charge name, detail null. Skip zero/negative tax amounts. keys 'room', 'tax-0', 'tax-1'…
 * Extra charges added on the folio (kind MANUAL) are CHARGE lines dated by their day.
 *
 * Taxes in the JSON that come to more than the whole stay are ignored as wrong, so the room line is never negative.
 */
export function stayLines(input: StayInput): FolioLine[] {
  const { currency } = input;
  const model = stayModel(input);
  const nights = `${input.nights} ${input.nights === 1 ? 'night' : 'nights'}`;
  const rooms = input.rooms > 1 ? ` × ${input.rooms} rooms` : '';
  const derived = { section: 'CHARGES', at: null } as const;
  return [
    { ...derived, key: 'room', kind: 'ROOM', label: model.roomLabel, detail: nights + rooms, amount: fromMinor(model.roomMinor, currency), ref: 'room' },
    ...model.charges.map(
      (t, i): FolioLine =>
        t.kind === MANUAL_CHARGE
          ? { ...derived, key: `tax-${i}`, kind: 'CHARGE', label: t.name, detail: null, amount: fromMinor(t.minor, currency), at: t.date, ref: `charge:${i}` }
          : { ...derived, key: `tax-${i}`, kind: 'TAX', label: t.name, detail: null, amount: fromMinor(t.minor, currency), ref: `charge:${i}` }
    ),
  ];
}

/** Booking.charges JSON for these charges (amounts back from minor units). */
export function chargesJson(charges: readonly StayCharge[], currency: string): { name: string; kind?: string; rate?: number; amount: number; date?: string }[] {
  return charges.map((c) => ({
    name: c.name,
    ...(c.kind ? { kind: c.kind } : {}),
    ...(c.rate !== null ? { rate: c.rate } : {}),
    amount: fromMinor(c.minor, currency),
    ...(c.date ? { date: c.date } : {}),
  }));
}

export interface FolioTotals {
  /** Room, taxes and fees, before allowances. */
  charges: number;
  /** Allowances, positive: what the charges were lowered by. */
  allowances: number;
  paid: number;
  refunded: number;
  balance: number;
}

/** An allowance on the folio, for staff who can remove it. */
export interface FolioAllowance {
  id: string;
  amount: number;
  reason: string;
  by: string | null;
  at: string;
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

/** Methods a payment can be recorded as (no money moved through HotelOne), so the owner can change it on the folio. */
export const RECORDED_PAYMENT_METHODS = ['CASH', 'EXTERNAL_CARD', 'OTHER'] as const;

/** What can be changed about one thing on the folio, with its values now (FolioView.edits, keyed by FolioLine.ref). */
export type FolioEditTarget =
  | { type: 'room'; label: string; defaultLabel: string; amount: number }
  /** percent: the rate when the charge is a percentage of the room (it moves with the room when a total is split). */
  | { type: 'charge'; index: number; name: string; amount: number; date: string | null; extra: boolean; percent: number | null }
  | { type: 'allowance'; id: string; amount: number; reason: string; max: number }
  | {
      type: 'payment';
      id: string;
      deposit: boolean;
      /** Recorded at the desk (cash, the hotel's own terminal, another way): amount, refunds, method and date can change. Card payments through Stripe: only the note. */
      recorded: boolean;
      amount: number;
      amountRefunded: number;
      method: string;
      paidAt: string | null;
      note: string | null;
    };

/** A change to the folio (PATCH /api/admin/bookings/:id/folio). `expected` is the line as the editor saw it: changed since, it's refused. */
export type FolioEdit = { reason?: string } & (
  | { target: 'room'; label?: string | null; amount?: number; expected: { label: string; amount: number } }
  /**
   * Several lines together come to `amount` ("room and tax together $50"): refs are FolioLine.ref values (room,
   * charge:<n>), expected what each showed. The room and percentage taxes share what's left after fixed fees (splitTotal).
   */
  | { target: 'setTotal'; refs: string[]; amount: number; expected: Record<string, number> }
  | { target: 'charge'; index: number; name?: string; amount?: number; date?: string | null; expected: { name: string; amount: number } }
  | { target: 'addCharge'; name: string; amount: number; date?: string | null }
  | { target: 'removeCharge'; index: number; expected: { name: string; amount: number } }
  | { target: 'allowance'; id: string; amount?: number; allowanceReason?: string }
  | { target: 'payment'; id: string; amount?: number; amountRefunded?: number; method?: string; paidAt?: string; note?: string | null }
  | { target: 'removePayment'; id: string }
);

/** Everything on a booking's folio, as the server sends it (server/services/folio.ts). */
export interface FolioView {
  bookingId: string;
  propertyId: string;
  code: string;
  currency: string;
  status: string;
  lines: FolioLine[];
  totals: FolioTotals;
  deposits: FolioDeposit[];
  /** Security deposit still held for the stay (not part of the balance). */
  depositHeld: number;
  /**
   * Set when one set of payments covers several room types (this folio shows this room type's share). balance: what the
   * whole reservation still owes (negative: owed back to the guest), its room types going ahead after their allowances,
   * less everything paid toward it.
   */
  reservation: { code: string; roomTypes: number; balance: number } | null;
  /**
   * What must be paid before check-out (BookingSummary.checkOutDue). For a room type of a shared reservation it's what
   * the whole reservation still owes, which can differ from this folio's balance (its share of the payments).
   */
  checkOutDue: number;
  /** Nothing left to pay: the guest can check out. */
  settled: boolean;
  /** The allowances lowering the charges (also among the lines), oldest first. */
  allowances: FolioAllowance[];
  /** At most this much more can be allowed: the charges less the allowances already given. */
  maxAllowance: number;
  /** The viewer may change anything on this folio (folio.edit at this hotel, and the stay isn't cancelled or a no-show). */
  canEdit: boolean;
  /** When canEdit: what each line (by FolioLine.ref) and deposit (payment:<id>) holds now, for the edit dialog. */
  edits: Record<string, FolioEditTarget>;
  /** Checked out while money was still owed, with a manager's reason. */
  checkoutOverride: { amount: number; reason: string; by: string | null; at: string } | null;
  /** The stay's length, for charges priced per night. */
  nights: number;
  rooms: number;
  /** When canEdit: the hotel's usual extra charges ("Pet fee", $50 per stay) to pick from when adding one. */
  savedCharges: SavedChargeView[];
  /** When canEdit: the viewer can also change the hotel's usual charges (save a new one from the add dialog). */
  canSaveCharges: boolean;
}

/** One line in a total being split (splitTotal), in minor units. */
export interface SplitPart {
  ref: string;
  minor: number;
  /** Moves with the total: the room, and taxes that are a percentage of it. Fixed fees keep their amount. */
  scales: boolean;
}

/**
 * New amounts (minor units) for lines that must together come to `totalMinor` ("make the room and tax together
 * $50"). Fixed fees keep their amount and the room and percentage taxes share the rest in their current proportions,
 * so a 12% tax stays 12% of the room. When there is nothing that scales, or the fixed fees alone are more than the
 * total, every line is scaled. The room line (or the largest) takes the rounding, so the result adds up exactly.
 */
export function splitTotal(parts: readonly SplitPart[], totalMinor: number): Map<string, number> {
  if (!parts.length) throw new Error('splitTotal needs at least one line');
  const total = Math.max(0, Math.round(totalMinor));
  let fixed = parts.filter((p) => !p.scales);
  let scaling = parts.filter((p) => p.scales);
  let fixedSum = fixed.reduce((s, p) => s + p.minor, 0);
  if (!scaling.length || fixedSum > total) {
    scaling = [...parts];
    fixed = [];
    fixedSum = 0;
  }
  const out = new Map<string, number>(fixed.map((p) => [p.ref, p.minor]));
  const remaining = total - fixedSum;
  const weight = scaling.reduce((s, p) => s + Math.max(0, p.minor), 0);
  const anchor = scaling.find((p) => p.ref === 'room') ?? scaling.reduce((a, b) => (b.minor > a.minor ? b : a));
  let given = 0;
  for (const p of scaling) {
    if (p === anchor) continue;
    const share = weight > 0 ? Math.round((remaining * Math.max(0, p.minor)) / weight) : 0;
    out.set(p.ref, share);
    given += share;
  }
  let rest = remaining - given;
  // Every share rounded up past what was left: take the difference back from the largest.
  while (rest < 0) {
    const [ref, v] = [...out.entries()].filter(([r]) => scaling.some((p) => p.ref === r)).reduce((a, b) => (b[1] > a[1] ? b : a));
    const take = Math.min(v, -rest);
    out.set(ref, v - take);
    rest += take;
  }
  out.set(anchor.ref, rest);
  return out;
}

/** Sums lines in the currency's precision: charges = ROOM+TAX+CHARGE, paid = PAYMENT (positive), refunded = REFUND (positive), balance = sum of signed amounts (negative = the hotel owes the guest). */
export function folioTotals(lines: readonly FolioLine[], currency: string): FolioTotals {
  let charges = 0;
  let allowances = 0;
  let paid = 0;
  let refunded = 0;
  let balance = 0;
  for (const line of lines) {
    const minor = toMinorUnits(line.amount, currency);
    balance += minor;
    if (line.kind === 'ROOM' || line.kind === 'TAX' || line.kind === 'CHARGE') charges += minor;
    else if (line.kind === 'ALLOWANCE') allowances -= minor;
    else if (line.kind === 'PAYMENT') paid -= minor;
    else refunded += minor;
  }
  return {
    charges: fromMinor(charges, currency),
    allowances: fromMinor(allowances, currency),
    paid: fromMinor(paid, currency),
    refunded: fromMinor(refunded, currency),
    balance: fromMinor(balance, currency),
  };
}
