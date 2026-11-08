/**
 * The model-driven agent harness.
 *
 * One Claude tool loop over the hotel's real tools, shared by every surface
 * that talks to the agent (console chat, voice, owner WhatsApp, and — for
 * changes — the AI advisor). The model decides what to look up and what to
 * change; this module keeps the guarantees the deterministic engine had:
 *
 *   • the model only ever calls the tools below — it never touches the DB;
 *   • read tools return live data, and the cards the person sees are built
 *     from those results, never from numbers the model wrote;
 *   • write tools never change anything. They resolve and validate through
 *     the same planners the deterministic engine uses (planWrite) and add
 *     steps to ONE signed plan the person confirms (plan.ts → confirmPlan).
 *
 * Tool inputs are defined once in zod: the JSON schema sent to Claude is
 * generated from them, and the same schema validates the model's input.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { prisma } from '@/lib/prisma';
import type { AgentBlock, AgentContextState, AgentEvent } from '@/lib/agent/blocks';
import type { ISODate } from '@/lib/dto';
import { money } from '@/lib/status';
import { can, canAtProperty } from '../authz';
import { addDaysISO, dayOfWeek, diffDays, eachNight, formatDay, isISODate } from '../dates';
import { hotelLocale } from '../services/hotels';
import { nightlyRates, propertyAvailability } from '../services/inventory';
import { DomainError } from '../errors';
import { logError } from '../log';
import type { DateRange, GuestRef, Intent, RoomPrefs } from './nlu';
import type { PlanStep } from './plan';
import { resolveBooking } from './resolve';
import { answerFromSkills } from './skills';
import { maxRisk, planWrite, runRead, type PlanOutput, type ToolCtx } from './tools';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODEL = process.env.AGENT_LLM_MODEL || 'claude-opus-5-5';
const EFFORT = (['low', 'medium', 'high'] as const).find((e) => e === process.env.AGENT_LLM_EFFORT) ?? 'low';
const MAX_ROUNDS = 8;
const MAX_RESULT_CHARS = 14_000;
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];

/** The model engine runs when an Anthropic key is configured, unless AGENT_LLM_ENABLED=false turns it off. */
export function llmConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.AGENT_LLM_ENABLED !== 'false';
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => isISODate(v), 'Not a valid date');

const guest = z
  .object({
    code: z.string().max(40).optional().describe('Confirmation code, e.g. "K7Q2MD".'),
    name: z.string().max(120).optional().describe('Guest name or surname, e.g. "Okafor" or "the Smiths".'),
    room_number: z.string().max(20).optional().describe('Room the guest is in or assigned to.'),
  })
  .describe('Who the reservation belongs to. Give at least one field; a code is most precise.');

const prefs = z
  .object({
    high_floor: z.boolean().optional(),
    low_floor: z.boolean().optional(),
    tags: z.array(z.enum(['quiet', 'accessible', 'view', 'corner'])).max(4).optional(),
  })
  .optional()
  .describe('Room preferences used when no room number is given.');

const weekdays = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .optional()
  .describe('Only these nights of the week: 0 = Sunday … 6 = Saturday. Omit for every night in the range.');

const rateChange = z
  .object({
    room_type: z.string().min(1).max(120).describe('Room type name exactly as list_room_types shows it, or its id.'),
    from: date.optional().describe('First night, YYYY-MM-DD (inclusive). Use with `to`.'),
    to: date.optional().describe('Last night, YYYY-MM-DD (INCLUSIVE). Use with `from`.'),
    nights: z.array(date).max(120).optional().describe('Specific nights instead of a range, e.g. ["2026-11-13","2026-11-14"].'),
    weekdays,
    price: z.number().positive().max(100_000).optional().describe('Set this exact nightly price.'),
    percent: z.number().min(-50).max(50).optional().describe('Or adjust the current price by this percent (e.g. -10).'),
    reset: z.boolean().optional().describe('Or remove overrides so the nights go back to the base price.'),
  })
  .describe('One rate change. Give nights or from/to, and exactly one of price, percent or reset.');

interface ToolDef {
  kind: 'read' | 'write';
  label: string;
  description: string;
  schema: z.ZodType;
}

