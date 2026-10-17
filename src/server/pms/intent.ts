/**
 * Deterministic planning for PMS tasks: a bridge task (kind + payload +
 * staff instruction) → one contract operation with canonical arguments.
 *
 * Covers the everyday front-desk asks ("who's arriving tomorrow?", "check in
 * Moreno into 14", "mark room 12 clean", "raise King rates 10% this
 * weekend"). Anything else returns null and goes to the AI planner.
 * No network, no model.
 */
import { addDaysISO, dayOfWeek, isISODate, type ISODate } from '../dates';
import { isContractOperation, type ContractOperationName } from './contract';

export interface ReservationRef {
  reservationId?: string;
  confirmationCode?: string;
  guestName?: string;
}

export interface PlannedOperation {
  operation: ContractOperationName;
  /** Canonical (contract) argument names. reservation_id may be missing when `ref` must be resolved first. */
  args: Record<string, unknown>;
  ref?: ReservationRef;
  /** "today", "tomorrow", "18 Oct" — for summaries. */
  dayLabel?: string;
}

export interface TaskLike {
  kind: string;
  instruction: string;
  payload?: unknown;
}

const NEEDS_RESERVATION: ContractOperationName[] = ['check_in', 'check_out', 'assign_room', 'add_reservation_note'];
export const needsReservation = (op: ContractOperationName) => NEEDS_RESERVATION.includes(op);

