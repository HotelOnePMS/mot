/**
 * The recommended PMS tool contract: what a PMS vendor's MCP server should
 * expose so HotelOne's agents work with it the moment a hotel connects.
 *
 * Vendors don't have to use these exact names — `matchContract` recognises
 * common aliases and descriptions, and `adaptArgs` maps our arguments onto
 * the vendor's own parameter names (reservationId, confirmation, room…).
 * Anything that doesn't match is still usable through the AI planner.
 *
 * Pure data + functions: safe to import from pages (the /developers/pms docs
 * and the contract JSON are generated from this file).
 */
import type { JsonSchema, McpTool } from './mcp-client';

export const CONTRACT_VERSION = '2026-10-18';

export type ContractOperationName =
  | 'list_arrivals'
  | 'list_departures'
  | 'list_in_house'
  | 'get_reservation'
  | 'check_in'
  | 'check_out'
  | 'assign_room'
  | 'add_reservation_note'
  | 'get_availability'
  | 'update_rates'
  | 'set_room_status';

export interface ContractOperation {
  name: ContractOperationName;
  title: string;
  description: string;
  /** false = read-only (allowed in look-ups); true = changes PMS data (only after staff confirm a plan). */
  writes: boolean;
  inputSchema: JsonSchema;
  /** What a good result looks like (documentation only). */
  returns: string;
  /** Other names vendors commonly use (normalised: lowercase, snake_case). */
  aliases: string[];
  /** Words that identify this operation in a tool's name/title/description. */
  keywords: { all: string[][]; none?: string[] };
}

const DATE = { type: 'string', format: 'date', description: 'Calendar day, YYYY-MM-DD (hotel’s local date).' };
const RES_ID = { type: 'string', description: 'The PMS’s reservation id (from list_* or get_reservation).' };
const ROOM = { type: 'string', description: 'Room number as shown at the front desk, e.g. "14".' };

const RESERVATION_SHAPE =
  'An array of reservations (top level, or under "reservations"/"items"/"data"): { reservation_id, confirmation_code, guest_name, arrival, departure, room_number?, room_type?, status, adults?, children?, balance? }.';

