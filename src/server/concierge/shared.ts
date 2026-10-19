/**
 * Stay rules shared by the hotel voice tools (booking page, phone line,
 * WhatsApp) and the concierge. Results keep the voice tools' wire shapes —
 * `{ error }` for a rule the model should explain — so their behaviour
 * doesn't change; the concierge turns `{ error }` into a DomainError.
 */
import { prisma } from '@/lib/prisma';
import type { StayQuote } from '@/lib/dto';
import { allocateGuests, normalizeSelection, selectionError, selectionLabel, totalRooms, type RoomSelection } from '@/lib/room-selection';
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

/** One room type (roomTypeId + rooms) or a mix (roomTypes), as the booking tools take it. */
export interface RoomChoice {
  roomTypeId?: string | null;
  rooms: number;
  roomTypes?: RoomSelection[] | null;
}

/** The rooms a tool call asked for, or `{ error }` the model can fix. */
export function chosenRooms(a: RoomChoice): RoomSelection[] | { error: string } {
  const items = a.roomTypes?.length ? normalizeSelection(a.roomTypes) : a.roomTypeId ? [{ roomTypeId: a.roomTypeId, rooms: a.rooms }] : [];
  if (!items.length) return { error: 'Which room? Pass a room type id from check_availability, or a list of room types for a mix.' };
  const problem = selectionError(items);
  return problem ? { error: problem } : items;
}

/** One or more room types for a stay that can be booked right now, with the booking's total. */
export interface BookableRooms {
  lines: { roomType: BookableStay['roomType']; quote: StayQuote; rooms: number }[];
  nights: number;
  rooms: number;
  /** USD, whole stay, every room. */
  total: number;
  /** "Ocean King" or "Ocean King × 1, Garden Double × 2". */
  label: string;
}

/**
 * `bookableStay` for a booking that may mix room types: every type is checked
 * (active here, enough rooms free) and the rooms together must sleep the
 * party, with at least one guest per type. One type keeps bookableStay's
 * exact rules and wording.
 */
export async function bookableRooms(
  propertyId: string,
  a: StayInput & RoomChoice,
  longStayMessage: string,
  liveInventory = true,
): Promise<BookableRooms | { error: string }> {
  const items = chosenRooms(a);
  if ('error' in items) return items;
  if (items.length === 1) {
    const one = await bookableStay(propertyId, { ...a, roomTypeId: items[0].roomTypeId, rooms: items[0].rooms }, longStayMessage, liveInventory);
    if ('error' in one) return one;
    return { lines: [{ roomType: one.roomType, quote: one.quote, rooms: items[0].rooms }], nights: one.nights, rooms: items[0].rooms, total: one.quote.total, label: one.roomType.name };
  }
  const error = stayDateError(a, longStayMessage);
  if (error) return { error };
  const types = await prisma.roomType.findMany({ where: { id: { in: items.map((i) => i.roomTypeId) }, propertyId, isActive: true }, select: { id: true, name: true, capacity: true } });
  const lines = [];
  for (const item of items) {
    const rt = types.find((t) => t.id === item.roomTypeId);
    if (!rt) return { error: 'One of those room types isn’t available here — check availability again.' };
    lines.push({ roomType: rt, rooms: item.rooms });
  }
  const shares = allocateGuests(a.guests, lines.map((l) => ({ capacity: l.roomType.capacity, rooms: l.rooms })));
  if (!shares) {
    if (a.guests < lines.length) return { error: 'Each room type needs at least one guest — drop a room type or add guests.' };
    return { error: `Those rooms sleep up to ${lines.reduce((n, l) => n + l.roomType.capacity * l.rooms, 0)} — add a room or choose larger rooms.` };
  }
  const quoted = [];
  for (const [n, l] of lines.entries()) {
    const quote = await quoteStay(prisma, { roomTypeId: l.roomType.id, checkIn: a.checkIn, checkOut: a.checkOut, rooms: l.rooms, guests: shares[n] });
    if (liveInventory && quote.available < l.rooms) {
      return { error: `${quote.available ? `Only ${quote.available} ${l.roomType.name} left` : `The ${l.roomType.name} is no longer free`} for those dates — check availability again.` };
    }
    quoted.push({ ...l, quote });
  }
  return {
    lines: quoted,
    nights: diffDays(a.checkIn, a.checkOut),
    rooms: totalRooms(items),
    total: Math.round(quoted.reduce((n, l) => n + l.quote.total, 0) * 100) / 100,
    label: selectionLabel(quoted.map((l) => ({ name: l.roomType.name, rooms: l.rooms }))),
  };
}

/** A booking request for the hotel team (phone line `request_booking`). */
export interface BookingRequestInput extends StayInput, RoomChoice {
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
  const stay = await bookableRooms(propertyId, a, 'Stays over 30 nights go through the team — take a message instead.', liveInventory);
  if ('error' in stay) return stay;
  const { nights, rooms } = stay;
  const total: number | null = stay.total;
  // The same pre-filled checkout the booking page opens: staff send it to the guest to finish online.
  const items = stay.lines.map((l) => ({ roomTypeId: l.roomType.id, rooms: l.rooms }));
  const link = `${publicSiteUrl() ?? ''}${checkoutPath(propertyId, { items, checkIn: a.checkIn, checkOut: a.checkOut, guests: a.guests })}`;
  const message = [
    `${a.label ?? REQUEST_LABEL[a.source] ?? 'Phone'} booking request: ${stay.label}, ${formatDay(a.checkIn, 'weekday')} to ${formatDay(a.checkOut, 'weekday')} (${nights} night${nights > 1 ? 's' : ''}), ${a.guests} guest${a.guests > 1 ? 's' : ''}${rooms > 1 && stay.lines.length === 1 ? `, ${rooms} rooms` : ''}.`,
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

/** A booking that mixes room types, as one: "Ocean King × 1, Garden Double × 2", every room and guest. Null for a single type. */
export async function groupSummary(b: { groupCode: string | null }): Promise<{ label: string; rooms: number; guests: number; total: number } | null> {
  if (!b.groupCode) return null;
  const all = await prisma.booking.findMany({
    where: { groupCode: b.groupCode, status: { not: 'CANCELLED' } },
    select: { rooms: true, guests: true, totalPrice: true, roomType: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (all.length < 2) return null;
  return {
    label: selectionLabel(all.map((x) => ({ name: x.roomType.name, rooms: x.rooms }))),
    rooms: all.reduce((n, x) => n + x.rooms, 0),
    guests: all.reduce((n, x) => n + x.guests, 0),
    total: Math.round(all.reduce((n, x) => n + Number(x.totalPrice), 0) * 100) / 100,
  };
}
