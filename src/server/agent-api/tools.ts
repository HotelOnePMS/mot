/**
 * The agent tools: one registry behind the MCP server (tools/list,
 * tools/call) and the REST API, wrapping the concierge. Each tool has its
 * input JSON Schema (from conciergeJsonSchemas), MCP annotations and a
 * description that teaches the model the booking flow.
 *
 * Scopes: the all-hotels server offers every tool; a hotel's own server
 * (hotel set) drops search_hotels and the propertyId argument — every call
 * is about that hotel. create_booking is offered only to API keys with the
 * "book" scope for the hotel in question.
 */
import {
  askHotel,
  bookingLink,
  checkAvailability,
  conciergeJsonSchemas,
  createBooking,
  findBooking,
  hotelDetails,
  requestBooking,
  searchHotels,
  type ConciergeOperation,
  type JsonSchema,
} from '../concierge';
import { DomainError, forbidden } from '../errors';
import { ensureConfigSkills, listSkills } from '../skills';
import type { RateCategory } from './http';
import { keyCanBook, keySource, type AgentKeyContext } from './keys';

/** The hotel a hotel-scoped server is for. */
export interface ScopedHotel {
  id: string;
  name: string;
  city: string;
  state: string;
}

/** Who is calling and where: shared by tools/list and tools/call. */
export interface ToolContext {
  /** Set on a hotel's own server; null on the all-hotels server. */
  hotel: ScopedHotel | null;
  key: AgentKeyContext | null;
  /** Counts the call in a rate-limit category (throws 429). */
  limit: (category: RateCategory) => Promise<void>;
}

/** MCP tool annotations (hints for clients; 2025-03-26+). */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** A tool as tools/list describes it. */
export interface ListedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
}

export type ToolName = 'search_hotels' | 'get_hotel' | 'check_availability' | 'get_booking_link' | 'request_booking' | 'create_booking' | 'find_booking' | 'ask_hotel';

type Args = Record<string, unknown>;

