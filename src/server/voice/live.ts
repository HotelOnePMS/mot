/**
 * GPT-Live voice sessions.
 *
 * Architecture: GPT-Live is the voice (full duplex: listens while it
 * talks). It delegates thinking and tool use to a Responses backend model
 * ("Responses delegation"). Tool calls arrive in the browser over the WebRTC
 * data channel and are executed by *our* code — guest tools on the server
 * via /api/voice/tool (signed session token), staff tools through the same
 * agent endpoints the console uses (session auth, permission checks, signed
 * confirmation plans). The voice never touches the database directly.
 */
import OpenAI from 'openai';
import { createHmac, timingSafeEqual } from 'crypto';
import { forbidden, DomainError } from '../errors';

export const LIVE_MODEL = process.env.OPENAI_LIVE_MODEL || 'gpt-live-1';
// Same default the OpenAI playground uses for Live delegation.
export const VOICE_BACKEND_MODEL = process.env.OPENAI_VOICE_BACKEND_MODEL || 'gpt-6-luna';
// Built-in Live voices (marin first: the API default).
export const VOICES = ['marin', 'cedar', 'gleam', 'willow', 'coral', 'sage', 'verse', 'ash', 'shimmer', 'alloy', 'ballad', 'beacon', 'bossa', 'cinder', 'delta', 'echo', 'meridian', 'quartz', 'ripple', 'stone', 'tempo', 'vesper'] as const;

export function voiceConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!voiceConfigured()) throw new DomainError(503, 'VOICE_DISABLED', 'The voice agent isn’t connected yet — add OPENAI_API_KEY to turn it on.');
  // Fail fast enough to report a clean error inside the serverless function's time limit.
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
  return client;
}