const definitions = {
  // ---- Reads -------------------------------------------------------------
  today_overview: {
    kind: 'read',
    label: 'Checking today',
    description: 'Today at a glance: arrivals, departures, in-house guests, occupancy, room readiness and alerts.',
    schema: z.object({}),
  },
  list_arrivals: {
    kind: 'read',
    label: 'Looking up arrivals',
    description: 'Guests arriving on a date, with booking status and assigned rooms.',
    schema: z.object({ date: date.optional().describe('Defaults to today.') }),
  },
  list_departures: {
    kind: 'read',
    label: 'Looking up departures',
    description: 'Guests departing on a date.',
    schema: z.object({ date: date.optional().describe('Defaults to today.') }),
  },
  list_in_house: {
    kind: 'read',
    label: 'Looking up in-house guests',
    description: 'Guests currently checked in.',
    schema: z.object({}),
  },
  find_reservation: {
    kind: 'read',
    label: 'Finding the reservation',
    description: 'Find one reservation by guest name, confirmation code or room number: dates, room, price, balance and status.',
    schema: z.object({ guest }),
  },
  check_availability: {
    kind: 'read',
    label: 'Checking availability',
    description: 'Rooms free per room type and the exact price the booking site would charge for a stay.',
    schema: z.object({
      check_in: date,
      check_out: date.describe('Departure day (exclusive).'),
      guests: z.number().int().min(1).max(40).default(2),
      rooms: z.number().int().min(1).max(20).default(1),
    }),
  },
  occupancy_forecast: {
    kind: 'read',
    label: 'Pulling occupancy',
    description: 'Occupancy, rooms sold, revenue and ADR per night for a date range (up to 120 nights).',
    schema: z.object({ from: date, to: date.describe('End of range, exclusive.') }),
  },
  list_room_types: {
    kind: 'read',
    label: 'Reading room types',
    description: 'Every room type with its id, base price, room count and capacity. Call this before changing rates or creating a reservation.',
    schema: z.object({}),
  },
  get_rate_calendar: {
    kind: 'read',
    label: 'Reading the rate calendar',
    description: 'The nightly price per room type for a date range (up to 120 nights), and whether each night is a custom rate or the base price.',
    schema: z.object({
      from: date,
      to: date.describe('End of range, exclusive.'),
      room_type: z.string().max(120).optional().describe('One room type name or id; omit for all.'),
    }),
  },
  room_board: {
    kind: 'read',
    label: 'Checking rooms',
    description: 'Rooms with cleaning status, occupancy and out-of-order flags, optionally filtered.',
    schema: z.object({
      status: z.enum(['CLEAN', 'DIRTY', 'OUT_OF_ORDER']).optional(),
      occupancy: z.enum(['VACANT']).optional(),
      floor: z.string().max(10).optional(),
    }),
  },
  housekeeping_board: {
    kind: 'read',
    label: 'Checking housekeeping',
    description: 'Today’s cleaning tasks and the housekeeping team with their loads.',
    schema: z.object({}),
  },
  recent_activity: {
    kind: 'read',
    label: 'Reading the activity log',
    description: 'The latest changes made at the hotel and who made them (managers and owners).',
    schema: z.object({}),
  },
  suggest_rooms: {
    kind: 'read',
    label: 'Finding the best rooms',
    description: 'Rank rooms for a reservation by readiness and preferences.',
    schema: z.object({ guest, prefs }),
  },
  hotel_knowledge: {
    kind: 'read',
    label: 'Checking the hotel’s saved answers',
    description: 'Answer a policy or amenity question (parking, pets, breakfast, cancellation policy…) from the answers the hotel saved.',
    schema: z.object({ question: z.string().min(2).max(300) }),
  },
  // ---- Writes (planned, confirmed by the person) -------------------------
  set_rates: {
    kind: 'write',
    label: 'Preparing the rate changes',
    description:
      'Change nightly rates: an exact price, a percent change, or a reset to base, for one room type over a range or a list of nights, optionally only on some weekdays. ' +
      'Put every change the person asked for in one call. Use `to` as the LAST night (inclusive).',
    schema: z.object({ changes: z.array(rateChange).min(1).max(40) }),
  },
  check_in: {
    kind: 'write',
    label: 'Preparing the check-in',
    description: 'Check a guest in, into a given room number or the best ready room for their preferences.',
    schema: z.object({ guest, room_number: z.string().max(20).optional(), prefs }),
  },
  check_out: {
    kind: 'write',
    label: 'Preparing the check-out',
    description: 'Check a guest out; their room is marked dirty and queued for housekeeping.',
    schema: z.object({ guest }),
  },
  assign_room: {
    kind: 'write',
    label: 'Preparing the room assignment',
    description: 'Assign or move a reservation to a room number, or the best room for the preferences.',
    schema: z.object({ guest, room_number: z.string().max(20).optional(), prefs }),
  },
  assign_rooms_to_arrivals: {
    kind: 'write',
    label: 'Planning rooms for arrivals',
    description: 'Give every arrival today that has no room the best free room.',
    schema: z.object({ prefs }),
  },
  add_note: {
    kind: 'write',
    label: 'Preparing the note',
    description: 'Append a note to a reservation.',
    schema: z.object({ guest, note: z.string().min(1).max(500) }),
  },
  change_booking_status: {
    kind: 'write',
    label: 'Preparing the status change',
    description: 'Confirm, cancel or mark a reservation as a no-show.',
    schema: z.object({ guest, status: z.enum(['confirm', 'cancel', 'no_show']), reason: z.string().max(300).optional() }),
  },
  create_reservation: {
    kind: 'write',
    label: 'Preparing the reservation',
    description: 'Create a front-desk reservation for a guest at the live price (pay at the property unless paid now).',
    schema: z.object({
      room_type: z.string().min(1).max(120),
      check_in: date,
      check_out: date.describe('Departure day (exclusive).'),
      guests: z.number().int().min(1).max(40).default(2),
      rooms: z.number().int().min(1).max(20).default(1),
      first_name: z.string().min(1).max(80),
      last_name: z.string().min(1).max(80),
      email: z.string().email().max(200).optional(),
      phone: z.string().max(40).optional(),
      notes: z.string().max(500).optional(),
      paid: z.boolean().optional().describe('True only when the guest has paid in full now.'),
    }),
  },
  add_folio_charge: {
    kind: 'write',
    label: 'Preparing the charge',
    description:
      'Add an extra charge to a reservation’s folio (pet fee, late check-out, damage, minibar, parking…). Needs the amount: if the person didn’t say it, ' +
      'look for the hotel’s usual fee with hotel_knowledge (e.g. "pet fee"); if that has none, ask the person how much instead of guessing.',
    schema: z.object({
      guest,
      name: z.string().min(1).max(80).describe('What the charge is for, as it should read on the folio, e.g. "Pet fee".'),
      amount: z.number().positive().max(100_000).describe('Amount in the hotel’s currency.'),
      date: date.optional().describe('Day the charge applies to; defaults to none.'),
      reason: z.string().max(200).optional(),
    }),
  },
  set_room_status: {
    kind: 'write',
    label: 'Preparing room updates',
    description: 'Mark rooms clean, dirty or inspected.',
    schema: z.object({ room_numbers: z.array(z.string().max(20)).min(1).max(60), status: z.enum(['CLEAN', 'DIRTY', 'INSPECTED']) }),
  },
  set_out_of_order: {
    kind: 'write',
    label: 'Preparing the room change',
    description: 'Take a room out of order (with a reason) or return it to service.',
    schema: z.object({ room_number: z.string().max(20), out_of_order: z.boolean(), reason: z.string().max(200).optional() }),
  },
  assign_cleaning: {
    kind: 'write',
    label: 'Planning housekeeping',
    description: 'Assign rooms to a housekeeper by name, or to whoever has the lightest load.',
    schema: z.object({ room_numbers: z.array(z.string().max(20)).min(1).max(60), housekeeper: z.string().max(80).optional() }),
  },
  auto_assign_housekeeping: {
    kind: 'write',
    label: 'Planning housekeeping',
    description: 'Spread every unassigned dirty room across the housekeeping team, arrivals first.',
    schema: z.object({}),
  },
} satisfies Record<string, ToolDef>;

