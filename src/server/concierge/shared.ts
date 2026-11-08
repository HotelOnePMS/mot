/**
 * Stay rules shared by the hotel voice tools (booking page, phone line,
 * WhatsApp) and the concierge. Results keep the voice tools' wire shapes —
 * `{ error }` for a rule the model should explain — so their behaviour
 * doesn't change; the concierge turns `{ error }` into a DomainError.
 */
import { prisma } from '@/lib/prisma';
import type { StayQuote } from '@/lib/dto';
import { MAX_RESERVATION_LINES, MAX_RESERVATION_ROOMS, normalizeLines, splitParty, totalRooms, type BookingLine } from '@/lib/booking-lines';
import { money } from '@/lib/status';
import { diffDays, formatDay, hotelToday } from '../dates';
import { publicSiteUrl } from '../public-url';
import { alertTeam } from '../services/guestRequests';
import { hotelLocale } from '../services/hotels';
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
export function stayDateError(s: { checkIn: string; checkOut: string }, longStayMessage: string, timezone?: string): string | null {
  const today = hotelToday(new Date(), timezone);
  if (s.checkIn < today) return `Check-in can’t be in the past. Today is ${formatDay(today, 'weekday')}.`;
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
  /** Room price per night, in `currency`; null only if no quote could be made. */
  average_per_night: number | null;
  /** The whole stay for all rooms, taxes and fees included, in `currency`. */
  total: number | null;
}

/** Live availability for a stay at one hotel (guest voice tool `check_availability` shape). */
export interface AvailabilityResult {
  /** "Fri, Oct 23 to Sun, Oct 25, 2 nights, 2 guests" */
  stay: string;
  /** The hotel's ISO 4217 currency for every amount. */
  currency: string;
  options: AvailabilityOption[];
}

/**
 * The guest voice tool `check_availability`: live availability and exact
 * prices for every active room type, or `{ error }` when the dates break a rule.
 */
