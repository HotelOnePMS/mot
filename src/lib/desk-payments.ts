/**
 * Front desk payments: what the desk collects at check-in and during the stay,
 * and how. Pure functions (no imports) so the dialogs, the API and the unit
 * tests use the same rules. Money is in integer cents.
 */

/**
 * How the desk took the money. ONLINE payments are the guest's own, made when booking. EXTERNAL_CARD and OTHER
 * record money taken outside HotelOne (the hotel's own card terminal; a bank transfer, the OTA, an invoice),
 * so the balance reflects it: check-out needs a zero balance.
 */
export type PaymentMethod = 'ONLINE' | 'TERMINAL' | 'CARD_ENTRY' | 'VIRTUAL_CARD' | 'CASH' | 'EXTERNAL_CARD' | 'OTHER';
export type DeskMethod = Exclude<PaymentMethod, 'ONLINE'>;
export const DESK_METHODS: readonly DeskMethod[] = ['TERMINAL', 'CARD_ENTRY', 'VIRTUAL_CARD', 'CASH', 'EXTERNAL_CARD', 'OTHER'];
/** Methods the desk only records (no money moves through HotelOne): handing back is recorded too. */
export const RECORDED_METHODS: readonly PaymentMethod[] = ['CASH', 'EXTERNAL_CARD', 'OTHER'];

/** PAYMENT goes toward the stay's balance; SECURITY_DEPOSIT is held against incidentals and returned at check-out. */
export type DeskKind = 'PAYMENT' | 'SECURITY_DEPOSIT';
export const DESK_KINDS: readonly DeskKind[] = ['PAYMENT', 'SECURITY_DEPOSIT'];

export type SecurityDepositMode = 'NONE' | 'HOLD' | 'CHARGE';
export const SECURITY_DEPOSIT_MODES: readonly SecurityDepositMode[] = ['NONE', 'HOLD', 'CHARGE'];
export const MAX_SECURITY_DEPOSIT = 10_000;

export const SECURITY_DEPOSIT_MODE_LABEL: Record<SecurityDepositMode, string> = {
  NONE: 'No deposit',
  HOLD: 'Hold on the card',
  CHARGE: 'Charge and refund',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  ONLINE: 'Paid online',
  TERMINAL: 'Card reader',
  CARD_ENTRY: 'Card typed in',
  VIRTUAL_CARD: 'OTA virtual card',
  CASH: 'Cash',
  EXTERNAL_CARD: 'Card on another terminal',
  OTHER: 'Paid another way',
};

export const KIND_LABEL: Record<string, string> = {
  FULL: 'Prepayment',
  DEPOSIT: 'Booking deposit',
  PAYMENT: 'Payment',
  SECURITY_DEPOSIT: 'Security deposit',
};

export interface DeskPaymentLike {
  kind: string;
  status: string;
  /** Security deposits: settled at check-out (returned, or kept for incidentals). */
  settled: boolean;
  amountCents: number;
  authorizedCents: number | null;
  refundedCents: number;
}

/**
 * The security deposit currently held for a stay, in cents: card holds still
 * authorized, plus charged deposits (card or cash) not yet returned.
 */
