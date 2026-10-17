/**
 * Hotel search across every listed hotel, for the global voice concierge and
 * external assistants. Text matching runs over the (small) directory in
 * memory; live availability uses the booking site's inventory service.
 */
import { prisma } from '@/lib/prisma';
import { badRequest } from '../errors';
import { diffDays } from '../dates';
import { propertyAvailability } from '../services/inventory';
import { CURRENCY, LISTED_PROPERTY } from './facts';
import { conciergeSchemas, type SearchHotelsInput } from './schemas';
import { stayDateError } from './shared';
import { absoluteUrl, propertyUrl } from './urls';

/** One hotel in search results. Money in `currency` (USD), dates YYYY-MM-DD. */
export interface HotelSearchResult {
  id: string;
  name: string;
  city: string;
  state: string;
  tagline: string | null;
  /** Absolute URL of the main photo. */
  photo: string | null;
  /** Lowest base nightly price among room types that fit the party (any room type if none fit). */
  fromPricePerNight: number | null;
  currency: typeof CURRENCY;
  /** Largest room type, in guests per room. */
  maxGuestsPerRoom: number;
  /** Some room type sleeps the party in the requested number of rooms. */
  fitsParty: boolean;
  /** With dates: a fitting room type is free for every night. Null without dates. */
  available: boolean | null;
  /** With dates, when available: the cheapest fitting option's average nightly price (per room). */
  cheapestNightly?: number;
  /** With dates, when available: that option's total for the whole stay and all rooms. */
  stayTotal?: number;
  /** With dates, when available: that option's room type id (for checkAvailability / bookingLink). */
  cheapestRoomTypeId?: string;
  /** Absolute URL of the hotel's booking page (stay pre-filled when dates were given). */
  url: string;
}

/** What `searchHotels` returns. */
export interface SearchHotelsResult {
  hotels: HotelSearchResult[];
  /** Hotels that matched the text before `limit` (and the availability cap) applied. */
  matched: number;
  /** The stay that was priced, or null without dates. */
  stay: { checkIn: string; checkOut: string; nights: number; guests: number; rooms: number } | null;
}

/** Hotels priced live per search; the rest of a large match set is left out. */
const MAX_PRICED = 30;
const PRICE_CONCURRENCY = 6;

const STOPWORDS = new Set(['a', 'an', 'the', 'in', 'into', 'near', 'nearby', 'at', 'by', 'around', 'of', 'for', 'and', 'or', 'to', 'on', 'close', 'hotel', 'hotels', 'motel', 'motels', 'inn', 'inns', 'lodging', 'stay', 'stays', 'room', 'rooms', 'place', 'places', 'somewhere', 'area', 'usa', 'us']);

const US_STATES: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware', DC: 'district of columbia',
  FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine',
  MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
  NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon',
  PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia',
  WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([abbr, name]) => [name, abbr.toLowerCase()]));

const words = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Search tokens: lower-cased words without filler ("hotels near santa cruz ca" → santa, cruz, ca). */
export function searchTokens(...texts: (string | undefined)[]): string[] {
  return [...new Set(texts.flatMap((t) => words(t)).filter((w) => !STOPWORDS.has(w)))];
}

/** Words a hotel can be found by: name, city, state (abbreviation and full name), address, zip, tagline. */
function haystack(p: { name: string; city: string; state: string; address: string; zipCode: string; tagline: string | null }): string[] {
  const state = p.state.trim();
  const expanded = US_STATES[state.toUpperCase()] ?? '';
  const abbr = STATE_BY_NAME.get(state.toLowerCase()) ?? '';
  return [...new Set([p.name, p.city, state, expanded, abbr, p.address, p.zipCode, p.tagline].flatMap(words))];
}

