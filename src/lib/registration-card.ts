/**
 * The guest registration card: what the guest reads and signs at check-in on
 * the desk's device. The server rebuilds this text from the database and
 * hashes it with the signature, so the same stay must always produce the same
 * words: no clock, no locale beyond money(), and free text is folded onto one
 * line so a stray newline can't change the paragraphs. Client-safe, no server
 * imports.
 *
 * It names the photo ID by type, country and last four characters only: never
 * the full ID number, the date of birth or staff notes.
 */
import { cardBrandLabel } from './card-authorization';
import { money } from './status';

/** Bump when the wording of {@link registrationCardText} changes: every signature records it. */
export const REGISTRATION_VERSION = '2026-10-v1';

export interface RegistrationCardInput {
  hotelName: string;
  /** One line, may be ''. */
  hotelAddress: string;
  bookingCode: string;
  guestName: string;
  /** One line, optional. */
  guestAddress: string | null;
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD */
  checkOut: string;
  nights: number;
  guests: number;
  roomNumber: string;
  roomTypeName: string;
  currency: string;
  /** Room and taxes for the stay. */
  stayTotal: number;
  /** Paid so far (online and at the desk), positive. */
  paid: number;
  /** Signed: positive = still to pay, negative = credit. */
  balance: number;
  /**
   * The security deposit held for the stay: a hold on a card (released at check-out), a charge to a card
   * (refunded at check-out), cash, or recorded another way.
   */
  deposit: { kind: 'CARD_HOLD' | 'CARD_CHARGE' | 'CASH' | 'OTHER'; amount: number; cardBrand: string | null; cardLast4: string | null } | null;
  /** Never the full ID number. country is a display name or null. */
  id: { typeLabel: string; country: string | null; last4: string };
  /** As guests are told elsewhere, e.g. 'by 11:00 AM'. */
  checkOutTime: string;
}

/** Collapses whitespace (newlines included) so free text stays on one line. */
const line = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Visa", or "card" when the brand is unknown. */
function brandName(brand: string | null): string {
  const b = line(brand);
  return !b || /^(other|unknown)$/i.test(b) ? 'card' : cardBrandLabel(b);
}

/** " ending 4242", or nothing without digits. Only ever the last four. */
function cardEnding(last4: string | null): string {
  const d = (last4 ?? '').replace(/\D/g, '').slice(-4);
  return d ? ` ending ${d}` : '';
}

function depositSentence(d: RegistrationCardInput['deposit'], currency: string): string {
  if (!d) return 'No security deposit was taken.';
  const amount = money(d.amount, { currency });
  if (d.kind === 'CASH') return `Security deposit: ${amount} in cash, returned at check-out less any charges.`;
  if (d.kind === 'OTHER') return `Security deposit: ${amount}, returned at check-out less any charges.`;
  const card = `${brandName(d.cardBrand)}${cardEnding(d.cardLast4)}`;
  if (d.kind === 'CARD_HOLD') return `Security deposit: a hold of ${amount} on ${card}. It is released after check-out, less any charges.`;
  return `Security deposit: ${amount} charged to ${card}, refunded after check-out less any charges.`;
}

function balanceSentence(balance: number, currency: string): string {
  // Settled when it rounds to nothing in this currency, so 0.001 never reads as "$0.00 to pay".
  const abs = money(Math.abs(balance), { currency });
  const settled = abs === money(0, { currency });
  if (!settled && balance > 0) return `Balance to pay: ${abs}.`;
  if (!settled && balance < 0) return `Credit of ${abs}.`;
  return 'Nothing left to pay for the room.';
}

/**
 * The registration card wording: paragraphs separated by a blank line ("\n\n").
 * The first paragraph is two lines: the title, then the reservation.
 * Draft wording: have it reviewed for your markets, like the cancellation policy.
 */
export function registrationCardText(i: RegistrationCardInput): string {
  const currency = i.currency;
  const hotelAddress = line(i.hotelAddress);
  const guestAddress = line(i.guestAddress);
  const country = line(i.id.country);
  // Last four characters at most, even if a caller passes more by mistake.
  const idLast4 = (i.id.last4 ?? '').replace(/\s/g, '').slice(-4);

  const heading = `Guest registration · ${line(i.hotelName)}${hotelAddress ? `, ${hotelAddress}` : ''}\nReservation ${line(i.bookingCode)}.`;

  const guest =
    `${line(i.guestName)}${guestAddress ? `, ${guestAddress}` : ''}. ` +
    `Photo ID: ${line(i.id.typeLabel)}${country ? ` issued in ${country}` : ''}, number ending ${idLast4}.`;

  const stay = [
    `${line(i.checkIn)} to ${line(i.checkOut)} (${plural(i.nights, 'night', 'nights')}), room ${line(i.roomNumber)} (${line(i.roomTypeName)}), ${plural(i.guests, 'guest', 'guests')}.`,
    `Room and taxes: ${money(i.stayTotal, { currency })}. Paid so far: ${money(i.paid, { currency })}.`,
    balanceSentence(i.balance, currency),
  ].join(' ');

  const agreement = [
    `I agree to check out ${line(i.checkOutTime)}, unless the hotel agrees otherwise.`,
    'I will pay for the stay and for any charges I or my guests make during it, such as food and drink, parking, damage beyond normal wear, or cleaning after smoking, which may be taken from the deposit or charged to my card.',
    'I will keep to the room’s maximum number of guests.',
    'The hotel is not responsible for valuables left in the room, except as the law requires.',
  ].join(' ');

  return [
    heading,
    guest,
    stay,
    depositSentence(i.deposit, currency),
    agreement,
    'The information above is correct. I agree to sign electronically, and my electronic signature has the same effect as my handwritten one.',
  ].join('\n\n');
}