type Rec = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);
const pickStr = (p: Rec, ...keys: string[]) => {
  for (const k of keys) {
    const v = s(p[k]);
    if (v) return v;
  }
  return undefined;
};
const pickNum = (p: Rec, ...keys: string[]) => {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Dates

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function monthDay(month: string, d: number, today: ISODate): ISODate | null {
  const m = MONTHS.indexOf(month.slice(0, 3));
  if (m < 0 || d < 1 || d > 31) return null;
  let y = Number(today.slice(0, 4));
  let iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // "3 Jan" said in December means next year.
  if (isISODate(iso) && iso < addDaysISO(today, -60)) {
    y += 1;
    iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return isISODate(iso) ? iso : null;
}

/** Every date mentioned, in order: today/tonight, tomorrow, yesterday, weekdays, "18 Oct", "Oct 18", ISO. */
export function findDates(text: string, today: ISODate): { day: ISODate; label: string }[] {
  const out: { day: ISODate; label: string; at: number }[] = [];
  const t = text.toLowerCase();
  const add = (day: ISODate | null, label: string, at: number) => {
    if (day && !out.some((o) => o.at === at)) out.push({ day, label, at });
  };
  for (const m of t.matchAll(/\b(today|tonight|this evening)\b/g)) add(today, 'today', m.index!);
  for (const m of t.matchAll(/\b(?:the day after tomorrow)\b/g)) add(addDaysISO(today, 2), 'the day after tomorrow', m.index!);
  for (const m of t.matchAll(/\b(?<!after )tomorrow\b/g)) add(addDaysISO(today, 1), 'tomorrow', m.index!);
  for (const m of t.matchAll(/\byesterday\b/g)) add(addDaysISO(today, -1), 'yesterday', m.index!);
  for (const m of t.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) if (isISODate(m[1])) add(m[1], m[1], m.index!);
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`, 'g'))) add(monthDay(m[2], Number(m[1]), today), `${Number(m[1])} ${m[2].slice(0, 3)}`, m.index!);
  for (const m of t.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'))) add(monthDay(m[1], Number(m[2]), today), `${Number(m[2])} ${m[1].slice(0, 3)}`, m.index!);
  for (const m of t.matchAll(/\b(?:(next|this|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)) {
    const target = WEEKDAYS.indexOf(m[2]);
    let delta = (target - dayOfWeek(today) + 7) % 7;
    if (m[1] === 'next' && delta === 0) delta = 7;
    add(addDaysISO(today, delta), m[2].charAt(0).toUpperCase() + m[2].slice(1), m.index!);
  }
  return out.sort((a, b) => a.at - b.at).map(({ day, label }) => ({ day, label }));
}

/** Nights a phrase covers: "this weekend" (Fri+Sat), "from X to Y" (inclusive), or the dates mentioned. */
function nights(text: string, today: ISODate): { start: ISODate; end: ISODate; label: string } | null {
  const t = text.toLowerCase();
  if (/\b(this|next)\s+weekend\b/.test(t)) {
    let fri = addDaysISO(today, (5 - dayOfWeek(today) + 7) % 7);
    if (dayOfWeek(today) === 6) fri = addDaysISO(today, -1);
    if (/\bnext\s+weekend\b/.test(t)) fri = addDaysISO(fri, 7);
    return { start: fri < today ? today : fri, end: addDaysISO(fri, 1), label: /\bnext/.test(t) ? 'next weekend' : 'this weekend' };
  }
  const dates = findDates(text, today);
  if (!dates.length) return null;
  const start = dates[0].day;
  const end = dates[1]?.day && dates[1].day >= start ? dates[1].day : start;
  return { start, end, label: end === start ? dates[0].label : `${dates[0].label}–${dates[1].label}` };
}

// ---------------------------------------------------------------------------
// Names and references

const FILLER = /^(?:the|guest|mr\.?|mrs\.?|ms\.?|miss|dr\.?|reservation|booking|for|of)\s+/i;
const TRAILING = /(?:'s|’s)?\s+(?:reservation|booking|stay|party|family|group)$|(?:'s|’s)$/i;

/** "the Morenos" → "Moreno"; "booking ABC123" → code ABC123. */
export function refFrom(raw: string | undefined): ReservationRef | null {
  if (!raw) return null;
  let t = raw.trim().replace(/[?.!,;:]+$/, '').replace(/^["“']|["”']$/g, '');
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(FILLER, '').replace(TRAILING, '').trim();
  }
  if (!t || t.length > 80) return null;
  if (/^(?=.*\d)[A-Z0-9][A-Z0-9-]{3,}$/i.test(t) && !/\s/.test(t)) return { confirmationCode: t.toUpperCase() };
  if (/^the\s/i.test(raw.trim()) && /[a-z]{3,}s$/i.test(t) && !/ss$/i.test(t)) t = t.slice(0, -1); // the Smiths → Smith
  if (/^(him|her|them|it|this|that|guest|someone|everyone|all)$/i.test(t)) return null;
  return { guestName: t };
}

// ---------------------------------------------------------------------------
// Payload → plan (structured tasks)

const KIND_OPS: Record<string, ContractOperationName> = {
  CHECK_IN: 'check_in',
  CHECK_OUT: 'check_out',
  NOTE: 'add_reservation_note',
  RATES: 'update_rates',
  ASSIGN_ROOM: 'assign_room',
  ROOM_STATUS: 'set_room_status',
};

function fromPayload(kind: string, p: Rec, today: ISODate): PlannedOperation | null {
  const explicit = isContractOperation(p.operation) ? p.operation : null;
  const op = explicit ?? KIND_OPS[kind];
  if (!op) return null;
  const args: Rec = p.args && typeof p.args === 'object' ? { ...(p.args as Rec) } : {};
  const ref: ReservationRef = {
    reservationId: pickStr(p, 'reservationId', 'reservation_id') ?? s(args.reservation_id),
    confirmationCode: pickStr(p, 'confirmationCode', 'confirmation_code', 'code', 'bookingCode') ?? s(args.confirmation_code),
    guestName: pickStr(p, 'guestName', 'guest_name', 'guest', 'name') ?? s(args.guest_name),
  };
  const room = pickStr(p, 'roomNumber', 'room_number', 'room');
  switch (op) {
    case 'list_arrivals':
    case 'list_departures':
      return { operation: op, args: { date: pickStr(p, 'date') ?? s(args.date) ?? today } };
    case 'list_in_house':
      return { operation: op, args: {} };
    case 'get_reservation':
      if (!ref.reservationId && !ref.confirmationCode && !ref.guestName) return null;
      return { operation: op, args: { reservation_id: ref.reservationId, confirmation_code: ref.confirmationCode, guest_name: ref.guestName } };
    case 'check_in':
      return withRef(op, { ...args, room_number: room ?? args.room_number }, ref);
    case 'check_out':
      return withRef(op, args, ref);
    case 'assign_room':
      if (!(room ?? args.room_number)) return null;
      return withRef(op, { ...args, room_number: room ?? args.room_number }, ref);
    case 'add_reservation_note': {
      const note = pickStr(p, 'note', 'text') ?? s(args.note);
      return note ? withRef(op, { ...args, note: note.slice(0, 1000) }, ref) : null;
    }
    case 'get_availability': {
      const ci = pickStr(p, 'checkIn', 'check_in') ?? s(args.check_in);
      const co = pickStr(p, 'checkOut', 'check_out') ?? s(args.check_out);
      return ci && co ? { operation: op, args: { check_in: ci, check_out: co, room_type: pickStr(p, 'roomType', 'room_type') ?? args.room_type } } : null;
    }
    case 'update_rates': {
      const a: Rec = {
        room_type: pickStr(p, 'roomType', 'room_type') ?? args.room_type,
        start_date: pickStr(p, 'startDate', 'start_date', 'from') ?? args.start_date,
        end_date: pickStr(p, 'endDate', 'end_date', 'to') ?? args.end_date,
        dates: Array.isArray(p.dates) ? p.dates : args.dates,
        amount: pickNum(p, 'amount') ?? args.amount,
        percent: pickNum(p, 'percent') ?? args.percent,
      };
      if (!a.room_type || (!a.start_date && !a.dates) || (a.amount === undefined && a.percent === undefined)) return null;
      return { operation: op, args: a };
    }
    case 'set_room_status': {
      const status = pickStr(p, 'status') ?? s(args.status);
      const r = room ?? s(args.room_number);
      return status && r ? { operation: op, args: { room_number: r, status: status.toLowerCase().replace(/[\s-]+/g, '_'), reason: pickStr(p, 'reason') ?? args.reason } } : null;
    }
  }
  return null;
}

function withRef(op: ContractOperationName, args: Rec, ref: ReservationRef): PlannedOperation | null {
  if (ref.reservationId) return { operation: op, args: { ...args, reservation_id: ref.reservationId } };
  if (s(args.reservation_id)) return { operation: op, args };
  if (!ref.confirmationCode && !ref.guestName) return null;
  return { operation: op, args, ref };
}

// ---------------------------------------------------------------------------
// Free text → plan

const ROOM_TOKEN = '#?([a-z]?\\d{1,5}[a-z]?)';
const STATUS_WORDS = '(clean|dirty|inspected|out[\\s-]of[\\s-]order|out[\\s-]of[\\s-]service|ooo|oos)';

function normStatus(w: string): string {
  const x = w.toLowerCase().replace(/[\s-]+/g, '_');
  return x === 'ooo' ? 'out_of_order' : x === 'oos' ? 'out_of_service' : x;
}

function fromText(instruction: string, today: ISODate): PlannedOperation | null {
  const raw = instruction.trim().replace(/\s+/g, ' ');
  const t = raw.toLowerCase().replace(/^(?:please|pls|can you|could you|would you|hey|ok|okay)[,\s]+/, '').replace(/[?.!]+$/, '').trim();
  const orig = raw.replace(/^(?:please|pls|can you|could you|would you|hey|ok|okay)[,\s]+/i, '').replace(/[?.!]+$/, '').trim();
  const dates = findDates(t, today);
  const firstDay = dates[0];

  // Room status: "mark room 12 clean", "room 12 is out of order", "set 12 to dirty".
  let m = t.match(new RegExp(`^(?:mark|set|make|flag|change)\\s+(?:room\\s+)?${ROOM_TOKEN}\\s+(?:as\\s+|to\\s+)?${STATUS_WORDS}\\b(?:[,:-]?\\s*(?:because|reason:?)?\\s*(.+))?$`));
  if (m) return { operation: 'set_room_status', args: { room_number: m[1].toUpperCase(), status: normStatus(m[2]), reason: m[3]?.slice(0, 200) } };
  m = t.match(new RegExp(`^room\\s+${ROOM_TOKEN}\\s+is\\s+(?:now\\s+)?${STATUS_WORDS}\\b`));
  if (m) return { operation: 'set_room_status', args: { room_number: m[1].toUpperCase(), status: normStatus(m[2]) } };

  // Check in: "check in Moreno into 14", "check in ABC123 to room 14", "check Moreno in".
  m = orig.match(new RegExp(`^check[\\s-]?in\\s+(?!today\\b|tomorrow\\b)(.+?)(?:\\s+(?:into|to|in|at)\\s+(?:room\\s+)?${ROOM_TOKEN})?$`, 'i'));
  if (!m) m = orig.match(new RegExp(`^check\\s+(.+?)\\s+in(?:\\s+(?:into|to|in|at)\\s+(?:room\\s+)?${ROOM_TOKEN})?$`, 'i'));
  if (m) {
    const ref = refFrom(m[1]);
    if (ref) return withRef('check_in', { room_number: m[2]?.toUpperCase() }, ref);
  }
  // Check out: "check out Moreno", "check Moreno out", "check out room 14" (needs the reservation: let the AI planner do rooms).
  m = orig.match(/^check[\s-]?out\s+(?!today\b|tomorrow\b)(.+)$/i) ?? orig.match(/^check\s+(.+?)\s+out$/i);
  if (m && !/^room\s/i.test(m[1])) {
    const ref = refFrom(m[1]);
    if (ref) return withRef('check_out', {}, ref);
  }

  // Assign room: "assign room 14 to Moreno", "give Moreno room 14", "move Moreno to 14", "put Moreno in 14".
  m = orig.match(new RegExp(`^(?:assign|give)\\s+room\\s+${ROOM_TOKEN}\\s+to\\s+(.+)$`, 'i'));
  if (m) {
    const ref = refFrom(m[2]);
    if (ref) return withRef('assign_room', { room_number: m[1].toUpperCase() }, ref);
  }
  m = orig.match(new RegExp(`^(?:assign|give|move|put|switch)\\s+(.+?)\\s+(?:to|into|in|room)\\s+(?:room\\s+)?${ROOM_TOKEN}$`, 'i'));
  if (m) {
    const ref = refFrom(m[1].replace(/\s+room$/i, ''));
    if (ref) return withRef('assign_room', { room_number: m[2].toUpperCase() }, ref);
  }

  // Note: "add a note to Moreno: late arrival", "note for ABC123 - allergic to feathers", "add note to Moreno saying …".
  m = orig.match(/^(?:add|leave|put|write)?\s*(?:a\s+)?note\s+(?:to|for|on)\s+(.+?)(?:\s*[:–—-]\s*|\s+(?:saying|that says|that)\s+)(.+)$/i);
  if (m) {
    const ref = refFrom(m[1]);
    if (ref) return withRef('add_reservation_note', { note: m[2].replace(/^["“']|["”']$/g, '').slice(0, 1000) }, ref);
  }

  // Rates: "raise King rates 10% this weekend", "set Queen rate to $129 tomorrow", "lower rates for doubles by 15% from 18 Oct to 20 Oct".
  if (/\b(rates?|prices?|pricing)\b/.test(t) && /\b(raise|increase|bump|lower|decrease|drop|cut|reduce|set|change|make|put)\b/.test(t)) {
    const pct = t.match(/([+-]?\d+(?:\.\d+)?)\s*(?:%|percent\b)/);
    const amt = t.match(/\b(?:to|at)\s+[$€£]?\s?(\d+(?:\.\d+)?)\b(?!\s*(?:%|percent))/);
    const down = /\b(lower|decrease|drop|cut|reduce)\b/.test(t);
    const type =
      t.match(/\b(?:for|on)\s+(?:the\s+|all\s+)?([a-z][a-z ]{1,30}?)\s+rooms?\b/)?.[1] ??
      t.match(/\b(?:raise|increase|bump|lower|decrease|drop|cut|reduce|set|change|make|put)\s+(?:the\s+)?([a-z][a-z ]{1,30}?)\s+(?:room\s+)?(?:rates?|prices?)\b/)?.[1] ??
      t.match(/\b(?:rates?|prices?)\s+(?:for|on)\s+(?:the\s+|all\s+)?([a-z][a-z ]{1,30}?)(?:\s+rooms?)?(?=\s+(?:by|to|at|this|next|on|for|from|tomorrow|today|tonight)\b|$)/)?.[1];
    const span = nights(t, today);
    const roomType = type && !/^(all|the|our|room|every|each)$/.test(type.trim()) ? type.trim() : undefined;
    if (roomType && span && (pct || amt)) {
      const percent = pct ? Math.abs(Number(pct[1])) * (down || pct[1].startsWith('-') ? -1 : 1) : undefined;
      return {
        operation: 'update_rates',
        args: { room_type: roomType.replace(/\b\w/g, (c) => c.toUpperCase()), start_date: span.start, end_date: span.end, ...(percent !== undefined ? { percent } : { amount: Number(amt![1]) }) },
        dayLabel: span.label,
      };
    }
    return null;
  }

  // Availability: "any rooms free tomorrow?", "availability 18 Oct to 20 Oct".
  if (/\b(availab\w*|vacan\w*|free rooms?|rooms? free|any rooms?|rooms? left|sold out)\b/.test(t)) {
    const ci = firstDay?.day ?? today;
    const co = dates[1]?.day && dates[1].day > ci ? dates[1].day : addDaysISO(ci, 1);
    return { operation: 'get_availability', args: { check_in: ci, check_out: co }, dayLabel: firstDay?.label ?? 'tonight' };
  }

  // Lists.
  if (/\b(in[\s-]?house|who'?s (?:here|staying|in)|staying (?:with us|tonight|now|here)|current guests|occupied rooms?|guests? (?:here|staying))\b/.test(t)) return { operation: 'list_in_house', args: {} };
  if (/\b(departures?|departing|leaving|checking out|check[\s-]?outs|due out)\b/.test(t)) return { operation: 'list_departures', args: { date: firstDay?.day ?? today }, dayLabel: firstDay?.label ?? 'today' };
  if (/\b(arrivals?|arriving|coming in|checking in|check[\s-]?ins|due in|expected)\b/.test(t)) return { operation: 'list_arrivals', args: { date: firstDay?.day ?? today }, dayLabel: firstDay?.label ?? 'today' };

  // Find one reservation: "find Moreno", "look up ABC123", "which room is Moreno in", "Moreno's reservation".
  m =
    orig.match(/^(?:find|look\s?up|lookup|search(?:\s+for)?|show(?:\s+me)?|pull up|get|open)\s+(?:the\s+)?(?:reservation|booking|guest)?\s*(?:for|of)?\s*(.+)$/i) ??
    orig.match(/^(?:what|which)\s+room\s+is\s+(.+?)\s+in$/i) ??
    orig.match(/^(?:details|info|information)\s+(?:for|on|about)\s+(.+)$/i) ??
    orig.match(/^(?:is|has)\s+(.+?)\s+(?:checked in|arrived|here|checked out)$/i) ??
    orig.match(/^(.+?)(?:'s|’s)\s+(?:reservation|booking|stay|room)$/i);
  if (m) {
    const ref = refFrom(m[1]);
    if (ref) return { operation: 'get_reservation', args: { confirmation_code: ref.confirmationCode, guest_name: ref.guestName } };
  }
  return null;
}

/**
 * Plan a task deterministically. Structured payloads win; otherwise the
 * staff instruction is parsed. Null = no confident match.
 */
export function planTask(task: TaskLike, today: ISODate): PlannedOperation | null {
  const payload = task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload) ? (task.payload as Rec) : {};
  const structured = fromPayload(task.kind, payload, today);
  if (structured) return structured;
  return fromText(task.instruction || '', today);
}
