/**
 * Deterministic natural-language understanding for the front desk.
 *
 * Turns a staff message into one or more structured intents. Handles
 * multi-part commands ("check in the Smiths, give them a quiet room on a high
 * floor and note it's their anniversary"), relative dates ("next 3
 * weekends"), confirmation codes, room numbers and guest preferences.
 * No network calls, no model — fast and predictable. Entity resolution
 * against the database happens later, in resolve.ts.
 */
import type { ISODate } from '@/lib/dto';
import { addDaysISO, dayOfWeek, hotelToday } from '../dates';

export interface RoomPrefs {
  highFloor?: boolean;
  lowFloor?: boolean;
  tags: string[];
}

export interface GuestRef {
  code?: string;
  name?: string;
  roomNumber?: string;
  pronoun?: boolean;
}

export interface DateRange {
  from: ISODate;
  /** exclusive */
  to: ISODate;
  label: string;
}

export type Intent =
  | { kind: 'overview' }
  | { kind: 'arrivals'; day: ISODate; label: string }
  | { kind: 'departures'; day: ISODate; label: string }
  | { kind: 'inHouse' }
  | { kind: 'find'; ref: GuestRef }
  | { kind: 'availability'; range: DateRange; guests: number; rooms: number }
  | { kind: 'occupancy'; range: DateRange }
  | { kind: 'weekendForecast'; weekends: DateRange[] }
  | { kind: 'rooms'; filter: RoomFilter; label: string; note?: string }
  | { kind: 'housekeeping' }
  | { kind: 'activity' }
  | { kind: 'property' }
  | { kind: 'help' }
  | { kind: 'suggestRooms'; ref: GuestRef; prefs: RoomPrefs }
  | { kind: 'checkIn'; ref: GuestRef; prefs: RoomPrefs; roomNumber?: string }
  | { kind: 'checkOut'; ref: GuestRef }
  | { kind: 'assignRoom'; ref: GuestRef; roomNumber?: string; prefs: RoomPrefs }
  | { kind: 'note'; ref: GuestRef; text: string }
  | { kind: 'confirm'; ref: GuestRef }
  | { kind: 'cancel'; ref: GuestRef; reason?: string }
  | { kind: 'noShow'; ref: GuestRef }
  | { kind: 'roomStatus'; roomNumbers: string[]; status: 'CLEAN' | 'DIRTY' | 'INSPECTED' }
  | { kind: 'outOfOrder'; roomNumber: string; reason?: string }
  | { kind: 'backInService'; roomNumber: string }
  | { kind: 'assignCleaning'; roomNumbers: string[]; who?: string }
  | { kind: 'autoAssignCleaning' }
  | { kind: 'assignArrivals'; prefs: RoomPrefs }
  | { kind: 'adjustRates'; percent: number; ranges: DateRange[]; roomTypeHint?: string }
  | { kind: 'unknown'; text: string };

export interface RoomFilter {
  status?: 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER';
  occupancy?: 'VACANT' | 'OCCUPIED' | 'ARRIVING' | 'DEPARTING';
  floor?: string;
  departingOn?: ISODate;
  roomTypeHint?: string;
}

export const WRITE_KINDS = new Set<Intent['kind']>([
  'checkIn',
  'checkOut',
  'assignRoom',
  'note',
  'confirm',
  'cancel',
  'noShow',
  'roomStatus',
  'outOfOrder',
  'backInService',
  'assignCleaning',
  'autoAssignCleaning',
  'assignArrivals',
  'adjustRates',
]);

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function nextWeekday(today: ISODate, target: number, forceNext = false): ISODate {
  const dow = dayOfWeek(today);
  let delta = (target - dow + 7) % 7;
  if (forceNext && delta === 0) delta = 7;
  return addDaysISO(today, delta);
}

/** Weekend = Friday and Saturday nights (check-in Fri, check-out Sun). */
export function weekendStarting(today: ISODate, offsetWeeks = 0): DateRange {
  const dow = dayOfWeek(today);
  // If we're already in a weekend (Fri/Sat/Sun), "this weekend" is the current one.
  const friday = dow === 5 ? today : dow === 6 ? addDaysISO(today, -1) : dow === 0 ? addDaysISO(today, -2) : nextWeekday(today, 5);
  const from = addDaysISO(friday, offsetWeeks * 7);
  return { from: from < today ? today : from, to: addDaysISO(from, 2), label: offsetWeeks === 0 ? 'this weekend' : offsetWeeks === 1 ? 'next weekend' : `weekend of ${from}` };
}