export const CONTRACT: ContractOperation[] = [
  {
    name: 'list_arrivals',
    title: 'List arrivals',
    description: 'Reservations arriving on a date (default today), including whether each is checked in and its room.',
    writes: false,
    inputSchema: { type: 'object', properties: { date: DATE }, additionalProperties: false },
    returns: RESERVATION_SHAPE,
    aliases: ['arrivals', 'get_arrivals', 'arrivals_list', 'list_arrival', 'todays_arrivals', 'get_todays_arrivals', 'search_arrivals', 'reservations_arriving'],
    keywords: { all: [['arrival', 'arriving']], none: ['check_in_guest', 'depart'] },
  },
  {
    name: 'list_departures',
    title: 'List departures',
    description: 'Reservations departing on a date (default today), with balance due and room.',
    writes: false,
    inputSchema: { type: 'object', properties: { date: DATE }, additionalProperties: false },
    returns: RESERVATION_SHAPE,
    aliases: ['departures', 'get_departures', 'departures_list', 'list_departure', 'todays_departures', 'get_todays_departures', 'search_departures', 'reservations_departing'],
    keywords: { all: [['departure', 'departing']], none: ['arriv'] },
  },
  {
    name: 'list_in_house',
    title: 'List in-house guests',
    description: 'Guests currently checked in, with room numbers and departure dates.',
    writes: false,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    returns: RESERVATION_SHAPE,
    aliases: ['in_house', 'get_in_house', 'list_inhouse', 'inhouse', 'in_house_guests', 'list_in_house_guests', 'get_in_house_guests', 'current_guests', 'list_current_guests', 'list_occupied_rooms', 'guests_in_house'],
    keywords: { all: [['in_house', 'inhouse', 'in-house', 'current_guest', 'staying', 'occupied']] },
  },
  {
    name: 'get_reservation',
    title: 'Find a reservation',
    description: 'Find reservations by confirmation code or guest name (partial names allowed). Returns every match.',
    writes: false,
    inputSchema: {
      type: 'object',
      properties: {
        confirmation_code: { type: 'string', description: 'Confirmation / booking code.' },
        guest_name: { type: 'string', description: 'Guest name or part of it, e.g. "Moreno".' },
        reservation_id: RES_ID,
      },
      additionalProperties: false,
      description: 'Give at least one of confirmation_code, guest_name, reservation_id.',
    },
    returns: RESERVATION_SHAPE,
    aliases: ['find_reservation', 'search_reservations', 'search_reservation', 'reservations_list', 'list_reservations', 'lookup_reservation', 'get_booking', 'find_booking', 'search_bookings', 'get_reservations', 'reservation_search', 'find_guest', 'search_guests', 'get_guest'],
    keywords: { all: [['reservation', 'booking', 'guest'], ['get', 'find', 'search', 'lookup', 'look_up', 'list', 'retrieve', 'fetch']], none: ['arriv', 'depart', 'in_house', 'create', 'cancel', 'update', 'note', 'check_in', 'check_out', 'assign'] },
  },
  {
    name: 'check_in',
    title: 'Check in',
    description: 'Check a reservation in, optionally into a specific room.',
    writes: true,
    inputSchema: { type: 'object', properties: { reservation_id: RES_ID, room_number: ROOM }, required: ['reservation_id'], additionalProperties: false },
    returns: 'The updated reservation (status checked_in, room_number) or { ok: true, message }.',
    aliases: ['checkin', 'check_in_guest', 'checkin_guest', 'check_in_reservation', 'checkin_reservation', 'guest_check_in', 'reservation_check_in', 'do_check_in'],
    keywords: { all: [['check_in', 'checkin', 'check-in']], none: ['list', 'arriv', 'undo', 'cancel', 'status'] },
  },
  {
    name: 'check_out',
    title: 'Check out',
    description: 'Check a reservation out (the PMS decides how balances are handled).',
    writes: true,
    inputSchema: { type: 'object', properties: { reservation_id: RES_ID }, required: ['reservation_id'], additionalProperties: false },
    returns: 'The updated reservation (status checked_out) or { ok: true, message }.',
    aliases: ['checkout', 'check_out_guest', 'checkout_guest', 'check_out_reservation', 'checkout_reservation', 'guest_check_out', 'reservation_check_out', 'do_check_out'],
    keywords: { all: [['check_out', 'checkout', 'check-out']], none: ['list', 'depart', 'undo', 'cancel', 'status'] },
  },
  {
    name: 'assign_room',
    title: 'Assign a room',
    description: 'Assign (or move) a reservation to a room.',
    writes: true,
    inputSchema: { type: 'object', properties: { reservation_id: RES_ID, room_number: ROOM }, required: ['reservation_id', 'room_number'], additionalProperties: false },
    returns: 'The updated reservation with room_number.',
    aliases: ['assign_room_to_reservation', 'set_room', 'room_assign', 'assign_reservation_room', 'move_room', 'change_room', 'reservation_assign_room', 'allocate_room'],
    keywords: { all: [['assign', 'allocate', 'move', 'change'], ['room']], none: ['housekeep', 'clean', 'status', 'rate'] },
  },
  {
    name: 'add_reservation_note',
    title: 'Add a note',
    description: 'Add a note or comment to a reservation, visible to the front desk.',
    writes: true,
    inputSchema: { type: 'object', properties: { reservation_id: RES_ID, note: { type: 'string', maxLength: 1000 } }, required: ['reservation_id', 'note'], additionalProperties: false },
    returns: '{ ok: true } or the note as stored.',
    aliases: ['add_note', 'create_note', 'reservation_add_note', 'add_reservation_comment', 'add_comment', 'post_note', 'note_reservation', 'add_booking_note'],
    keywords: { all: [['note', 'comment', 'remark'], ['add', 'create', 'post', 'write']], none: ['list', 'get', 'delete'] },
  },
  {
    name: 'get_availability',
    title: 'Check availability',
    description: 'Rooms or room types available for a stay, with prices if the PMS has them.',
    writes: false,
    inputSchema: {
      type: 'object',
      properties: { check_in: { ...DATE, description: 'First night, YYYY-MM-DD.' }, check_out: { ...DATE, description: 'Departure day (exclusive), YYYY-MM-DD.' }, room_type: { type: 'string' } },
      required: ['check_in', 'check_out'],
      additionalProperties: false,
    },
    returns: 'An array of { room_type, available, rate? } or of free room numbers.',
    aliases: ['availability', 'check_availability', 'search_availability', 'list_availability', 'get_room_availability', 'room_availability', 'available_rooms', 'list_available_rooms', 'get_inventory'],
    keywords: { all: [['availab', 'vacan', 'inventory', 'free_room']], none: ['update', 'set', 'block'] },
  },
  {
    name: 'update_rates',
    title: 'Update rates',
    description: 'Change the nightly rate of a room type for a date range or a list of dates — to an amount, or by a percentage.',
    writes: true,
    inputSchema: {
      type: 'object',
      properties: {
        room_type: { type: 'string', description: 'Room type name or code, e.g. "King".' },
        start_date: { ...DATE, description: 'First night, YYYY-MM-DD.' },
        end_date: { ...DATE, description: 'Last night (inclusive), YYYY-MM-DD. Omit for one night.' },
        dates: { type: 'array', items: DATE, description: 'Alternative to start/end: specific nights.' },
        amount: { type: 'number', description: 'New nightly rate in the hotel’s currency.' },
        percent: { type: 'number', description: 'Change by this percentage instead, e.g. 10 or -15.' },
      },
      required: ['room_type'],
      additionalProperties: false,
      description: 'Give start_date (+ end_date) or dates, and amount or percent.',
    },
    returns: '{ ok: true, updated_nights } or the new rates.',
    aliases: ['set_rates', 'update_rate', 'set_rate', 'change_rates', 'adjust_rates', 'rates_update', 'update_room_rates', 'set_room_rate', 'update_prices', 'set_prices'],
    keywords: { all: [['rate', 'price', 'pricing'], ['update', 'set', 'change', 'adjust', 'modify']], none: ['get', 'list'] },
  },
  {
    name: 'set_room_status',
    title: 'Set room status',
    description: 'Set a room’s housekeeping status: clean, dirty, inspected, out_of_order or out_of_service.',
    writes: true,
    inputSchema: {
      type: 'object',
      properties: { room_number: ROOM, status: { type: 'string', enum: ['clean', 'dirty', 'inspected', 'out_of_order', 'out_of_service'] }, reason: { type: 'string', description: 'Why, for out of order.' } },
      required: ['room_number', 'status'],
      additionalProperties: false,
    },
    returns: 'The room with its new status.',
    aliases: ['update_room_status', 'room_status', 'set_housekeeping_status', 'update_housekeeping_status', 'set_room_condition', 'mark_room', 'housekeeping_update'],
    keywords: { all: [['room', 'housekeeping'], ['status', 'condition', 'clean', 'dirty']], none: ['get', 'list', 'rate'] },
  },
];

