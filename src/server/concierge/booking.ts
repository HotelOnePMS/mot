/**
 * Booking for agents: a pre-filled checkout link (the guest pays and books
 * themselves), a request the hotel team confirms, a direct pay-at-hotel
 * booking for trusted API keys, and looking up an existing booking.
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { diffDays, toISODate } from '../dates';
import { DomainError, badRequest } from '../errors';
import { isEmailConfigured, sendBookingConfirmation } from '../email';
import { confirmReservationPayAtProperty, createReservation } from '../services/bookings';
import { policyFor } from '../services/guest';
import { localeOf } from '../services/hotels';
import { findListedHotel } from './hotel';
import { consumeRateLimit } from './rateLimit';
import { conciergeSchemas, type BookingLinkInput, type CreateBookingInput, type FindBookingInput, type RequestBookingInput } from './schemas';
import { bookableReservation, lookupBooking, reservationRooms, stayLines, submitBookingRequest, type BookableReservation, type BookingRequestSaved } from './shared';
import { bookingPageUrl, checkoutPath, siteUrl } from './urls';

// ---------------------------------------------------------------------------
// Checkout link
// ---------------------------------------------------------------------------

/** What `bookingLink` returns. */
export interface BookingLinkResult {
  /** Absolute URL of the pre-filled checkout; the guest signs in (or registers) and pays there. */
  url: string;
  summary: {
    hotel: { id: string; name: string };
    roomType: { id: string; name: string; sleeps: number };
    checkIn: string;
    checkOut: string;
    nights: number;
    guests: number;
    /** All rooms, across every room type. */
    rooms: number;
    /** Room price per room per night, in `currency` (averaged across room types when there are several). */
    averageNightly: number;
    /** Whole stay, all rooms, taxes and fees included, in `currency`. */
    total: number;
    /** The hotel's ISO 4217 currency. */
    currency: string;
    /** Rooms of this type still free for every night (the scarcest type when there are several). */
    roomsLeft: number;
    /** Every room type in the booking, in order (`roomType` is the first). */
    items: ReservationItem[];
  };
  expiresNote: string;
}

/** One room type of a booking, as the concierge reports it. */
export interface ReservationItem {
  roomType: { id: string; name: string; sleeps: number };
  rooms: number;
  /** Guests this room type is for (the party shared across the room types). */
  guests: number;
  /** This room type's share of the total, taxes and fees included, in the booking's currency. */
  total: number;
  roomsLeft: number;
}

function reservationItems(r: BookableReservation): ReservationItem[] {
  return r.lines.map((l) => ({
    roomType: { id: l.roomType.id, name: l.roomType.name, sleeps: l.roomType.capacity },
    rooms: l.rooms,
    guests: l.guests,
    total: l.quote.total,
    roomsLeft: l.quote.available,
  }));
}

/**
 * A link to the hotel's own checkout with the room, dates and party (and
 * optionally the guest's name, email and phone) pre-filled — the same page
 * the guest voice tool `start_booking` opens. One room type (`roomTypeId`,
 * `rooms`) or several booked together (`items`). Checks each room type
 * belongs to the listed hotel and the stay is bookable right now; DomainError
 * 400 (rules, e.g. sold out or too many guests) or 404 (hotel) otherwise.
 */
export async function bookingLink(input: BookingLinkInput): Promise<BookingLinkResult> {
  const a = conciergeSchemas.bookingLink.parse(input);
  const hotel = await findListedHotel(a.propertyId);
  const stay = await reservationOrThrow(hotel.id, a);
  const [first] = stay.lines;
  const path = checkoutPath(
    hotel.id,
    { roomTypeId: first.roomType.id, items: stay.lines.map((l) => ({ roomTypeId: l.roomType.id, rooms: l.rooms })), checkIn: a.checkIn, checkOut: a.checkOut, guests: a.guests, rooms: stay.rooms },
    a.guest
  );
  return {
    url: siteUrl(path),
    summary: {
      hotel,
      roomType: { id: first.roomType.id, name: first.roomType.name, sleeps: first.roomType.capacity },
      checkIn: a.checkIn,
      checkOut: a.checkOut,
      nights: stay.nights,
      guests: a.guests,
      rooms: stay.rooms,
      // Room charges only (taxes and fees aside), per room per night.
      averageNightly:
        stay.lines.length === 1 ? first.quote.averageNightly : Math.round((stay.lines.reduce((s, l) => s + l.quote.subtotal, 0) / (stay.nights * stay.rooms)) * 100) / 100,
      total: stay.total,
      currency: stay.currency,
      roomsLeft: Math.min(...stay.lines.map((l) => l.quote.available)),
      items: reservationItems(stay),
    },
    expiresNote: 'The link doesn’t hold the room: availability and the price are confirmed when the guest completes checkout.',
  };
}