export async function availabilityOptions(propertyId: string, a: StayInput): Promise<AvailabilityResult | { error: string }> {
  const locale = await hotelLocale(propertyId);
  const error = stayDateError(a, 'Online stays are limited to 30 nights; offer to take a message for longer stays.', locale.timezone);
  if (error) return { error };
  const types = await propertyAvailability({ propertyId, checkIn: a.checkIn, checkOut: a.checkOut, guests: a.guests, rooms: a.rooms });
  const nights = diffDays(a.checkIn, a.checkOut);
  return {
    stay: `${formatDay(a.checkIn, 'weekday')} to ${formatDay(a.checkOut, 'weekday')}, ${nights} night${nights > 1 ? 's' : ''}, ${a.guests} guest${a.guests > 1 ? 's' : ''}${a.rooms > 1 ? `, ${a.rooms} rooms` : ''}`,
    currency: locale.currency,
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
  currency: string;
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
    currency: result.currency,
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
  const error = stayDateError(a, longStayMessage, (await hotelLocale(propertyId)).timezone);
  if (error) return { error };
  const rt = await prisma.roomType.findFirst({ where: { id: a.roomTypeId, propertyId, isActive: true }, select: { id: true, name: true, capacity: true } });
  if (!rt) return { error: 'That room type isn’t available here. Check availability again.' };
  if (a.guests > rt.capacity * a.rooms) return { error: `The ${rt.name} sleeps up to ${rt.capacity} per room. Add a room or choose a larger room.` };
  const quote = await quoteStay(prisma, { roomTypeId: rt.id, checkIn: a.checkIn, checkOut: a.checkOut, rooms: a.rooms, guests: a.guests });
  if (liveInventory && quote.available < a.rooms) return { error: `The ${rt.name} is no longer free for those dates. Check availability again.` };
  return { roomType: rt, quote, nights: diffDays(a.checkIn, a.checkOut) };
}

/**
 * The room types a request is for: `items` when given (several room types
 * for the same stay), else `roomTypeId` + `rooms`. `{ error }` when neither.
 */
export function stayLines(a: { roomTypeId?: string | null; rooms?: number | null; items?: BookingLine[] | null }): BookingLine[] | { error: string } {
  const lines = a.items?.length ? normalizeLines(a.items) : a.roomTypeId ? [{ roomTypeId: a.roomTypeId, rooms: a.rooms ?? 1 }] : [];
  if (!lines.length) return { error: 'Say which room: a room_type_id from check_availability, or items for several room types.' };
  return lines;
}

/** One or more room types for one stay that can be booked right now. */
export interface BookableReservation {
  lines: (BookableStay & { rooms: number; guests: number })[];
  /** Whole stay, all rooms, taxes and fees included, in `currency`. */
  total: number;
  /** The hotel's ISO 4217 currency. */
  currency: string;
  rooms: number;
  nights: number;
}

/**
 * `bookableStay` for one or more room types booked together: each must be
 * active here and free for every night, the party must fit across them
 * (at least one guest per room type), and the reservation stays within 4
 * room types and 9 rooms. One line gives exactly `bookableStay`'s answers.
 */
export async function bookableReservation(
  propertyId: string,
  a: Omit<StayInput, 'rooms'> & { lines: BookingLine[] },
  longStayMessage: string,
  liveInventory = true,
): Promise<BookableReservation | { error: string }> {
  const lines = normalizeLines(a.lines);
  if (lines.length === 1) {
    const one = await bookableStay(propertyId, { ...a, roomTypeId: lines[0].roomTypeId, rooms: lines[0].rooms }, longStayMessage, liveInventory);
    if ('error' in one) return one;
    return { lines: [{ ...one, rooms: lines[0].rooms, guests: a.guests }], total: one.quote.total, currency: one.quote.currency, rooms: lines[0].rooms, nights: one.nights };
  }
  const error = stayDateError(a, longStayMessage, (await hotelLocale(propertyId)).timezone);
  if (error) return { error };
  if (!lines.length) return { error: 'Say which room types to book.' };
  if (lines.length > MAX_RESERVATION_LINES) return { error: `One booking can hold up to ${MAX_RESERVATION_LINES} room types. Send a message to the team for bigger groups.` };
  const rooms = totalRooms(lines);
  if (rooms > MAX_RESERVATION_ROOMS) return { error: `One booking can hold up to ${MAX_RESERVATION_ROOMS} rooms. Send a message to the team for bigger groups.` };
  const types = await prisma.roomType.findMany({ where: { id: { in: lines.map((l) => l.roomTypeId) }, propertyId, isActive: true }, select: { id: true, name: true, capacity: true } });
  const rts = lines.map((l) => types.find((t) => t.id === l.roomTypeId));
  if (rts.some((t) => !t)) return { error: 'One of those room types isn’t available here. Check availability again.' };
  const party = splitParty(
    a.guests,
    lines.map((l, i) => ({ rooms: l.rooms, capacity: rts[i]!.capacity }))
  );
  if (!party) {
    const sleeps = lines.reduce((s, l, i) => s + l.rooms * rts[i]!.capacity, 0);
    return { error: a.guests < lines.length ? 'Each room type needs at least one guest. Drop a room type or add guests.' : `Those rooms sleep up to ${sleeps}. Add a room or choose larger rooms.` };
  }
  const out: BookableReservation['lines'] = [];
  for (const [i, l] of lines.entries()) {
    const rt = rts[i]!;
    const quote = await quoteStay(prisma, { roomTypeId: rt.id, checkIn: a.checkIn, checkOut: a.checkOut, rooms: l.rooms, guests: party[i] });
    if (liveInventory && quote.available < l.rooms) {
      return { error: quote.available ? `Only ${quote.available} ${rt.name} left for those dates. Check availability again.` : `The ${rt.name} is no longer free for those dates. Check availability again.` };
    }
    out.push({ roomType: rt, quote, nights: diffDays(a.checkIn, a.checkOut), rooms: l.rooms, guests: party[i] });
  }
  return {
    lines: out,
    total: out.reduce((s, l) => s + Math.round(l.quote.total * 100), 0) / 100,
    currency: out[0].quote.currency,
    rooms,
    nights: diffDays(a.checkIn, a.checkOut),
  };
}

/** "2 × Ocean King, 1 × Garden Twin", or "Ocean King" for one line. */
export function linesLabel(lines: { roomType: { name: string }; rooms: number }[]): string {
  return lines.length === 1 ? lines[0].roomType.name : lines.map((l) => `${l.rooms} × ${l.roomType.name}`).join(', ');
}

/** A booking request for the hotel team (phone line `request_booking`). */
export interface BookingRequestInput extends StayInput {
  roomTypeId?: string | null;
  /** Several room types for the same stay, in place of roomTypeId + rooms. */
  items?: BookingLine[] | null;
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
  /** In `currency`, taxes and fees included; null if no quote could be made. */
  quoted_total: number | null;
  currency: string;
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
  const lines = stayLines(a);
  if ('error' in lines) return lines;
  const stay = await bookableReservation(propertyId, { ...a, lines }, 'Stays over 30 nights go through the team. Take a message instead.', liveInventory);
  if ('error' in stay) return stay;
  const { nights } = stay;
  const rooms = stay.rooms;
  const total: number | null = stay.total;
  // The same pre-filled checkout the booking page opens: staff send it to the guest to finish online.
  const link = `${publicSiteUrl() ?? ''}${checkoutPath(propertyId, { roomTypeId: lines[0].roomTypeId, items: lines, checkIn: a.checkIn, checkOut: a.checkOut, guests: a.guests, rooms })}`;
  const message = [
    `${a.label ?? REQUEST_LABEL[a.source] ?? 'Phone'} booking request: ${linesLabel(stay.lines)}, ${formatDay(a.checkIn, 'weekday')} to ${formatDay(a.checkOut, 'weekday')} (${nights} night${nights > 1 ? 's' : ''}), ${a.guests} guest${a.guests > 1 ? 's' : ''}${rooms > 1 ? `, ${rooms} rooms` : ''}.`,
    total !== null ? `Quoted total: ${money(total, { currency: stay.currency })}.` : '',
    a.notes ? `Notes: ${a.notes.trim()}${/[.!?]$/.test(a.notes.trim()) ? '' : '.'}` : '',
    liveInventory ? `Confirm with the guest, then send them this link to finish booking: ${link}` : `Check ${stay.lines.length > 1 ? 'they’re' : 'it’s'} free in your system, book it there, then confirm with the guest.`,
  ]
    .filter(Boolean)
    .join(' ');
  const r = await prisma.guestRequest.create({ data: { propertyId, name: a.name, phone: a.phone || null, email: a.email || null, message, source: a.source } });
  alertTeam(r.id);
  return {
    saved: true,
    reference: r.id.slice(-6).toUpperCase(),
    quoted_total: total,
    currency: stay.currency,
    say: liveInventory
      ? `I’ve sent your request to the team. They’ll confirm and send you a link to finish booking${a.email ? ' by email' : ''}. It isn’t booked until then.`
      : `I’ve sent your request to the front desk. They’ll check the room is free and ${a.phone ? 'call you back' : 'email you'} to confirm. It isn’t booked until then.`,
  };
}

/**
 * The room types of a multi-room-type reservation a found booking belongs
 * to (the guest's code finds the lead line), or null for a single booking.
 */
export async function reservationRooms(b: { groupCode: string | null; userId: string }) {
  if (!b.groupCode) return null;
  const rows = await prisma.booking.findMany({
    where: { groupCode: b.groupCode, userId: b.userId },
    orderBy: { createdAt: 'asc' },
    select: { rooms: true, guests: true, status: true, roomType: { select: { name: true } } },
  });
  return rows.length > 1 ? rows.map((r) => ({ room: r.roomType.name, rooms: r.rooms, guests: r.guests, status: r.status })) : null;
}

/**
 * How a booking found by its code stands: its status, rooms and party, across
 * every room type of a reservation. Cancelled room types are left out of the
 * rooms and party while any other is still booked, and the reservation reads
 * as cancelled only once every room type is.
 */
export function bookingStanding(b: { status: string; rooms: number; guests: number; roomType: { name: string } }, items: Awaited<ReturnType<typeof reservationRooms>>) {
  if (!items) return { status: b.status, room: b.roomType.name, rooms: b.rooms, guests: b.guests };
  const live = items.filter((i) => i.status !== 'CANCELLED' && i.status !== 'NO_SHOW');
  const counted = live.length ? live : items;
  return {
    status: !live.length || live.some((i) => i.status === b.status) ? b.status : live[0].status,
    room: counted.map((i) => `${i.rooms} × ${i.room}`).join(', '),
    rooms: counted.reduce((s, i) => s + i.rooms, 0),
    guests: counted.reduce((s, i) => s + i.guests, 0),
  };
}

/** Normalises a spoken or typed confirmation code ("abc-123" → "ABC123"). */
export const normalizeBookingCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A name for comparing: trimmed, single spaces, lower case. */
const nameKey = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether the last name a guest gives matches the one stored. Exact (case
 * and spacing aside) for every booking. Direct bookings by API key store
 * everything after the first word of the name the integration sent ("Mary
 * Jane Watson" → "Jane Watson"), so for those (`direct`) the trailing words
 * also match ("Watson", "Jane Watson") — the confirmation code is still
 * required either way.
 */
export function lastNameMatches(stored: string, given: string, direct: boolean): boolean {
  const s = nameKey(stored);
  const g = nameKey(given);
  if (!g || !s) return false;
  if (s === g) return true;
  // "Smith" finds a stored "Lee Smith" (middle names end up in the last name); the code is still required.
  void direct;
  return s.endsWith(` ${g}`);
}

/**
 * Finds a booking by confirmation code and the guest's last name (both must
 * match; see lastNameMatches). Scoped to one hotel when `propertyId` is given
 * (the hotel voice tools); codes are unique platform-wide otherwise.
 */
export async function lookupBooking(q: { propertyId?: string; code: string; lastName: string }) {
  const code = normalizeBookingCode(q.code);
  if (!code) return null;
  const found = await prisma.booking.findFirst({
    where: { ...(q.propertyId ? { propertyId: q.propertyId } : {}), code },
    include: { roomType: { select: { name: true } }, property: { select: { id: true, name: true, phone: true, timezone: true } }, user: { select: { lastName: true } } },
  });
  if (!found || !lastNameMatches(found.user.lastName, q.lastName, !!found.guestEmail)) return null;
  const { user: _user, ...booking } = found;
  return booking;
}