export const CONTRACT_BY_NAME = Object.fromEntries(CONTRACT.map((op) => [op.name, op])) as Record<ContractOperationName, ContractOperation>;

export function isContractOperation(name: unknown): name is ContractOperationName {
  return typeof name === 'string' && name in CONTRACT_BY_NAME;
}

// ---------------------------------------------------------------------------
// Matching vendor tools to the contract.

/** lowercase snake_case, without common namespaces ("pms.", "cloudbeds_", "hotel-"). */
export function normaliseToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(pms|hotel|api|v\d+|tool|mcp)_/, '')
    .replace(/^(pms|hotel|api|v\d+|tool|mcp)_/, '');
}

const READ_VERB = /^(get|list|search|find|fetch|lookup|look_up|read|query|show|view|retrieve|describe|count)(_|$)/;
const WRITE_WORD = /(^|_)(create|add|update|set|delete|remove|cancel|check_?in|check_?out|assign|move|post|charge|refund|void|modify|change|edit|write|send|book|make|close|open|mark|adjust|block|unblock)(_|$)/;

/** Read-only by annotation, by contract, or by name (get_/list_/search_/find_…). */
export function isReadOnlyTool(tool: Pick<McpTool, 'name' | 'annotations'>, contractOp?: ContractOperationName | null): boolean {
  if (tool.annotations?.readOnlyHint === true) return true;
  if (tool.annotations?.readOnlyHint === false) return false;
  if (contractOp) return !CONTRACT_BY_NAME[contractOp].writes;
  const n = normaliseToolName(tool.name);
  return READ_VERB.test(n) && !WRITE_WORD.test(n.replace(READ_VERB, ''));
}

/** Tools HotelOne never calls, whatever the task (also stops a vendor tool list from steering the model there). */
const NEVER = /(^|_)(delete|purge|wipe|drop|truncate|refund|void|password|passwd|permission|role|roles|user|users|api_?key|token|secret|export|webhook|credential|admin)(_|$)/;
export function isForbiddenTool(name: string): boolean {
  return NEVER.test(normaliseToolName(name));
}