/** The stay's room types (`items`, else `roomTypeId` + `rooms`), checked bookable right now; DomainError 400 otherwise. */
async function reservationOrThrow(
  propertyId: string,
  a: { roomTypeId?: string; rooms: number; items?: { roomTypeId: string; rooms: number }[]; checkIn: string; checkOut: string; guests: number }
): Promise<BookableReservation> {
  const lines = stayLines(a);
  if ('error' in lines) throw badRequest('Give roomTypeId (from checkAvailability), or items to book several room types.');
  const stay = await bookableReservation(propertyId, { ...a, lines }, 'Stays are limited to 30 nights online.');
  if ('error' in stay) throw badRequest(stay.error);
  return stay;
}

// ---------------------------------------------------------------------------
// Booking request (the hotel team confirms)
// ---------------------------------------------------------------------------

/** What `requestBooking` returns: the phone line's `request_booking` result. */
export type RequestBookingResult = BookingRequestSaved;

/** A positive whole number from the environment, else the default. */
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** Requests per hotel per hour from each API key's hotel (and from the voice concierge), so one integration can't flood a team's inbox. */
const AGENT_REQUESTS_PER_HOTEL_HOUR = () => envInt('CONCIERGE_MAX_REQUESTS_PER_HOTEL_HOUR', 20);
/** Requests per hotel per hour from all callers without an API key together — lower, and kept apart from keyed partners'. */
const PUBLIC_REQUESTS_PER_HOTEL_HOUR = () => envInt('CONCIERGE_MAX_PUBLIC_REQUESTS_PER_HOTEL_HOUR', 10);

/** Who sent an AGENT request: the API key (its id and the hotel it belongs to, null for all-hotel keys), or null for public callers. */
export interface RequestCaller {
  keyId: string;
  keyPropertyId: string | null;
}

/**
 * Sends a booking request to the hotel team — the phone line's
 * `request_booking`: the stay is validated and quoted, and the team confirms
 * with the guest and sends them the pre-filled checkout link; it isn't booked
 * until then. Needs an email or phone. `source` (AGENT, default, or VOICE) is
 * stored on the request. Requests are capped per hotel per hour in separate
 * allowances, so one group of callers can't shut the others out (429):
 * - AGENT without a key (`caller` null): all public callers together,
 *   CONCIERGE_MAX_PUBLIC_REQUESTS_PER_HOTEL_HOUR (default 10);
 * - AGENT with a key: per key-owning hotel (all-hotel keys: per key),
 *   CONCIERGE_MAX_REQUESTS_PER_HOTEL_HOUR (default 20);
 * - VOICE: the voice concierge's own allowance (same default).
 * Rule failures throw DomainError 400 with the phone tool's message.
 */
export async function requestBooking(input: RequestBookingInput, caller: RequestCaller | null = null): Promise<RequestBookingResult> {
  const a = conciergeSchemas.requestBooking.parse(input);
  const hotel = await findListedHotel(a.propertyId);
  const hourAgo = new Date(Date.now() - HOUR_MS);
  const busy = `${hotel.name} has a lot of requests right now — try again later or send the guest a booking link instead.`;
  if (a.source !== 'AGENT') {
    // The voice concierge's requests are counted from the inbox, apart from assistants'.
    const recent = await prisma.guestRequest.count({ where: { propertyId: hotel.id, source: a.source, createdAt: { gte: hourAgo } } });
    if (recent >= AGENT_REQUESTS_PER_HOTEL_HOUR()) throw new DomainError(429, 'RATE_LIMITED', busy);
  }
  // One guest doesn't need more than a couple of open requests an hour; this stops one caller filling the inbox.
  const contact = [a.email ? { email: { equals: a.email.trim(), mode: 'insensitive' as const } } : null, a.phone ? { phone: a.phone.trim() } : null].filter((c) => c !== null);
  if (contact.length) {
    const same = await prisma.guestRequest.count({ where: { propertyId: hotel.id, createdAt: { gte: hourAgo }, OR: contact } });
    if (same >= 2) throw new DomainError(429, 'RATE_LIMITED', `${hotel.name} already has a request from this guest — the team will be in touch. Send a booking link if they want to book straight away.`);
  }
  if (a.source === 'AGENT') {
    // Public callers share one (smaller) allowance per hotel; each key-owning hotel has its own, so anonymous traffic can't starve partners.
    if (caller) await consumeRateLimit(`concierge:requests:${hotel.id}:keys:${caller.keyPropertyId ?? `key-${caller.keyId}`}`, AGENT_REQUESTS_PER_HOTEL_HOUR(), HOUR_MS, busy);
    else await consumeRateLimit(`concierge:requests:${hotel.id}:public`, PUBLIC_REQUESTS_PER_HOTEL_HOUR(), HOUR_MS, busy);
  }
  const r = await submitBookingRequest(hotel.id, { ...a, email: a.email ?? null, phone: a.phone ?? null, notes: a.notes ?? null });
  if ('error' in r) throw badRequest(r.error);
  return r;
}

