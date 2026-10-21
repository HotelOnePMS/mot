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