function parseMonthDay(text: string, today: ISODate): ISODate | null {
  const year = Number(today.slice(0, 4));
  const pick = (m: number, d: number, y?: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let yy = y ?? year;
    let iso = `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!y && iso < addDaysISO(today, -60)) {
      yy += 1;
      iso = `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) ? null : iso;
  };
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return pick(Number(m[2]), Number(m[3]), Number(m[1]));
  m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) return pick(Number(m[1]), Number(m[2]), m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined);
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) return pick(MONTHS.indexOf(m[1].slice(0, 3)) + 1, Number(m[2]));
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/);
  if (m) return pick(MONTHS.indexOf(m[2].slice(0, 3)) + 1, Number(m[1]));
  return null;
}

export interface ParsedDates {
  day?: ISODate;
  dayLabel?: string;
  range?: DateRange;
  weekends?: DateRange[];
  nights?: number;
}

export function parseDates(text: string, today: ISODate): ParsedDates {
  const t = text.toLowerCase();
  const out: ParsedDates = {};
  const nightsM = t.match(/\b(\d{1,2})\s*nights?\b/) ?? t.match(/\bfor\s+(a|one|two|three|four|five|six|seven)\s+nights?\b/);
  if (nightsM) {
    const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    out.nights = Number.isNaN(Number(nightsM[1])) ? words[nightsM[1]] : Number(nightsM[1]);
  }

  // Multiple weekends: "next 3 weekends", "the next three weekends", "upcoming weekends"
  const wkM = t.match(/\b(?:next|coming|upcoming|following)\s+(\d|two|three|four|five|six)\s+weekends?\b/) ?? t.match(/\b(\d|two|three|four|five|six)\s+weekends?\b/);
  if (wkM || /\bupcoming weekends\b|\bnext few weekends\b/.test(t)) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = wkM ? (Number.isNaN(Number(wkM[1])) ? words[wkM[1]] : Number(wkM[1])) : 3;
    const startOffset = /\bthis\b/.test(t) ? 0 : dayOfWeek(today) >= 5 || dayOfWeek(today) === 0 ? 1 : 0;
    out.weekends = Array.from({ length: Math.min(Math.max(n, 1), 8) }, (_, i) => weekendStarting(today, startOffset + i));
  } else if (/\bnext weekend\b/.test(t)) {
    out.range = weekendStarting(today, dayOfWeek(today) >= 5 || dayOfWeek(today) === 0 ? 1 : 1);
    if (dayOfWeek(today) >= 1 && dayOfWeek(today) <= 4) out.range = weekendStarting(today, 1);
    out.weekends = [out.range];
  } else if (/\b(this|the) weekend\b|\bweekend\b/.test(t)) {
    out.range = weekendStarting(today, 0);
    out.weekends = [out.range];
  }

  // Explicit range: "from X to Y", "X - Y", "X through Y"
  const rangeM = t.match(/(?:from\s+)?(.+?)\s+(?:to|until|till|through|thru|-|–)\s+(.+)/);
  if (rangeM && !out.range) {
    const a = parseMonthDay(rangeM[1], today);
    const b = parseMonthDay(rangeM[2], today);
    if (a && b && b > a) out.range = { from: a, to: b, label: `${a} → ${b}` };
  }

  if (!out.range) {
    if (/\b(next|coming)\s+(7|seven)\s+days\b|\bthis week\b|\bnext few days\b/.test(t)) out.range = { from: today, to: addDaysISO(today, 7), label: 'the next 7 days' };
    else if (/\bnext week\b/.test(t)) {
      const mon = nextWeekday(today, 1, true);
      out.range = { from: mon, to: addDaysISO(mon, 7), label: 'next week' };
    } else if (/\b(next|coming)\s+(14|two weeks|fortnight)\b|\bnext two weeks\b/.test(t)) out.range = { from: today, to: addDaysISO(today, 14), label: 'the next 14 days' };
    else if (/\b(next|coming)\s+(30|month)\b|\bthis month\b|\bnext month\b/.test(t)) out.range = { from: today, to: addDaysISO(today, 30), label: 'the next 30 days' };
    else {
      const nDays = t.match(/\bnext\s+(\d{1,2})\s+days\b/);
      if (nDays) out.range = { from: today, to: addDaysISO(today, Number(nDays[1])), label: `the next ${nDays[1]} days` };
    }
  }

  // Single day
  if (/\b(today|tonight|this evening)\b/.test(t)) {
    out.day = today;
    out.dayLabel = 'today';
  } else if (/\btomorrow\b/.test(t)) {
    out.day = addDaysISO(today, 1);
    out.dayLabel = 'tomorrow';
  } else if (/\byesterday\b/.test(t)) {
    out.day = addDaysISO(today, -1);
    out.dayLabel = 'yesterday';
  } else {
    const inDays = t.match(/\bin\s+(\d{1,2})\s+days?\b/);
    if (inDays) {
      out.day = addDaysISO(today, Number(inDays[1]));
      out.dayLabel = `in ${inDays[1]} days`;
    } else {
      const wd = t.match(/\b(next|this|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
      if (wd) {
        out.day = nextWeekday(today, WEEKDAYS.indexOf(wd[2]), wd[1] === 'next');
        out.dayLabel = `${wd[1] === 'next' ? 'next ' : ''}${wd[2][0].toUpperCase()}${wd[2].slice(1)}`;
      } else if (!rangeM || !out.range) {
        const md = parseMonthDay(t, today);
        if (md) {
          out.day = md;
          out.dayLabel = md;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small extractors
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s: string) => (NUMBER_WORDS[s] ?? Number(s));

export function parseParty(text: string): { guests?: number; rooms?: number } {
  const t = text.toLowerCase();
  let guests: number | undefined;
  const adults = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight)\s*(adults?|guests?|people|persons?|pax|travell?ers)\b/);
  const kids = t.match(/\b(\d+|one|two|three|four|five|six)\s*(kids?|children|child|infants?)\b/);
  if (adults) guests = num(adults[1]);
  if (kids) guests = (guests ?? 0) + num(kids[1]);
  const family = t.match(/\bfamily of (\d+|three|four|five|six|seven|eight)\b/);
  if (family) guests = num(family[1]);
  if (!guests && /\bcouple\b/.test(t)) guests = 2;
  if (!guests && /\b(solo|single traveller|just me|one person)\b/.test(t)) guests = 1;
  const roomsM = t.match(/\b(\d+|two|three|four|five)\s*rooms\b/);
  return { guests, rooms: roomsM ? num(roomsM[1]) : undefined };
}

export function parsePrefs(text: string): RoomPrefs {
  const t = text.toLowerCase();
  const tags: string[] = [];
  if (/\bquiet\b|\bpeaceful\b|\baway from (the )?(street|noise|elevator|lift)\b/.test(t)) tags.push('quiet');
  if (/\baccessible\b|\bwheelchair\b|\bada\b|\bmobility\b/.test(t)) tags.push('accessible');
  if (/\b(ocean|sea|bay|mountain|city|garden)?\s*view\b/.test(t)) tags.push('view');
  if (/\bcorner\b/.test(t)) tags.push('corner');
  return {
    highFloor: /\b(high|higher|top|upper|highest)\s+floor\b|\bhigh up\b/.test(t) || undefined,
    lowFloor: /\b(ground|low|lower|lowest|first)\s+floor\b|\bno stairs\b/.test(t) || undefined,
    tags,
  };
}

export function hasPrefs(p: RoomPrefs): boolean {
  return !!(p.highFloor || p.lowFloor || p.tags.length);
}

function roomNumbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\brooms?\s*#?\s*(\d{1,4}[a-z]?)((?:\s*(?:,|and|&)\s*\d{1,4}[a-z]?)*)/gi)) {
    out.add(m[1].toUpperCase());
    for (const extra of (m[2] ?? '').matchAll(/(\d{1,4}[a-z]?)/gi)) out.add(extra[1].toUpperCase());
  }
  return [...out];
}

/** Bare 3–4 digit numbers (room-ish), used when the intent is clearly about rooms. */
function bareNumbers(text: string): string[] {
  return [...text.matchAll(/(?<![\d/:$.-])\b(\d{3,4})\b(?![\d/:%.])/g)].map((m) => m[1]);
}

const CODE_RE = /(?:#|\b(?:reservation|booking|confirmation|res|conf)\s*(?:number|no\.?|code|#)?\s*:?\s*)([A-Za-z0-9]{4,30})\b/i;
const STANDALONE_CODE_RE = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,8}\b/;

const PRONOUN_RE = /\b(them|they|their|him|her|he|she|this guest|that guest|this reservation|that reservation|this booking|that booking|the guest)\b/i;

const NAME_STOPWORDS = new Set(
  `the a an for from of to in into on at with and or please now today tonight tomorrow yesterday reservation booking confirmation guest guests party family room rooms mr mrs ms miss dr sir madam them they their him her he she it its this that these those who is are was were be check checkin checkout out arrival arrivals departure departures early late quiet high higher floor top upper low ground accessible view corner give put move assign note add make sure confirm cancel mark as no show noshow booked stay staying celebrating anniversary birthday honeymoon wedding find look lookup search show me pull up open details info about can you could would i we our my is
  will by up just already currently booking's please. reservation's if available possible possibly ideally preferably first want wants would like
  nice good best another different new`.split(/\s+/)
);

/** Extract a probable guest name from the leftover words of a clause. */
export function extractName(original: string): string | undefined {
  const cleaned = original
    .replace(/\bno[\s-]?show\b/gi, ' ')
    .replace(/\bcheck[\s-]?(?:in|out)\b/gi, ' ')
    .replace(/\bcheck\b|\b(?:in|out)\s*$/gi, ' ')
    .replace(CODE_RE, ' ')
    .replace(/\brooms?\s*#?\s*\d+[a-z]?\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[“”"'’`]s\b/g, '')
    .replace(/[^A-Za-zÀ-ÿ'’\-\s]/g, ' ');
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, ''))
    .filter((w) => w && !NAME_STOPWORDS.has(w.toLowerCase()));
  if (!words.length) return undefined;
  return words.slice(0, 3).join(' ');
}

function guestRef(original: string, ctxPronoun = true): GuestRef {
  const ref: GuestRef = {};
  const code = original.match(CODE_RE)?.[1] ?? original.match(STANDALONE_CODE_RE)?.[0];
  if (code) ref.code = code.toUpperCase();
  const rooms = roomNumbersIn(original);
  if (rooms.length) ref.roomNumber = rooms[0];
  // Keep the name alongside a code: if the code isn't found, the name still resolves.
  const name = extractName(original);
  if (name) ref.name = name;
  if (ctxPronoun && !ref.code && !ref.name && !ref.roomNumber && PRONOUN_RE.test(original)) ref.pronoun = true;
  return ref;
}

const hasRef = (r: GuestRef) => !!(r.code || r.name || r.roomNumber || r.pronoun);

// ---------------------------------------------------------------------------
// Clause classification
// ---------------------------------------------------------------------------

const QUESTION_RE = /^\s*(who|whom|which|what|how|when|is|are|do|does|any|list|show|display|give me|tell me|get me|can you show|i need to see|let me see)\b/i;

function tidyNote(note: string): string {
  const t = note.trim().replace(/[.!]+$/, '');
  const m = t.match(/^(?:they|he|she)(?:'re|’re| are| is|'s|’s)\s+(.+)$/i);
  const out = m ? m[1] : t;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function splitClauses(message: string): { clauses: string[]; noteText?: string; noteRefText?: string } {
  let text = message.trim();
  let noteText: string | undefined;
  // "add a note to Emily Nakamura: wants late checkout"
  const directed = text.match(/\b(?:add|leave|put|write)\s+(?:a\s+)?note\s+(?:to|for|on)\s+(.+?)\s*[:\-–]\s*(.+)$/i);
  if (directed && directed.index !== undefined) {
    const before = text.slice(0, directed.index).replace(/[,;\s]*(and\s*)?$/i, '').trim();
    return { clauses: before ? [before] : [], noteText: tidyNote(directed[2]), noteRefText: directed[1] };
  }
  // A note swallows the rest of the message ("note that they want late checkout and extra towels").
  const noteM = text.match(/(?:^|,|;|\band\b)\s*(?:please\s+)?(?:add\s+(?:a\s+)?note(?:\s+(?:that|saying))?|make\s+a\s+note(?:\s+that)?|leave\s+a\s+note(?:\s+that)?|note(?:\s+(?:that|down))?|remember\s+that|mention\s+that|flag\s+that)\s*[:,-]?\s+(.+)$/i);
  if (noteM && noteM.index !== undefined) {
    noteText = tidyNote(noteM[1]);
    text = text.slice(0, noteM.index).trim();
  } else {
    const celeb = text.match(/\b(?:and\s+)?(?:(?:they|he|she)(?:'re|’re| are| is|'s|’s)|it's|it is|it’s)\s+(celebrating|here for|on)\s+(?:their|a|an|his|her)?\s*(.+)$/i);
    if (celeb && celeb.index !== undefined && /celebrat|anniversary|birthday|honeymoon|wedding|business|conference/i.test(celeb[0])) {
      const what = celeb[2].trim().replace(/[.!]+$/, '');
      noteText = `${celeb[1].toLowerCase() === 'celebrating' ? 'Celebrating' : celeb[1][0].toUpperCase() + celeb[1].slice(1)} ${what}`;
      text = text.slice(0, celeb.index).trim();
    }
  }
  const clauses = text
    .split(/\s*(?:;|,\s*(?:and\s+)?(?:then\s+)?|\.\s+|\band then\b|\bthen\b|\band also\b|\balso\b|\band\b(?=\s+(?:give|put|assign|move|check|mark|confirm|cancel|send|have|make|note|add|set|take|raise|lower|bump)))\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);
  return { clauses: clauses.length ? clauses : [text].filter(Boolean), noteText };
}

function classify(clause: string, today: ISODate): Intent | null {
  const t = clause.toLowerCase().replace(/[’']/g, "'");
  const isQuestion = QUESTION_RE.test(t) || /\?\s*$/.test(t);
  const dates = parseDates(t, today);

  if (/^\s*(help|\?|commands|what can you do|how do (i|you) use|examples?)\b/.test(t)) return { kind: 'help' };

  // --- Writes ----------------------------------------------------------------
  if (!isQuestion) {
    if (/\b(auto[\s-]?assign|distribute|divide|split|balance)\b.*\b(housekeep|clean|rooms|tasks)/.test(t) || /\bassign (all |the )?(dirty|unassigned) rooms\b/.test(t)) {
      return { kind: 'autoAssignCleaning' };
    }
    if (/\b(assign|pre-?assign|allocate|block|give)\b.*\brooms?\b.*\b(for|to)\b.*\barrivals?\b/.test(t) || /\bassign rooms for (today'?s )?arrivals\b/.test(t)) {
      return { kind: 'assignArrivals', prefs: parsePrefs(t) };
    }
    const rate = t.match(/\b(raise|increase|bump|up|lift|lower|drop|reduce|discount|cut)\b.*?\b(rates?|prices?|pricing)\b.*?(\d{1,3})\s*(%|percent)/) ?? t.match(/\b(raise|increase|bump|lower|drop|reduce|discount|cut)\b.*?(\d{1,3})\s*(%|percent).*?\b(rates?|prices?)\b/);
    if (rate) {
      const pct = Number(rate[3] && /\d/.test(rate[3]) ? rate[3] : rate[2]);
      const down = /lower|drop|reduce|discount|cut/.test(rate[1]);
      const ranges = dates.weekends?.length ? dates.weekends : dates.range ? [dates.range] : dates.day ? [{ from: dates.day, to: addDaysISO(dates.day, dates.nights ?? 1), label: dates.dayLabel ?? dates.day }] : [];
      const rt = t.match(/\bfor\s+(?:the\s+)?([a-z][a-z ]+?)\s+(?:rooms?|suites?)\b/);
      return { kind: 'adjustRates', percent: down ? -pct : pct, ranges, roomTypeHint: rt?.[1] };
    }
    if (/\bout of (order|service)\b|\btake\b.*\b(offline|out of service)\b|\bmaintenance\b/.test(t) && !/\bback\b/.test(t)) {
      const room = roomNumbersIn(clause)[0] ?? bareNumbers(clause)[0];
      if (room) {
        const reason = clause.match(/\b(?:because|due to|for|reason:?)\s+(.+)$/i)?.[1];
        return { kind: 'outOfOrder', roomNumber: room, reason };
      }
    }
    if (/\bback (in|into) (service|order)\b|\breturn\b.*\bto service\b|\b(is )?fixed\b|\bavailable again\b|\bback online\b/.test(t)) {
      const room = roomNumbersIn(clause)[0] ?? bareNumbers(clause)[0];
      if (room) return { kind: 'backInService', roomNumber: room };
    }
    const statusM = t.match(/\b(clean|dirty|inspected)\b/);
    if (statusM && (/\bmark\b|\bset\b|\bis (now )?(clean|dirty|inspected)\b|\bas (clean|dirty|inspected)\b/.test(t) || /^\s*(rooms?\s*)?\d{3,4}[a-z]?\s+(is\s+)?(clean|dirty|inspected)\b/.test(t)) && !/\bassign|\bhave\b|\bsend\b/.test(t)) {
      const rooms = roomNumbersIn(clause).length ? roomNumbersIn(clause) : bareNumbers(clause);
      if (rooms.length) return { kind: 'roomStatus', roomNumbers: rooms, status: statusM[1].toUpperCase() as 'CLEAN' | 'DIRTY' | 'INSPECTED' };
    }
    if (/\b(clean|housekeep|turn ?down|refresh)\b/.test(t) && /\b(assign|send|have|get|ask|give|put)\b/.test(t)) {
      const rooms = roomNumbersIn(clause).length ? roomNumbersIn(clause) : bareNumbers(clause);
      const who = clause.match(/\b(?:to|have|ask|get|send)\s+([A-Z][a-zÀ-ÿ'-]+)/)?.[1];
      if (rooms.length) return { kind: 'assignCleaning', roomNumbers: rooms, who };
    }
    if (/\bno[\s-]?show\b/.test(t)) return { kind: 'noShow', ref: guestRef(clause) };
    if (/\bcancel\b/.test(t)) {
      const reason = clause.match(/\b(?:because|reason:?|due to)\s+(.+)$/i)?.[1];
      return { kind: 'cancel', ref: guestRef(clause.replace(/\b(?:because|reason:?|due to)\s+.+$/i, '')), reason };
    }
    if (/\bconfirm\b/.test(t) && !/\bconfirmation\b/.test(t.replace(/\bconfirm\b/, ''))) return { kind: 'confirm', ref: guestRef(clause) };
    const split = t.match(/\bcheck\s+((?:the\s+)?[a-z'’]+(?:\s+[a-z'’]+)?)\s+(in|out)\b/);
    const splitOk = split && !/\b(availability|rates?|prices?|rooms?|occupancy|status|calendar|board|list)\b/.test(split[1]);
    if (splitOk && split[2] === 'out') return { kind: 'checkOut', ref: guestRef(clause) };
    if ((/\bcheck[\s-]?in\b|\bcheckin\b/.test(t) || (splitOk && split?.[2] === 'in')) && !/\bwho\b|\barrivals?\b/.test(t)) {
      const room = roomNumbersIn(clause)[0];
      const refText = clause.replace(/\b(?:in|into|to)\s+rooms?\s*#?\s*\d+[a-z]?\b/i, ' ');
      return { kind: 'checkIn', ref: guestRef(refText), prefs: parsePrefs(t), roomNumber: room };
    }
    if (/\bcheck[\s-]?out\b|\bcheckout\b/.test(t) && !/\bwho\b|\bdepartures?\b/.test(t)) {
      return { kind: 'checkOut', ref: guestRef(clause) };
    }
    if (/\b(give|put|move|assign|upgrade|switch|place)\b/.test(t) && /\b(room|floor|quiet|view|corner|accessible)\b/.test(t)) {
      const room = roomNumbersIn(clause)[0] ?? bareNumbers(clause)[0];
      // "assign room 304 to the Smiths" / "move Smith to 304" / "give them a quiet room"
      const refText = clause.replace(/\brooms?\s*#?\s*\d+[a-z]?\b/gi, ' ').replace(/\b\d{3,4}\b/g, ' ');
      return { kind: 'assignRoom', ref: guestRef(refText), roomNumber: room, prefs: parsePrefs(t) };
    }
  }

  // A bare preference ("quiet room on a high floor", "quiet rooms first") refines the main action.
  if (!isQuestion && hasPrefs(parsePrefs(t)) && /\b(room|rooms|floor|first|if)\b/.test(t) && !/\bavailab|\bfree\b|\bany\b/.test(t)) {
    return { kind: 'assignRoom', ref: { pronoun: true }, prefs: parsePrefs(t) };
  }

  // --- Reads -------------------------------------------------------------------
  if (/\b(best|which|what|good)\b.*\broom\b.*\b(for|give)\b/.test(t) || /\broom (options|suggestions)\b/.test(t)) {
    const ref = guestRef(clause.replace(/\b(best|which|what|good|room|options|suggestions|should|i|we|give)\b/gi, ' '));
    if (hasRef(ref)) return { kind: 'suggestRooms', ref, prefs: parsePrefs(t) };
  }
  if (/\b(weekend|weekends)\b/.test(t) && /\b(forecast|occupan|rate|strategy|pricing|how (full|busy)|outlook|demand|pace)\b/.test(t)) {
    return { kind: 'weekendForecast', weekends: dates.weekends ?? [weekendStarting(today, 0)] };
  }
  if (/\boccupan|\bhow (full|busy)\b|\bforecast\b|\butili[sz]ation\b|\brevenue\b|\badr\b|\bpace\b|\bpickup\b/.test(t)) {
    const range = dates.range ?? (dates.day ? { from: dates.day, to: addDaysISO(dates.day, 1), label: dates.dayLabel ?? dates.day } : { from: today, to: addDaysISO(today, 7), label: 'the next 7 days' });
    return { kind: 'occupancy', range };
  }
  if (/\bavailab|\bvacan|\bfree rooms?\b|\bany rooms?\b|\brooms? (left|open)\b|\bsell\b|\bquote\b|\bhow much\b|\bprice for\b|\bdo we have (a |any )?(room|space)\b/.test(t)) {
    const party = parseParty(t);
    const from = dates.range?.from ?? dates.day ?? today;
    const to = dates.range?.to ?? addDaysISO(from, dates.nights ?? 1);
    return { kind: 'availability', range: { from, to, label: dates.range?.label ?? dates.dayLabel ?? 'tonight' }, guests: party.guests ?? 2, rooms: party.rooms ?? 1 };
  }
  if (/\b(need|needs|needing)\b.*\bclean|\bto (be )?clean|\bdirty\b|\bturnovers?\b|\bdeep clean/.test(t)) {
    const departingOn = /\bchecking out\b|\bdepart|\bleaving\b|\bcheck[\s-]?outs?\b/.test(t) || (dates.day && dates.day !== today) ? dates.day ?? today : undefined;
    return {
      kind: 'rooms',
      filter: departingOn ? { departingOn } : { status: 'DIRTY' },
      label: departingOn ? `Rooms needing a clean ${dates.dayLabel ?? 'today'}` : 'Rooms that need cleaning',
      note: /\b(after|before)\s+\d/.test(t) ? 'Check-out times aren’t recorded yet, so this includes every departure that day.' : undefined,
    };
  }
  if (/\bout of (order|service)\b|\booo\b/.test(t)) return { kind: 'rooms', filter: { status: 'OUT_OF_ORDER' }, label: 'Out-of-order rooms' };
  if (/\b(vacant|empty|unoccupied) rooms?\b/.test(t)) return { kind: 'rooms', filter: { occupancy: 'VACANT' }, label: 'Vacant rooms' };
  if (/\b(clean|ready|inspected) rooms?\b|\brooms? (are )?(clean|ready)\b/.test(t)) return { kind: 'rooms', filter: { status: 'CLEAN' }, label: 'Ready rooms' };
  const floorM = t.match(/\b(?:floor|level)\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+floor\b/);
  if (/\broom (board|status|map|rack)\b|\ball rooms\b|\bfloor plan\b|\brooms on\b|\bshow (me )?(the )?rooms\b/.test(t) || floorM) {
    return { kind: 'rooms', filter: floorM ? { floor: floorM[1] ?? floorM[2] } : {}, label: floorM ? `Floor ${floorM[1] ?? floorM[2]}` : 'Room board' };
  }
  if (/\bhousekeep|\bwho is cleaning\b|\bcleaning (queue|status|board|tasks)\b/.test(t)) return { kind: 'housekeeping' };
  if (/\barriv|\bchecking in\b|\bcheck[\s-]?ins\b|\bcoming in\b|\bexpected\b/.test(t)) {
    const day = dates.day ?? today;
    return { kind: 'arrivals', day, label: dates.dayLabel ?? 'today' };
  }
  if (/\bdepart|\bchecking out\b|\bcheck[\s-]?outs\b|\bleaving\b/.test(t)) {
    const day = dates.day ?? today;
    return { kind: 'departures', day, label: dates.dayLabel ?? 'today' };
  }
  if (/\bin[\s-]?house\b|\bwho('s| is) (staying|here|in)\b|\bcurrent guests\b|\bstaying (with us|tonight)\b/.test(t)) return { kind: 'inHouse' };
  if (/\bactivity\b|\baudit\b|\bwhat (happened|changed)\b|\bhistory\b|\blog\b|\bwhat did (you|the agent) do\b/.test(t)) return { kind: 'activity' };
  if (/\b(brief|briefing|overview|summary|dashboard|status report|how are we doing|what'?s (up|happening|going on)|morning|today at a glance|catch me up)\b/.test(t) || /^\s*today\s*\??$/.test(t)) {
    return { kind: 'overview' };
  }
  if (/\b(property|hotel) (info|details)\b|\babout (this|the) (hotel|property)\b|\bour address\b|\bphone number\b/.test(t)) return { kind: 'property' };

  // Lookup: "find Smith", "reservation ABC123", "pull up Jordan", "Emily Nakamura"
  const ref = guestRef(clause, false);
  if (/\b(find|search|look ?up|pull up|open|show|details|where is|who is)\b/.test(t) || ref.code) {
    const r = guestRef(clause.replace(/\b(find|search|look ?up|pull up|open|show|details|for|where is|who is)\b/gi, ' '));
    if (hasRef(r)) return { kind: 'find', ref: r };
  }
  return null;
}

/**
 * Parse a full message into intents. Write intents that refer to the same
 * guest are merged so "check in X and give them a quiet room" becomes one
 * check-in with preferences.
 */
export function parseMessage(message: string, today: ISODate = hotelToday()): Intent[] {
  const { clauses, noteText, noteRefText } = splitClauses(message);
  const intents: Intent[] = [];
  for (const clause of clauses) {
    const intent = classify(clause, today);
    if (intent) intents.push(intent);
  }
  // Second chance: whole message as one clause (e.g. "who's checking in tomorrow and how full are we" splits fine, but
  // "show me all rooms that need deep cleaning tomorrow and are currently occupied" should stay whole).
  if (intents.length === 0 && clauses.length > 1) {
    const whole = classify(message, today);
    if (whole) intents.push(whole);
  }

  // Merge room preferences / assignments into the main room-choosing action for the same guest.
  const host = intents.find(
    (i): i is Extract<Intent, { kind: 'checkIn' | 'suggestRooms' | 'assignArrivals' }> =>
      i.kind === 'checkIn' || i.kind === 'suggestRooms' || i.kind === 'assignArrivals'
  );
  if (host) {
    for (let i = intents.length - 1; i >= 0; i--) {
      const it = intents[i];
      if (it === host || it.kind !== 'assignRoom') continue;
      const sameGuest = it.ref.pronoun || !hasRef(it.ref) || ('ref' in host && sameRef(it.ref, host.ref));
      if (!sameGuest) continue;
      host.prefs = mergePrefs(host.prefs, it.prefs);
      if (host.kind === 'checkIn' && it.roomNumber && !host.roomNumber) host.roomNumber = it.roomNumber;
      intents.splice(i, 1);
    }
  }
  // Pronoun refs inherit the first explicit guest in the same message.
  const anchor = intents.map(refOf).find((r) => r && !r.pronoun && hasRef(r));
  for (const it of intents) {
    const r = refOf(it);
    if (r && (r.pronoun || !hasRef(r)) && anchor) Object.assign(r, anchor, { pronoun: false });
  }
  if (noteText) {
    const r = noteRefText ? guestRef(noteRefText) : anchor ?? { pronoun: true };
    intents.push({ kind: 'note', ref: { ...r }, text: noteText });
  }
  if (intents.length === 0) intents.push({ kind: 'unknown', text: message });
  return intents;
}

function refOf(i: Intent): GuestRef | undefined {
  return 'ref' in i ? i.ref : undefined;
}

function sameRef(a: GuestRef, b: GuestRef) {
  return (a.code && a.code === b.code) || (a.name && b.name && a.name.toLowerCase() === b.name.toLowerCase());
}

function mergePrefs(a: RoomPrefs, b: RoomPrefs): RoomPrefs {
  return { highFloor: a.highFloor || b.highFloor, lowFloor: a.lowFloor || b.lowFloor, tags: [...new Set([...a.tags, ...b.tags])] };
}