export function depositHeldCents(payments: readonly DeskPaymentLike[]): number {
  return payments
    .filter((p) => p.kind === 'SECURITY_DEPOSIT' && !p.settled)
    .reduce((sum, p) => {
      if (p.status === 'AUTHORIZED') return sum + (p.authorizedCents ?? p.amountCents);
      if (p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED') return sum + Math.max(0, p.amountCents - p.refundedCents);
      return sum;
    }, 0);
}

/** What is still to take as a security deposit at check-in, in cents (0 when the hotel takes none). */
export function depositDueCents(input: { mode: SecurityDepositMode; amountCents: number; payments: readonly DeskPaymentLike[] }): number {
  if (input.mode === 'NONE' || input.amountCents <= 0) return 0;
  // A deposit that was taken and then settled counts as taken: don't ask for it again.
  if (input.payments.some((p) => p.kind === 'SECURITY_DEPOSIT' && p.settled)) return 0;
  return Math.max(0, input.amountCents - depositHeldCents(input.payments));
}

/** Change to give back for a cash payment, in cents; null when the guest handed over too little. */
export function cashChangeCents(tenderedCents: number, amountCents: number): number | null {
  if (!Number.isFinite(tenderedCents) || tenderedCents < amountCents) return null;
  return tenderedCents - amountCents;
}

/**
 * Checks an amount the desk is about to collect. A payment can't be more than
 * the balance (typos at the desk are expensive); a deposit has a ceiling.
 * Returns the problem, or null.
 */
export function deskAmountProblem(input: { kind: DeskKind; amountCents: number; balanceCents: number; currency: string }): string | null {
  const { kind, amountCents, balanceCents, currency } = input;
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 'Enter an amount to collect.';
  if (kind === 'PAYMENT') {
    if (balanceCents <= 0) return 'Nothing is left to pay on this reservation.';
    if (amountCents > balanceCents) return `The balance is ${(balanceCents / 100).toFixed(2)} ${currency}. Collect at most that.`;
  } else if (amountCents > MAX_SECURITY_DEPOSIT * 100) {
    return `A security deposit can be at most ${MAX_SECURITY_DEPOSIT.toLocaleString('en-US')} ${currency}.`;
  }
  return null;
}

/**
 * Settling a security deposit at check-out: keep `keepCents` for incidentals
 * (minibar, damage) and return the rest. For a card hold that means capturing
 * `keepCents` (or releasing the hold when it is 0); for a charged deposit,
 * refunding the rest.
 */
export function depositSettlement(input: { status: string; amountCents: number; authorizedCents: number | null; refundedCents: number; keepCents: number }):
  | { action: 'capture'; captureCents: number }
  | { action: 'release' }
  | { action: 'refund'; refundCents: number }
  | { action: 'none' }
  | { error: string } {
  const keep = Math.round(input.keepCents);
  if (!Number.isFinite(keep) || keep < 0) return { error: 'Enter what to keep, or 0 to return the whole deposit.' };
  if (input.status === 'AUTHORIZED') {
    const held = input.authorizedCents ?? input.amountCents;
    if (keep > held) return { error: `Only ${(held / 100).toFixed(2)} is held on the card.` };
    return keep === 0 ? { action: 'release' } : { action: 'capture', captureCents: keep };
  }
  if (input.status === 'SUCCEEDED' || input.status === 'PARTIALLY_REFUNDED') {
    const left = Math.max(0, input.amountCents - input.refundedCents);
    if (keep > left) return { error: `Only ${(left / 100).toFixed(2)} of this deposit is left.` };
    const refund = left - keep;
    return refund > 0 ? { action: 'refund', refundCents: refund } : { action: 'none' };
  }
  return { error: 'This deposit has already been settled.' };
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

const CARD_PREFIX = /^(?:[3-6]|2[2-7])/;
const EXPIRY = /^(0[1-9]|1[0-2])\d\d$/;
/** 13 to 19 digits starting the way card numbers do (Visa, Mastercard, Amex, Discover, JCB, UnionPay...), passing Luhn. */
const isCardNumber = (d: string) => d.length >= 13 && d.length <= 19 && CARD_PREFIX.test(d) && luhn(d);
// Spaces, dashes of any kind, dots, slashes and underscores split digit groups.
const SEPARATORS = /[\s._/\u2010-\u2015-]+/;

/**
 * A full card number typed by mistake into a note or an approval code: whole or in the groups cards are printed in
 * (fours, or 4-6-5 for Amex, with a shorter last group), even next to other digits (an expiry, a reference) or typed
 * with full-width digits. Card numbers are never stored, so the desk refuses them.
 */
export function containsCardNumber(text: string | null | undefined): boolean {
  for (const piece of (text ?? '').normalize('NFKC').split(/[^\d\s._/\u2010-\u2015-]+/)) {
    const groups = piece.split(SEPARATORS).filter(Boolean);
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      // Unbroken, or stuck to its expiry (MMYY), as copied from a terminal slip.
      if (isCardNumber(g) || (g.length >= 17 && g.length <= 23 && EXPIRY.test(g.slice(-4)) && isCardNumber(g.slice(0, -4)))) return true;
      // Groups joined from this one on as cards are printed: groups of four or more, a shorter one only last after fours.
      let run = g;
      for (let j = i + 1; j < groups.length && groups[j - 1].length >= 4; j++) {
        const next = groups[j];
        // The expiry typed straight after the last group.
        if (next.length > 4 && EXPIRY.test(next.slice(-4)) && isCardNumber(run + next.slice(0, -4))) return true;
        if (next.length < 4 && !groups.slice(i, j).every((x) => x.length === 4)) break;
        if (run.length + next.length > 19) break;
        run += next;
        if (isCardNumber(run)) return true;
      }
    }
  }
  return false;
}

export const CARD_NUMBER_REFUSED = 'That looks like a full card number. Never type card numbers here: only the last four digits and the terminal’s approval code.';
