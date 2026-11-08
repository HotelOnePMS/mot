/**
 * Custom reports: one engine for any report someone describes in plain words ("pet fees by month this year",
 * "occupancy by weekday in October", "top 10 guests by spend", "cash taken yesterday").
 *
 * A report is a ReportQuery over one dataset (reservations, room nights, folio charges or payments): a date range,
 * filters, an optional grouping (with date buckets: week, month, weekday…), metrics (count, sum, average, share,
 * occupancy, ADR…), sorting and a row limit. The agent writes the query; the server fetches the hotel's rows
 * (server/services/report-query.ts) and shapeReport turns them into the table. Pure and client-safe: the same rules
 * are unit-tested, render the table and write the CSV.
 */
import type { ISODate } from './dto';
import { MAX_REPORT_DAYS, type ReportCell, type ReportColumn } from './reports';

export type FieldType = 'text' | 'number' | 'money' | 'date' | 'datetime';

export interface DatasetField {
  key: string;
  label: string;
  type: FieldType;
  /** For the model: what the field holds, and its values when they're a fixed set. */
  about?: string;
  /** Number fields that add up in a list's total row (nights, guests), as money always does. */
  sums?: boolean;
  /** datetime fields: the date field with the same moment as a day on the hotel's clock (for grouping by day or month). */
  day?: string;
}

export type DatasetId = 'reservations' | 'nights' | 'charges' | 'payments';

export interface DatasetDef {
  id: DatasetId;
  label: string;
  /** What one row is, for the model and the count column ("Reservations"). */
  noun: string;
  about: string;
  /** Which date the range applies to; the first is the default. */
  dateFields: { key: string; about: string }[];
  fields: DatasetField[];
  /** A plain list's columns when none are asked for. */
  defaultColumns: string[];
  /** Left out unless the query filters on status (revenue rows skip cancelled stays and no-shows). */
  excludeStatuses?: string[];
}

const STATUS_VALUES = 'Pending, Confirmed, Checked in, Checked out, Cancelled, No-show';
const SOURCE_VALUES = 'Website, Front desk, AI assistant, Phone (voice agent), Expedia, Booking.com';

const stayFields: DatasetField[] = [
  { key: 'code', label: 'Confirmation', type: 'text' },
  { key: 'guest', label: 'Guest', type: 'text' },
  { key: 'status', label: 'Status', type: 'text', about: STATUS_VALUES },
  { key: 'roomType', label: 'Room type', type: 'text' },
  { key: 'room', label: 'Room', type: 'text', about: 'Room number, empty when none is assigned' },
  { key: 'source', label: 'Source', type: 'text', about: SOURCE_VALUES },
];