// ---------------------------------------------------------------------------
// Direct booking (trusted API keys)
// ---------------------------------------------------------------------------

/** What `createBooking` returns. */
export interface CreateBookingResult {
  bookingId: string;
  /** Confirmation code the guest quotes (also used by findBooking). */
  code: string;
  status: 'CONFIRMED';
  /** Whole stay, all rooms, taxes and fees included — priced by the server from the rate calendar. */
  total: number;
  /** The hotel's ISO 4217 currency. */
  currency: string;
  paymentStatus: 'PAY_AT_PROPERTY';
  hotel: { id: string; name: string };
  /** The first room type (see `items` for every one). */
  roomType: { id: string; name: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  /** All rooms, across every room type. */
  rooms: number;
  /** Every room type booked, in order: each is its own booking at the hotel, all under `code`. */
  items: (ReservationItem & { bookingId: string })[];
  /** How the guest changes or cancels (they have no account here; through the hotel). */
  manage: string;
  /** A confirmation email was handed to the mailer (false when email isn't configured or a daily cap was hit). */
  confirmationEmailSent: boolean;
}

/** Email domain of per-booking guest records: the reserved .invalid TLD is never deliverable and never an account anyone signs in to. */
export const INTEGRATION_GUEST_DOMAIN = 'guests.hotelone.invalid';
/** Confirmation emails one address (normalised: see normalizeEmailForCap) may receive from direct bookings per day, so a key can't be used to spam someone. */
const CONFIRMATIONS_PER_RECIPIENT_DAY = 3;
/** Confirmation emails per API key per day (AGENT_CONFIRMATIONS_PER_KEY_DAY overrides). */
const CONFIRMATIONS_PER_KEY_DAY = () => envInt('AGENT_CONFIRMATIONS_PER_KEY_DAY', 25);
/** Confirmation emails per hotel per day from API-key bookings (AGENT_CONFIRMATIONS_PER_HOTEL_DAY overrides). */
const CONFIRMATIONS_PER_HOTEL_DAY = () => envInt('AGENT_CONFIRMATIONS_PER_HOTEL_DAY', 50);

/**
 * The mailbox an address delivers to, for counting confirmations: lower-cased,
 * without a "+tag", and for Gmail without dots (googlemail.com = gmail.com),
 * so "Jo.Smith+1@gmail.com" and "josmith@googlemail.com" count as one person.
 * Only for caps — mail still goes to the address as given.
 */
export function normalizeEmailForCap(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1).replace(/\.+$/, '');
  local = local.split('+')[0] || local;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '') || local;
  return `${local}@${domain}`;
}

/**
 * Whether a direct booking's confirmation email may go out: counts one send
 * against the hotel's and the key's daily caps, then the recipient's
 * (normalised), and says no as soon as one is used up — the hotel and key
 * first, so a capped integration doesn't eat into someone's own allowance.
 * Never throws: the booking is already made, so a failed check only means
 * no email.
 */