/** Every token must match a word: short tokens (≤ 2 chars, e.g. "ca") exactly, longer ones as a word prefix. */
function matches(tokens: string[], hay: string[]): boolean {
  return tokens.every((t) => hay.some((w) => (t.length <= 2 ? w === t : w.startsWith(t))));
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/**
 * Finds listed hotels by place or name, optionally priced for a stay.
 * `location` and `query` are matched token by token (case- and
 * accent-insensitive; "santa cruz ca" and "Santa Cruz, California" both
 * match a Santa Cruz, CA hotel). Hotels without bookable room types are left
 * out. With dates, up to 30 matching hotels get live availability and the
 * cheapest fitting price; results are sorted available first, then by price.
 * Throws ZodError for bad input and DomainError 400 for bad dates.
 */
export async function searchHotels(input: SearchHotelsInput): Promise<SearchHotelsResult> {
  const a = conciergeSchemas.searchHotels.parse(input);
  if (!!a.checkIn !== !!a.checkOut) throw badRequest('Give both checkIn and checkOut, or neither.');
  const dates = a.checkIn && a.checkOut ? { checkIn: a.checkIn, checkOut: a.checkOut } : null;
  if (dates) {
    const error = stayDateError(dates, 'Stays are limited to 30 nights online.');
    if (error) throw badRequest(error);
  }

  const tokens = searchTokens(a.location, a.query);
  const properties = await prisma.property.findMany({
    where: { ...LISTED_PROPERTY, roomTypes: { some: { isActive: true } } },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      address: true,
      zipCode: true,
      tagline: true,
      photos: { orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }], take: 1, select: { url: true } },
      roomTypes: { where: { isActive: true }, select: { basePrice: true, capacity: true } },
    },
    orderBy: [{ isDemo: 'desc' }, { createdAt: 'asc' }],
  });
  const found = properties.filter((p) => !tokens.length || matches(tokens, haystack(p)));

  const base = found.map((p) => {
    const fitting = p.roomTypes.filter((t) => t.capacity * a.rooms >= a.guests);
    const priced = fitting.length ? fitting : p.roomTypes;
    const result: HotelSearchResult = {
      id: p.id,
      name: p.name,
      city: p.city,
      state: p.state,
      tagline: p.tagline || null,
      photo: absoluteUrl(p.photos[0]?.url),
      fromPricePerNight: priced.length ? Math.min(...priced.map((t) => Number(t.basePrice))) : null,
      currency: CURRENCY,
      maxGuestsPerRoom: p.roomTypes.reduce((m, t) => Math.max(m, t.capacity), 0),
      fitsParty: fitting.length > 0,
      available: dates ? false : null,
      url: propertyUrl(p.id, dates ? { ...dates, guests: a.guests, rooms: a.rooms } : undefined),
    };
    return result;
  });

  let results = base;
  if (dates) {
    // Price the most promising hotels: ones that fit the party, cheapest first.
    const candidates = [...base].sort((x, y) => Number(y.fitsParty) - Number(x.fitsParty) || (x.fromPricePerNight ?? Infinity) - (y.fromPricePerNight ?? Infinity)).slice(0, MAX_PRICED);
    results = await inBatches(candidates, PRICE_CONCURRENCY, async (h) => {
      if (!h.fitsParty) return h;
      const types = await propertyAvailability({ propertyId: h.id, checkIn: dates.checkIn, checkOut: dates.checkOut, guests: a.guests, rooms: a.rooms });
      const best = types
        .filter((t) => t.capacity * a.rooms >= a.guests && t.available >= a.rooms && t.quote)
        .sort((x, y) => x.quote!.averageNightly - y.quote!.averageNightly)[0];
      return best ? { ...h, available: true, cheapestNightly: best.quote!.averageNightly, stayTotal: best.quote!.total, cheapestRoomTypeId: best.id } : h;
    });
  }

  const price = (h: HotelSearchResult) => h.cheapestNightly ?? h.fromPricePerNight ?? Infinity;
  results.sort((x, y) => Number(y.available === true) - Number(x.available === true) || Number(y.fitsParty) - Number(x.fitsParty) || price(x) - price(y) || x.name.localeCompare(y.name));

  return {
    hotels: results.slice(0, a.limit),
    matched: found.length,
    stay: dates ? { ...dates, nights: diffDays(dates.checkIn, dates.checkOut), guests: a.guests, rooms: a.rooms } : null,
  };
}