export interface FunctionToolSpec {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

/** Events an untrusted browser may send on the data channel (no prompt rewrites). */
const ALLOWED_CLIENT_EVENTS = ['response.item.create', 'response.create', 'session.close', 'session.input_audio.mute', 'session.input_audio.unmute'];

export async function createLiveSession(input: {
  sdp: string;
  voice: string;
  instructions: string;
  backendInstructions: string;
  tools: FunctionToolSpec[];
}): Promise<{ sessionId: string; sdp: string }> {
  try {
    const live = await openai().live.create({
      session: {
        model: LIVE_MODEL,
        instructions: input.instructions,
        audio: { output: { voice: input.voice } },
        client: { data_channel: { allowed_client_events: ALLOWED_CLIENT_EVENTS } },
        delegation: {
          type: 'responses',
          responses: {
            model: VOICE_BACKEND_MODEL,
            instructions: input.backendInstructions,
            tools: input.tools,
            tool_choice: 'auto',
            parallel_tool_calls: false,
          },
        },
      },
      transport: { type: 'webrtc', sdp: input.sdp },
    });
    return { sessionId: live.session.id, sdp: live.transport.sdp };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const { status, reason } = describeOpenAIError(e, `${LIVE_MODEL} (voice) or ${VOICE_BACKEND_MODEL} (reasoning)`);
    console.error('GPT-Live session creation failed:', status, e instanceof Error ? e.message : e);
    // Staff-facing reason; the session route shows guests a gentler line.
    throw new DomainError(502, 'VOICE_UPSTREAM', reason, { status });
  }
}

/**
 * Turns an OpenAI failure into something a hotel owner can act on. OpenAI's
 * own message is included where it explains model access; never for auth
 * errors, whose message echoes part of the key.
 */
export function describeOpenAIError(e: unknown, model: string): { status: number | null; reason: string } {
  const clip = (s: string) => (s.length > 280 ? `${s.slice(0, 277)}…` : s);
  if (e instanceof OpenAI.APIConnectionError) return { status: null, reason: 'Couldn’t reach OpenAI just now — try again in a moment.' };
  if (!(e instanceof OpenAI.APIError)) return { status: null, reason: 'Couldn’t start the voice line just now. Please try again.' };
  const status = e.status ?? null;
  const detail = clip(String(e.message ?? '').replace(/sk-[A-Za-z0-9_*.-]+/g, 'sk-…'));
  switch (status) {
    case 401:
      return { status, reason: 'OpenAI didn’t accept the API key. Re-check OPENAI_API_KEY in Vercel (Settings → Environment Variables), then redeploy.' };
    case 403:
      return { status, reason: `OpenAI won’t let this key use ${model} yet — new models often need a verified organization or a higher usage tier. OpenAI says: ${detail}` };
    case 404:
      return { status, reason: `This OpenAI key doesn’t have access to ${model}. OpenAI says: ${detail}` };
    case 429:
      return e.code === 'insufficient_quota'
        ? { status, reason: 'The OpenAI account is out of credit — add billing at platform.openai.com, then try again.' }
        : { status, reason: 'OpenAI is rate-limiting this key right now — try again in a minute.' };
    case 400:
      return { status, reason: `OpenAI rejected the voice session setup. OpenAI says: ${detail}` };
    default:
      return { status, reason: `OpenAI returned an error${status ? ` (${status})` : ''}. ${detail}` };
  }
}

/** Setup check for the console: can this key use the voice and reasoning models? */
export async function checkVoiceModels(): Promise<{ model: string; role: string; ok: boolean; reason: string | null }[]> {
  const client = openai();
  return Promise.all(
    [
      { model: LIVE_MODEL, role: 'Voice' },
      { model: VOICE_BACKEND_MODEL, role: 'Reasoning & tools' },
    ].map(async ({ model, role }) => {
      try {
        await client.models.retrieve(model);
        return { model, role, ok: true, reason: null };
      } catch (e) {
        return { model, role, ok: false, reason: describeOpenAIError(e, model).reason };
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Voice session tokens: bind a browser to one voice session for tool calls.
// ---------------------------------------------------------------------------

/** HOTEL: one hotel's front desk (pid set). GLOBAL: the HotelOne concierge across every listed hotel (pid null; web guests only). */
export type VoiceScope = 'HOTEL' | 'GLOBAL';

export interface VoiceTokenPayload {
  sid: string; // VoiceSession id
  /** The hotel; null only for GLOBAL (concierge) sessions. */
  pid: string | null;
  aud: 'GUEST' | 'STAFF';
  uid: string | null;
  /** Set for phone calls and WhatsApp (tools run server to server, with the phone tool set). */
  ch?: 'PHONE' | 'WHATSAPP';
  /** Absent on tokens minted before the concierge existed: those are HOTEL. */
  sc?: VoiceScope;
  exp: number;
}

/** A verified token's scope (older tokens carry none and are HOTEL). */
export const voiceTokenScope = (t: Pick<VoiceTokenPayload, 'sc'>): VoiceScope => (t.sc === 'GLOBAL' ? 'GLOBAL' : 'HOTEL');

/** A HOTEL session's verified token: its property is always set. */
export type HotelVoiceToken = VoiceTokenPayload & { pid: string };

/** Narrows a verified token to one hotel, or refuses (GLOBAL tokens can't use hotel-only endpoints). */
export function requireHotelToken(t: VoiceTokenPayload): HotelVoiceToken {
  if (voiceTokenScope(t) !== 'HOTEL' || !t.pid) throw forbidden('This voice session isn’t tied to a hotel.');
  return t as HotelVoiceToken;
}

function secret(): string {
  const s = process.env.AGENT_PLAN_SECRET || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET must be set to sign voice sessions.');
  return `voice:${s}`;
}

/** A stable secret for one purpose (e.g. the header the voice provider sends on webhooks), derived from the server secret. */
export function deriveVoiceKey(purpose: string): string {
  return createHmac('sha256', secret()).update(`derive:${purpose}`).digest('base64url');
}

/** Constant-time comparison for derived keys. */
export function sameKey(given: string | null | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signVoiceToken(p: Omit<VoiceTokenPayload, 'exp'>, ttlMs = 30 * 60 * 1000): string {
  const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyVoiceToken(token: string): VoiceTokenPayload {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw forbidden('Voice session is invalid.');
  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw forbidden('Voice session is invalid.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as VoiceTokenPayload;
  if (Date.now() > p.exp) throw forbidden('This voice session has ended. Start a new one.');
  // Only web guest concierge sessions may lack a hotel.
  const global = voiceTokenScope(p) === 'GLOBAL';
  if (global ? p.pid !== null || p.aud !== 'GUEST' || !!p.ch : !p.pid) throw forbidden('Voice session is invalid.');
  return p;
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

/** "2026-10-16" → "Friday, 2026-10-16": models resolve "this Friday" far more reliably with the weekday spelled out. */
const dayWithWeekday = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : `${d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}, ${day}`;
};

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const date = (description: string) => ({ type: 'string', description: `${description} (YYYY-MM-DD)` });
/** Several room types in one booking (start_booking, request_booking), in place of room_type_id + rooms. */
const roomItems = {
  type: ['array', 'null'],
  description:
    'Only when the guest wants different room types together (e.g. 2 King rooms and a Twin): each room_type_id from check_availability with its room count. Leave null for one room type. At most 4 types and 9 rooms; guests is the whole party.',
  items: obj({ room_type_id: { type: 'string', description: 'room_type_id from check_availability' }, rooms: { type: 'integer', minimum: 1, maximum: 9 } }, ['room_type_id', 'rooms']),
};

const PROPERTY_INFO: FunctionToolSpec = {
  type: 'function',
  name: 'get_property_info',
  description: 'Hotel facts: description, amenities, address, phone, check-in/out times, cancellation policy, room types with base prices, and the hotel’s FAQ answers. Call before answering any question about the hotel.',
  parameters: obj({}, []),
  strict: true,
};

const CHECK_AVAILABILITY: FunctionToolSpec = {
  type: 'function',
  name: 'check_availability',
  description: 'Live availability and exact prices for a stay. Always call this before quoting a price or saying a room is free.',
  parameters: obj(
    {
      check_in: date('Arrival date'),
      check_out: date('Departure date, after check_in'),
      guests: { type: 'integer', minimum: 1, maximum: 16 },
      rooms: { type: 'integer', minimum: 1, maximum: 9 },
    },
    ['check_in', 'check_out', 'guests', 'rooms']
  ),
  strict: true,
};

const FIND_BOOKING: FunctionToolSpec = {
  type: 'function',
  name: 'find_booking',
  description: 'Look up an existing reservation. Requires the 6–8 character confirmation code and the guest’s last name; both must match.',
  parameters: obj({ confirmation_code: { type: 'string' }, last_name: { type: 'string' } }, ['confirmation_code', 'last_name']),
  strict: true,
};

const LEAVE_MESSAGE: FunctionToolSpec = {
  type: 'function',
  name: 'leave_message',
  description: 'Pass a message or callback request to the hotel team (special requests, group bookings, anything you can’t resolve).',
  parameters: obj(
    {
      name: { type: 'string' },
      phone: { type: ['string', 'null'], description: 'Callback number if given' },
      email: { type: ['string', 'null'] },
      message: { type: 'string', description: 'What the guest needs, in one or two sentences' },
    },
    ['name', 'phone', 'email', 'message']
  ),
  strict: true,
};

/** Phone callers have no screen to check out on, and some hotels confirm every booking themselves: the team finishes these. */
const REQUEST_BOOKING: FunctionToolSpec = {
  type: 'function',
  name: 'request_booking',
  description:
    'Send a booking request to the hotel team once the guest has chosen a room from check_availability. The team confirms it with the guest — it is not booked until then. Never take card details.',
  parameters: obj(
    {
      room_type_id: { type: ['string', 'null'], description: 'id from check_availability (null when items lists several room types)' },
      check_in: date('Arrival date'),
      check_out: date('Departure date'),
      guests: { type: 'integer', minimum: 1, maximum: 16, description: 'Total guests in the party' },
      rooms: { type: 'integer', minimum: 1, maximum: 9, description: 'Rooms of the single room type (ignored with items)' },
      items: roomItems,
      name: { type: 'string', description: 'Guest’s full name' },
      email: { type: ['string', 'null'], description: 'Email for the booking link, if the guest gives one' },
      phone: { type: ['string', 'null'], description: 'Callback number, only if different from the number they are calling from' },
      notes: { type: ['string', 'null'], description: 'Special requests, if any' },
    },
    ['room_type_id', 'check_in', 'check_out', 'guests', 'rooms', 'items', 'name', 'email', 'phone', 'notes']
  ),
  strict: true,
};

const SKILL_ARGUMENTS = {
  type: ['string', 'null'],
  description: 'The skill’s inputs as a JSON object in text, e.g. {"date":"2026-11-14"}. Empty for skills without inputs.',
};

/** A hotel's saved answers and tools (AgentSkill), on the phone line: the call is pinned to one hotel. */
const PHONE_USE_SKILL: FunctionToolSpec = {
  type: 'function',
  name: 'use_skill',
  description: 'Use one of the hotel’s skills — saved answers and tools its team set up — by its key from the list in your instructions. Returns the exact answer to give.',
  parameters: obj({ key: { type: 'string', description: 'Skill key, e.g. "faq-parking"' }, arguments: SKILL_ARGUMENTS }, ['key', 'arguments']),
  strict: true,
};

/**
 * What the hotel's phone line can do: the guest tools, with phone booking
 * requests instead of on-screen checkout. Wire contract: these become webhook
 * tools on every hotel's phone agent at ElevenLabs — add tools, but keep
 * existing names and arguments.
 */
export const PHONE_TOOLS: FunctionToolSpec[] = [PROPERTY_INFO, CHECK_AVAILABILITY, REQUEST_BOOKING, FIND_BOOKING, LEAVE_MESSAGE, PHONE_USE_SKILL];

// --- Booking site (the voice dock) ---------------------------------------------
// One set of definitions serves both scopes: on a hotel's own pages (HOTEL)
// property_id is left empty and other hotels are refused; the all-hotels
// concierge (GLOBAL) passes ids from search_hotels. open_hotel, start_booking,
// fill_guest_details and confirm_booking change what is on the guest's screen
// and run (or finish) in the browser.

const propertyId = (description = 'Hotel id from search_hotels. Leave empty on a hotel’s own line (it means that hotel).') => ({ type: ['string', 'null'], description });
const guests = { type: 'integer', minimum: 1, maximum: 16, description: 'Total guests' };
const rooms = { type: 'integer', minimum: 1, maximum: 9, description: 'Rooms needed' };

const SEARCH_HOTELS: FunctionToolSpec = {
  type: 'function',
  name: 'search_hotels',
  description:
    'Find hotels on HotelOne by place (city, state, zip or area) or by name. With both dates, each result has live availability, the cheapest price per night and the stay total. Returns up to 5 hotels, best matches first.',
  parameters: obj(
    {
      location: { type: ['string', 'null'], description: 'Where the guest wants to stay, e.g. "Santa Cruz, CA"' },
      query: { type: ['string', 'null'], description: 'A hotel name or other words to match, if the guest named one' },
      check_in: { type: ['string', 'null'], description: 'Arrival date (YYYY-MM-DD), if known' },
      check_out: { type: ['string', 'null'], description: 'Departure date (YYYY-MM-DD), if known' },
      guests,
      rooms,
    },
    ['location', 'query', 'check_in', 'check_out', 'guests', 'rooms']
  ),
  strict: true,
};

const WEB_PROPERTY_INFO: FunctionToolSpec = {
  type: 'function',
  name: 'get_property_info',
  description:
    'One hotel’s facts: description, amenities, address, phone, check-in/out times, cancellation policy, room types with base prices, and the hotel’s own answers to common questions (skills). Call before answering any question about a hotel.',
  parameters: obj({ property_id: propertyId() }, ['property_id']),
  strict: true,
};

const WEB_CHECK_AVAILABILITY: FunctionToolSpec = {
  type: 'function',
  name: 'check_availability',
  description: 'Live availability and exact prices at one hotel for a stay. Always call this before quoting a price or saying a room is free. When that hotel’s page is on screen, its room list updates to these dates.',
  parameters: obj(
    { property_id: propertyId(), check_in: date('Arrival date'), check_out: date('Departure date, after check_in'), guests, rooms },
    ['property_id', 'check_in', 'check_out', 'guests', 'rooms']
  ),
  strict: true,
};

const OPEN_HOTEL: FunctionToolSpec = {
  type: 'function',
  name: 'open_hotel',
  description: 'Open a hotel’s page on the guest’s screen (photos, rooms and prices), with the stay filled in when you know the dates. Use when the guest wants to see a hotel from search_hotels.',
  parameters: obj(
    {
      property_id: { type: 'string', description: 'Hotel id from search_hotels' },
      check_in: { type: ['string', 'null'], description: 'Arrival date (YYYY-MM-DD), if known' },
      check_out: { type: ['string', 'null'], description: 'Departure date (YYYY-MM-DD), if known' },
      guests: { type: ['integer', 'null'], minimum: 1, maximum: 16, description: 'Total guests, if known' },
      rooms: { type: ['integer', 'null'], minimum: 1, maximum: 9, description: 'Rooms needed, if known' },
    },
    ['property_id', 'check_in', 'check_out', 'guests', 'rooms']
  ),
  strict: true,
};

const WEB_START_BOOKING: FunctionToolSpec = {
  type: 'function',
  name: 'start_booking',
  description:
    'Open the hotel’s secure checkout on the guest’s screen with the chosen room (or several room types booked together), dates and party filled in. Use once the guest has picked from check_availability and you have repeated the rooms, dates and total back. Never take card details by voice.',
  parameters: obj(
    {
      property_id: propertyId(),
      room_type_id: { type: ['string', 'null'], description: 'room_type_id from check_availability (null when items lists several room types)' },
      check_in: date('Arrival date'),
      check_out: date('Departure date'),
      guests: { ...guests, description: 'Total guests in the party' },
      rooms: { ...rooms, description: 'Rooms of the single room type (ignored with items)' },
      items: roomItems,
    },
    ['property_id', 'room_type_id', 'check_in', 'check_out', 'guests', 'rooms', 'items']
  ),
  strict: true,
};

const FILL_GUEST_DETAILS: FunctionToolSpec = {
  type: 'function',
  name: 'fill_guest_details',
  description:
    'Fill in the guest’s details on the checkout page that is open on their screen: full name, phone and special requests. Only works on checkout. Says what is still missing (for example, signing in). Never ask for card details.',
  parameters: obj(
    {
      name: { type: ['string', 'null'], description: 'Guest’s first and last name' },
      phone: { type: ['string', 'null'], description: 'Guest’s phone number' },
      notes: { type: ['string', 'null'], description: 'Special requests for the hotel (arrival time, a quiet room…)' },
    },
    ['name', 'phone', 'notes']
  ),
  strict: true,
};

const CONFIRM_BOOKING: FunctionToolSpec = {
  type: 'function',
  name: 'confirm_booking',
  description:
    'Book the room (or rooms) shown on the open checkout page, paying at the hotel. Call ONLY after you have read back that exact room, dates and total and the guest has clearly said yes to it in this conversation. If the guest must sign in first, or card payment is selected, it tells you what they need to tap on screen.',
  parameters: obj({}, []),
  strict: true,
};

const WEB_LEAVE_MESSAGE: FunctionToolSpec = {
  type: 'function',
  name: 'leave_message',
  description: 'Pass a message or callback request to a hotel’s team (special requests, group bookings, anything you can’t resolve).',
  parameters: obj(
    {
      property_id: propertyId('Hotel id from search_hotels — required in the all-hotels concierge. Leave empty on a hotel’s own line.'),
      name: { type: 'string' },
      phone: { type: ['string', 'null'], description: 'Callback number if given' },
      email: { type: ['string', 'null'] },
      message: { type: 'string', description: 'What the guest needs, in one or two sentences' },
    },
    ['property_id', 'name', 'phone', 'email', 'message']
  ),
  strict: true,
};

const WEB_USE_SKILL: FunctionToolSpec = {
  type: 'function',
  name: 'use_skill',
  description: 'Use one of a hotel’s skills — saved answers and tools its team set up — by key (from your instructions or get_property_info). Returns the exact answer to give.',
  parameters: obj({ property_id: propertyId(), key: { type: 'string', description: 'Skill key, e.g. "faq-parking"' }, arguments: SKILL_ARGUMENTS }, ['property_id', 'key', 'arguments']),
  strict: true,
};

/** Tools that run in the browser only (the server can't see or change the guest's screen). */
export const CLIENT_ONLY_TOOLS = new Set(['fill_guest_details', 'confirm_booking']);

/** A hotel's front desk on its own booking pages (HOTEL web sessions). */
export const GUEST_TOOLS: FunctionToolSpec[] = [
  WEB_PROPERTY_INFO,
  WEB_CHECK_AVAILABILITY,
  WEB_START_BOOKING,
  FILL_GUEST_DETAILS,
  CONFIRM_BOOKING,
  FIND_BOOKING,
  WEB_LEAVE_MESSAGE,
  WEB_USE_SKILL,
];

/**
 * The booking page and the console's test call for hotels that keep their own
 * system (voice only, keep your PMS): no on-screen checkout or reservation
 * look-ups — the team confirms booking requests.
 */
export const REQUEST_ONLY_GUEST_TOOLS: FunctionToolSpec[] = [WEB_PROPERTY_INFO, WEB_CHECK_AVAILABILITY, REQUEST_BOOKING, WEB_LEAVE_MESSAGE, WEB_USE_SKILL];

/** The HotelOne concierge across every listed hotel (GLOBAL web sessions). */
export const CONCIERGE_TOOLS: FunctionToolSpec[] = [
  SEARCH_HOTELS,
  WEB_PROPERTY_INFO,
  WEB_CHECK_AVAILABILITY,
  OPEN_HOTEL,
  WEB_START_BOOKING,
  FILL_GUEST_DETAILS,
  CONFIRM_BOOKING,
  FIND_BOOKING,
  WEB_LEAVE_MESSAGE,
  WEB_USE_SKILL,
];

/**
 * Every booking-site tool, for the one ElevenLabs guest agent that serves
 * both scopes and every kind of hotel (its prompt, sent per conversation,
 * says which apply).
 */
export const GUEST_AGENT_TOOLS: FunctionToolSpec[] = [
  ...new Map([...CONCIERGE_TOOLS, ...GUEST_TOOLS, ...REQUEST_ONLY_GUEST_TOOLS].map((t) => [t.name, t])).values(),
];

export const STAFF_TOOLS: FunctionToolSpec[] = [
  {
    type: 'function',
    name: 'front_desk',
    description:
      'Run a request against the hotel’s live systems and show the result on the staff member’s screen. Use plain imperative English the way the staff member said it, e.g. "who is arriving today", "check in Jordan Smith, quiet room on a high floor", "mark 204 clean", "raise Ocean King 10% next weekend". Reads return facts; changes come back as a plan that needs confirmation.',
    parameters: obj({ request: { type: 'string' } }, ['request']),
    strict: true,
  },
  {
    type: 'function',
    name: 'confirm_plan',
    description: 'Carry out the plan currently shown on screen. Only call after the staff member clearly says yes to that specific plan in this conversation.',
    parameters: obj({}, []),
    strict: true,
  },
  {
    type: 'function',
    name: 'dismiss_plan',
    description: 'Discard the plan currently shown on screen when the staff member says no or changes their mind.',
    parameters: obj({}, []),
    strict: true,
  },
];

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function guestPrompts(p: {
  name: string;
  greeting?: string | null;
  houseRules?: string | null;
  today: string;
  timezone: string;
  handoffPhone?: string | null;
  /** A call to the hotel's phone line (or a WhatsApp chat or call) rather than the booking page. */
  phone?: { callerNumber: string | null; canTransfer: boolean; whatsapp?: boolean };
  /** The hotel's active guest answer skills (skillCatalogText), so the agent knows what it can answer. */
  skills?: string | null;
  /**
   * False for hotels that keep their own system (voice only, keep your PMS):
   * the voice quotes prices, but the team confirms availability and bookings.
   */
  liveInventory?: boolean;
}) {
  const phone = p.phone;
  const whatsapp = !!phone?.whatsapp;
  const live = p.liveInventory ?? true;
  // On the phone, the hotel's number is usually the one that forwarded them here: take a message instead.
  const person =
    phone?.canTransfer && !whatsapp
      ? 'If the caller asks for a person, or something urgent needs staff, say you’ll put them through and transfer the call.'
      : whatsapp
        ? 'If the guest wants a person, take a message so the team can get back to them.'
        : phone
          ? 'If the caller wants a person, take a message so the team can call them back. Don’t give out the hotel’s phone number for that — it may lead straight back to you.'
          : p.handoffPhone
            ? `If the guest wants a person, offer to take a message or give the hotel number ${p.handoffPhone}.`
            : 'If the guest wants a person, offer to take a message for the team.';
  const instructions = [
    whatsapp
      ? `You are the front desk of ${p.name} on WhatsApp — guests message (or call) this number. Warm, calm and brief, like a great hotel receptionist.`
      : `You are the voice of the front desk at ${p.name}${phone ? ', answering the hotel’s phone' : ''}. Warm, calm and brief — like a great hotel receptionist on the phone.`,
    whatsapp ? '' : p.greeting ? `Open with: "${p.greeting}"` : `Open with a short welcome to ${p.name} and ask how you can help.`,
    // WhatsApp may be text or a call: plain amounts read well and the voice says them naturally.
    whatsapp
      ? 'Keep replies short — a sentence or two. Write prices as plain amounts ("$227 a night") and dates like "Fri, Oct 23". Repeat dates back before acting on them.'
      : 'Speak in short sentences. Say prices as natural amounts ("two hundred and twenty-seven dollars a night"). Repeat dates back before acting on them.',
    'Whenever the guest asks about rooms, prices, availability, policies, the hotel, or an existing booking, delegate — never answer facts from memory.',
    whatsapp ? '' : 'If you are waiting on a result, say a brief natural filler ("let me check that for you").',
    !live
      ? 'Never take card details. The front desk confirms every booking with the guest.'
      : whatsapp
        ? 'Never take card details here: the team confirms bookings made on WhatsApp and sends a link to finish booking online.'
        : phone
          ? 'Never take card details over the phone: the team confirms phone bookings and sends a link to finish booking online.'
          : 'Never ask for card numbers. Bookings are completed on the guest’s screen.',
    person,
    phone ? 'If someone describes an emergency, tell them to call the local emergency number straight away.' : '',
    whatsapp ? 'If asked, say you are the hotel’s virtual assistant.' : phone ? 'If asked, say you are the hotel’s virtual assistant. When the caller is done, say goodbye and end the call.' : '',
  ]
    .filter(Boolean)
    .join('\n');
  const caller = phone
    ? whatsapp
      ? phone.callerNumber
        ? `the WhatsApp number they are using (${phone.callerNumber}) unless they give another`
        : 'a number or email they give you'
      : phone.callerNumber
        ? `the number they are calling from (${phone.callerNumber}) unless they give another`
        : 'a number or email they give you — their caller ID is withheld'
    : // The booking page (and the console's test call) has no caller ID.
      !live && 'a phone number or email they give you';
  const backendInstructions = [
    `You handle tasks for the voice front desk of ${p.name}. Today is ${dayWithWeekday(p.today)} (${p.timezone}). Resolve relative dates ("this Friday", "next weekend") against today.`,
    'Rules:',
    '- Facts come only from tools. Never invent prices, availability, amenities or policies.',
    ...(live
      ? [
          '- Quote exact prices from check_availability. If nothing fits, say so and suggest other dates or a message to the team.',
          phone
            ? '- To book: once the guest picks a room from check_availability, get their full name and an email for the booking link, then call request_booking. Tell them the team will confirm and send a link to finish booking — it isn’t booked until then.'
            : '- To book: when the guest picks a room, repeat the room, dates, guests and total from check_availability, then call start_booking — the checkout opens on their screen.',
          MULTI_ROOM_RULE,
          phone ? '' : WEB_CHECKOUT_RULES,
          '- Existing bookings: find_booking needs the confirmation code and last name. Guests can change dates or cancel free until 3 PM the day before arrival on their booking page.',
        ]
      : [
          '- You can’t see which rooms are free: the front desk keeps the bookings. Quote the exact prices from check_availability, then say the front desk will confirm the room is free. Never say a room is available or sold out.',
          `- To book: once the guest picks a room and dates, get their full name${phone ? '' : ' and a phone number or email'}, read the request back, then call request_booking. Tell them the front desk will check and confirm — it isn’t booked until then.`,
          MULTI_ROOM_RULE,
          '- Existing bookings, changes and cancellations: you can’t look them up. Take a message with leave_message (their name, dates and what they need) so the front desk can help.',
          '- Check-in and check-out times and the cancellation policy come from get_property_info. If it says they’re not on file, don’t guess — offer to take a message.',
        ]),
    '- Anything you cannot do (group rates, complaints, special arrangements): leave_message with their name and callback details.',
    phone ? '' : `- You only speak for ${p.name}: never suggest, compare or look up other hotels. Leave property_id empty in every tool — it means ${p.name}.`,
    phone ? '' : PAGE_UPDATE_RULE,
    caller ? `- Callback details: use ${caller}.` : '',
    whatsapp ? '- Reply with one or two short sentences.' : '- Reply with one or two short sentences for the voice to say.',
    p.houseRules ? `House rules from the hotel:\n${p.houseRules}` : '',
    p.skills?.trim()
      ? `The hotel’s saved answers (skills). For these topics call use_skill with the key and give its answer; get_property_info also lists them:\n${p.skills.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { instructions, backendInstructions };
}

/** How the booking-site voice finishes a booking on the guest's screen (both scopes). */
const WEB_CHECKOUT_RULES = [
  '- On checkout: fill_guest_details can fill in the guest’s name, phone and special requests. When they want to book, read back the room, dates and total shown on checkout and ask “Shall I book it?”.',
  '- Call confirm_booking only after a clear yes to that exact room, dates and total in this conversation. It books pay-at-the-hotel. If it says the guest must sign in, or that card payment is selected, tell them exactly what to tap on screen. Never take card details by voice.',
].join('\n');

/** Booking different room types together (start_booking and request_booking take `items`). */
const MULTI_ROOM_RULE =
  '- Different room types in one booking (for example a King for the parents and a Twin for the kids): check_availability for the whole party, then pass items with each room_type_id and its room count (room_type_id null); guests is the whole party. Read back every room type, the dates and the combined total first. It is one booking with one confirmation code.';

/** Page updates the browser sends while the guest moves around the site. */
const PAGE_UPDATE_RULE = '- Messages starting with [Page] say what is on the guest’s screen right now. Use them to stay in step; don’t read them out.';

/**
 * The HotelOne concierge (GLOBAL scope): one voice for every listed hotel,
 * on the platform's own pages (home, directory, trips). Finds stays,
 * opens hotels and checkout on screen, and books only on a clear yes.
 */
export function conciergePrompts(p: { product: string; today: string; timezone: string }) {
  const instructions = [
    `You are the ${p.product} concierge: a friendly voice assistant that helps people find and book a room at the independent hotels on ${p.product}. Warm, calm and brief.`,
    `Open with a short welcome: say you’re ${p.product}’s AI concierge and ask where and when they’d like to stay.`,
    'Speak in short sentences. Ask for what is missing — where, which dates, how many guests — one question at a time.',
    'Say prices as natural amounts ("one hundred and eighty-nine dollars a night"). Repeat dates back before acting on them.',
    'Whenever the guest asks about hotels, rooms, prices, availability, policies or a booking, delegate — never answer facts from memory.',
    'If you are waiting on a result, say a brief natural filler ("let me look").',
    'Offer at most three hotels at a time, each with its name, town and price.',
    'Never ask for card numbers. Bookings are completed on the guest’s screen.',
    'If the guest wants a person, offer to take a message for the hotel’s team.',
    'If asked, say you are an AI assistant.',
  ].join('\n');
  const backendInstructions = [
    `You find and book hotels on ${p.product} for the voice concierge. Today is ${p.today} (${p.timezone}). Resolve relative dates ("this Friday", "next weekend") against today.`,
    'Rules:',
    '- Facts come only from tools. Never invent hotels, prices, availability, amenities or policies.',
    '- Finding a stay: call search_hotels with the place and, once known, check_in, check_out and guests. Present at most three options with their price per night (or stay total). If nothing fits, say so and suggest other dates or a nearby place.',
    '- Questions about one hotel: get_property_info with its property_id; its skills are the hotel’s own answers (use_skill gives one by key).',
    '- To show a hotel on screen, call open_hotel. Use check_availability for its rooms and exact prices.',
    '- To book: confirm the hotel, room, dates, guests and total with the guest, then call start_booking — the checkout opens on their screen.',
    MULTI_ROOM_RULE,
    WEB_CHECKOUT_RULES,
    '- Existing bookings: find_booking needs the confirmation code and last name.',
    '- Anything you can’t do (group rates, special arrangements): leave_message with the hotel’s property_id, the guest’s name and a phone number or email.',
    `${PAGE_UPDATE_RULE} When a hotel’s page is open, its property_id is in the update.`,
    '- Reply with one or two short sentences for the voice to say.',
  ].join('\n');
  return { instructions, backendInstructions };
}

export function staffPrompts(p: { name: string; userName: string; role: string; today: string; timezone: string }) {
  const instructions = [
    `You are the hands-free assistant for ${p.userName} (${p.role.replace('_', ' ').toLowerCase()}) at ${p.name}. Brisk, friendly, professional.`,
    'Delegate every operational question or request. Results also appear on their screen, so summarise in one sentence instead of reading lists aloud.',
    'When a plan needs confirmation, read the plan title, ask "Shall I go ahead?", and wait for a clear yes before delegating the confirmation.',
    'If they say stop, cancel, or no, stop talking and delegate dismissing the plan.',
  ].join('\n');
  const backendInstructions = [
    `You operate ${p.name}'s systems for staff. Today is ${dayWithWeekday(p.today)} (${p.timezone}).`,
    '- Use front_desk for every read or change, passing the staff member’s request in plain words. Split multi-part requests into separate front_desk calls.',
    '- front_desk returns a summary and whether a plan is waiting. Plans never run on their own.',
    '- Call confirm_plan only after the staff member explicitly agrees to the pending plan; call dismiss_plan if they decline.',
    '- If front_desk asks a clarifying question, ask the staff member exactly that question.',
    '- Respond with one short sentence for the voice to say.',
  ].join('\n');
  return { instructions, backendInstructions };
}