async function confirmationAllowed(to: string, propertyId: string, keyId: string | null): Promise<boolean> {
  const caps: [string, number][] = [
    [`concierge:confirm-email:hotel:${propertyId}`, CONFIRMATIONS_PER_HOTEL_DAY()],
    ...(keyId ? [[`concierge:confirm-email:key:${keyId}`, CONFIRMATIONS_PER_KEY_DAY()] as [string, number]] : []),
    [`concierge:confirm-email:to:${normalizeEmailForCap(to)}`, CONFIRMATIONS_PER_RECIPIENT_DAY],
  ];
  try {
    for (const [bucket, max] of caps) await consumeRateLimit(bucket, max, DAY_MS);
    return true;
  } catch (e) {
    if (!(e instanceof DomainError && e.status === 429)) console.error('[concierge] confirmation email cap check failed', e);
    return false;
  }
}

/**
 * The guest record a direct booking belongs to: made for this booking alone
 * from the details the integration sent, never an existing account. So a key
 * can't read anyone's stored name or phone, can't put a booking into their
 * account, and can't tell which emails have accounts or belong to staff —
 * every email is handled the same way. The record can't sign in (no
 * password, inactive, undeliverable address); the contact email the
 * integration sent is kept on the booking (Booking.guestEmail).
 */
async function integrationGuest(guest: { name: string; email: string; phone?: string | null }): Promise<{ id: string }> {
  const [firstName, ...rest] = guest.name.trim().split(/\s+/);
  return prisma.user.create({
    data: {
      email: `guest-${randomUUID()}@${INTEGRATION_GUEST_DOMAIN}`,
      password: '',
      firstName,
      lastName: rest.join(' '),
      phone: guest.phone || null,
      role: 'CUSTOMER',
      isActive: false,
    },
    select: { id: true },
  });
}

/**
 * A confirmed, pay-at-hotel booking for trusted integrations (API keys with
 * the "book" scope — the caller checks that). Goes through the website's
 * booking service (serializable transaction, live availability, server-side
 * price = the quote) and is confirmed instantly like pay-at-property bookings
 * on the site; the guest gets the usual confirmation email when email is
 * configured, within daily caps per hotel, per key (`opts.keyId`) and per
 * recipient (normalised address). The booking belongs to a guest record
 * made for it alone (`integrationGuest`), never an existing account.
 * DomainError 400/404/409 (sold out).
 */
export async function createBooking(input: CreateBookingInput, opts: { keyId?: string | null } = {}): Promise<CreateBookingResult> {
  const a = conciergeSchemas.createBooking.parse(input);
  const hotel = await findListedHotel(a.propertyId);
  // Check the stay before making the guest record; the booking service re-checks inside its transaction.
  const stay = await reservationOrThrow(hotel.id, a);
  const guest = await integrationGuest(a.guest);
  let bookings: Awaited<ReturnType<typeof createReservation>>;
  try {
    bookings = await createReservation({
      userId: guest.id,
      propertyId: hotel.id,
      lines: stay.lines.map((l) => ({ roomTypeId: l.roomType.id, rooms: l.rooms })),
      checkIn: a.checkIn,
      checkOut: a.checkOut,
      guests: a.guests,
      notes: a.notes,
      paymentStatus: 'PAY_AT_PROPERTY',
      createdVia: `Booked by ${a.source} — pay at property`,
      source: 'AGENT_API',
    });
  } catch (e) {
    // Sold out or busy: the guest record was made for this booking alone, so don't leave it behind.
    await prisma.user.delete({ where: { id: guest.id } }).catch(() => undefined);
    throw e;
  }
  const [lead] = bookings;
  const ids = bookings.map((b) => b.id);
  const guestEmail = a.guest.email.trim().toLowerCase();
  await prisma.booking.updateMany({ where: { id: { in: ids } }, data: { guestEmail } });
  await confirmReservationPayAtProperty(ids);

  const total = bookings.reduce((s, b) => s + Math.round(Number(b.totalPrice) * 100), 0) / 100;
  const rooms = bookings.reduce((s, b) => s + b.rooms, 0);
  // One reservation is one confirmation email (one send against the caps), however many room types it holds.
  const sendEmail = isEmailConfigured() && (await confirmationAllowed(guestEmail, hotel.id, opts.keyId ?? null));
  if (sendEmail) {
    await sendBookingConfirmation({
      to: guestEmail,
      guestName: a.guest.name.trim(),
      propertyName: lead.property.name,
      roomTypeName: lead.roomType.name,
      lines: bookings.map((b) => ({ roomTypeName: b.roomType.name, rooms: b.rooms })),
      checkIn: a.checkIn,
      checkOut: a.checkOut,
      guests: a.guests,
      rooms,
      totalPrice: total.toFixed(2),
      currency: lead.currency,
      bookingId: lead.code ?? lead.id,
      paymentStatus: 'PAY_AT_PROPERTY',
    });
  }

  return {
    bookingId: lead.id,
    code: lead.code ?? lead.id,
    status: 'CONFIRMED',
    total,
    currency: lead.currency,
    paymentStatus: 'PAY_AT_PROPERTY',
    hotel: { id: hotel.id, name: lead.property.name },
    roomType: { id: lead.roomTypeId, name: lead.roomType.name },
    checkIn: a.checkIn,
    checkOut: a.checkOut,
    nights: diffDays(a.checkIn, a.checkOut),
    guests: a.guests,
    rooms,
    items: bookings.map((b, i) => ({
      bookingId: b.id,
      roomType: { id: b.roomTypeId, name: b.roomType.name, sleeps: stay.lines[i].roomType.capacity },
      rooms: b.rooms,
      guests: b.guests,
      total: Number(b.totalPrice),
      roomsLeft: Math.max(0, stay.lines[i].quote.available - b.rooms),
    })),
    manage: integrationManageNote((await prisma.property.findUnique({ where: { id: hotel.id }, select: { phone: true } }))?.phone),
    confirmationEmailSent: sendEmail,
  };
}

