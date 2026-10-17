/**
 * Stay rules shared by the hotel voice tools (booking page, phone line,
 * WhatsApp) and the concierge. Results keep the voice tools' wire shapes —
 * `{ error }` for a rule the model should explain — so their behaviour
 * doesn't change; the concierge turns `{ error }` into a DomainError.
 */
import { prisma } from '@/lib/prisma';
import type { StayQuote } from '@/lib/dto';
import { diffDays, formatDay, hotelToday } from '../dates';
import { publicSiteUrl } from '../public-url';
import { alertTeam } from '../services/guestRequests';
import { propertyAvailability, quoteStay } from '../services/inventory';
import { checkoutPath } from './urls';

/** Longest stay bookable online. */
export const MAX_NIGHTS = 30;

/** A stay as the shared rules take it (dates YYYY-MM-DD). */
export interface StayInput {
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
}

/** Date rules every stay passes: not in the past, check-out after check-in, at most 30 nights. */
export function stayDateError(s: { checkIn: string; checkOut: string }, longStayMessage: string): string | null {
  const today = hotelToday();
  if (s.checkIn < today) return `Check-in can’t be in the past — today is ${formatDay(today, 'weekday')}.`;
  if (s.checkOut <= s.checkIn) return 'Check-out must be after check-in.';
  if (diffDays(s.checkIn, s.checkOut) > MAX_NIGHTS) return longStayMessage;
  return null;
}

/** One room type's availability for a stay (guest voice tool `check_availability` shape). */
export interface AvailabilityOption {
  room_type_id: string;
  name: string;
  sleeps: number;
  /** sleeps × rooms covers the party. */
  fits_party: boolean;
  /** At least `rooms` rooms free on every night. */
  available: boolean;
  rooms_left: number;
  /** USD; null only if no quote could be made. */
  average_per_night: number | null;
  /** USD for the whole stay and all rooms. */
  total: number | null;
}

/** Live availability for a stay at one hotel (guest voice tool `check_availability` shape). */
export interface AvailabilityResult {
  /** "Fri, Oct 23 to Sun, Oct 25, 2 nights, 2 guests" */
  stay: string;
  options: AvailabilityOption[];
}

/**
 * The guest voice tool `check_availability`: live availability and exact
 * prices for every active room type, or `{ error }` when the dates break a rule.
 */
export async function availabilityOptions(propertyId: string, a: StayInput): Promise<AvailabilityResult | { error: string }> {
  const error = stayDateError(a, 'Online stays are limited to 30 nights; offer to take a message for longer stays.');
  if (error) return { error };
  const types = await propertyAvailability({ propertyId, checkIn: a.checkIn, checkOut: a.checkOut, guests: a.guests, rooms: a.rooms });
  const nights = diffDays(a.checkIn, a.checkOut);
  return {
    stay: `${formatDay(a.checkIn, 'weekday')} to ${formatDay(a.checkOut, 'weekday')}, ${nights} night${nights > 1 ? 's' : ''}, ${a.guests} guest${a.guests > 1 ? 's' : ''}${a.rooms > 1 ? `, ${a.rooms} rooms` : ''}`,
    options: types.map((t) => ({
      room_type_id: t.id,
      name: t.name,
      sleeps: t.capacity,
      fits_party: t.capacity * a.rooms >= a.guests,
      available: t.available >= a.rooms,
      rooms_left: t.available,
      average_per_night: t.quote?.averageNightly ?? null,
      total: t.quote?.total ?? null,
    })),
  };
}

/** Prices for a stay at a hotel that keeps its own system (guest voice tool `check_availability` shape there). */
export interface PriceOptionsResult {
  stay: string;
  /** Read out instead of availability: HotelOne can't see this hotel's bookings. */
  availability: string;
  options: Omit<AvailabilityOption, 'available' | 'rooms_left'>[];
}

/**
 * `check_availability` for hotels that keep their own system: the prices of
 * every active room type from the rate calendar, without claiming anything
 * is free — the hotel's team confirms that.
 */
export async function priceOptions(propertyId: string, a: StayInput): Promise<PriceOptionsResult | { error: string }> {
  const result = await availabilityOptions(propertyId, a);
  if ('error' in result) return result;
  return {
    stay: result.stay,
    availability: 'Not shown here: the front desk checks it. Quote the price, then offer to send a booking request so they can confirm the room is free.',
    options: result.options.map(({ available: _a, rooms_left: _r, ...o }) => o),
  };
}

/** A room type and stay that can be booked right now. */
export interface BookableStay {
  roomType: { id: string; name: string; capacity: number };
  quote: StayQuote;
  nights: number;
}

/**
 * Checks one room type for a stay: dates, that it's active at this hotel,
 * that it fits the party, and that enough rooms are free. Error wording is
 * the phone line's `request_booking` (only the long-stay line varies).
 */
