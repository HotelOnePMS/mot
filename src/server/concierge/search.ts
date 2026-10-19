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
  /** Set when the results are not exact matches: closest places, or the place without the extra words. */
  note?: string;
  /** With no hotels in the place asked for: every town HotelOne lists hotels in ("Santa Cruz, CA"), to suggest one nearby. */
  places?: string[];
}

/** Hotels priced live per search; the rest of a large match set is left out. */
const MAX_PRICED = 30;
const PRICE_CONCURRENCY = 6;

/** Filler that never narrows a search ("hotels near santa cruz county" → santa, cruz). */
const STOPWORDS = new Set(['a', 'an', 'the', 'in', 'into', 'near', 'nearby', 'at', 'by', 'around', 'of', 'for', 'and', 'or', 'to', 'on', 'with', 'close', 'hotel', 'hotels', 'lodging', 'stay', 'stays', 'room', 'rooms', 'place', 'places', 'somewhere', 'area', 'usa', 'us', 'county', 'city', 'downtown', 'want', 'need', 'looking', 'find', 'me', 'some', 'good', 'nice', 'cheap', 'best']);

/** Kinds of property: matched against a hotel's type and name, and never required in a place. */
const TYPE_WORDS = new Set(['motel', 'motels', 'inn', 'inns', 'lodge', 'lodges', 'boutique', 'resort', 'resorts', 'hostel', 'hostels', 'bnb']);

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
    .replace(/\bb\s*(?:&|and|n)\s*b\b/g, 'bnb')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Search tokens: lower-cased words without filler ("hotels near santa cruz ca" → santa, cruz, ca). */
export function searchTokens(...texts: (string | undefined)[]): string[] {
  return [...new Set(texts.flatMap((t) => words(t)).filter((w) => !STOPWORDS.has(w) && !TYPE_WORDS.has(w)))];
}

/** A US state named at the end of a place ("Portland, OR", "Bend OR", "Aspen, Colorado"), as its 2-letter code. */
function trailingState(location: string): { code: string; rest: string } | null {
  const parts = location.trim().split(/[\s,]+/).filter(Boolean);
  for (const n of [3, 2, 1]) {
    if (parts.length <= n) continue;
    const tailWords = parts.slice(-n);
    const tail = tailWords.join(' ').toLowerCase().replace(/\./g, '');
    const rest = parts.slice(0, -n).join(' ');
    const name = STATE_BY_NAME.get(tail);
    if (name) return { code: name, rest };
    if (n === 1 && tail.length === 2 && US_STATES[tail.toUpperCase()]) {
      // "in", "or" and "me" only count as states after a comma or in capitals ("Portland OR").
      const word = tailWords[0].replace(/\./g, '');
      if (!STOPWORDS.has(tail) || word === word.toUpperCase() || /,\s*\S+\s*$/.test(location)) return { code: tail, rest };
    }
  }
  return null;
}

/** Splits a place into words that must all match and an optional state. Type words ("motel") become soft. */
function placeTerms(location: string | undefined): { tokens: string[]; state: string | null; soft: string[] } {
  if (!location?.trim()) return { tokens: [], state: null, soft: [] };
  const st = trailingState(location);
  const text = st ? st.rest : location;
  const all = words(text);
  return {
    tokens: [...new Set(all.filter((w) => !STOPWORDS.has(w) && !TYPE_WORDS.has(w) && !(w.length === 2 && US_STATES[w.toUpperCase()] && STOPWORDS.has(w))))],
    state: st?.code ?? null,
    soft: all.filter((w) => TYPE_WORDS.has(w)),
  };
}

/** Optimal-string-alignment distance, stopping early once it passes 1. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ra = a.slice(i + 1);
  const rb = b.slice(i + 1);
  if (a.length === b.length) return ra === rb || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Whether a search word matches a hotel word: short words (≤ 2 chars, e.g. "ca") exactly, longer ones as a
 * prefix ("cruz" → "cruz", "view" → "views"). Words of 5+ characters may have one typo ("saltwter"), and
 * 4-letter words one swapped pair ("curz").
 */
function wordMatches(t: string, w: string): boolean {
  if (t.length <= 2) return w === t;
  if (w.startsWith(t)) return true;
  if (t.length >= 5) return withinOneEdit(t, w) || withinOneEdit(t, w.slice(0, t.length));
  if (t.length === 4 && w.length >= 4) {
    const p = w.slice(0, 4);
    return t !== p && withinOneEdit(t, p) && [...t].sort().join('') === [...p].sort().join('');
  }
  return false;
}

const hits = (t: string, hay: string[]) => hay.some((w) => wordMatches(t, w));

interface Listed {
  name: string;
  city: string;
  state: string;
  address: string;
  zipCode: string;
  tagline: string | null;
  description: string | null;
  type: string | null;
  amenities: string[];
  roomTypes: { amenities: string[] }[];
}

const stateCode = (state: string) => {
  const s = state.trim().toLowerCase();
  return US_STATES[s.toUpperCase()] ? s : STATE_BY_NAME.get(s) ?? s;
};

/** Words a hotel's place is known by: name, city, address, zip, and its state's code and full name. */
function placeHaystack(p: Listed): string[] {
  const code = stateCode(p.state);
  return [...new Set([p.name, p.city, p.address, p.zipCode, code, US_STATES[code.toUpperCase()] ?? ''].flatMap(words))];
}

/** Everything else a guest might ask for: tagline, description, type, hotel and room amenities. */
function detailHaystack(p: Listed): string[] {
  return [...new Set([p.tagline, p.description, p.type, ...p.amenities, ...p.roomTypes.flatMap((t) => t.amenities)].flatMap(words))];
}

