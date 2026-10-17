/**
 * Input validation for the concierge: one zod schema per operation (shared by
 * the global voice concierge, the MCP endpoint and the REST API) and their
 * JSON Schemas for tool lists and OpenAPI. Caps keep public endpoints cheap:
 * ≤ 16 guests, ≤ 9 rooms, ≤ 30 nights (checked in the operations), ≤ 20 results.
 */
import { z, type ZodTypeAny } from 'zod';
import { isISODate } from '../dates';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine(isISODate, 'must be a real date');
const id = (what: string) => z.string().trim().min(1).max(64).describe(what);
const guests = z.coerce.number().int().min(1).max(16);
const rooms = z.coerce.number().int().min(1).max(9);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

const stay = {
  checkIn: isoDate.describe('Arrival date (YYYY-MM-DD)'),
  checkOut: isoDate.describe('Departure date (YYYY-MM-DD), after checkIn; stays are at most 30 nights'),
  guests: guests.default(2).describe('Total guests in the party (1–16)'),
  rooms: rooms.default(1).describe('Rooms needed (1–9)'),
};

const fullName = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, 'must include a first and last name');

export const conciergeSchemas = {
  searchHotels: z.object({
    query: z.string().trim().max(100).optional().describe('Free text matched against hotel name, city, state, address, zip and tagline, e.g. "saltwater inn" or "santa cruz ca"'),
    location: z.string().trim().max(100).optional().describe('Where the guest wants to stay: city, state, zip or area, e.g. "Santa Cruz, CA"'),
    checkIn: isoDate.optional().describe('Arrival date (YYYY-MM-DD). With checkOut, results carry live availability and prices'),
    checkOut: isoDate.optional().describe('Departure date (YYYY-MM-DD), after checkIn; at most 30 nights'),
    guests: guests.default(2).describe('Total guests in the party (1–16)'),
    rooms: rooms.default(1).describe('Rooms needed (1–9)'),
    limit: z.coerce.number().int().min(1).max(20).default(8).describe('Maximum hotels to return (1–20)'),
  }),
  hotelDetails: z.object({
    propertyId: id('Hotel id from searchHotels'),
  }),
  checkAvailability: z.object({
    propertyId: id('Hotel id from searchHotels'),
    ...stay,
  }),
  bookingLink: z.object({
    propertyId: id('Hotel id from searchHotels'),
    roomTypeId: id('room_type_id from checkAvailability'),
    ...stay,
    guest: z
      .object({
        name: optionalText(120).describe('Guest’s full name, to pre-fill checkout'),
        email: z.string().trim().toLowerCase().email().max(200).nullish().describe('Guest’s email, to pre-fill checkout'),
        phone: optionalText(40).describe('Guest’s phone, to pre-fill checkout'),
      })
      .optional()
      .describe('Optional details the checkout page pre-fills'),
  }),
  requestBooking: z.object({
    propertyId: id('Hotel id from searchHotels'),
    roomTypeId: id('room_type_id from checkAvailability'),
    ...stay,
    name: z.string().trim().min(1).max(120).describe('Guest’s full name'),
    email: z.string().trim().toLowerCase().email().max(200).nullish().describe('Email for the booking link (email or phone is required)'),
    phone: optionalText(40).describe('Callback number (email or phone is required)'),
    notes: optionalText(500).describe('Special requests, if any'),
    source: z.enum(['AGENT', 'VOICE']).default('AGENT').describe('Set by the server, not the end user: AGENT (external assistants, default) or VOICE (the HotelOne voice concierge)'),
  }),
  createBooking: z.object({
    propertyId: id('Hotel id from searchHotels'),
    roomTypeId: id('room_type_id from checkAvailability'),
    ...stay,
    guest: z
      .object({
        name: fullName.describe('Guest’s first and last name'),
        email: z.string().trim().toLowerCase().email().max(200).describe('Guest’s own email: the confirmation goes there'),
        phone: optionalText(40).describe('Guest’s phone, if given'),
      })
      .describe('The guest the booking is for'),
    notes: optionalText(1000).describe('Special requests, passed to the hotel'),
    source: z.string().trim().min(1).max(80).describe('Set by the server from the API key, not the end user: who booked it, for the hotel’s booking history, e.g. "Muse (API key ho_live_ab12…)"'),
  }),
  findBooking: z.object({
    code: z.string().trim().min(4).max(20).describe('Confirmation code from the booking confirmation'),
    lastName: z.string().trim().min(1).max(60).describe('Guest’s last name as booked'),
  }),
  askHotel: z.object({
    propertyId: id('Hotel id from searchHotels'),
    question: z.string().trim().max(300).optional().describe('The guest’s question in their own words, e.g. "Is parking free?" or "can I bring my dog"'),
    topic: z.string().trim().max(80).optional().describe('A topic key from the hotel’s answers (e.g. "policies", "amenities", "contact") to get that answer directly'),
  }),
} as const;

export type ConciergeOperation = keyof typeof conciergeSchemas;

