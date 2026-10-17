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
import { confirmPayAtProperty, createBooking as createSiteBooking } from '../services/bookings';
import { policyFor } from '../services/guest';
import { CURRENCY } from './facts';
import { findListedHotel } from './hotel';
import { conciergeSchemas, type BookingLinkInput, type CreateBookingInput, type FindBookingInput, type RequestBookingInput } from './schemas';
import { bookableStay, lookupBooking, submitBookingRequest, type BookingRequestSaved } from './shared';
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
    rooms: number;
    /** Per room, USD. */
    averageNightly: number;
    /** Whole stay, all rooms, USD. */
    total: number;
    currency: typeof CURRENCY;
    /** Rooms of this type still free for every night. */
    roomsLeft: number;
  };
  expiresNote: string;
}

/**
 * A link to the hotel's own checkout with the room, dates and party (and
 * optionally the guest's name, email and phone) pre-filled — the same page
 * the guest voice tool `start_booking` opens. Checks the room type belongs to
 * the listed hotel and the stay is bookable right now; DomainError 400 (rules,
 * e.g. sold out or too many guests) or 404 (hotel) otherwise.
 */
export async function bookingLink(input: BookingLinkInput): Promise<BookingLinkResult> {
  const a = conciergeSchemas.bookingLink.parse(input);
  const hotel = await findListedHotel(a.propertyId);
  const stay = await bookableStay(hotel.id, a, 'Stays are limited to 30 nights online.');
  if ('error' in stay) throw badRequest(stay.error);
  const path = checkoutPath(hotel.id, { roomTypeId: stay.roomType.id, checkIn: a.checkIn, checkOut: a.checkOut, guests: a.guests, rooms: a.rooms }, a.guest);
  return {
    url: siteUrl(path),
    summary: {
      hotel,
      roomType: { id: stay.roomType.id, name: stay.roomType.name, sleeps: stay.roomType.capacity },
      checkIn: a.checkIn,
      checkOut: a.checkOut,
      nights: stay.nights,
      guests: a.guests,
      rooms: a.rooms,
      averageNightly: stay.quote.averageNightly,
      total: stay.quote.total,
      currency: CURRENCY,
      roomsLeft: stay.quote.available,
    },
    expiresNote: 'The link doesn’t hold the room: availability and the price are confirmed when the guest completes checkout.',
  };
}

// ---------------------------------------------------------------------------
// Booking request (the hotel team confirms)
// ---------------------------------------------------------------------------

/** What `requestBooking` returns: the phone line's `request_booking` result. */
export type RequestBookingResult = BookingRequestSaved;

/** Requests from assistants per hotel per hour, so one integration can't flood a team's inbox. */
const AGENT_REQUESTS_PER_HOTEL_HOUR = () => Number(process.env.CONCIERGE_MAX_REQUESTS_PER_HOTEL_HOUR || 20);

/**
 * Sends a booking request to the hotel team — the phone line's
 * `request_booking`: the stay is validated and quoted, and the team confirms
 * with the guest and sends them the pre-filled checkout link; it isn't booked
 * until then. Needs an email or phone. `source` (AGENT, default, or VOICE) is
 * stored on the request. Requests through here are capped per hotel per hour
 * (CONCIERGE_MAX_REQUESTS_PER_HOTEL_HOUR, default 20; 429). Rule failures
 * throw DomainError 400 with the phone tool's message.
 */