export type HotelToolName = keyof typeof definitions;

const isToolName = (name: string): name is HotelToolName => Object.prototype.hasOwnProperty.call(definitions, name);

function toApiTool(name: string, def: ToolDef, extra?: { property_id?: true }): Anthropic.Beta.BetaTool {
  const schema = z.toJSONSchema(def.schema, { io: 'input' }) as Record<string, unknown> & { properties?: Record<string, unknown>; required?: string[] };
  delete schema.$schema;
  if (extra?.property_id) {
    schema.properties = { property_id: { type: 'string', description: 'The property id from the portfolio snapshot.' }, ...(schema.properties ?? {}) };
    schema.required = ['property_id', ...(schema.required ?? [])];
  }
  return { name, description: def.description, input_schema: schema as Anthropic.Beta.BetaTool.InputSchema };
}

/** Every hotel tool, for the console agent. */
export const HOTEL_TOOLS: Anthropic.Beta.BetaTool[] = Object.entries(definitions).map(([n, d]) => toApiTool(n, d));

/** The write tools with a property_id, for the portfolio-level AI advisor. */
export const HOTEL_WRITE_TOOLS_FOR_ADVISOR: Anthropic.Beta.BetaTool[] = Object.entries(definitions)
  .filter(([n, d]) => d.kind === 'write' && n !== 'create_reservation')
  .map(([n, d]) => toApiTool(n, d, { property_id: true }));

export const isHotelWriteTool = (name: string) => isToolName(name) && definitions[name].kind === 'write';
export const hotelToolLabel = (name: string) => (isToolName(name) ? definitions[name].label : 'Working');

/** A tool input the model can fix; returned to it as an is_error result. */
export class HarnessInputError extends Error {}

function parseInput<N extends HotelToolName>(name: N, raw: unknown): z.infer<(typeof definitions)[N]['schema']> {
  const parsed = definitions[name].schema.safeParse(raw ?? {});
  if (!parsed.success) throw new HarnessInputError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
  return parsed.data as z.infer<(typeof definitions)[N]['schema']>;
}

// ---------------------------------------------------------------------------
// Mapping tool inputs onto the engine's intents
// ---------------------------------------------------------------------------

