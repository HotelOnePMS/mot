/**
 * One hotel, for agents: its facts and answer skills, and live availability.
 */
import { prisma } from '@/lib/prisma';
import { badRequest, notFound } from '../errors';
import { ensureConfigSkills, listSkills, type AnswerBody } from '../skills';
import { CURRENCY, LISTED_PROPERTY, propertyFacts, type PropertyFacts } from './facts';
import { conciergeSchemas, type CheckAvailabilityInput } from './schemas';
import { availabilityOptions, type AvailabilityResult } from './shared';
import { absoluteUrl, propertyUrl } from './urls';

/** A listed hotel's id and name, or DomainError 404. */
export async function findListedHotel(propertyId: string): Promise<{ id: string; name: string }> {
  const p = await prisma.property.findFirst({ where: { id: propertyId, ...LISTED_PROPERTY }, select: { id: true, name: true } });
  if (!p) throw notFound('Hotel');
  return p;
}

/** What `hotelDetails` returns: `propertyFacts` (snake_case, as the voice tools see it) without `faqs`, plus ids, photos, skills and the URL. */
export type HotelDetails = Omit<PropertyFacts, 'faqs'> & {
  id: string;
  currency: typeof CURRENCY;
  /** Absolute URLs, main photo first (at most 6). */
  photos: string[];
  /** The hotel's active guest-facing answers (FAQs, amenities, policies, rooms, contact…), most used first. */
  skills: { key: string; title: string; answer: string }[];
  /** Absolute URL of the hotel's booking page. */
  url: string;
};

/**
 * Everything an agent needs to talk about one listed hotel. FAQs come as
 * `skills` (so a hotel can switch one off); hotels that have never had their
 * skills generated get them now. DomainError 404 for unknown or unlisted hotels.
 */
export async function hotelDetails(propertyId: string): Promise<HotelDetails> {
  const { propertyId: id } = conciergeSchemas.hotelDetails.parse({ propertyId });
  await findListedHotel(id);
  await ensureConfigSkills(id);
  const [facts, photos, skills] = await Promise.all([
    propertyFacts(id),
    prisma.propertyPhoto.findMany({ where: { propertyId: id }, orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }], take: 6, select: { url: true } }),
    listSkills(id, { audience: 'GUEST', status: ['ACTIVE'], kinds: ['ANSWER'] }),
  ]);
  const { faqs: _faqs, ...rest } = facts;
  return {
    id,
    ...rest,
    currency: CURRENCY,
    photos: photos.map((p) => absoluteUrl(p.url)).filter((u): u is string => !!u),
    skills: skills.map((s) => ({ key: s.key, title: s.title, answer: (s.body as AnswerBody).answer })),
    url: propertyUrl(id),
  };
}

/** What `checkAvailability` returns: exactly the guest voice tool `check_availability` result. */
export type CheckAvailabilityResult = AvailabilityResult;

/**
 * Live availability and exact prices (USD) for every active room type at a
 * listed hotel — the same rules and output as the guest voice tool
 * `check_availability`. Where that tool returns `{ error }` (past dates,
 * check-out not after check-in, over 30 nights) this throws DomainError 400
 * with the same message. DomainError 404 for unknown or unlisted hotels.
 */
export async function checkAvailability(input: CheckAvailabilityInput): Promise<CheckAvailabilityResult> {
  const a = conciergeSchemas.checkAvailability.parse(input);
  await findListedHotel(a.propertyId);
  const r = await availabilityOptions(a.propertyId, { checkIn: a.checkIn, checkOut: a.checkOut, guests: a.guests, rooms: a.rooms });
  if ('error' in r) throw badRequest(r.error);
  return r;
}