export async function requestBooking(input: RequestBookingInput): Promise<RequestBookingResult> {
  const a = conciergeSchemas.requestBooking.parse(input);
  const hotel = await findListedHotel(a.propertyId);
  const hourAgo = new Date(Date.now() - 3600_000);
  // Each source has its own allowance, so assistants can't crowd out the hotel's own voice line (or the other way round).
  const recent = await prisma.guestRequest.count({ where: { propertyId: hotel.id, source: a.source, createdAt: { gte: hourAgo } } });
  if (recent >= AGENT_REQUESTS_PER_HOTEL_HOUR()) throw new DomainError(429, 'RATE_LIMITED', `${hotel.name} has a lot of requests right now — try again later or send the guest a booking link instead.`);
  // One guest doesn't need more than a couple of open requests an hour; this stops one caller filling the inbox.
  const contact = [a.email ? { email: { equals: a.email.trim(), mode: 'insensitive' as const } } : null, a.phone ? { phone: a.phone.trim() } : null].filter((c) => c !== null);
  if (contact.length) {
    const same = await prisma.guestRequest.count({ where: { propertyId: hotel.id, createdAt: { gte: hourAgo }, OR: contact } });
    if (same >= 2) throw new DomainError(429, 'RATE_LIMITED', `${hotel.name} already has a request from this guest — the team will be in touch. Send a booking link if they want to book straight away.`);
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
  /** Whole stay, all rooms, USD — priced by the server from the rate calendar. */
  total: number;
  currency: typeof CURRENCY;
  paymentStatus: 'PAY_AT_PROPERTY';
  hotel: { id: string; name: string };
  roomType: { id: string; name: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  rooms: number;
  /** How the guest changes or cancels (they have no account here; through the hotel). */
  manage: string;
  /** A confirmation email was handed to the mailer (false when email isn't configured or the hourly cap was hit). */
  confirmationEmailSent: boolean;
}

/** Email domain of per-booking guest records: the reserved .invalid TLD is never deliverable and never an account anyone signs in to. */
export const INTEGRATION_GUEST_DOMAIN = 'guests.hotelone.invalid';
/** Confirmation emails one address may receive from direct bookings per day, so a key can't be used to spam someone. */
const CONFIRMATIONS_PER_RECIPIENT_DAY = 3;

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
 * configured (capped per recipient). The booking belongs to a guest record
 * made for it alone (`integrationGuest`), never an existing account.
 * DomainError 400/404/409 (sold out).
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const a = conciergeSchemas.createBooking.parse(input);
  const hotel = await findListedHotel(a.propertyId);
  // Check the stay before making the guest record; the booking service re-checks inside its transaction.
  const stay = await bookableStay(hotel.id, a, 'Stays are limited to 30 nights online.');
  if ('error' in stay) throw badRequest(stay.error);
  const guest = await integrationGuest(a.guest);
  const booking = await createSiteBooking({
    userId: guest.id,
    propertyId: hotel.id,
    roomTypeId: a.roomTypeId,
    checkIn: a.checkIn,
    checkOut: a.checkOut,
    guests: a.guests,
    rooms: a.rooms,
    notes: a.notes,
    paymentStatus: 'PAY_AT_PROPERTY',
    createdVia: `Booked by ${a.source} — pay at property`,
  });
  const guestEmail = a.guest.email.trim().toLowerCase();
  await prisma.booking.update({ where: { id: booking.id }, data: { guestEmail } });
  await confirmPayAtProperty(booking.id);

  const total = Number(booking.totalPrice);
  const sentToday = await prisma.booking.count({ where: { guestEmail, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
  const sendEmail = isEmailConfigured() && sentToday <= CONFIRMATIONS_PER_RECIPIENT_DAY;
  if (sendEmail) {
    await sendBookingConfirmation({
      to: guestEmail,
      guestName: a.guest.name.trim(),
      propertyName: booking.property.name,
      roomTypeName: booking.roomType.name,
      checkIn: a.checkIn,
      checkOut: a.checkOut,
      guests: a.guests,
      rooms: a.rooms,
      totalPrice: total.toFixed(2),
      bookingId: booking.code ?? booking.id,
      paymentStatus: 'PAY_AT_PROPERTY',
    });
  }

  return {
    bookingId: booking.id,
    code: booking.code ?? booking.id,
    status: 'CONFIRMED',
    total,
    currency: CURRENCY,
    paymentStatus: 'PAY_AT_PROPERTY',
    hotel: { id: hotel.id, name: booking.property.name },
    roomType: { id: booking.roomTypeId, name: booking.roomType.name },
    checkIn: a.checkIn,
    checkOut: a.checkOut,
    nights: diffDays(a.checkIn, a.checkOut),
    guests: a.guests,
    rooms: a.rooms,
    manage: integrationManageNote((await prisma.property.findUnique({ where: { id: hotel.id }, select: { phone: true } }))?.phone),
    confirmationEmailSent: sendEmail,
  };
}

/** How the guest of a direct booking changes or cancels: they have no account here, so through the hotel. */
function integrationManageNote(phone: string | null | undefined): string {
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
      /** "3:00 PM on Thu, Oct 22" while free changes are still possible, else null. */
      freeChangesUntil: string | null;
      manage: string;
      /** The guest's booking page (they sign in to change or cancel). */
      bookingUrl: string;
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
  const policy = policyFor(checkIn);
  return {
    found: true,
    code: b.code ?? a.code,
    status: b.status,
    hotel: b.property,
    room: b.roomType.name,
    checkIn,
    checkOut,
    nights: diffDays(checkIn, checkOut),
    guests: b.guests,
    rooms: b.rooms,
    freeChangesUntil: policy.passed ? null : policy.deadlineLabel,
    manage: b.guestEmail
      ? integrationManageNote(b.property.phone)
      : 'The guest can change dates or cancel by signing in at the booking site with the email they booked with.',
    bookingUrl: bookingPageUrl(b.id),
  };
}