function haystack(tool: McpTool): string {
  return [normaliseToolName(tool.name), tool.title ?? '', tool.annotations?.title ?? '', (tool.description ?? '').slice(0, 300)]
    .join(' ')
    .toLowerCase()
    .replace(/check[\s-]?in/g, 'check_in')
    .replace(/check[\s-]?out/g, 'check_out')
    .replace(/in[\s-]house/g, 'in_house');
}

function score(op: ContractOperation, tool: McpTool): number {
  const n = normaliseToolName(tool.name);
  if (n === op.name) return 100;
  if (op.aliases.includes(n)) return 90;
  // Annotation sanity: never map a write operation to a read-only tool or vice versa.
  if (tool.annotations?.readOnlyHint === true && op.writes) return 0;
  if (tool.annotations?.readOnlyHint === false && !op.writes) return 0;
  const nameHit = op.keywords.all.every((group) => group.some((w) => n.includes(w)));
  const text = haystack(tool);
  if (op.keywords.none?.some((w) => n.includes(w))) return 0;
  if (nameHit) return 60;
  // Weakest signal: the words appear in the title/description.
  return op.keywords.all.every((group) => group.some((w) => text.includes(w))) ? 30 : 0;
}

export type ContractMapping = Partial<Record<ContractOperationName, string>>;

/**
 * { operation → vendor tool name } for every operation we can recognise.
 * Each tool maps to at most one operation (its best score); ties go to the
 * earlier operation in CONTRACT. Forbidden tools are never mapped.
 */
export function matchContract(tools: McpTool[]): ContractMapping {
  const candidates: { op: ContractOperationName; tool: string; s: number }[] = [];
  for (const tool of tools) {
    if (isForbiddenTool(tool.name)) continue;
    for (const op of CONTRACT) {
      const s = score(op, tool);
      if (s > 0) candidates.push({ op: op.name, tool: tool.name, s });
    }
  }
  candidates.sort((a, b) => b.s - a.s);
  const mapping: ContractMapping = {};
  const usedTools = new Set<string>();
  for (const c of candidates) {
    if (mapping[c.op] || usedTools.has(c.tool)) continue;
    mapping[c.op] = c.tool;
    usedTools.add(c.tool);
  }
  return mapping;
}

/** Inverse of a mapping: vendor tool → operation. */
export function operationForTool(mapping: ContractMapping, toolName: string): ContractOperationName | null {
  for (const [op, t] of Object.entries(mapping)) if (t === toolName) return op as ContractOperationName;
  return null;
}

export function coverage(mapping: ContractMapping) {
  const matched = CONTRACT.filter((op) => mapping[op.name]).map((op) => ({ operation: op.name, tool: mapping[op.name]!, writes: op.writes }));
  return {
    matched: matched.length,
    total: CONTRACT.length,
    operations: CONTRACT.map((op) => ({ operation: op.name, title: op.title, writes: op.writes, tool: mapping[op.name] ?? null })),
  };
}

// ---------------------------------------------------------------------------
// Argument adaptation: our canonical args → the vendor tool's parameter names.

const SYNONYMS: Record<string, string[]> = {
  date: ['date', 'day', 'arrival_date', 'departure_date', 'for_date', 'on', 'business_date', 'start_date'],
  reservation_id: ['reservation_id', 'reservationid', 'id', 'booking_id', 'bookingid', 'reservation', 'res_id', 'reservation_number', 'folio_id', 'stay_id'],
  // Generic search fields last: a single "query" parameter takes a code as well as a name.
  confirmation_code: ['confirmation_code', 'confirmation', 'confirmation_number', 'code', 'booking_code', 'booking_reference', 'reference', 'conf', 'conf_number', 'confirmation_no', 'query', 'q', 'search', 'term', 'keyword'],
  guest_name: ['guest_name', 'guestname', 'name', 'guest', 'last_name', 'lastname', 'surname', 'query', 'q', 'search', 'term', 'full_name'],
  room_number: ['room_number', 'roomnumber', 'room', 'room_no', 'room_id', 'roomid', 'unit', 'unit_number', 'room_name'],
  note: ['note', 'text', 'comment', 'notes', 'message', 'body', 'content', 'remark'],
  check_in: ['check_in', 'checkin', 'arrival', 'arrival_date', 'start_date', 'from', 'start', 'date_from', 'from_date'],
  check_out: ['check_out', 'checkout', 'departure', 'departure_date', 'end_date', 'to', 'end', 'date_to', 'to_date'],
  room_type: ['room_type', 'roomtype', 'room_type_id', 'room_type_code', 'room_type_name', 'category', 'room_category', 'type'],
  start_date: ['start_date', 'from', 'date_from', 'from_date', 'start', 'begin'],
  end_date: ['end_date', 'to', 'date_to', 'to_date', 'end', 'until'],
  dates: ['dates', 'nights', 'days'],
  amount: ['amount', 'rate', 'price', 'value', 'new_rate', 'nightly_rate'],
  percent: ['percent', 'percentage', 'pct', 'change_percent', 'adjustment_percent'],
  status: ['status', 'state', 'condition', 'housekeeping_status', 'room_status'],
  reason: ['reason', 'comment', 'note', 'description'],
};

