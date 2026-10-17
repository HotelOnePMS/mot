/**
 * Server-side execution of the guest voice agent's tools. Every answer is
 * read from live data with the same services the booking site uses.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { HOTEL_TIMEZONE, formatDay, hotelToday, isISODate, toISODate } from '../dates';
import { DomainError, badRequest } from '../errors';
import { policyFor } from '../services/guest';
import { propertyFacts, runsOnHotelOne } from '../concierge/facts';
import { availabilityOptions, lookupBooking, priceOptions, submitBookingRequest } from '../concierge/shared';
import { checkoutPath } from '../concierge/urls';
import { alertTeam } from '../services/guestRequests';
import { useSkill as runSkill } from '../skills';

// Hotel facts live with the concierge (shared with the agent API and skills).
export { propertyFacts };

const isoDate = z.string().refine(isISODate, 'must be YYYY-MM-DD');

/**
 * Where a guest conversation is happening: the booking page, or the hotel's
 * phone line or WhatsApp (`via`), with the caller's number if known.
 */
export type GuestChannel = { kind: 'WEB' } | { kind: 'PHONE'; callerNumber: string | null; via?: 'PHONE' | 'WHATSAPP' };

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export async function runGuestTool(propertyId: string, name: string, rawArgs: unknown, channel: GuestChannel = { kind: 'WEB' }): Promise<unknown> {
  const phone = channel.kind === 'PHONE';
  const source = channel.kind === 'PHONE' ? (channel.via ?? 'PHONE') : 'VOICE';
  // Hotels that keep their own system: HotelOne can't see their availability or reservations, so their team confirms bookings.
  const hotel = await prisma.property.findUnique({ where: { id: propertyId }, select: { setupPath: true } });
  const live = runsOnHotelOne(hotel?.setupPath);
  switch (name) {
    case 'get_property_info':
      return propertyFacts(propertyId);

    case 'check_availability': {
      const a = z.object({ check_in: isoDate, check_out: isoDate, guests: z.number().int().min(1).max(16), rooms: z.number().int().min(1).max(9) }).parse(rawArgs);
      const stay = { checkIn: a.check_in, checkOut: a.check_out, guests: a.guests, rooms: a.rooms };
      return live ? availabilityOptions(propertyId, stay) : priceOptions(propertyId, stay);
    }

    case 'start_booking': {
      if (phone) return { error: 'There’s no screen on a phone call — use request_booking instead.' };
      if (!live) return { error: 'This hotel’s front desk confirms bookings — use request_booking instead.' };
      const a = z.object({ room_type_id: z.string().min(1), check_in: isoDate, check_out: isoDate, guests: z.number().int().min(1).max(16), rooms: z.number().int().min(1).max(9) }).parse(rawArgs);
      const rt = await prisma.roomType.findFirst({ where: { id: a.room_type_id, propertyId, isActive: true }, select: { id: true, name: true } });
      if (!rt) return { error: 'That room type isn’t available here — check availability again.' };
      const url = checkoutPath(propertyId, { roomTypeId: rt.id, checkIn: a.check_in, checkOut: a.check_out, guests: a.guests, rooms: a.rooms });
      return { opened: true, room: rt.name, url, say: `I’ve opened the checkout for the ${rt.name} on your screen.` };
    }

    case 'find_booking': {
      if (!live) return { found: false, say: 'I can’t look up reservations here, but I can take a message for the front desk — what’s your name, your dates, and what do you need?' };
      const a = z.object({ confirmation_code: z.string().min(4).max(20), last_name: z.string().min(1).max(60) }).parse(rawArgs);
      const b = await lookupBooking({ propertyId, code: a.confirmation_code, lastName: a.last_name });
      // Same answer for a wrong code or a wrong name: don't confirm either alone.
      if (!b) return { found: false, say: 'I couldn’t find a booking with that code and last name.' };
      const checkIn = toISODate(b.checkIn);
      const policy = policyFor(checkIn);
      return {
        found: true,
        status: b.status,
        room: b.roomType.name,
        check_in: formatDay(checkIn, 'weekday'),
        check_out: formatDay(toISODate(b.checkOut), 'weekday'),
        guests: b.guests,
        free_changes_until: policy.passed ? null : policy.deadlineLabel,
        manage: 'The guest can change dates or cancel from the link in their confirmation, or by signing in at the booking site.',
      };
    }

    case 'request_booking': {
      if (!phone && live) return { error: 'Use start_booking to open the checkout on the guest’s screen.' };
      const a = z
        .object({
          room_type_id: z.string().min(1),
          check_in: isoDate,
          check_out: isoDate,
          guests: z.number().int().min(1).max(16),
          rooms: z.number().int().min(1).max(9),
          name: z.string().trim().min(1).max(120),
          email: optionalText(200),
          phone: optionalText(40),
          notes: optionalText(500),
        })
        .parse(rawArgs);
      return submitBookingRequest(
        propertyId,
        {
          roomTypeId: a.room_type_id,
          checkIn: a.check_in,
          checkOut: a.check_out,
          guests: a.guests,
          rooms: a.rooms,
          name: a.name,
          email: a.email,
          // On the phone, the caller ID is the callback number unless they gave another.
          phone: a.phone || (phone ? channel.callerNumber : null),
          notes: a.notes,
          source,
          // On the web, a voice-only hotel's only guest is its own team trying it out.
          label: phone ? undefined : hotel?.setupPath === 'VOICE' ? 'Test call' : 'Booking page',
        },
        live,
      );
    }

    case 'use_skill': {
      // The hotel's saved answers and tools (AgentSkill); phone calls are pinned to their hotel.
      const a = z.object({ key: z.string().trim().min(1).max(80), arguments: z.string().max(4000).nullish() }).parse(rawArgs);
      let values: unknown = {};
      if (a.arguments?.trim()) {
        try {
          values = JSON.parse(a.arguments);
        } catch {
          return { error: 'arguments must be a JSON object, e.g. {"date":"2026-11-14"}.' };
        }
      }
      return runSkill(propertyId, a.key, values, { audience: 'GUEST' });
    }

    case 'leave_message': {
      const a = z.object({ name: z.string().trim().min(1).max(120), phone: optionalText(40), email: optionalText(200), message: z.string().trim().min(1).max(1000) }).parse(rawArgs);
      // On the phone, the caller ID is the callback number unless they gave another.
      const callback = a.phone || (phone ? channel.callerNumber : null);
      if (!callback && !a.email) return { error: 'Ask for a phone number or email so the team can reply.' };
      const r = await prisma.guestRequest.create({ data: { propertyId, name: a.name, phone: callback || null, email: a.email || null, message: a.message, source } });
      alertTeam(r.id);
      return { saved: true, reference: r.id.slice(-6).toUpperCase(), say: 'I’ve passed that to the team — they’ll get back to you.' };
    }

    default:
      throw badRequest(`Unknown tool ${name}.`);
  }
}

export const guestContext = () => ({ today: hotelToday(), timezone: HOTEL_TIMEZONE });

/**
 * Run a tool and always return something the model can use: validation
 * problems go back so it can correct itself, domain errors are written for
 * people, and anything else stays in the logs.
 */
export async function guestToolOutput(propertyId: string, name: string, args: unknown, channel?: GuestChannel): Promise<unknown> {
  try {
    return await runGuestTool(propertyId, name, args, channel);
  } catch (e) {
    if (!(e instanceof z.ZodError) && !(e instanceof DomainError)) console.error('voice tool failed', name, e);
    return {
      error:
        e instanceof z.ZodError
          ? `Invalid arguments: ${e.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`
          : e instanceof DomainError
            ? e.message
            : 'That lookup failed — offer to take a message for the team instead.',
    };
  }
}