export const DATASETS: Record<DatasetId, DatasetDef> = {
  reservations: {
    id: 'reservations',
    label: 'Reservations',
    noun: 'Reservations',
    about: 'One row per reservation (each room type of a multi-room-type booking is its own row).',
    dateFields: [
      { key: 'stay', about: 'staying at least one night in the range (default; also guests still checked in)' },
      { key: 'checkIn', about: 'arriving in the range' },
      { key: 'checkOut', about: 'departing in the range' },
      { key: 'bookedOn', about: 'booked in the range' },
    ],
    fields: [
      ...stayFields,
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'checkIn', label: 'Check-in', type: 'date' },
      { key: 'checkOut', label: 'Check-out', type: 'date' },
      { key: 'nights', label: 'Nights', type: 'number', sums: true },
      { key: 'guests', label: 'Guests', type: 'number', sums: true },
      { key: 'rooms', label: 'Rooms', type: 'number', sums: true },
      { key: 'roomNights', label: 'Room nights', type: 'number', sums: true, about: 'nights × rooms' },
      { key: 'paymentMethod', label: 'Payment method', type: 'text', about: 'Card (online) or At the property' },
      { key: 'paymentStatus', label: 'Payment status', type: 'text' },
      { key: 'roomRevenue', label: 'Room charges', type: 'money', about: 'the room before taxes, fees and extras' },
      { key: 'taxes', label: 'Taxes & fees', type: 'money', about: 'the hotel’s taxes and fees on the stay' },
      { key: 'extras', label: 'Extra charges', type: 'money', about: 'charges added on the folio (pet fee, minibar…)' },
      { key: 'extraCharges', label: 'Extras', type: 'text', about: 'names of the extra charges, comma separated' },
      { key: 'total', label: 'Total', type: 'money', about: 'everything the stay costs, before allowances' },
      { key: 'allowances', label: 'Allowances', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'money' },
      { key: 'balance', label: 'Balance', type: 'money', about: 'still owed (0 for cancelled and no-shows)' },
      { key: 'bookedOn', label: 'Booked on', type: 'datetime', day: 'bookedDate' },
      { key: 'bookedDate', label: 'Booked', type: 'date', about: 'the day it was booked' },
      { key: 'bookedBy', label: 'Booked by', type: 'text', about: 'staff member who took it at the desk' },
      { key: 'leadDays', label: 'Lead time (days)', type: 'number', about: 'days between booking and arrival' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
    defaultColumns: ['code', 'guest', 'status', 'checkIn', 'checkOut', 'roomType', 'room', 'total', 'balance'],
  },
  nights: {
    id: 'nights',
    label: 'Room nights',
    noun: 'Nights',
    about: 'One row per night of each stay in the range, with that night’s share of the room revenue: for occupancy, ADR, RevPAR and revenue by day, week, month or weekday.',
    dateFields: [{ key: 'date', about: 'the night' }],
    fields: [
      { key: 'date', label: 'Night', type: 'date' },
      ...stayFields,
      { key: 'paymentMethod', label: 'Payment method', type: 'text', about: 'Card (online) or At the property' },
      { key: 'rooms', label: 'Rooms', type: 'number', sums: true, about: 'rooms this stay has that night: sum it for room nights sold' },
      { key: 'roomRevenue', label: 'Room revenue', type: 'money', about: 'the night’s share of the room charges' },
      { key: 'taxes', label: 'Taxes & fees', type: 'money', about: 'the night’s share of taxes and fees' },
    ],
    defaultColumns: ['date', 'code', 'guest', 'roomType', 'rooms', 'roomRevenue'],
    excludeStatuses: ['Cancelled', 'No-show'],
  },
  charges: {
    id: 'charges',
    label: 'Folio charges',
    noun: 'Charges',
    about: 'One row per line on the folios: the room, each tax and fee, each extra charge (pet fee, late check-out, minibar…) and each allowance (negative).',
    dateFields: [
      { key: 'date', about: 'the charge’s day: an extra charge’s own date, otherwise the arrival day (default)' },
      { key: 'checkIn', about: 'the stay arrives in the range' },
      { key: 'checkOut', about: 'the stay departs in the range' },
    ],
    fields: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'type', label: 'Type', type: 'text', about: 'Room, Tax or fee, Extra charge, Allowance' },
      { key: 'name', label: 'Charge', type: 'text', about: 'what the line says, e.g. Pet fee, Occupancy tax, or the room line' },
      { key: 'amount', label: 'Amount', type: 'money', about: 'allowances are negative' },
      ...stayFields,
      { key: 'checkIn', label: 'Check-in', type: 'date' },
      { key: 'checkOut', label: 'Check-out', type: 'date' },
    ],
    defaultColumns: ['date', 'code', 'guest', 'type', 'name', 'amount'],
    excludeStatuses: ['Cancelled', 'No-show'],
  },
  payments: {
    id: 'payments',
    label: 'Payments',
    noun: 'Payments',
    about: 'One row per payment taken: online, at the desk (card reader, typed in, virtual card, cash, recorded) and security deposits, with what was given back.',
    dateFields: [{ key: 'date', about: 'the day it was paid' }],
    fields: [
      { key: 'date', label: 'Paid', type: 'date' },
      { key: 'paidAt', label: 'Paid at', type: 'datetime', day: 'date' },
      { key: 'code', label: 'Confirmation', type: 'text' },
      { key: 'guest', label: 'Guest', type: 'text' },
      { key: 'method', label: 'Method', type: 'text', about: 'Paid online, Card reader, Card typed in, OTA virtual card, Cash, Card on another terminal, Paid another way' },
      { key: 'kind', label: 'Kind', type: 'text', about: 'Prepayment, Booking deposit, Payment (at the desk), Security deposit' },
      { key: 'status', label: 'Status', type: 'text', about: 'Paid, Partly refunded, Refunded, Held on card' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'refunded', label: 'Given back', type: 'money' },
      { key: 'net', label: 'Kept', type: 'money', about: 'amount less what was given back' },
      { key: 'card', label: 'Card', type: 'text' },
      { key: 'recordedBy', label: 'Taken by', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
    ],
    defaultColumns: ['date', 'code', 'guest', 'method', 'kind', 'amount', 'refunded'],
    excludeStatuses: ['Held on card'],
  },
};