const toRef = (g: z.infer<typeof guest>): GuestRef => {
  const ref: GuestRef = { code: g.code?.replace(/^#/, '').toUpperCase() || undefined, name: g.name || undefined, roomNumber: g.room_number || undefined };
  if (!ref.code && !ref.name && !ref.roomNumber) throw new HarnessInputError('Say which guest: give a name, confirmation code or room number.');
  return ref;
};
const toPrefs = (p: z.infer<typeof prefs>): RoomPrefs => ({ highFloor: p?.high_floor, lowFloor: p?.low_floor, tags: p?.tags ?? [] });
const range = (from: ISODate, to: ISODate): DateRange => {
  if (to <= from) throw new HarnessInputError('`to` must be after `from` (it is exclusive).');
  if (diffDays(from, to) > 120) throw new HarnessInputError('Ranges are limited to 120 nights.');
  return { from, to, label: `${formatDay(from)} – ${formatDay(addDaysISO(to, -1))}` };
};

function readIntent(name: HotelToolName, raw: unknown, today: ISODate): Intent | null {
  switch (name) {
    case 'today_overview':
      return { kind: 'overview' };
    case 'list_arrivals': {
      const a = parseInput('list_arrivals', raw);
      const day = a.date ?? today;
      return { kind: 'arrivals', day, label: day === today ? 'today' : formatDay(day) };
    }
    case 'list_departures': {
      const a = parseInput('list_departures', raw);
      const day = a.date ?? today;
      return { kind: 'departures', day, label: day === today ? 'today' : formatDay(day) };
    }
    case 'list_in_house':
      return { kind: 'inHouse' };
    case 'find_reservation':
      return { kind: 'find', ref: toRef(parseInput('find_reservation', raw).guest) };
    case 'check_availability': {
      const a = parseInput('check_availability', raw);
      return { kind: 'availability', range: range(a.check_in, a.check_out), guests: a.guests, rooms: a.rooms };
    }
    case 'occupancy_forecast': {
      const a = parseInput('occupancy_forecast', raw);
      return { kind: 'occupancy', range: range(a.from, a.to) };
    }
    case 'room_board': {
      const a = parseInput('room_board', raw);
      const label = a.status === 'DIRTY' ? 'Rooms to clean' : a.status === 'OUT_OF_ORDER' ? 'Out of order' : a.occupancy === 'VACANT' ? 'Vacant rooms' : 'Rooms';
      return { kind: 'rooms', filter: { status: a.status, occupancy: a.occupancy, floor: a.floor }, label };
    }
    case 'housekeeping_board':
      return { kind: 'housekeeping' };
    case 'recent_activity':
      return { kind: 'activity' };
    case 'suggest_rooms': {
      const a = parseInput('suggest_rooms', raw);
      return { kind: 'suggestRooms', ref: toRef(a.guest), prefs: toPrefs(a.prefs) };
    }
    default:
      return null;
  }
}

function writeIntent(name: HotelToolName, raw: unknown): Intent | null {
  switch (name) {
    case 'check_in': {
      const a = parseInput('check_in', raw);
      return { kind: 'checkIn', ref: toRef(a.guest), roomNumber: a.room_number, prefs: toPrefs(a.prefs) };
    }
    case 'check_out':
      return { kind: 'checkOut', ref: toRef(parseInput('check_out', raw).guest) };
    case 'assign_room': {
      const a = parseInput('assign_room', raw);
      return { kind: 'assignRoom', ref: toRef(a.guest), roomNumber: a.room_number, prefs: toPrefs(a.prefs) };
    }
    case 'assign_rooms_to_arrivals':
      return { kind: 'assignArrivals', prefs: toPrefs(parseInput('assign_rooms_to_arrivals', raw).prefs) };
    case 'add_note': {
      const a = parseInput('add_note', raw);
      return { kind: 'note', ref: toRef(a.guest), text: a.note };
    }
    case 'change_booking_status': {
      const a = parseInput('change_booking_status', raw);
      const ref = toRef(a.guest);
      return a.status === 'confirm' ? { kind: 'confirm', ref } : a.status === 'cancel' ? { kind: 'cancel', ref, reason: a.reason } : { kind: 'noShow', ref };
    }
    case 'set_room_status': {
      const a = parseInput('set_room_status', raw);
      return { kind: 'roomStatus', roomNumbers: a.room_numbers, status: a.status };
    }
    case 'set_out_of_order': {
      const a = parseInput('set_out_of_order', raw);
      return a.out_of_order ? { kind: 'outOfOrder', roomNumber: a.room_number, reason: a.reason } : { kind: 'backInService', roomNumber: a.room_number };
    }
    case 'assign_cleaning': {
      const a = parseInput('assign_cleaning', raw);
      return { kind: 'assignCleaning', roomNumbers: a.room_numbers, who: a.housekeeper };
    }
    case 'auto_assign_housekeeping':
      return { kind: 'autoAssignCleaning' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tools the deterministic engine never had
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function roomTypesOf(propertyId: string) {
  return prisma.roomType.findMany({
    where: { propertyId, isActive: true },
    select: { id: true, name: true, basePrice: true, totalRooms: true, capacity: true },
    orderBy: { basePrice: 'asc' },
  });
}

/** Exactly one room type for a name or id, or an error the model can act on. */
async function resolveRoomTypeExact(propertyId: string, hint: string) {
  const all = await roomTypesOf(propertyId);
  const h = norm(hint);
  const byId = all.find((rt) => rt.id === hint);
  if (byId) return byId;
  const exact = all.filter((rt) => norm(rt.name) === h);
  if (exact.length === 1) return exact[0];
  const partial = all.filter((rt) => norm(rt.name).includes(h) || h.includes(norm(rt.name)));
  if (partial.length === 1) return partial[0];
  throw new HarnessInputError(`No single room type matches “${hint}”. Room types here: ${all.map((rt) => rt.name).join(', ')}.`);
}

function nightsLabel(nights: ISODate[]): string {
  if (nights.length === 1) return formatDay(nights[0], 'weekday');
  const contiguous = nights.every((d, i) => i === 0 || diffDays(nights[i - 1], d) === 1);
  if (contiguous) return `${formatDay(nights[0])}–${formatDay(nights[nights.length - 1])}`;
  if (nights.length <= 4) return nights.map((d) => formatDay(d, 'weekday')).join(', ');
  return `${nights.length} nights, ${formatDay(nights[0])}–${formatDay(nights[nights.length - 1])}`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function planSetRates(ctx: ToolCtx, raw: unknown): Promise<PlanOutput> {
  if (!can(ctx.actor, 'rates.write')) return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text: 'Rate changes are made by managers and owners.' }] };
  const { changes } = parseInput('set_rates', raw);
  const { currency } = await hotelLocale(ctx.propertyId);
  const fmt = (n: number) => money(n, { cents: false, currency });
  const steps: PlanStep[] = [];
  const warnings: string[] = [];
  for (const [i, c] of changes.entries()) {
    const which = `changes[${i}]`;
    const kinds = [c.price !== undefined, c.percent !== undefined, !!c.reset].filter(Boolean).length;
    if (kinds !== 1) throw new HarnessInputError(`${which}: give exactly one of price, percent or reset.`);
    let nights: ISODate[];
    if (c.nights?.length) {
      nights = [...new Set(c.nights)].sort();
    } else if (c.from && c.to) {
      if (c.to < c.from) throw new HarnessInputError(`${which}: \`to\` is the last night and can’t be before \`from\`.`);
      nights = eachNight(c.from, addDaysISO(c.to, 1));
    } else {
      throw new HarnessInputError(`${which}: give \`nights\` or both \`from\` and \`to\`.`);
    }
    if (c.weekdays?.length) nights = nights.filter((d) => c.weekdays!.includes(dayOfWeek(d)));
    if (!nights.length) throw new HarnessInputError(`${which}: no nights match those dates and weekdays.`);
    if (nights.length > 400) throw new HarnessInputError(`${which}: at most 400 nights per change.`);
    if (nights[0] < ctx.today) throw new HarnessInputError(`${which}: ${nights[0]} is in the past (today is ${ctx.today}).`);
    const rt = await resolveRoomTypeExact(ctx.propertyId, c.room_type);
    const current = await nightlyRates(prisma, rt.id, nights[0], addDaysISO(nights[nights.length - 1], 1));
    const byDate = new Map(current.map((r) => [r.date, r.price]));
    const before = [...new Set(nights.map((d) => byDate.get(d) ?? Number(rt.basePrice)))];
    const beforeLabel = before.length === 1 ? fmt(before[0]) : `${fmt(Math.min(...before))}–${fmt(Math.max(...before))}`;
    const afterLabel = c.price !== undefined ? fmt(c.price) : c.reset ? `base ${fmt(Number(rt.basePrice))}` : `${c.percent! > 0 ? '+' : ''}${c.percent}%`;
    if (c.price !== undefined && before.length && Math.abs(c.price - before[0]) / before[0] > 0.5) {
      warnings.push(`${rt.name}: ${fmt(c.price)} is more than 50% away from the current ${fmt(before[0])} — double-check it.`);
    }
    const days = c.weekdays?.length && c.weekdays.length < 7 ? ` (${c.weekdays.map((d) => WEEKDAY[d]).join('/')} only)` : '';
    steps.push({
      tool: 'set_rates',
      args: { roomTypeId: rt.id, nights, ...(c.price !== undefined ? { price: c.price } : c.reset ? { reset: true } : { percent: c.percent }) },
      summary: `${rt.name} · ${nightsLabel(nights)}${days}: ${beforeLabel} → ${afterLabel}`,
      detail: `${nights.length} night${nights.length === 1 ? '' : 's'}`,
    });
  }
  warnings.unshift('Existing reservations keep the price they booked at. The booking site and connected channels update right away.');
  return { steps, warnings, risk: 'medium' };
}

async function planCreateReservation(ctx: ToolCtx, raw: unknown): Promise<PlanOutput> {
  if (!can(ctx.actor, 'booking.create')) return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text: 'Your role can’t create reservations.' }] };
  const a = parseInput('create_reservation', raw);
  if (a.check_out <= a.check_in) throw new HarnessInputError('check_out must be after check_in.');
  if (a.check_in < ctx.today) throw new HarnessInputError(`check_in ${a.check_in} is in the past (today is ${ctx.today}).`);
  const rt = await resolveRoomTypeExact(ctx.propertyId, a.room_type);
  const avail = await propertyAvailability({ propertyId: ctx.propertyId, checkIn: a.check_in, checkOut: a.check_out, guests: a.guests, rooms: a.rooms });
  const row = avail.find((r) => r.id === rt.id);
  if (!row || row.available < a.rooms) throw new HarnessInputError(`${rt.name} has ${row?.available ?? 0} room(s) free for those dates — not enough. Check availability for another type.`);
  const { currency } = await hotelLocale(ctx.propertyId);
  const nights = diffDays(a.check_in, a.check_out);
  return {
    steps: [
      {
        tool: 'create_reservation',
        args: {
          propertyId: ctx.propertyId,
          roomTypeId: rt.id,
          checkIn: a.check_in,
          checkOut: a.check_out,
          guests: a.guests,
          rooms: a.rooms,
          firstName: a.first_name,
          lastName: a.last_name,
          email: a.email,
          phone: a.phone,
          notes: a.notes,
          paid: !!a.paid,
        },
        summary: `Book ${a.first_name} ${a.last_name} · ${rt.name} · ${formatDay(a.check_in)}–${formatDay(a.check_out)}`,
        detail: `${nights} night${nights === 1 ? '' : 's'} · ${a.guests} guest${a.guests === 1 ? '' : 's'}${a.rooms > 1 ? ` · ${a.rooms} rooms` : ''} · ${row.quote ? money(row.quote.total, { currency }) : ''} · ${a.paid ? 'paid at the desk' : 'pay at the property'}`,
      },
    ],
    warnings: [],
    risk: 'low',
  };
}