/** How the guest of a direct booking changes or cancels: they have no account here, so through the hotel. */
export function integrationManageNote(phone: string | null | undefined): string {
  return `To change or cancel, the guest contacts the hotel${phone ? ` at ${phone}` : ''} with the confirmation code (free until 3 PM hotel time the day before arrival), or asks their assistant to look the booking up with the code and their last name.`;
}

// ---------------------------------------------------------------------------
// Find a booking
// ---------------------------------------------------------------------------

/** What `findBooking` returns. A wrong code and a wrong name get the same `found: false`. */
export type FindBookingResult =
  | { found: false; message: string }
  | {
      found: true;
      code: string;
      status: string;
      hotel: { id: string; name: string; phone: string };
      room: string;
      checkIn: string;
      checkOut: string;
      nights: number;
      guests: number;
      rooms: number;
      /** Several room types booked under this code: each with its rooms, guests and status (null for one room type). */
      items: { room: string; rooms: number; guests: number; status: string }[] | null;
      /** "3:00 PM on Thu, Oct 22" while free changes are still possible, else null. */
      freeChangesUntil: string | null;
      manage: string;
      /** The guest's booking page (they sign in to change or cancel); null for direct bookings by API key. */
      bookingUrl: string | null;
    };

/**
 * Looks up a booking by confirmation code and last name across all hotels —
 * the guest voice tool `find_booking`'s rules (both must match; the answer
 * never says which one was wrong). Callers on public endpoints should rate
 * limit this (consumeRateLimit) to stop code guessing.
 */
export async function findBooking(input: FindBookingInput): Promise<FindBookingResult> {
  const a = conciergeSchemas.findBooking.parse(input);
  const b = await lookupBooking({ code: a.code, lastName: a.lastName });
  if (!b) return { found: false, message: 'No booking matches that confirmation code and last name.' };
  const checkIn = toISODate(b.checkIn);
  const checkOut = toISODate(b.checkOut);
  const policy = policyFor(checkIn, localeOf(b.property).timezone);
  const items = await reservationRooms(b);
  return {
    found: true,
    code: b.code ?? a.code,
    status: b.status,
    hotel: b.property,
    room: items ? items.map((i) => `${i.rooms} × ${i.room}`).join(', ') : b.roomType.name,
    checkIn,
    checkOut,
    nights: diffDays(checkIn, checkOut),
    guests: items ? items.reduce((s, i) => s + i.guests, 0) : b.guests,
    rooms: items ? items.reduce((s, i) => s + i.rooms, 0) : b.rooms,
    items,
    freeChangesUntil: policy.passed ? null : policy.deadlineLabel,
    manage: b.guestEmail
      ? integrationManageNote(b.property.phone)
      : 'The guest can change dates or cancel by signing in at the booking site with the email they booked with.',
    // Direct bookings have no account to sign in to, so no booking page for them.
    bookingUrl: b.guestEmail ? null : bookingPageUrl(b.id),
  };
}