export const DATASET_IDS = Object.keys(DATASETS) as DatasetId[];

export const FILTER_OPS = ['eq', 'ne', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'empty', 'not_empty'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export type FilterValue = string | number | (string | number)[];

export interface QueryFilter {
  field: string;
  op: FilterOp;
  value?: FilterValue;
}

export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year', 'weekday'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export interface QueryGroup {
  field: string;
  /** Date fields only: one row per day (default), week (from Monday), month, quarter, year, or day of the week. */
  by?: DateBucket;
}

export const METRIC_FNS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'share', 'ratio', 'adr', 'occupancy', 'revpar', 'available'] as const;
export type MetricFn = (typeof METRIC_FNS)[number];

export interface QueryMetric {
  fn: MetricFn;
  field?: string;
  /** ratio: sum(field) ÷ sum(per), e.g. total per guest. */
  per?: string;
  label?: string;
}

export interface QuerySort {
  /** A column of the result: a field (lists), a group field, or a metric's key (count, sum_total, avg_leadDays…). */
  key: string;
  dir?: 'asc' | 'desc';
}

export interface ReportQuery {
  dataset: DatasetId;
  title?: string;
  from: ISODate;
  /** Inclusive. */
  to: ISODate;
  dateField?: string;
  filters?: QueryFilter[];
  groupBy?: QueryGroup[];
  metrics?: QueryMetric[];
  /** A plain list's columns (no groupBy or metrics). */
  columns?: string[];
  sort?: QuerySort[];
  limit?: number;
}

export type QueryRow = Record<string, string | number | null>;

export interface QueryResult {
  query: ReportQuery;
  title: string;
  property: { id: string; name: string; currency: string };
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
  /** Rows the filters matched before grouping and the limit. */
  matched: number;
  /** More source rows than a report reads (the dates or filters should be narrower). */
  truncated: boolean;
  generatedAt: string;
}

/** Most source rows a report reads, and most rows it returns. */
export const MAX_QUERY_SOURCE_ROWS = 20_000;
export const MAX_QUERY_ROWS = 5_000;

const fieldOf = (d: DatasetDef, key: string) => d.fields.find((f) => f.key === key);

/** The date field the range applies to (the dataset's default when none or an unknown one is given). */
export function rangeField(q: Pick<ReportQuery, 'dataset' | 'dateField'>): string {
  const d = DATASETS[q.dataset];
  return d.dateFields.some((f) => f.key === q.dateField) ? q.dateField! : d.dateFields[0].key;
}

const isNumeric = (t: FieldType) => t === 'number' || t === 'money';
const isDay = /^\d{4}-\d{2}-\d{2}$/;