interface ToolDef {
  name: ToolName;
  title: string;
  op: ConciergeOperation;
  annotations: Omit<ToolAnnotations, 'title'>;
  /** Not on a hotel's own server. */
  globalOnly?: boolean;
  /** Only for API keys that may book at the hotel. */
  needsBookKey?: boolean;
  describe: (ctx: { hotel: ScopedHotel | null; key: AgentKeyContext | null }) => string;
  run: (args: Args, ctx: ToolContext) => Promise<Record<string, unknown>>;
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

/** "at The Saltwater Inn" on a hotel's server, else "at one hotel". */
const at = (hotel: ScopedHotel | null, fallback = 'at one hotel') => (hotel ? `at ${hotel.name}` : fallback);
/** The hotel argument: the server's hotel, or the caller's propertyId. */
const property = (args: Args, ctx: ToolContext) => (ctx.hotel ? ctx.hotel.id : args.propertyId);

const READ_BACK = 'Before calling, read back the hotel, room, dates, number of guests and the total, and only call it after the person clearly says yes.';

const TOOLS: ToolDef[] = [
  {
    name: 'search_hotels',
    title: 'Search hotels',
    op: 'searchHotels',
    annotations: READ,
    globalOnly: true,
    describe: () =>
      'Find HotelOne hotels by place (city, state, zip or area) or by name. Pass checkIn and checkOut (YYYY-MM-DD) to get live availability and the cheapest price for the stay; guests and rooms default to 2 and 1. Start here, then call check_availability for the hotel the person picks. Each hotel has an id (propertyId) for the other tools.',
    run: async (args) => ({ ...(await searchHotels(args)) }),
  },
  {
    name: 'get_hotel',
    title: 'Hotel details',
    op: 'hotelDetails',
    annotations: READ,
    describe: ({ hotel }) =>
      `Everything about ${hotel ? hotel.name : 'one hotel'}: description, address, phone, amenities, check-in and check-out times, cancellation policy, room types with starting prices, photos, and the hotel’s own answers to common questions. Use when the person wants to know more about ${hotel ? 'the hotel' : 'a hotel'}.`,
    run: async (args, ctx) => ({ ...(await hotelDetails(String(property(args, ctx) ?? ''))) }),
  },
  {
    name: 'check_availability',
    title: 'Check availability',
    op: 'checkAvailability',
    annotations: READ,
    describe: ({ hotel }) =>
      `Live availability and exact prices (USD) for every room type ${at(hotel)} for given dates and party. Suggest an option that is available and fits the party (fits_party), then use its room_type_id with get_booking_link.`,
    run: async (args, ctx) => ({ ...(await checkAvailability({ ...args, propertyId: property(args, ctx) } as Parameters<typeof checkAvailability>[0])) }),
  },
  {
    name: 'get_booking_link',
    title: 'Get a booking link',
    op: 'bookingLink',
    annotations: READ,
    describe: ({ hotel }) =>
      `The fastest way to book ${at(hotel, 'a room')}: returns a checkout link with the hotel, room, dates and party filled in (and the guest’s name, email and phone if you pass them), plus a summary with the total. Give the person the link and the summary — they open it, check the details and confirm in one tap. The link doesn’t hold the room or charge anything by itself. Use this by default.`,
    run: async (args, ctx) => ({ ...(await bookingLink({ ...args, propertyId: property(args, ctx) } as Parameters<typeof bookingLink>[0])) }),
  },
  {
    name: 'request_booking',
    title: 'Send a booking request',
    op: 'requestBooking',
    annotations: WRITE,
    describe: ({ hotel }) =>
      `For people who can’t open a link (for example on a voice call): sends a booking request to ${hotel ? hotel.name : 'the hotel'}’s team, who confirm with the guest and send a link to finish booking. Nothing is booked until then. Needs the guest’s full name and an email or phone number. ${READ_BACK}`,
    run: async (args, ctx) => {
      await ctx.limit('request');
      return { ...(await requestBooking({ ...args, propertyId: property(args, ctx), source: 'AGENT' } as Parameters<typeof requestBooking>[0])) };
    },
  },
  {
    name: 'create_booking',
    title: 'Book now (pay at the hotel)',
    op: 'createBooking',
    annotations: WRITE,
    needsBookKey: true,
    describe: ({ hotel, key }) =>
      `Makes a confirmed booking ${hotel ? `at ${hotel.name}` : key?.propertyId ? `at the hotel this API key belongs to (propertyId ${key.propertyId})` : 'at any HotelOne hotel'}, paid at the hotel on arrival, and emails the guest a confirmation. Needs the guest’s first and last name and their own email. ${READ_BACK} Returns a confirmation code to give the guest.`,
    run: async (args, ctx) => {
      const propertyId = property(args, ctx);
      if (!ctx.key) throw new DomainError(401, 'API_KEY_REQUIRED', 'create_booking needs a HotelOne API key with booking access. Use get_booking_link (the guest confirms in one tap) or request_booking (the hotel confirms) instead.');
      if (!keyCanBook(ctx.key, typeof propertyId === 'string' ? propertyId : null)) {
        throw forbidden(ctx.key.scopes.includes('book') ? 'This API key can only book at its own hotel. Use get_booking_link for other hotels.' : 'This API key can’t make bookings. Use get_booking_link or request_booking instead.');
      }
      await ctx.limit('book');
      return { ...(await createBooking({ ...args, propertyId, source: keySource(ctx.key) } as Parameters<typeof createBooking>[0])) };
    },
  },
  {
    name: 'find_booking',
    title: 'Find a booking',
    op: 'findBooking',
    annotations: READ,
    describe: ({ hotel }) =>
      `Look up an existing booking${hotel ? ` at ${hotel.name}` : ''} by its confirmation code and the guest’s last name: status, hotel, room, dates, until when changes are free, and how to change or cancel.`,
    run: async (args, ctx) => {
      await ctx.limit('lookup');
      const r = await findBooking(args as Parameters<typeof findBooking>[0]);
      // A hotel's own server only finds that hotel's bookings.
      if (r.found && ctx.hotel && r.hotel.id !== ctx.hotel.id) return { found: false, message: 'No booking matches that confirmation code and last name.' };
      return { ...r };
    },
  },
  {
    name: 'ask_hotel',
    title: 'Ask the hotel',
    op: 'askHotel',
    annotations: READ,
    describe: ({ hotel }) =>
      `Answer a guest’s question about ${hotel ? hotel.name : 'a hotel'} — parking, pets, breakfast, Wi-Fi, check-in times, cancellation, getting there and more — from the hotel’s own saved answers. Pass the question in the guest’s words, or a topic key. If nothing matches, say you’re not sure and share the hotel’s phone number; never guess.`,
    run: async (args, ctx) => ({ ...(await askHotel({ ...args, propertyId: property(args, ctx) } as Parameters<typeof askHotel>[0])) }),
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** A tool's JSON Schema for this scope: without propertyId on a hotel's own server. */
function inputSchemaFor(def: ToolDef, hotel: ScopedHotel | null): JsonSchema {
  const schema = conciergeJsonSchemas[def.op] as { properties?: Record<string, JsonSchema>; required?: string[] } & JsonSchema;
  if (!hotel || !schema.properties?.propertyId) return schema;
  const { propertyId: _drop, ...properties } = schema.properties;
  const required = (schema.required ?? []).filter((r) => r !== 'propertyId');
  const out: JsonSchema = { ...schema, properties };
  if (required.length) out.required = required;
  else delete out.required;
  return out;
}

/** Whether a tool is offered here (hotel scope, and the key for create_booking). */
function offered(def: ToolDef, ctx: Pick<ToolContext, 'hotel' | 'key'>): boolean {
  if (def.globalOnly && ctx.hotel) return false;
  if (def.needsBookKey) return keyCanBook(ctx.key, ctx.hotel?.id ?? null);
  return true;
}

/**
 * The tools offered to this caller, as tools/list returns them. On a hotel's
 * server, ask_hotel lists the hotel's current answer topics (whatever it has
 * configured), so new FAQs show up without any change here.
 */
export async function listTools(ctx: Pick<ToolContext, 'hotel' | 'key'>): Promise<ListedTool[]> {
  let topics: { key: string; title: string }[] = [];
  if (ctx.hotel) {
    await ensureConfigSkills(ctx.hotel.id);
    const skills = await listSkills(ctx.hotel.id, { audience: 'GUEST', status: ['ACTIVE'], kinds: ['ANSWER'], includePlatform: true });
    topics = skills.slice(0, 40).map((s) => ({ key: s.key, title: s.title }));
  }
  return TOOLS.filter((t) => offered(t, ctx)).map((t) => {
    let description = t.describe(ctx);
    let inputSchema = inputSchemaFor(t, ctx.hotel);
    if (t.name === 'ask_hotel' && topics.length) {
      description += ` Topics: ${topics.map((x) => `${x.key} (${x.title})`).join('; ')}.`;
      const props = (inputSchema.properties ?? {}) as Record<string, JsonSchema>;
      inputSchema = { ...inputSchema, properties: { ...props, topic: { ...props.topic, enum: topics.map((x) => x.key) } } };
    }
    return { name: t.name, title: t.title, description, inputSchema, annotations: { title: t.title, ...t.annotations } };
  });
}

/** Whether `name` is a tool at all (offered here or not). */
export const isToolName = (name: string): name is ToolName => BY_NAME.has(name as ToolName);

/**
 * Runs a tool and returns its result; throws what the concierge throws
 * (ZodError, DomainError). create_booking without a suitable key throws 401
 * (no key) or 403 (key can't book here); search_hotels on a hotel's server
 * throws 404.
 */
export async function callTool(name: ToolName, args: Args, ctx: ToolContext): Promise<Record<string, unknown>> {
  const def = BY_NAME.get(name)!;
  if (def.globalOnly && ctx.hotel) throw new DomainError(404, 'NOT_FOUND', `${name} isn’t available on ${ctx.hotel.name}’s own server — it only covers this hotel.`);
  return def.run(args, ctx);
}

/** Every tool with its all-hotels description and schema (llms-full.txt, docs). */
export function toolCatalog(): (ListedTool & { needsKey: boolean })[] {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.describe({ hotel: null, key: null }),
    inputSchema: inputSchemaFor(t, null),
    annotations: { title: t.title, ...t.annotations },
    needsKey: !!t.needsBookKey,
  }));
}