const squash = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Map canonical args onto the tool's input schema. Returns null when a
 * parameter the tool requires can't be filled (the caller then falls back
 * to the AI planner or asks for help). Unknown schemas get the args as-is.
 */
export function adaptArgs(args: Record<string, unknown>, schema: JsonSchema | undefined): Record<string, unknown> | null {
  const props = schema?.properties;
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  if (!props || !Object.keys(props).length) {
    const required = schema?.required ?? [];
    return required.every((r) => r in clean) ? clean : null;
  }
  const out: Record<string, unknown> = {};
  const used = new Set<string>();
  const vendorBySquash = new Map(Object.keys(props).map((k) => [squash(k), k]));
  for (const [ours, value] of Object.entries(clean)) {
    const options = [ours, ...(SYNONYMS[ours] ?? [])].map(squash);
    const target = options.map((o) => vendorBySquash.get(o)).find((k) => k && !used.has(k));
    if (!target) continue;
    used.add(target);
    const t = props[target]?.type;
    const type = Array.isArray(t) ? t[0] : t;
    out[target] = type === 'number' || type === 'integer' ? (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value) : type === 'string' && typeof value === 'number' ? String(value) : value;
    // Enums: match case-insensitively, also "out of order" ↔ "OUT_OF_ORDER".
    const en = props[target]?.enum;
    if (Array.isArray(en) && typeof out[target] === 'string') {
      const want = squash(String(out[target]));
      const hit = en.find((e) => typeof e === 'string' && squash(e) === want);
      if (hit !== undefined) out[target] = hit;
      else return null;
    }
  }
  const required = schema?.required ?? [];
  return required.every((r) => r in out) ? out : null;
}

/** The contract as a public JSON document (served at /developers/pms/contract.json). */
export function contractDocument(origin: string | null) {
  return {
    name: 'HotelOne PMS MCP contract',
    version: CONTRACT_VERSION,
    description:
      'Tools a PMS vendor’s MCP server should expose so HotelOne’s agents (console, voice front desk, phone line) can read and act in the PMS. Names are recommendations: HotelOne also recognises common aliases and adapts parameter names. Read tools should set annotations.readOnlyHint = true.',
    transport: { type: 'streamable-http', mcpProtocolVersion: '2025-06-18', auth: ['Authorization: Bearer <token>', 'custom header (e.g. X-API-Key: <token>)'] },
    docs: origin ? `${origin}/developers/pms` : '/developers/pms',
    tools: CONTRACT.map((op) => ({
      name: op.name,
      title: op.title,
      description: op.description,
      annotations: { readOnlyHint: !op.writes, destructiveHint: false },
      inputSchema: op.inputSchema,
      returns: op.returns,
      aliases: op.aliases,
    })),
    events: {
      url: origin ? `${origin}/api/pms/events/{connectionId}` : '/api/pms/events/{connectionId}',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HotelOne-Timestamp': 'Unix time in seconds',
        'X-HotelOne-Signature': 'sha256=<hex HMAC-SHA256 of `${timestamp}.${rawBody}` using the connection’s events secret>',
      },
      body: { id: 'optional unique event id (deduplicated for 24 h)', type: 'reservation.created', occurred_at: 'ISO 8601', data: {} },
      types: EVENT_TYPES,
      toleranceSeconds: 300,
      maxBytes: 65536,
    },
  };
}

export const EVENT_TYPES = [
  'reservation.created',
  'reservation.updated',
  'reservation.cancelled',
  'reservation.checked_in',
  'reservation.checked_out',
  'room.status_changed',
  'rates.updated',
  'availability.changed',
  'ping',
] as const;