/** Inputs as callers send them (defaults optional). */
export type SearchHotelsInput = z.input<typeof conciergeSchemas.searchHotels>;
export type HotelDetailsInput = z.input<typeof conciergeSchemas.hotelDetails>;
export type CheckAvailabilityInput = z.input<typeof conciergeSchemas.checkAvailability>;
export type BookingLinkInput = z.input<typeof conciergeSchemas.bookingLink>;
export type RequestBookingInput = z.input<typeof conciergeSchemas.requestBooking>;
export type CreateBookingInput = z.input<typeof conciergeSchemas.createBooking>;
export type FindBookingInput = z.input<typeof conciergeSchemas.findBooking>;
export type AskHotelInput = z.input<typeof conciergeSchemas.askHotel>;

// ---------------------------------------------------------------------------
// zod → JSON Schema (the subset these schemas use)
// ---------------------------------------------------------------------------

/** A JSON Schema object (draft 2020-12 subset). */
export type JsonSchema = Record<string, unknown>;

type Def = { typeName: string; description?: string; [k: string]: unknown };

/**
 * Converts a zod schema built from object, string, number, boolean, enum,
 * literal, array, optional, nullable, nullish, default and refine into JSON
 * Schema, keeping `.describe()` texts and min/max constraints. Optional and
 * defaulted fields are left out of `required`.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema).schema;
}

function convert(schema: ZodTypeAny): { schema: JsonSchema; optional: boolean } {
  const def = schema._def as Def;
  const describe = (s: JsonSchema) => (def.description && !s.description ? { ...s, description: def.description } : s);
  switch (def.typeName) {
    case 'ZodOptional': {
      const inner = convert(def.innerType as ZodTypeAny);
      return { schema: describe(inner.schema), optional: true };
    }
    case 'ZodDefault': {
      const inner = convert(def.innerType as ZodTypeAny);
      return { schema: describe({ ...inner.schema, default: (def.defaultValue as () => unknown)() }), optional: true };
    }
    case 'ZodNullable': {
      const inner = convert(def.innerType as ZodTypeAny);
      const t = inner.schema.type;
      return { schema: describe({ ...inner.schema, type: Array.isArray(t) ? [...t, 'null'] : t ? [t, 'null'] : undefined }), optional: inner.optional };
    }
    case 'ZodEffects': {
      const inner = convert(def.schema as ZodTypeAny);
      return { schema: describe(inner.schema), optional: inner.optional };
    }
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        const c = convert(v);
        properties[k] = c.schema;
        if (!c.optional) required.push(k);
      }
      return { schema: describe({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }), optional: false };
    }
    case 'ZodString': {
      const s: JsonSchema = { type: 'string' };
      for (const c of (def.checks as { kind: string; value?: number; regex?: RegExp }[]) ?? []) {
        if (c.kind === 'min') s.minLength = c.value;
        else if (c.kind === 'max') s.maxLength = c.value;
        else if (c.kind === 'email') s.format = 'email';
        else if (c.kind === 'regex' && c.regex) s.pattern = c.regex.source;
      }
      return { schema: describe(s), optional: false };
    }
    case 'ZodNumber': {
      const s: JsonSchema = { type: 'number' };
      for (const c of (def.checks as { kind: string; value?: number; inclusive?: boolean }[]) ?? []) {
        if (c.kind === 'int') s.type = 'integer';
        else if (c.kind === 'min') s[c.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = c.value;
        else if (c.kind === 'max') s[c.inclusive === false ? 'exclusiveMaximum' : 'maximum'] = c.value;
      }
      return { schema: describe(s), optional: false };
    }
    case 'ZodBoolean':
      return { schema: describe({ type: 'boolean' }), optional: false };
    case 'ZodEnum':
      return { schema: describe({ type: 'string', enum: def.values as string[] }), optional: false };
    case 'ZodLiteral':
      return { schema: describe({ const: def.value }), optional: false };
    case 'ZodArray': {
      const s: JsonSchema = { type: 'array', items: convert(def.type as ZodTypeAny).schema };
      if (def.minLength) s.minItems = (def.minLength as { value: number }).value;
      if (def.maxLength) s.maxItems = (def.maxLength as { value: number }).value;
      return { schema: describe(s), optional: false };
    }
    default:
      return { schema: describe({}), optional: false };
  }
}

/**
 * JSON Schemas of what clients send for each operation, for MCP tool lists
 * and OpenAPI. `source` (requestBooking, createBooking) is left out: the
 * server sets it, so callers can't dodge the per-hotel request cap or
 * misattribute a booking.
 */
export const conciergeJsonSchemas = {
  searchHotels: zodToJsonSchema(conciergeSchemas.searchHotels),
  hotelDetails: zodToJsonSchema(conciergeSchemas.hotelDetails),
  checkAvailability: zodToJsonSchema(conciergeSchemas.checkAvailability),
  bookingLink: zodToJsonSchema(conciergeSchemas.bookingLink),
  requestBooking: zodToJsonSchema(conciergeSchemas.requestBooking.omit({ source: true })),
  createBooking: zodToJsonSchema(conciergeSchemas.createBooking.omit({ source: true })),
  findBooking: zodToJsonSchema(conciergeSchemas.findBooking),
  askHotel: zodToJsonSchema(conciergeSchemas.askHotel),
} satisfies Record<ConciergeOperation, JsonSchema>;