/** Everything wrong with a query, in words the model (or a person) can act on. Empty when it can run. */
export function checkQuery(q: ReportQuery): string[] {
  const problems: string[] = [];
  const d = DATASETS[q.dataset];
  if (!d) return [`Unknown dataset “${String(q.dataset)}”. Use one of: ${DATASET_IDS.join(', ')}.`];
  const fieldList = d.fields.map((f) => f.key).join(', ');
  const known = (key: string, where: string) => {
    if (fieldOf(d, key)) return true;
    problems.push(`${where}: “${key}” isn’t a field of ${d.id}. Fields: ${fieldList}.`);
    return false;
  };
  if (!isDay.test(q.from) || !isDay.test(q.to)) problems.push('from and to must be dates (YYYY-MM-DD).');
  else if (q.from > q.to) problems.push('from is after to (to is the last day, inclusive).');
  else if (daysBetween(q.from, q.to) + 1 > MAX_REPORT_DAYS) problems.push(`A report covers at most ${MAX_REPORT_DAYS} days.`);
  if (q.dateField && !d.dateFields.some((f) => f.key === q.dateField)) problems.push(`dateField for ${d.id} is one of: ${d.dateFields.map((f) => f.key).join(', ')}.`);
  for (const [i, f] of (q.filters ?? []).entries()) {
    if (!known(f.field, `filters[${i}]`)) continue;
    const t = fieldOf(d, f.field)!.type;
    const compare = ['gt', 'gte', 'lt', 'lte'].includes(f.op);
    const first = Array.isArray(f.value) ? f.value[0] : f.value;
    if (!(FILTER_OPS as readonly string[]).includes(f.op)) problems.push(`filters[${i}]: op is one of ${FILTER_OPS.join(', ')}.`);
    else if (f.op !== 'empty' && f.op !== 'not_empty' && (first === undefined || first === '')) problems.push(`filters[${i}]: give a value.`);
    else if (compare && t === 'text') problems.push(`filters[${i}]: ${f.field} is text: use eq, in or contains.`);
    else if (compare && isNumeric(t) && Number.isNaN(Number(first))) problems.push(`filters[${i}]: ${f.field} is a number.`);
  }
  for (const [i, g] of (q.groupBy ?? []).entries()) {
    if (!known(g.field, `groupBy[${i}]`)) continue;
    const t = fieldOf(d, g.field)!.type;
    if (g.by && t !== 'date' && t !== 'datetime') problems.push(`groupBy[${i}]: “by” is for date fields; ${g.field} isn’t one.`);
    if (g.by && !(DATE_BUCKETS as readonly string[]).includes(g.by)) problems.push(`groupBy[${i}]: by is one of ${DATE_BUCKETS.join(', ')}.`);
    if (isNumeric(t)) problems.push(`groupBy[${i}]: grouping by an amount (${g.field}) makes a row per value; group by a text or date field.`);
  }
  if ((q.groupBy?.length ?? 0) > 3) problems.push('Group by at most 3 fields.');
  for (const [i, m] of (q.metrics ?? []).entries()) {
    if (!(METRIC_FNS as readonly string[]).includes(m.fn)) {
      problems.push(`metrics[${i}]: fn is one of ${METRIC_FNS.join(', ')}.`);
      continue;
    }
    if (['sum', 'avg', 'min', 'max', 'ratio'].includes(m.fn)) {
      if (!m.field) problems.push(`metrics[${i}]: ${m.fn} needs a field.`);
      else if (known(m.field, `metrics[${i}]`) && !isNumeric(fieldOf(d, m.field)!.type) && m.fn !== 'min' && m.fn !== 'max') problems.push(`metrics[${i}]: ${m.fn} needs a number or money field; ${m.field} isn’t one.`);
    }
    if (m.fn === 'count_distinct' && (!m.field || !known(m.field, `metrics[${i}]`))) problems.push(`metrics[${i}]: count_distinct needs a field.`);
    if (m.fn === 'share' && m.field && known(m.field, `metrics[${i}]`) && !isNumeric(fieldOf(d, m.field)!.type)) problems.push(`metrics[${i}]: share needs a number or money field (or none, for the share of rows).`);
    if (m.fn === 'ratio' && (!m.per || !known(m.per, `metrics[${i}].per`))) problems.push(`metrics[${i}]: ratio needs per (sum of field ÷ sum of per).`);
    if (['occupancy', 'revpar', 'available'].includes(m.fn) && q.dataset !== 'nights') problems.push(`metrics[${i}]: ${m.fn} is for the nights dataset.`);
    if (m.fn === 'adr' && q.dataset !== 'nights' && q.dataset !== 'reservations') problems.push(`metrics[${i}]: adr is for the nights or reservations datasets.`);
  }
  if ((q.metrics?.length ?? 0) > 12) problems.push('At most 12 metrics.');
  if (q.columns?.length && !q.groupBy?.length && !q.metrics?.length) for (const c of q.columns) known(c, 'columns');
  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > MAX_QUERY_ROWS)) problems.push(`limit is a whole number from 1 to ${MAX_QUERY_ROWS}.`);
  return problems;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const utc = (d: ISODate) => Date.parse(`${d}T12:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a: ISODate, b: ISODate) => Math.round((utc(b) - utc(a)) / DAY_MS);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let t = utc(from), end = utc(to); t <= end && out.length <= MAX_REPORT_DAYS; t += DAY_MS) out.push(iso(t));
  return out;
}

/** A day's bucket: its value (shown and in the CSV) and a key that sorts it. */
export function bucketOf(day: string, by: DateBucket): { value: string; sort: string } {
  const d = day.slice(0, 10);
  switch (by) {
    case 'day':
      return { value: d, sort: d };
    case 'week': {
      const t = utc(d);
      const monday = iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS);
      return { value: monday, sort: monday };
    }
    case 'month':
      return { value: d.slice(0, 7), sort: d.slice(0, 7) };
    case 'quarter': {
      const q = `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
      return { value: q, sort: q };
    }
    case 'year':
      return { value: d.slice(0, 4), sort: d.slice(0, 4) };
    case 'weekday': {
      const i = (new Date(utc(d)).getUTCDay() + 6) % 7;
      return { value: WEEKDAYS[i], sort: String(i) };
    }
  }
}