/** How many place words match, and whether the hotel is in the state asked for (if one was). */
function placeMatch(p: Listed, place: { tokens: string[]; state: string | null }): { words: number; stateOk: boolean } {
  const hay = placeHaystack(p);
  return { words: place.tokens.filter((t) => hits(t, hay)).length, stateOk: !place.state || stateCode(p.state) === place.state };
}

/** How many of the guest's words (and type words) the hotel matches anywhere. */
function relevance(p: Listed, terms: string[], soft: string[]): number {
  if (!terms.length && !soft.length) return 0;
  const hay = [...placeHaystack(p), ...detailHaystack(p)];
  const one = (w: string) => w.replace(/s$/, '');
  const typeHay = words(`${p.type ?? ''} ${p.name}`).map(one);
  const typeHits = soft.filter((t) => typeHay.includes(one(t))).length;
  return terms.filter((t) => hits(t, hay)).length + typeHits;
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/**
 * Finds listed hotels by place, name or what the guest wants, optionally priced for a stay.
 * Every word of `location` must match the hotel's place (name, city, address, zip; a trailing state such
 * as "CA" or "California" must be the hotel's state). Words in `query` rank hotels instead: description,
 * amenities, type and tagline count, and hotels matching none of them are dropped unless that would leave
 * nothing. Matching is case- and accent-insensitive, by word prefix, with one typo allowed in longer words.
 * When no hotel is in the place asked for, the closest partial matches come back with a `note`, or none
 * and the list of `places` HotelOne covers. Hotels without bookable room types are left out. With dates, up
 * to 30 hotels get live availability and the cheapest fitting price; results are sorted available first,
 * then by relevance and price.
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

  const place = placeTerms(a.location);
  const terms = searchTokens(a.query);
  const soft = [...place.soft, ...words(a.query).filter((w) => TYPE_WORDS.has(w))];
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
      description: true,
      type: true,
      amenities: true,
      photos: { orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }], take: 1, select: { url: true } },
      roomTypes: { where: { isActive: true }, select: { basePrice: true, capacity: true, amenities: true } },
    },
    orderBy: [{ isDemo: 'desc' }, { createdAt: 'asc' }],
  });

  let note: string | undefined;
  let places: string[] | undefined;
  const placeAsked = place.tokens.length > 0 || !!place.state;
  // The place as the guest said it, without leading "cheap motels in"-style words, for notes.
  const where = (a.location?.trim() ?? '').replace(/^(?:(?:hotels?|motels?|inns?|lodges?|boutique|resorts?|hostels?|bnb|in|near|around|at|by|the|a|an|some|cheap|nice|good|best)\s+)+/i, '');

  // Place: every word must match. Failing that, the hotels matching the most of it.
  const scoredPlace = properties.map((p) => {
    const m = placeMatch(p, place);
    return { p, full: m.stateOk && m.words === place.tokens.length, score: m.words + (place.state && m.stateOk ? 0.5 : 0) };
  });
  let inPlace = scoredPlace.filter((x) => x.full).map((x) => x.p);
  if (placeAsked && !inPlace.length) {
    const best = Math.max(0, ...scoredPlace.map((x) => x.score));
    if (best > 0) {
      inPlace = scoredPlace.filter((x) => x.score === best).map((x) => x.p);
      note = `No hotels match all of "${where}"; these are the closest matches.`;
    }
  }

  // What the guest wants: rank by how many words match; keep the place's hotels if none match.
  const rel = new Map(inPlace.map((p) => [p.id, relevance(p, terms, soft)]));
  let found = inPlace;
  if (terms.length || soft.length) {
    const matching = inPlace.filter((p) => rel.get(p.id)! > 0);
    if (matching.length) found = matching;
    else if (placeAsked && inPlace.length) note = `No hotels${where ? ` in ${where}` : ''} mention "${[a.query, ...place.soft].filter(Boolean).join(' ').trim()}"; these are the hotels there.`;
    else found = [];
  }
  if (!found.length) {
    places = [...new Set(properties.map((p) => `${p.city}, ${p.state}`))].sort();
    note = placeAsked
      ? `HotelOne has no hotels in ${where || 'that place'} yet. It lists hotels in the places given; suggest one if it is near.`
      : 'No hotels match those words. HotelOne lists hotels in the places given.';
  }

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
    // Price the most promising hotels: ones that fit the party, most relevant, then cheapest first.
    const candidates = [...base]
      .sort((x, y) => Number(y.fitsParty) - Number(x.fitsParty) || (rel.get(y.id) ?? 0) - (rel.get(x.id) ?? 0) || (x.fromPricePerNight ?? Infinity) - (y.fromPricePerNight ?? Infinity))
      .slice(0, MAX_PRICED);
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
  const score = (h: HotelSearchResult) => rel.get(h.id) ?? 0;
  results.sort(
    (x, y) =>
      Number(y.available === true) - Number(x.available === true) ||
      score(y) - score(x) ||
      Number(y.fitsParty) - Number(x.fitsParty) ||
      price(x) - price(y) ||
      x.name.localeCompare(y.name)
  );

  return {
    hotels: results.slice(0, a.limit),
    matched: found.length,
    stay: dates ? { ...dates, nights: diffDays(dates.checkIn, dates.checkOut), guests: a.guests, rooms: a.rooms } : null,
    ...(note ? { note } : {}),
    ...(places ? { places } : {}),
  };
}