export async function bookableStay(
  propertyId: string,
  a: StayInput & { roomTypeId: string },
  longStayMessage: string,
  /** False for hotels that keep their own system: HotelOne can't see their availability, so their team checks it. */
  liveInventory = true,
): Promise<BookableStay | { error: string }> {
  const error = stayDateError(a, longStayMessage);
  if (error) return { error };
  const rt = await prisma.roomType.findFirst({ where: { id: a.roomTypeId, propertyId, isActive: true }, select: { id: true, name: true, capacity: true } });
  if (!rt) return { error: 'That room type isn’t available here — check availability again.' };
  if (a.guests > rt.capacity * a.rooms) return { error: `The ${rt.name} sleeps up to ${rt.capacity} per room — add a room or choose a larger room.` };
  const quote = await quoteStay(prisma, { roomTypeId: rt.id, checkIn: a.checkIn, checkOut: a.checkOut, rooms: a.rooms, guests: a.guests });
  if (liveInventory && quote.available < a.rooms) return { error: `The ${rt.name} is no longer free for those dates — check availability again.` };
  return { roomType: rt, quote, nights: diffDays(a.checkIn, a.checkOut) };
}

/** A booking request for the hotel team (phone line `request_booking`). */
export interface BookingRequestInput extends StayInput {
  roomTypeId: string;
  name: string;
  email?: string | null;
  /** Callback number, already resolved (phone calls fall back to the caller ID). */
  phone?: string | null;
  notes?: string | null;
  /** GuestRequest.source: PHONE | WHATSAPP (phone line) · AGENT | VOICE (concierge). */
  source: string;
  /** Where it came from, as the team reads it ("Test call"); defaults by source. */
  label?: string;
}

/** What `request_booking` returns once the request is saved. */
export interface BookingRequestSaved {
  saved: true;
  /** Last 6 characters of the GuestRequest id, upper-cased. */
  reference: string;
  /** USD, or null if no quote could be made. */
  quoted_total: number | null;
  say: string;
}

// Phone line requests say "Phone"/"WhatsApp"; the concierge's say who asked (VOICE = HotelOne's voice concierge).
const REQUEST_LABEL: Record<string, string> = { WHATSAPP: 'WhatsApp', AGENT: 'AI assistant', VOICE: 'Voice concierge' };

/**
 * The phone line's `request_booking`: validates the stay and saves a
 * GuestRequest for the team with the quoted total. Hotels on HotelOne get the
 * pre-filled checkout link to send the guest (nothing is booked until the
 * guest finishes online); hotels that keep their own system check
 * availability and book it there, then confirm with the guest.
 */
export async function submitBookingRequest(propertyId: string, a: BookingRequestInput, liveInventory = true): Promise<BookingRequestSaved | { error: string }> {
  if (!a.phone && !a.email) return { error: 'Ask for an email or a callback number so the team can confirm the booking.' };
  const stay = await bookableStay(propertyId, a, 'Stays over 30 nights go through the team — take a message instead.', liveInventory);
  if ('error' in stay) return stay;
  const { roomType: rt, nights } = stay;
  const total: number | null = stay.quote.total;
  // The same pre-filled checkout the booking page opens: staff send it to the guest to finish online.
  const link = `${publicSiteUrl() ?? ''}${checkoutPath(propertyId, { roomTypeId: rt.id, checkIn: a.checkIn, checkOut: a.checkOut, guests: a.guests, rooms: a.rooms })}`;
  const message = [
    `${a.label ?? REQUEST_LABEL[a.source] ?? 'Phone'} booking request: ${rt.name}, ${formatDay(a.checkIn, 'weekday')} to ${formatDay(a.checkOut, 'weekday')} (${nights} night${nights > 1 ? 's' : ''}), ${a.guests} guest${a.guests > 1 ? 's' : ''}${a.rooms > 1 ? `, ${a.rooms} rooms` : ''}.`,
    total !== null ? `Quoted total: $${total.toFixed(2)}.` : '',
    a.notes ? `Notes: ${a.notes.trim()}${/[.!?]$/.test(a.notes.trim()) ? '' : '.'}` : '',
    liveInventory ? `Confirm with the guest, then send them this link to finish booking: ${link}` : 'Check it’s free in your system, book it there, then confirm with the guest.',
  ]
    .filter(Boolean)
    .join(' ');
  const r = await prisma.guestRequest.create({ data: { propertyId, name: a.name, phone: a.phone || null, email: a.email || null, message, source: a.source } });
  alertTeam(r.id);
  return {
    saved: true,
    reference: r.id.slice(-6).toUpperCase(),
    quoted_total: total,
    say: liveInventory
      ? `I’ve sent your request to the team — they’ll confirm and send you a link to finish booking${a.email ? ' by email' : ''}. It isn’t booked until then.`
      : `I’ve sent your request to the front desk — they’ll check the room is free and ${a.phone ? 'call you back' : 'email you'} to confirm. It isn’t booked until then.`,
  };
}

/** Normalises a spoken or typed confirmation code ("abc-123" → "ABC123"). */
export const normalizeBookingCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Finds a booking by confirmation code and the guest's last name (both must
 * match; case-insensitive name). Scoped to one hotel when `propertyId` is
 * given (the hotel voice tools); codes are unique platform-wide otherwise.
 */
export async function lookupBooking(q: { propertyId?: string; code: string; lastName: string }) {
  return prisma.booking.findFirst({
    where: { ...(q.propertyId ? { propertyId: q.propertyId } : {}), code: normalizeBookingCode(q.code), user: { lastName: { equals: q.lastName.trim(), mode: 'insensitive' } } },
    include: { roomType: { select: { name: true } }, property: { select: { id: true, name: true, phone: true } } },
  });
}