async function planFolioCharge(ctx: ToolCtx, raw: unknown): Promise<PlanOutput> {
  const a = parseInput('add_folio_charge', raw);
  const r = await resolveBooking(ctx, toRef(a.guest), 'any');
  if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
  const b = r.value;
  if (!(await canAtProperty(ctx.actor, 'folio.edit', ctx.propertyId))) {
    return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text: 'Your role can’t change folios here. The owner can allow it under Settings → Permissions.' }] };
  }
  if (b.status === 'CANCELLED' || b.status === 'NO_SHOW') throw new HarnessInputError(`${b.code} is ${b.status.toLowerCase().replace('_', '-')}; reinstate it before adding charges.`);
  const name = `${b.user.firstName} ${b.user.lastName}`.trim();
  return {
    steps: [
      {
        tool: 'add_folio_charge',
        args: { bookingId: b.id, name: a.name, amount: a.amount, ...(a.date ? { date: a.date } : {}), ...(a.reason ? { reason: a.reason } : {}) },
        summary: `Add ${a.name} ${money(a.amount, { currency: b.currency })} to ${name}’s folio (${b.code})`,
        detail: `${b.roomType.name}${b.room ? ` · room ${b.room.roomNumber}` : ''} · stay total ${money(Number(b.totalPrice), { currency: b.currency })} → ${money(Number(b.totalPrice) + a.amount, { currency: b.currency })}`,
      },
    ],
    warnings: [],
    risk: 'low',
    memory: { lastBookingId: b.id, lastBookingCode: b.code ?? undefined, lastGuestName: name, lastRoomNumber: b.room?.roomNumber },
  };
}

