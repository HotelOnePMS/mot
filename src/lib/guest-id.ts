/**
 * Rules for the guest's photo ID at check-in, shared by the check-in screen
 * (which warns as staff type or scan) and the server (which enforces them).
 * A warning never blocks on its own: staff can accept an expired ID, a
 * different name or a minor, but must say why. Client-safe, no server imports.
 */
import { ageOn } from './id-scan';
import { namesMatch } from './risk';

/** Guests younger than this need a reason to check in (e.g. staying with a parent). */
export const MIN_GUEST_AGE = 18;

/** The last four letters or digits of an ID number, upper-cased: all that is shown or printed. */
export function idLast4Of(documentNumber: string): string {
  return documentNumber.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
}

export interface IdWarnings {
  nameMatched: boolean;
  expired: boolean;
  /** Younger than MIN_GUEST_AGE on the check-in day; null when no date of birth was given. */
  minor: boolean | null;
  /** Something above needs staff to give a reason. */
  needsReason: boolean;
  messages: string[];
}

/** What staff should look at twice before accepting an ID. Dates are YYYY-MM-DD; today is the hotel's day. */
export function idWarnings(input: { nameOnId: string; guestName: string; expiresOn: string | null; dateOfBirth: string | null; today: string }): IdWarnings {
  const nameMatched = namesMatch(input.nameOnId, input.guestName);
  const expired = !!input.expiresOn && input.expiresOn < input.today;
  const age = input.dateOfBirth ? ageOn(input.dateOfBirth, input.today) : null;
  const minor = age === null ? null : age < MIN_GUEST_AGE;
  const messages: string[] = [];
  if (input.nameOnId.trim() && !nameMatched) messages.push(`The ID is in the name of ${input.nameOnId.trim()}, not ${input.guestName}. Check they’re on the reservation.`);
  if (expired) messages.push(`The ID expired on ${input.expiresOn}.`);
  if (minor) messages.push(`The guest is ${age}, under ${MIN_GUEST_AGE}.`);
  return { nameMatched, expired, minor, needsReason: (!!input.nameOnId.trim() && !nameMatched) || expired || !!minor, messages };
}
