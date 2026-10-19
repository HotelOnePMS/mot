/**
 * The OpenAPI 3.1 description of the REST API (/api/agents/v1), served at
 * /openapi.json: request schemas come from the concierge's JSON Schemas, so
 * the API, the MCP tools and this document never disagree. Good enough to
 * import as a ChatGPT GPT Action, a Grok/xAI tool or any OpenAPI client.
 */
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL, PRODUCT_URL } from '@/config/product';
import { conciergeJsonSchemas, type JsonSchema } from '../concierge';
import { PUBLISHED_LIMITS } from './http';
import { REST_BASE } from './rest';

export const API_VERSION = '1.0.0';

type Props = { properties: Record<string, JsonSchema>; required?: string[] };

/** Query parameters from an operation's JSON Schema (descriptions moved to the parameter). */
function queryParams(schema: JsonSchema, omit: string[] = []) {
  const { properties, required = [] } = schema as unknown as Props;
  return Object.entries(properties)
    .filter(([name]) => !omit.includes(name))
    .map(([name, s]) => {
      const { description, ...rest } = s as JsonSchema & { description?: string };
      return { name, in: 'query', required: required.includes(name), ...(description ? { description } : {}), schema: rest };
    });
}

const str = (description?: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const num = (description?: string): JsonSchema => ({ type: 'number', ...(description ? { description } : {}) });
const int = (description?: string): JsonSchema => ({ type: 'integer', ...(description ? { description } : {}) });
const nullable = (s: JsonSchema): JsonSchema => ({ ...s, type: [s.type as string, 'null'] });
const obj = (properties: Record<string, JsonSchema>, required: string[] = Object.keys(properties), description?: string): JsonSchema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required,
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const date = (description: string) => str(description, { format: 'date' });
const USD = { type: 'string', const: 'USD' } as JsonSchema;

const SCHEMAS: Record<string, JsonSchema> = {
  Error: obj(
    {
      error: str('What went wrong, written for people and models.'),
      message: str('Same as error.'),
      code: str('BAD_REQUEST, VALIDATION, NOT_FOUND, CONFLICT, FORBIDDEN, UNAUTHORIZED, INVALID_API_KEY, API_KEY_REQUIRED, RATE_LIMITED, INTERNAL…'),
      details: { type: 'object', description: 'Extra detail, e.g. validation issues or retryAfterSeconds.' },
    },
    ['error', 'code'],
  ),
  HotelSummary: obj(
    {
      id: str('Hotel id (propertyId) for the other operations.'),
      name: str(),
      city: str(),
      state: str(),
      tagline: nullable(str()),
      photo: nullable(str('Main photo URL.', { format: 'uri' })),
      fromPricePerNight: nullable(num('Lowest base nightly price among room types that fit the party.')),
      currency: USD,
      maxGuestsPerRoom: int(),
      fitsParty: { type: 'boolean', description: 'A room type sleeps the party in the requested number of rooms.' },
      available: { type: ['boolean', 'null'], description: 'With dates: a fitting room type is free every night. Null without dates.' },
      cheapestNightly: num('With dates, when available: cheapest fitting average nightly price per room.'),
      stayTotal: num('With dates, when available: that option’s total for the whole stay and all rooms.'),
      cheapestRoomTypeId: str('With dates, when available: that option’s room type id.'),
      url: str('The hotel’s booking page (stay pre-filled when dates were given).', { format: 'uri' }),
    },
    ['id', 'name', 'city', 'state', 'currency', 'fitsParty', 'available', 'url'],
  ),
  SearchResult: obj({
    hotels: { type: 'array', items: ref('HotelSummary') },
    matched: int('Hotels that matched before the limit.'),
    stay: nullable(obj({ checkIn: date('Arrival'), checkOut: date('Departure'), nights: int(), guests: int(), rooms: int() })),
    note: str('Only when results are not exact matches (closest places, or the place without the query words): what to tell the person.'),
    places: { type: 'array', description: 'Only when no hotel is in the place asked for: every town with HotelOne hotels, e.g. "Santa Cruz, CA".', items: str() },
  }),
  HotelDetails: obj(
    {
      id: str(),
      name: str(),
      type: nullable(str('Hotel, Motel, Inn, B&B, Boutique…')),
      tagline: nullable(str()),
      description: nullable(str()),
      address: str(),
      phone: str(),
      email: nullable(str()),
      amenities: { type: 'array', items: str() },
      check_in: str('e.g. "from 3:00 PM"'),
      check_out: str('e.g. "by 11:00 AM"'),
      cancellation: str(),
      room_types: {
        type: 'array',
        items: obj({ id: str(), name: str(), sleeps: int(), from_price_per_night: num(), amenities: { type: 'array', items: str() }, description: nullable(str()) }),
      },
      currency: USD,
      photos: { type: 'array', items: str(undefined, { format: 'uri' }) },
      skills: { type: 'array', description: 'The hotel’s own answers (FAQs, amenities, policies, rooms, contact).', items: obj({ key: str(), title: str(), answer: str() }) },
      url: str(undefined, { format: 'uri' }),
    },
    ['id', 'name', 'address', 'phone', 'amenities', 'check_in', 'check_out', 'cancellation', 'room_types', 'currency', 'photos', 'skills', 'url'],
  ),
  Availability: obj({
    stay: str('e.g. "Fri, Oct 23 to Sun, Oct 25, 2 nights, 2 guests"'),
    options: {
      type: 'array',
      items: obj({
        room_type_id: str('Use with booking links, requests and bookings.'),
        name: str(),
        sleeps: int(),
        fits_party: { type: 'boolean' },
        available: { type: 'boolean' },
        rooms_left: int(),
        average_per_night: nullable(num('USD per room')),
        total: nullable(num('USD for the whole stay and all rooms')),
      }),
    },
  }),
  HotelAnswers: obj(
    {
      hotel: obj({ id: str(), name: str(), phone: str(), email: nullable(str()) }),
      answers: { type: 'array', items: obj({ key: str('Topic key'), title: str(), answer: str() }) },
      topics: { type: 'array', description: 'Only when nothing matched: every topic the hotel has answers for.', items: obj({ key: str(), title: str() }) },
      note: str('Only when nothing matched: what to tell the guest.'),
    },
    ['hotel', 'answers'],
  ),
  BookingLink: obj({
    url: str('The pre-filled checkout. The guest opens it, checks the details and confirms.', { format: 'uri' }),
    summary: obj({
      hotel: obj({ id: str(), name: str() }),
      roomType: obj({ id: str(), name: str(), sleeps: int() }),
      checkIn: date('Arrival'),
      checkOut: date('Departure'),
      nights: int(),
      guests: int(),
      rooms: int(),
      averageNightly: num('USD per room'),
      total: num('USD, whole stay, all rooms'),
      currency: USD,
      roomsLeft: int(),
    }),
    expiresNote: str(),
  }),
  BookingRequest: obj({
    saved: { type: 'boolean', const: true },
    reference: str('Request reference for the guest.'),
    quoted_total: nullable(num('USD')),
    say: str('What to tell the guest.'),
  }),
  Booking: obj({
    bookingId: str(),
    code: str('Confirmation code for the guest.'),
    status: { type: 'string', const: 'CONFIRMED' },
    total: num('USD, priced by the server'),
    currency: USD,
    paymentStatus: { type: 'string', const: 'PAY_AT_PROPERTY' },
    hotel: obj({ id: str(), name: str() }),
    roomType: obj({ id: str(), name: str() }),
    checkIn: date('Arrival'),
    checkOut: date('Departure'),
    nights: int(),
    guests: int(),
    rooms: int(),
    manage: str('How the guest changes or cancels (through the hotel, with the confirmation code).'),
    confirmationEmailSent: { type: 'boolean' },
  }),
  FoundBooking: obj({
    found: { type: 'boolean', const: true },
    code: str(),
    status: str('PENDING, CONFIRMED, CHECKED_IN, CHECKED_OUT, CANCELLED, NO_SHOW…'),
    hotel: obj({ id: str(), name: str(), phone: str() }),
    room: str(),
    checkIn: date('Arrival'),
    checkOut: date('Departure'),
    nights: int(),
    guests: int(),
    rooms: int(),
    freeChangesUntil: nullable(str('e.g. "3:00 PM on Thu, Oct 22"; null once passed.')),
    manage: str(),
    bookingUrl: str(undefined, { format: 'uri' }),
  }),
};

const json = (schema: JsonSchema) => ({ 'application/json': { schema } });
const errorResponse = (description: string) => ({ description, content: json(ref('Error')) });
const COMMON_ERRORS = {
  '400': errorResponse('Invalid input or a rule failed (dates in the past, too many guests…). The message says how to fix it.'),
  '429': {
    description: 'Rate limited. Wait for Retry-After seconds.',
    headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait.' } },
    content: json(ref('Error')),
  },
};
const ok = (description: string, schema: string, status = '200') => ({ [status]: { description, content: json(ref(schema)) } });
const propertyIdParam = { name: 'propertyId', in: 'path', required: true, description: 'Hotel id from searchHotels.', schema: { type: 'string', minLength: 1, maxLength: 64 } };

const limitLine = () => {
  const l = PUBLISHED_LIMITS;
  return `Rate limits: ${l.read.anonymous!.max} requests a minute per IP (${l.read.withKey.max} with an API key); booking requests ${l.request.anonymous!.max} an hour per IP; bookings ${l.book.withKey.max} an hour per key; booking lookups ${l.lookup.anonymous!.max} an hour per IP.`;
};

/** The OpenAPI 3.1 document, with `origin` as the server URL. */
export function openApiDocument(origin: string) {
  const s = conciergeJsonSchemas;
  return {
    openapi: '3.1.0',
    info: {
      title: `${PRODUCT_NAME} Agent API`,
      version: API_VERSION,
      summary: 'Search and book independent hotels from AI assistants and agents.',
      description: [
        `Find ${PRODUCT_NAME} hotels, check live availability and prices, and book. The same operations are available as an MCP server at ${origin}/api/mcp.`,
        '',
        'Booking flow: searchHotels → checkAvailability → createBookingLink (the guest opens the pre-filled checkout and confirms; the default) — or requestBooking when the guest can’t open a link (the hotel confirms), or createBooking with an API key (confirmed at once, paid at the hotel).',
        'Always confirm the hotel, room, dates, guests and total with the guest before requestBooking or createBooking.',
        '',
        'Dates are YYYY-MM-DD; prices are USD. Only createBooking needs an API key (`Authorization: Bearer ho_live_…`), which hotel owners create in the console under AI assistants.',
        limitLine(),
      ].join('\n'),
      contact: { name: PRODUCT_NAME, url: `${origin}/assistants`, email: PRODUCT_SUPPORT_EMAIL },
      termsOfService: `${PRODUCT_URL}/about`,
    },
    servers: [{ url: origin, description: PRODUCT_NAME }],
    tags: [
      { name: 'Hotels', description: 'Find hotels, their details, availability and answers.' },
      { name: 'Booking', description: 'Book, request a booking or find one.' },
    ],
    paths: {
      [`${REST_BASE}/hotels`]: {
        get: {
          operationId: 'searchHotels',
          tags: ['Hotels'],
          summary: 'Search hotels',
          description: 'Find hotels by place or name. With checkIn and checkOut, results include live availability and the cheapest price for the stay. Start here.',
          security: [],
          parameters: queryParams(s.searchHotels),
          responses: { ...ok('Matching hotels, available and cheapest first.', 'SearchResult'), ...COMMON_ERRORS },
        },
      },
      [`${REST_BASE}/hotels/{propertyId}`]: {
        get: {
          operationId: 'getHotel',
          tags: ['Hotels'],
          summary: 'Hotel details',
          description: 'Description, address, phone, amenities, policies, room types with starting prices, photos and the hotel’s own answers to common questions.',
          security: [],
          parameters: [propertyIdParam],
          responses: { ...ok('The hotel.', 'HotelDetails'), '404': errorResponse('Unknown or unlisted hotel.'), ...COMMON_ERRORS },
        },
      },
      [`${REST_BASE}/hotels/{propertyId}/availability`]: {
        get: {
          operationId: 'checkAvailability',
          tags: ['Hotels'],
          summary: 'Check availability',
          description: 'Live availability and exact prices (USD) for every room type at one hotel. Pick an option that is available and fits the party, then create a booking link with its room_type_id.',
          security: [],
          parameters: [propertyIdParam, ...queryParams(s.checkAvailability, ['propertyId'])],
          responses: { ...ok('Room types with availability and prices.', 'Availability'), '404': errorResponse('Unknown or unlisted hotel.'), ...COMMON_ERRORS },
        },
      },
      [`${REST_BASE}/hotels/{propertyId}/answers`]: {
        get: {
          operationId: 'askHotel',
          tags: ['Hotels'],
          summary: 'Ask the hotel',
          description: 'Answers a guest’s question (parking, pets, breakfast, Wi-Fi, policies, getting there…) from the hotel’s own saved answers. Pass question or topic. If nothing matches, offer the hotel’s phone — don’t guess.',
          security: [],
          parameters: [propertyIdParam, ...queryParams(s.askHotel, ['propertyId'])],
          responses: { ...ok('The best matching answers, or the topics the hotel has answers for.', 'HotelAnswers'), '404': errorResponse('Unknown or unlisted hotel.'), ...COMMON_ERRORS },
        },
      },
      [`${REST_BASE}/booking-links`]: {
        post: {
          operationId: 'createBookingLink',
          tags: ['Booking'],
          summary: 'Get a pre-filled booking link',
          description: 'The fastest way to book: a checkout link with the hotel, room, dates, party (and optionally the guest’s details) filled in. Give it to the guest with the summary; they confirm in one tap. Holds nothing by itself.',
          security: [],
          'x-openai-isConsequential': false,
          requestBody: { required: true, content: json(s.bookingLink) },
          responses: { ...ok('The link and a summary with the total.', 'BookingLink'), '404': errorResponse('Unknown or unlisted hotel.'), ...COMMON_ERRORS },
        },
      },
      [`${REST_BASE}/booking-requests`]: {
        post: {
          operationId: 'requestBooking',
          tags: ['Booking'],
          summary: 'Send a booking request to the hotel',
          description: 'For guests who can’t open a link: the hotel team confirms with the guest and sends a link to finish booking. Nothing is booked until then. Needs a full name and an email or phone. Confirm the details with the guest first.',
          security: [],
          'x-openai-isConsequential': true,
          requestBody: { required: true, content: json(s.requestBooking) },
          responses: { ...ok('The request was sent to the hotel.', 'BookingRequest', '201'), '404': errorResponse('Unknown or unlisted hotel.'), ...COMMON_ERRORS },
        },
      },
      [`${REST_BASE}/bookings`]: {
        post: {
          operationId: 'createBooking',
          tags: ['Booking'],
          summary: 'Book now (pay at the hotel)',
          description: 'Makes a confirmed booking paid at the hotel and emails the guest. Needs an API key with booking access for that hotel. Confirm hotel, room, dates, guests, total and the guest’s name and email first.',
          security: [{ bearerAuth: [] }],
          'x-openai-isConsequential': true,
          requestBody: { required: true, content: json(s.createBooking) },
          responses: {
            ...ok('The confirmed booking.', 'Booking', '201'),
            '401': errorResponse('No API key, or the key is unknown or revoked.'),
            '403': errorResponse('The key can’t book at this hotel, or the email can’t be used.'),
            '404': errorResponse('Unknown or unlisted hotel.'),
            '409': errorResponse('The room was just taken.'),
            ...COMMON_ERRORS,
          },
        },
      },
      [`${REST_BASE}/bookings/{code}`]: {
        get: {
          operationId: 'findBooking',
          tags: ['Booking'],
          summary: 'Find a booking',
          description: 'Looks up a booking by confirmation code and the guest’s last name: status, hotel, room, dates, the free-change deadline and how to change or cancel.',
          security: [],
          parameters: [
            { name: 'code', in: 'path', required: true, description: 'Confirmation code.', schema: { type: 'string', minLength: 4, maxLength: 20 } },
            ...queryParams(s.findBooking, ['code']),
          ],
          responses: { ...ok('The booking.', 'FoundBooking'), '404': errorResponse('No booking matches that code and last name.'), ...COMMON_ERRORS },
        },
      },
    },
    components: {
      schemas: SCHEMAS,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'ho_live_…',
          description: `A ${PRODUCT_NAME} API key. Hotel owners create keys in the ${PRODUCT_NAME} console under AI assistants. Only needed for createBooking; with any valid key the rate limits are higher.`,
        },
      },
    },
  };
}