async function roomTypesResult(propertyId: string): Promise<unknown> {
  const { currency } = await hotelLocale(propertyId);
  return { currency, roomTypes: (await roomTypesOf(propertyId)).map((rt) => ({ id: rt.id, name: rt.name, basePrice: Number(rt.basePrice), rooms: rt.totalRooms, capacity: rt.capacity })) };
}

async function rateCalendarResult(propertyId: string, raw: unknown): Promise<unknown> {
  const a = parseInput('get_rate_calendar', raw);
  const r = range(a.from, a.to);
  const types = a.room_type ? [await resolveRoomTypeExact(propertyId, a.room_type)] : await roomTypesOf(propertyId);
  const { currency } = await hotelLocale(propertyId);
  const out = [];
  for (const rt of types) {
    const nights = await nightlyRates(prisma, rt.id, r.from, r.to);
    out.push({ roomType: rt.name, id: rt.id, basePrice: Number(rt.basePrice), nights: nights.map((n) => ({ date: n.date, dow: WEEKDAY[dayOfWeek(n.date)], price: n.price, custom: n.isCustom })) });
  }
  return { currency, from: r.from, toExclusive: r.to, rates: out };
}

// ---------------------------------------------------------------------------
// Planning a write (shared with the AI advisor)
// ---------------------------------------------------------------------------