const BUCKET_LABEL: Record<DateBucket, string> = { day: 'Day', week: 'Week of', month: 'Month', quarter: 'Quarter', year: 'Year', weekday: 'Weekday' };

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Same value, other words: "In house" is "Checked in". */
const SYNONYMS: Record<string, string> = { 'in house': 'checked in', inhouse: 'checked in', canceled: 'cancelled', noshow: 'no show', 'no shows': 'no show' };

/** Text compared ignoring case, accents, punctuation and spacing: "CHECKED_IN" is "Checked in". */
const norm = (v: unknown) => {
  const t = String(v ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
  return SYNONYMS[t] ?? t;
};

function matches(row: QueryRow, f: QueryFilter, type: FieldType): boolean {
  const raw = row[f.field];
  const empty = raw === null || raw === undefined || raw === '';
  if (f.op === 'empty') return empty;
  if (f.op === 'not_empty') return !empty;
  const values = Array.isArray(f.value) ? f.value : [f.value as string | number];
  if (isNumeric(type)) {
    if (empty) return f.op === 'ne' || f.op === 'not_in';
    const n = Number(raw);
    const nums = values.map(Number);
    switch (f.op) {
      case 'eq':
      case 'in':
        return nums.some((v) => Math.abs(v - n) < 0.0005);
      case 'ne':
      case 'not_in':
        return !nums.some((v) => Math.abs(v - n) < 0.0005);
      case 'gt':
        return n > nums[0];
      case 'gte':
        return n >= nums[0] - 0.0005;
      case 'lt':
        return n < nums[0];
      case 'lte':
        return n <= nums[0] + 0.0005;
      default:
        return String(raw).includes(String(values[0])) === (f.op === 'contains');
    }
  }
  if (type === 'date' || type === 'datetime') {
    const s = empty ? '' : String(raw);
    const day = type === 'datetime' ? s : s.slice(0, 10);
    const v = String(values[0] ?? '');
    switch (f.op) {
      case 'gt':
        return !empty && day.slice(0, v.length) > v;
      case 'gte':
        return !empty && day.slice(0, v.length) >= v;
      case 'lt':
        return !empty && day.slice(0, v.length) < v;
      case 'lte':
        return !empty && day.slice(0, v.length) <= v;
      default:
        break;
    }
  }
  const text = norm(raw);
  const wanted = values.map(norm);
  switch (f.op) {
    case 'eq':
    case 'in':
      return wanted.includes(text);
    case 'ne':
    case 'not_in':
      return !wanted.includes(text);
    case 'contains':
      return wanted.some((w) => text.includes(w));
    case 'not_contains':
      return !wanted.some((w) => text.includes(w));
    default:
      return false;
  }
}

/** The filters as given, plus the dataset's default (no cancelled stays in revenue) when status isn't filtered. */
function effectiveFilters(q: ReportQuery): QueryFilter[] {
  const d = DATASETS[q.dataset];
  const filters = [...(q.filters ?? [])];
  if (d.excludeStatuses?.length && !filters.some((f) => f.field === 'status')) filters.push({ field: 'status', op: 'not_in', value: d.excludeStatuses });
  return filters;
}

export function filterRows(rows: readonly QueryRow[], q: ReportQuery): QueryRow[] {
  const d = DATASETS[q.dataset];
  const filters = effectiveFilters(q);
  return rows.filter((r) => filters.every((f) => matches(r, f, fieldOf(d, f.field)?.type ?? 'text')));
}

// ---------------------------------------------------------------------------
// Shaping: a list, or groups with metrics
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' ? v : v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const sumOf = (rows: readonly QueryRow[], key: string) => rows.reduce((s, r) => s + (num(r[key]) ?? 0), 0);

export function metricKey(m: QueryMetric): string {
  if (m.fn === 'ratio') return `ratio_${m.field}_${m.per}`;
  return m.field && !['count', 'adr', 'occupancy', 'revpar', 'available'].includes(m.fn) ? `${m.fn}_${m.field}` : m.fn;
}

function metricColumn(d: DatasetDef, m: QueryMetric): ReportColumn {
  const f = m.field ? fieldOf(d, m.field) : undefined;
  const per = m.per ? fieldOf(d, m.per) : undefined;
  const label = (() => {
    if (m.label?.trim()) return m.label.trim().slice(0, 60);
    const name = f?.label ?? '';
    switch (m.fn) {
      case 'count':
        return d.noun;
      case 'count_distinct':
        return `${name} (distinct)`;
      case 'sum':
        return name;
      case 'avg':
        return `Average ${name.toLowerCase()}`;
      case 'min':
        return `Lowest ${name.toLowerCase()}`;
      case 'max':
        return `Highest ${name.toLowerCase()}`;
      case 'share':
        return f ? `Share of ${name.toLowerCase()}` : `Share of ${d.noun.toLowerCase()}`;
      case 'ratio':
        return `${name} per ${(per?.label ?? '').toLowerCase()}`;
      case 'adr':
        return 'ADR';
      case 'occupancy':
        return 'Occupancy';
      case 'revpar':
        return 'RevPAR';
      case 'available':
        return 'Room nights available';
    }
  })();
  const format: ReportColumn['format'] =
    m.fn === 'count' || m.fn === 'count_distinct' || m.fn === 'available'
      ? 'number'
      : m.fn === 'share' || m.fn === 'occupancy'
        ? 'percent'
        : m.fn === 'adr' || m.fn === 'revpar'
          ? 'money'
          : m.fn === 'ratio'
            ? f?.type === 'money'
              ? 'money'
              : 'number'
            : f?.type === 'money'
              ? 'money'
              : f?.type === 'date' || f?.type === 'datetime'
                ? f.type
                : 'number';
  return { key: metricKey(m), label, format };
}

/** Room inventory for occupancy: each room type's rooms (after the report's room type filter). */
export interface Inventory {
  roomTypes: { name: string; rooms: number }[];
}

interface GroupAcc {
  values: (string | null)[];
  sorts: string[];
  rows: QueryRow[];
}

function computeMetric(m: QueryMetric, rows: readonly QueryRow[], all: readonly QueryRow[], available: number): ReportCell {
  switch (m.fn) {
    case 'count':
      return rows.length;
    case 'count_distinct':
      return new Set(rows.map((r) => r[m.field!]).filter((v) => v !== null && v !== '')).size;
    case 'sum':
      return round2(sumOf(rows, m.field!));
    case 'avg': {
      const vals = rows.map((r) => num(r[m.field!])).filter((v): v is number => v !== null);
      return vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
    }
    case 'min':
    case 'max': {
      const vals = rows.map((r) => r[m.field!]).filter((v): v is string | number => v !== null && v !== '');
      if (!vals.length) return null;
      const sorted = [...vals].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
      return m.fn === 'min' ? sorted[0] : sorted[sorted.length - 1];
    }
    case 'share': {
      const whole = m.field ? sumOf(all, m.field) : all.length;
      const part = m.field ? sumOf(rows, m.field) : rows.length;
      return whole ? Math.round((part / whole) * 1000) / 10 : 0;
    }
    case 'ratio': {
      const per = sumOf(rows, m.per!);
      return per ? round2(sumOf(rows, m.field!) / per) : null;
    }
    case 'adr': {
      const sold = rows.length && 'roomNights' in rows[0] ? sumOf(rows, 'roomNights') : sumOf(rows, 'rooms');
      return sold ? round2(sumOf(rows, 'roomRevenue') / sold) : 0;
    }
    case 'occupancy':
      return available ? Math.round((sumOf(rows, 'rooms') / available) * 1000) / 10 : 0;
    case 'revpar':
      return available ? round2(sumOf(rows, 'roomRevenue') / available) : 0;
    case 'available':
      return available;
  }
}

export interface Shaped {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
  matched: number;
}

/**
 * Turn a dataset's rows (already limited to the query's date range by the server) into the report: filtered, then
 * either a list of the chosen columns, or one row per group with its metrics and a total row; sorted and limited.
 */
export function shapeReport(source: readonly QueryRow[], q: ReportQuery, inventory?: Inventory): Shaped {
  const d = DATASETS[q.dataset];
  const rows = filterRows(source, q);
  const groups = q.groupBy ?? [];
  const metrics = q.metrics?.length ? q.metrics : groups.length ? [{ fn: 'count' as const }] : [];

  if (!groups.length && !metrics.length) {
    const keys = (q.columns?.length ? q.columns : d.defaultColumns).filter((k) => fieldOf(d, k));
    const columns: ReportColumn[] = keys.map((k) => {
      const f = fieldOf(d, k)!;
      return { key: k, label: f.label, format: f.type };
    });
    const sorted = sortRows(rows, q.sort?.length ? q.sort : [{ key: rangeField(q) === 'stay' ? 'checkIn' : rangeField(q), dir: 'asc' }], (r, k) => r[k] ?? null);
    const out = sorted.slice(0, q.limit ?? MAX_QUERY_ROWS).map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])) as Record<string, ReportCell>);
    const totals: Record<string, ReportCell> = {};
    let any = false;
    for (const c of columns) {
      const f = fieldOf(d, c.key)!;
      if (f.type === 'money' || f.sums) {
        totals[c.key] = round2(sumOf(rows, c.key));
        any = true;
      } else totals[c.key] = null;
    }
    if (columns.length && totals[columns[0].key] === null) totals[columns[0].key] = `${rows.length} ${rows.length === 1 ? d.noun.toLowerCase().replace(/s$/, '') : d.noun.toLowerCase()}`;
    return { columns, rows: out, totals: any || rows.length ? totals : null, matched: rows.length };
  }

  // A group's column: the field's key, or field_bucket when the same field is grouped twice (by month and weekday).
  const groupKeys = groups.map((g) => (groups.filter((o) => o.field === g.field).length > 1 ? `${g.field}_${g.by ?? 'day'}` : g.field));
  // Group keys: a date field's bucket, or the field's value.
  const groupField = (g: QueryGroup) => {
    const f = fieldOf(d, g.field)!;
    // A moment (booked on, paid at) is grouped by its day on the hotel's clock.
    return f.type === 'datetime' && f.day ? f.day : g.field;
  };
  const keyOf = (r: QueryRow, g: QueryGroup) => {
    const v = r[groupField(g)];
    if (v === null || v === undefined || v === '') return { value: null, sort: '￿' };
    const f = fieldOf(d, groupField(g)) ?? fieldOf(d, g.field)!;
    if (f.type === 'date' || f.type === 'datetime') return bucketOf(String(v), g.by ?? 'day');
    return { value: String(v), sort: norm(v) };
  };
  const acc = new Map<string, GroupAcc>();
  const add = (values: (string | null)[], sorts: string[]) => {
    const k = JSON.stringify(values);
    let a = acc.get(k);
    if (!a) {
      a = { values, sorts, rows: [] };
      acc.set(k, a);
    }
    return a;
  };
  const days = eachDay(q.from, q.to);
  // One date grouping over the range's own date: every bucket shows, even with nothing in it.
  if (groups.length === 1) {
    const g = groups[0];
    const f = fieldOf(d, g.field)!;
    if (f.type === 'date' && g.field === rangeField(q)) for (const day of days) {
      const b = bucketOf(day, g.by ?? 'day');
      add([b.value], [b.sort]);
    }
  }
  // Every room type shows when grouping occupancy by room type alone.
  if (groups.length === 1 && groups[0].field === 'roomType' && inventory && q.dataset === 'nights') for (const rt of scopeTypes(inventory, q)) add([rt.name], [norm(rt.name)]);
  for (const r of rows) {
    const keys = groups.map((g) => keyOf(r, g));
    add(
      keys.map((k) => k.value),
      keys.map((k) => k.sort)
    ).rows.push(r);
  }

  const needsInventory = metrics.some((m) => m.fn === 'occupancy' || m.fn === 'revpar' || m.fn === 'available');
  const availableFor = (values: (string | null)[] | null) => {
    if (!needsInventory || !inventory) return 0;
    let types = scopeTypes(inventory, q);
    let groupDays = days;
    groups.forEach((g, i) => {
      if (!values) return;
      if (g.field === 'roomType') types = types.filter((t) => t.name === values[i]);
      if (g.field === 'date') groupDays = groupDays.filter((day) => bucketOf(day, g.by ?? 'day').value === values[i]);
    });
    return groupDays.length * types.reduce((s, t) => s + t.rooms, 0);
  };

  const groupColumns: ReportColumn[] = groups.map((g, i) => {
    const f = fieldOf(d, g.field)!;
    const date = f.type === 'date' || f.type === 'datetime';
    const by = g.by ?? 'day';
    return {
      key: groupKeys[i],
      label: date && by !== 'day' ? `${BUCKET_LABEL[by]}${by === 'week' ? '' : ` (${f.label.toLowerCase()})`}` : f.label,
      format: date && (by === 'day' || by === 'week') ? 'date' : 'text',
    };
  });
  const metricColumns = metrics.map((m) => metricColumn(d, m));
  const columns = [...groupColumns, ...metricColumns];

  const built = [...acc.values()].map((a) => {
    const row: Record<string, ReportCell> = {};
    groups.forEach((_g, i) => (row[groupKeys[i]] = a.values[i] ?? '(none)'));
    const available = availableFor(a.values);
    metrics.forEach((m, i) => (row[metricColumns[i].key] = computeMetric(m, a.rows, rows, available)));
    return { row, sorts: a.sorts };
  });
  const dateFirst = groups.length > 0 && ['date', 'datetime'].includes(fieldOf(d, groups[0].field)!.type);
  const sortSpec = q.sort?.length ? q.sort : dateFirst ? [] : metricColumns.length ? [{ key: metricColumns[0].key, dir: 'desc' as const }] : [];
  const ordered = sortSpec.length
    ? sortRows(built, sortSpec, (b, k) => {
        const gi = groups.findIndex((g, i) => groupKeys[i] === k || g.field === k);
        // Group columns sort by their bucket's order (weekdays Mon→Sun, months in time).
        return gi >= 0 ? b.sorts[gi] : (b.row[k] ?? null);
      })
    : [...built].sort((x, y) => x.sorts.join('\u0000').localeCompare(y.sorts.join('\u0000')));
  const limited = ordered.slice(0, q.limit ?? MAX_QUERY_ROWS).map((b) => b.row);

  // A total row when there are groups: every metric over all the matching rows (not a sum of the groups).
  let totals: Record<string, ReportCell> | null = null;
  if (groups.length) {
    totals = {};
    groups.forEach((_g, i) => (totals![groupKeys[i]] = i === 0 ? 'Total' : null));
    const available = availableFor(null);
    metrics.forEach((m, i) => (totals![metricColumns[i].key] = computeMetric(m, rows, rows, available)));
  }
  return { columns, rows: limited, totals, matched: rows.length };
}

