/**
 * Hotel facts and visibility rules shared by the guest voice tools, the
 * concierge (global voice + agent API) and the skills generator. Leaf module:
 * it must not import the concierge index or the skills core.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatClock } from '@/lib/format';

/**
 * Which hotels guests and agents can find and book: the same rule as the
 * public directory (GET /api/properties) and the booking page. Voice-only
 * hotels take bookings in their own system, so they are never listed.
 */
export const LISTED_PROPERTY = { isActive: true, setupPath: { not: 'VOICE' } } as const satisfies Prisma.PropertyWhereInput;

/** The house policy every guest-facing answer quotes (voice tools, skills, concierge). */
export const HOTEL_POLICY = {
  checkIn: 'from 3:00 PM',
  checkOut: 'by 11:00 AM',
  cancellation: 'Free cancellation and date changes until 3:00 PM (hotel time) the day before arrival.',
} as const;

/** Prices are quoted in this currency everywhere (see StayQuote.currency). */
export const CURRENCY = 'USD' as const;

/**
 * Hotels on the voice-only or keep-your-PMS paths take bookings in their own
 * system: HotelOne can't see their availability or reservations, and their
 * policy is their own. Only hotels running fully on HotelOne are listed and
 * bookable online, and only they quote live availability.
 */
export const runsOnHotelOne = (setupPath: string | null | undefined) => (setupPath ?? 'FULL') === 'FULL';

/** What callers are told when a hotel hasn't given a policy: the team answers it. */
const NOT_ON_FILE = 'Not on file — offer to take a message so the team can confirm.';

/**
 * The check-in/out times and cancellation policy guests are told: the booking
 * engine's for hotels on HotelOne, the hotel's own otherwise.
 */
export function hotelPolicy(
  setupPath: string | null | undefined,
  own: { checkInTime?: string | null; checkOutTime?: string | null; cancellationPolicy?: string | null } | null | undefined,
): { checkIn: string; checkOut: string; cancellation: string } {
  if (runsOnHotelOne(setupPath)) return HOTEL_POLICY;
  return {
    checkIn: own?.checkInTime ? `from ${formatClock(own.checkInTime)}` : NOT_ON_FILE,
    checkOut: own?.checkOutTime ? `by ${formatClock(own.checkOutTime)}` : NOT_ON_FILE,
    cancellation: own?.cancellationPolicy?.trim() || NOT_ON_FILE,
  };
}

/** A hotel FAQ as stored in VoiceAgentConfig.faqs; malformed entries are dropped. */
export function cleanFaqs(raw: unknown): { q: string; a: string }[] {
  return Array.isArray(raw) ? (raw as { q?: string; a?: string }[]).filter((f) => f?.q && f?.a).map((f) => ({ q: f.q!, a: f.a! })) : [];
}

/**
 * Hotel facts for agents (the guest voice tool `get_property_info`): story,
 * address, contact, amenities, policy, active room types with base prices and
 * the hotel's FAQs. Throws (Prisma not-found) for an unknown id; callers check
 * visibility first.
 */
export async function propertyFacts(propertyId: string) {
  const p = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    include: { roomTypes: { where: { isActive: true }, orderBy: { basePrice: 'asc' } }, voiceAgent: true },
  });
  const faqs = Array.isArray(p.voiceAgent?.faqs) ? (p.voiceAgent!.faqs as { q?: string; a?: string }[]).filter((f) => f?.q && f?.a) : [];
  const policy = hotelPolicy(p.setupPath, p.voiceAgent);
  return {
    name: p.name,
    type: p.type,
    tagline: p.tagline,
    description: p.description,
    address: `${p.address}, ${p.city}, ${p.state} ${p.zipCode}`,
    phone: p.phone,
    email: p.email,
    amenities: p.amenities,
    check_in: policy.checkIn,
    check_out: policy.checkOut,
    cancellation: policy.cancellation,
    room_types: p.roomTypes.map((rt) => ({ id: rt.id, name: rt.name, sleeps: rt.capacity, from_price_per_night: Number(rt.basePrice), amenities: rt.amenities, description: rt.description })),
    faqs,
  };
}

/** What `propertyFacts` returns. */
export type PropertyFacts = Awaited<ReturnType<typeof propertyFacts>>;