/** What a write tool call adds to the plan, and what to tell the model. */
export interface PlannedWrite {
  out: PlanOutput;
  /** Text for the model: what was planned, or why nothing was. */
  report: string;
  isError: boolean;
}

export async function planHotelWrite(ctx: ToolCtx, name: string, raw: unknown): Promise<PlannedWrite> {
  if (!isToolName(name) || definitions[name].kind !== 'write') throw new HarnessInputError(`Unknown write tool: ${name}`);
  let out: PlanOutput;
  if (name === 'set_rates') out = await planSetRates(ctx, raw);
  else if (name === 'add_folio_charge') out = await planFolioCharge(ctx, raw);
  else if (name === 'create_reservation') out = await planCreateReservation(ctx, raw);
  else {
    const intent = writeIntent(name, raw);
    if (!intent) throw new HarnessInputError(`Unknown write tool: ${name}`);
    out = await planWrite(ctx, intent);
  }
  const problems = (out.blocks ?? []).flatMap(blockText).filter(Boolean);
  if (!out.steps.length) {
    return { out, report: problems.join('\n') || 'Nothing to change.', isError: problems.length > 0 };
  }
  const lines = out.steps.map((s) => `- ${s.summary}${s.detail ? ` (${s.detail})` : ''}`);
  return {
    out,
    report: `Added to the plan the person will confirm (NOT done yet):\n${lines.join('\n')}${out.warnings.length ? `\nWarnings shown to them: ${out.warnings.join(' ')}` : ''}${problems.length ? `\nAlso: ${problems.join(' ')}` : ''}`,
    isError: false,
  };
}

/** Readable text of a block, for the model. */
function blockText(b: AgentBlock): string[] {
  switch (b.type) {
    case 'text':
    case 'error':
      return [b.text];
    case 'clarify':
      return [`${b.question} Options: ${b.options.map((o) => `${o.label}${o.hint ? ` (${o.hint})` : ''}`).join('; ')}`];
    default:
      return [];
  }
}

/** Compact JSON of read blocks for the model (UI-only blocks are dropped). */
function blocksForModel(blocks: AgentBlock[]): string {
  const keep = blocks.filter((b) => !['suggestions', 'navigate'].includes(b.type));
  const text = JSON.stringify(keep, (_k, v) => (v === null || v === undefined || v === '' ? undefined : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v));
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… (truncated — narrow the query for more)` : text;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

function systemPrompt(ctx: ToolCtx): string {
  return `You are the operations agent built into ${ctx.propertyName}'s property management system. Staff and owners talk to you in plain words — often messy, typo-ridden, pasted tables, or voice transcripts — and you get things done with the tools.

How to work:
- Work out what the person wants, even from rough phrasing, typos ("ped fee" = pet fee), half sentences or a pasted table. Follow-ups refer to what you showed last ("patel", "her", "the arrival guy"): resolve them from that context. Look things up with the read tools when you need facts (ids, current prices, who is arriving) and make independent calls in parallel.
- To change anything, call the write tools. Writes are never applied directly: each call adds steps to ONE plan the person reviews and confirms with a button. So never say a change is done — say you've prepared it for them to confirm. Put everything the person asked for into this one plan; don't ask permission first.
- For rates: map each row of a request to set_rates changes (one call with all changes). Use list_room_types for exact names. Remember \`to\` in set_rates is the last night, inclusive; use \`nights\` for scattered dates and \`weekdays\` for patterns like Sun–Thu. Read the current calendar first only if you need current prices to compute something.
- If a tool says something is ambiguous or impossible, fix your input and retry, or explain it plainly and ask one short question. Don't invent ids, names, rooms or prices.
- For questions about hotel policies or amenities, use hotel_knowledge.

Reply style: the cards from your tools are shown to the person automatically, so don't repeat their numbers at length. End with one or two short sentences: what you found or what's ready to confirm, plus anything that needs their attention. Plain words, no markdown headings.

Today at the hotel is ${ctx.today} (${WEEKDAY[dayOfWeek(ctx.today)]}).`;
}

/** Content to echo back after a server-side fallback: before the last fallback block only text carries over. */
function echoable(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary < 0) return content;
  return content.filter((b, i) => i >= boundary || b.type === 'text');
}

export interface HarnessResult {
  steps: PlanStep[];
  warnings: string[];
  risk: PlanOutput['risk'];
  memory: AgentContextState;
  toolsUsed: string[];
}

/**
 * Runs the model over a message. Yields status lines and UI blocks as tools
 * finish; returns the gathered writes for the caller to sign into one plan.
 * Throws on API errors so the caller can fall back to the deterministic engine.
 */
