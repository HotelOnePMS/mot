/**
 * Server side of the booking-site voice (the voice dock), for both scopes:
 *
 * - HOTEL: a hotel's front desk on its own pages. Every tool is pinned to the
 *   session's hotel; another property_id is refused (white-label: it never
 *   looks up other hotels).
 * - GLOBAL: the HotelOne concierge across every listed hotel, built on the
 *   shared concierge toolkit (@/server/concierge), the same code the agent
 *   API uses.
 *
 * Tools that change the guest's screen return a relative `url` the browser
 * opens (open_hotel, start_booking); fill_guest_details and confirm_booking
 * run in the browser only. Results are compact JSON for a voice model, with
 * `{ error }` for anything it should explain or correct.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  bookingLink,
  checkAvailability,
  conciergeError,
  consumeRateLimit,
  findBooking,
  findListedHotel,
  hotelDetails,
  searchHotels,
} from '../concierge';
import { runsOnHotelOne } from '../concierge/facts';
import { availabilityOptions } from '../concierge/shared';
import { useSkill as runSkill } from '../skills';
import { PRODUCT_NAME } from '@/config/product';
import { CLIENT_ONLY_TOOLS, TOUR_TOOLS, type VoiceScope } from './live';
import { runGuestTool } from './guestTools';
import { isISODate } from '../dates';

export interface WebVoiceSession {
  /** VoiceSession id (rate limits per conversation). */
  sid: string;
  scope: VoiceScope;
  /** The session's hotel; null for GLOBAL. */
  pid: string | null;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').refine(isISODate, 'must be a real date');
const optionalId = z.string().trim().max(64).nullish();
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const count = (max: number) => z.coerce.number().int().min(1).max(max);

/** The path part of an absolute site URL, so the browser stays on this deployment. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Voice-sized hotel facts: hotelDetails without photo URLs and links. */
async function hotelFacts(propertyId: string) {
  const { photos: _photos, url: _url, ...facts } = await hotelDetails(propertyId);
  return facts;
}

/** A skill's inputs arrive as JSON text (strict tool schemas can't take free-form objects). */
function skillArgs(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    throw new z.ZodError([{ code: 'custom', path: ['arguments'], message: 'must be a JSON object, e.g. {"date":"2026-11-14"}' }]);
  }
}

/** Which hotel a tool call is about: the session's (HOTEL) or the one named (GLOBAL). */
async function hotelFor(session: WebVoiceSession, given: string | null | undefined): Promise<{ id: string } | { error: string }> {
  const id = given?.trim() || null;
  if (session.scope === 'HOTEL') {
    if (id && id !== session.pid) {
      const name = (await prisma.property.findUnique({ where: { id: session.pid! }, select: { name: true } }))?.name ?? 'this hotel';
      return { error: `This line only handles ${name}. Leave property_id empty — it means ${name}.` };
    }
    return { id: session.pid! };
  }
  if (!id) return { error: 'Which hotel? Pass its property_id from search_hotels.' };
  return { id: (await findListedHotel(id)).id };
}

const hotelOnly = (tool: string) => ({ error: `${tool} isn’t available on a hotel’s own line — this conversation is only about this hotel.` });

/** Front-desk tools that hotels keeping their own system answer through guestTools: prices without availability, requests instead of checkout. */
const REQUEST_ONLY_DESK_TOOLS = new Set(['get_property_info', 'check_availability', 'start_booking', 'request_booking']);

/**
 * Runs one booking-site voice tool. Throws ZodError / DomainError for bad
 * input and rule failures (see `webToolOutput`).
 */