function scopeTypes(inventory: Inventory, q: ReportQuery) {
  const filters = (q.filters ?? []).filter((f) => f.field === 'roomType');
  return inventory.roomTypes.filter((t) => filters.every((f) => matches({ roomType: t.name }, f, 'text')));
}

function sortRows<T>(rows: readonly T[], sort: readonly QuerySort[], get: (row: T, key: string) => ReportCell | string): T[] {
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const x = get(a, s.key);
      const y = get(b, s.key);
      const dir = s.dir === 'desc' ? -1 : 1;
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      if (c) return c * dir;
    }
    return 0;
  });
}

/** A title for the report when the query has none: "Charges by month", "Reservations". */
export function queryTitle(q: ReportQuery): string {
  if (q.title?.trim()) return q.title.trim().slice(0, 80);
  const d = DATASETS[q.dataset];
  const groups = (q.groupBy ?? []).map((g) => (g.by && g.by !== 'day' ? g.by : (fieldOf(d, g.field)?.label ?? g.field).toLowerCase()));
  return groups.length ? `${d.label} by ${groups.join(' and ')}` : d.label;
}

// ---------------------------------------------------------------------------
// In a URL (the agent's "open in Reports" and CSV links)
// ---------------------------------------------------------------------------

export function encodeQuery(q: ReportQuery): string {
  const bytes = new TextEncoder().encode(JSON.stringify(q));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeQuery(s: string): unknown {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** The datasets and their fields, compactly, for the model's tool description. */
export function describeDatasets(): string {
  return DATASET_IDS.map((id) => {
    const d = DATASETS[id];
    const fields = d.fields.map((f) => `${f.key} (${f.type}${f.about ? `: ${f.about}` : ''})`).join('; ');
    const dates = d.dateFields.map((f) => `${f.key} = ${f.about}`).join('; ');
    return `• ${id}: ${d.about} dateField: ${dates}.${d.excludeStatuses ? ` Leaves out status ${d.excludeStatuses.join('/')} unless you filter on status.` : ''} Fields: ${fields}.`;
  }).join('\n');
}