export async function* runHarness(
  ctx: ToolCtx,
  opts: { recent?: string[]; lastReply?: string; client?: Anthropic; signal?: AbortSignal } = {}
): AsyncGenerator<AgentEvent, HarnessResult> {
  const client = opts.client ?? new Anthropic();
  const memory: AgentContextState = { ...ctx.memory };
  const result: HarnessResult = { steps: [], warnings: [], risk: 'low', memory, toolsUsed: [] };
  const earlier = (opts.recent ?? []).filter((m) => m !== ctx.message).slice(-6);
  const context = [
    earlier.length ? `Earlier messages from the person in this conversation (oldest first):\n${earlier.map((m) => `- ${m}`).join('\n')}` : '',
    opts.lastReply?.trim() ? `What you showed them in your last reply:\n${opts.lastReply.trim().slice(0, 2000)}` : '',
    memory.lastBookingCode || memory.lastGuestName || memory.lastRoomNumber
      ? `Last guest/room discussed: ${[memory.lastGuestName, memory.lastBookingCode && `#${memory.lastBookingCode}`, memory.lastRoomNumber && `room ${memory.lastRoomNumber}`].filter(Boolean).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: context ? `${context}\n\n---\n\n${ctx.message}` : ctx.message }];

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const message = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: BETAS,
        fallbacks: 'default',
        output_config: { effort: EFFORT },
        cache_control: { type: 'ephemeral' },
        system: systemPrompt(ctx),
        tools: HOTEL_TOOLS,
        tool_choice: round === MAX_ROUNDS ? { type: 'none' } : { type: 'auto' },
        messages,
      },
      { signal: opts.signal }
    );

    if (message.stop_reason === 'refusal') {
      yield { type: 'block', block: { type: 'text', text: 'I can’t help with that one. Ask me about guests, rooms, rates or housekeeping.' } };
      return result;
    }
    const content = echoable(message.content);
    const toolUses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const text = content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim();

    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content });
      continue;
    }
    if (message.stop_reason !== 'tool_use' || !toolUses.length) {
      if (text) yield { type: 'block', block: { type: 'text', text } };
      return result;
    }
    if (message.stop_reason === 'tool_use' && text) yield { type: 'status', text: text.slice(0, 160) };

    messages.push({ role: 'assistant', content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      result.toolsUsed.push(use.name);
      yield { type: 'status', text: `${hotelToolLabel(use.name)}…` };
      try {
        const out = await runTool({ ...ctx, memory }, use.name, use.input, result);
        for (const b of out.blocks) yield { type: 'block', block: b };
        results.push({ type: 'tool_result', tool_use_id: use.id, content: out.forModel, ...(out.isError ? { is_error: true } : {}) });
      } catch (e) {
        if (!(e instanceof HarnessInputError) && !(e instanceof DomainError)) logError('agent/harness', 'Tool failed:', use.name, e);
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: e instanceof HarnessInputError ? e.message : e instanceof DomainError ? e.message : 'The tool failed unexpectedly. Try different input or continue without it.',
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return result;
}

async function runTool(ctx: ToolCtx, name: string, raw: unknown, acc: HarnessResult): Promise<{ blocks: AgentBlock[]; forModel: string; isError?: boolean }> {
  if (!isToolName(name)) throw new HarnessInputError(`Unknown tool: ${name}`);
  if (definitions[name].kind === 'write') {
    const w = await planHotelWrite(ctx, name, raw);
    Object.assign(acc.memory, w.out.memory ?? {});
    acc.steps.push(...w.out.steps);
    acc.warnings.push(...w.out.warnings);
    acc.risk = maxRisk(acc.risk, w.out.risk);
    return { blocks: [], forModel: w.report, isError: w.isError };
  }
  if (name === 'list_room_types') return { blocks: [], forModel: JSON.stringify(await roomTypesResult(ctx.propertyId)) };
  if (name === 'get_rate_calendar') {
    const text = JSON.stringify(await rateCalendarResult(ctx.propertyId, raw));
    return { blocks: [], forModel: text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… (truncated — ask for fewer nights or one room type)` : text };
  }
  if (name === 'hotel_knowledge') {
    const { question } = parseInput('hotel_knowledge', raw);
    const ans = await answerFromSkills(ctx.actor, ctx.propertyId, question);
    if (!ans) return { blocks: [], forModel: 'The hotel has no saved answer for that. Say so, and suggest a manager adds it on the Skills page.' };
    return { blocks: [], forModel: ans.blocks.flatMap(blockText).join('\n') || 'No answer text.' };
  }
  const intent = readIntent(name, raw, ctx.today);
  if (!intent) throw new HarnessInputError(`Unknown tool: ${name}`);
  const out = await runRead(ctx, intent);
  Object.assign(acc.memory, out.memory ?? {});
  const problem = out.blocks.some((b) => b.type === 'error' || b.type === 'clarify');
  // Problems go to the model to resolve or explain; data cards go to the person.
  const shown = problem ? [] : out.blocks.filter((b) => b.type !== 'suggestions' && b.type !== 'text');
  return { blocks: shown, forModel: problem ? out.blocks.flatMap(blockText).join('\n') : blocksForModel(out.blocks), isError: problem };
}