export async function runWebTool(session: WebVoiceSession, name: string, raw: unknown): Promise<unknown> {
  const args = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hotel = session.scope === 'HOTEL';

  if (TOUR_TOOLS.has(name)) {
    return { error: `${name} runs on the visitor’s screen and only in the ${PRODUCT_NAME} concierge.` };
  }
  if (CLIENT_ONLY_TOOLS.has(name)) {
    return { error: `${name} works on the guest’s screen while checkout is open. Call start_booking first to open checkout.` };
  }

  if (hotel && REQUEST_ONLY_DESK_TOOLS.has(name)) {
    // Voice-only and keep-your-PMS hotels aren't listed (hotelDetails refuses them): their team's test call quotes prices and takes requests.
    const p = await prisma.property.findUnique({ where: { id: session.pid! }, select: { setupPath: true } });
    if (!runsOnHotelOne(p?.setupPath)) {
      const h = await hotelFor(session, optionalId.parse(args.property_id));
      if ('error' in h) return h;
      return runGuestTool(h.id, name, args);
    }
  }

  switch (name) {
    case 'search_hotels': {
      if (hotel) return hotelOnly('search_hotels');
      const a = z
        .object({ location: optionalText(100), query: optionalText(100), check_in: isoDate.nullish(), check_out: isoDate.nullish(), guests: count(16).default(2), rooms: count(9).default(1) })
        .parse(args);
      const r = await searchHotels({
        location: a.location || undefined,
        query: a.query || undefined,
        checkIn: a.check_in || undefined,
        checkOut: a.check_out || undefined,
        guests: a.guests,
        rooms: a.rooms,
        limit: 5,
      });
      return {
        stay: r.stay,
        matched: r.matched,
        hotels: r.hotels.map((h) => ({
          property_id: h.id,
          name: h.name,
          town: `${h.city}, ${h.state}`,
          tagline: h.tagline,
          from_price_per_night: h.fromPricePerNight,
          fits_party: h.fitsParty,
          available: h.available,
          ...(h.cheapestNightly !== undefined ? { cheapest_per_night: h.cheapestNightly, stay_total: h.stayTotal, cheapest_room_type_id: h.cheapestRoomTypeId } : {}),
        })),
        ...(r.note ? { note: r.note } : {}),
        ...(r.places ? { places_with_hotels: r.places } : {}),
        ...(r.hotels.length === 0 ? { say: 'Say HotelOne has no hotels there yet, and offer one of places_with_hotels if it is nearby.' } : {}),
      };
    }

    case 'get_property_info': {
      const a = z.object({ property_id: optionalId }).parse(args);
      const h = await hotelFor(session, a.property_id);
      if ('error' in h) return h;
      return hotelFacts(h.id);
    }

    case 'check_availability': {
      const a = z.object({ property_id: optionalId, check_in: isoDate, check_out: isoDate, guests: count(16), rooms: count(9) }).parse(args);
      const h = await hotelFor(session, a.property_id);
      if ('error' in h) return h;
      const stay = { checkIn: a.check_in, checkOut: a.check_out, guests: a.guests, rooms: a.rooms };
      // HOTEL keeps the front desk's own wording ({ error } for date rules); GLOBAL uses the concierge's checks.
      return hotel ? availabilityOptions(h.id, stay) : checkAvailability({ propertyId: h.id, ...stay });
    }

    case 'open_hotel': {
      if (hotel) return hotelOnly('open_hotel');
      const a = z
        .object({ property_id: z.string().trim().min(1).max(64), check_in: isoDate.nullish(), check_out: isoDate.nullish(), guests: count(16).nullish(), rooms: count(9).nullish() })
        .parse(args);
      const h = await findListedHotel(a.property_id);
      const q = new URLSearchParams();
      if (a.check_in && a.check_out && a.check_out > a.check_in) {
        q.set('checkIn', a.check_in);
        q.set('checkOut', a.check_out);
        q.set('guests', String(a.guests ?? 2));
        q.set('rooms', String(a.rooms ?? 1));
      }
      const qs = q.toString();
      return { opened: true, hotel: h.name, property_id: h.id, url: `/properties/${h.id}${qs ? `?${qs}` : ''}`, say: `I’ve opened ${h.name} on your screen.` };
    }

    case 'start_booking': {
      const a = z
        .object({
          property_id: optionalId,
          room_type_id: z.string().trim().min(1).max(64).nullish(),
          check_in: isoDate,
          check_out: isoDate,
          guests: count(16),
          rooms: count(9),
          // Several room types booked together, in place of room_type_id + rooms.
          items: z.array(z.object({ room_type_id: z.string().trim().min(1).max(64), rooms: count(9) })).max(4).nullish(),
        })
        .parse(args);
      const h = await hotelFor(session, a.property_id);
      if ('error' in h) return h;
      const link = await bookingLink({
        propertyId: h.id,
        roomTypeId: a.room_type_id || undefined,
        items: a.items?.length ? a.items.map((i) => ({ roomTypeId: i.room_type_id, rooms: i.rooms })) : undefined,
        checkIn: a.check_in,
        checkOut: a.check_out,
        guests: a.guests,
        rooms: a.rooms,
      });
      const s = link.summary;
      const room = s.items.length > 1 ? s.items.map((i) => `${i.rooms} × ${i.roomType.name}`).join(', ') : s.roomType.name;
      return {
        opened: true,
        url: pathOf(link.url),
        // What confirm_booking takes, so the model names exactly what it books.
        property_id: s.hotel.id,
        room_type_id: s.roomType.id,
        items: s.items.length > 1 ? s.items.map((i) => ({ room_type_id: i.roomType.id, rooms: i.rooms })) : null,
        hotel: s.hotel.name,
        room,
        check_in: s.checkIn,
        check_out: s.checkOut,
        nights: s.nights,
        guests: s.guests,
        rooms: s.rooms,
        total: s.total,
        currency: s.currency,
        say: s.items.length > 1 ? `I’ve opened the checkout for ${room} on your screen.` : `I’ve opened the checkout for the ${s.roomType.name} on your screen.`,
      };
    }

    case 'request_booking':
      return { error: 'Use start_booking to open the checkout on the guest’s screen.' };

    case 'find_booking': {
      const a = z.object({ confirmation_code: z.string().trim().min(4).max(20), last_name: z.string().trim().min(1).max(60) }).parse(args);
      // A conversation can't be used to guess codes.
      await consumeRateLimit(`voice:find_booking:${session.sid}`, 6, 10 * 60_000, 'That’s a lot of lookups — ask the guest to check the code in their confirmation email.');
      if (hotel) return runGuestTool(session.pid!, 'find_booking', a);
      const r = await findBooking({ code: a.confirmation_code, lastName: a.last_name });
      if (!r.found) return { found: false, say: 'I couldn’t find a booking with that code and last name.' };
      const { bookingUrl: _url, ...rest } = r;
      return rest;
    }

    case 'leave_message': {
      const a = z.object({ property_id: optionalId, name: z.string().trim().min(1).max(120), phone: optionalText(40), email: optionalText(200), message: z.string().trim().min(1).max(1000) }).parse(args);
      const h = await hotelFor(session, a.property_id);
      if ('error' in h) return h;
      return runGuestTool(h.id, 'leave_message', { name: a.name, phone: a.phone ?? null, email: a.email ?? null, message: a.message });
    }

    case 'use_skill': {
      const a = z.object({ property_id: optionalId, key: z.string().trim().min(1).max(80), arguments: z.unknown().optional() }).parse(args);
      // GLOBAL without a hotel: platform-wide skills only.
      const h = hotel || a.property_id ? await hotelFor(session, a.property_id) : null;
      if (h && 'error' in h) return h;
      return runSkill(h?.id ?? null, a.key, skillArgs(a.arguments), { audience: 'GUEST' });
    }

    default:
      return { error: `Unknown tool ${name}.` };
  }
}

/**
 * Runs a tool and always returns something the model can use: validation
 * problems listed so it can correct itself, rule failures as written for
 * people, anything else logged and replaced with a gentle line.
 */
export async function webToolOutput(session: WebVoiceSession, name: string, args: unknown): Promise<unknown> {
  try {
    return await runWebTool(session, name, args);
  } catch (e) {
    // conciergeError logs unexpected failures.
    const err = conciergeError(e);
    return { error: err.code === 'INTERNAL' ? 'That lookup failed — offer to take a message for the team instead.' : err.error };
  }
}
