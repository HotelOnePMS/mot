import { CHANNEL_NAMES } from '@/lib/channels/catalog';
/**
 * Front desk reports: the report catalogue shared by the API and the
 * Reports page. Pure definitions only (safe on client and server): which
 * columns exist, what each ready-made report starts from, and CSV output.
 *
 * Two kinds of report:
 * - list: one row per reservation line, picked by a date (stay, check-in,
 *   check-out or booked on) plus filters.
 * - summary: room nights, occupancy and revenue in the date range, grouped by
 *   night, room type, source or payment method.
 */
import type { BookingStatus, ISODate } from './dto';

export type ReportKind = 'list' | 'summary';
/** Which date of a reservation the range applies to (list reports). */
export type ReportDateField = 'stay' | 'checkIn' | 'checkOut' | 'created';
export type ReportGroupBy = 'date' | 'roomType' | 'source' | 'paymentMethod';
/** How a reservation is paid, as far as HotelOne records it today. */
export type ReportPaymentMethod = 'CARD_ONLINE' | 'PAY_AT_PROPERTY';

export const REPORT_STATUSES: BookingStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];
export const REPORT_PAYMENT_METHODS: ReportPaymentMethod[] = ['CARD_ONLINE', 'PAY_AT_PROPERTY'];
export const PAYMENT_METHOD_LABEL: Record<ReportPaymentMethod, string> = {
  CARD_ONLINE: 'Card (online)',
  PAY_AT_PROPERTY: 'At the property',
};

/** Where a booking came from (Booking.source). Older bookings without one are direct web bookings. */
export const SOURCE_LABEL: Record<string, string> = {
  WEB: 'Website',
  FRONT_DESK: 'Front desk',
  AGENT_API: 'AI assistant',
  VOICE: 'Phone (voice agent)',
  ...CHANNEL_NAMES,
};
export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export type ColumnFormat = 'text' | 'date' | 'datetime' | 'number' | 'money' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  format: ColumnFormat;
}

export const LIST_COLUMNS = [
  { key: 'code', label: 'Confirmation', format: 'text' },
  { key: 'guest', label: 'Guest', format: 'text' },
  { key: 'email', label: 'Email', format: 'text' },
  { key: 'phone', label: 'Phone', format: 'text' },
  { key: 'status', label: 'Status', format: 'text' },
  { key: 'checkIn', label: 'Check-in', format: 'date' },
  { key: 'checkOut', label: 'Check-out', format: 'date' },
  { key: 'nights', label: 'Nights', format: 'number' },
  { key: 'guests', label: 'Guests', format: 'number' },
  { key: 'rooms', label: 'Rooms', format: 'number' },
  { key: 'roomType', label: 'Room type', format: 'text' },
  { key: 'room', label: 'Room', format: 'text' },
  { key: 'source', label: 'Source', format: 'text' },
  { key: 'paymentMethod', label: 'Payment method', format: 'text' },
  { key: 'paymentStatus', label: 'Payment status', format: 'text' },
  { key: 'roomRevenue', label: 'Room charges', format: 'money' },
  { key: 'taxes', label: 'Taxes & fees', format: 'money' },
  { key: 'total', label: 'Total', format: 'money' },
  { key: 'paid', label: 'Paid', format: 'money' },
  { key: 'balance', label: 'Balance', format: 'money' },
  { key: 'bookedOn', label: 'Booked on', format: 'datetime' },
  { key: 'bookedBy', label: 'Booked by', format: 'text' },
  { key: 'notes', label: 'Notes', format: 'text' },
] as const satisfies readonly ReportColumn[];

export const SUMMARY_COLUMNS = [
  { key: 'group', label: 'Group', format: 'text' },
  { key: 'roomNights', label: 'Room nights sold', format: 'number' },
  { key: 'available', label: 'Room nights available', format: 'number' },
  { key: 'occupancy', label: 'Occupancy', format: 'percent' },
  { key: 'roomRevenue', label: 'Room revenue', format: 'money' },
  { key: 'taxes', label: 'Taxes & fees', format: 'money' },
  { key: 'totalRevenue', label: 'Total revenue', format: 'money' },
  { key: 'adr', label: 'ADR', format: 'money' },
  { key: 'revpar', label: 'RevPAR', format: 'money' },
  { key: 'arrivals', label: 'Arrivals', format: 'number' },
  { key: 'departures', label: 'Departures', format: 'number' },
  { key: 'reservations', label: 'Reservations', format: 'number' },
] as const satisfies readonly ReportColumn[];

export type ListColumnKey = (typeof LIST_COLUMNS)[number]['key'];
export type SummaryColumnKey = (typeof SUMMARY_COLUMNS)[number]['key'];

export const GROUP_LABEL: Record<ReportGroupBy, string> = {
  date: 'Night',
  roomType: 'Room type',
  source: 'Source',
  paymentMethod: 'Payment method',
};

export const DATE_FIELD_LABEL: Record<ReportDateField, string> = {
  stay: 'Staying',
  checkIn: 'Arriving',
  checkOut: 'Departing',
  created: 'Booked',
};

/** Everything that defines a report; the page keeps it in the URL query and saved reports. */
export interface ReportSpec {
  kind: ReportKind;
  from: ISODate;
  to: ISODate;
  dateField: ReportDateField;
  groupBy: ReportGroupBy;
  roomTypes: string[];
  sources: string[];
  statuses: BookingStatus[];
  paymentMethods: ReportPaymentMethod[];
  columns: string[];
}

export type ReportPresetId = 'arrivals' | 'departures' | 'inhouse' | 'cancellations' | 'occupancy' | 'revenue' | 'custom';

export interface ReportPreset {
  id: ReportPresetId;
  label: string;
  description: string;
  spec: Omit<ReportSpec, 'from' | 'to' | 'roomTypes' | 'sources'>;
  /** Range from today: [start offset, end offset] in days, inclusive. */
  range: [number, number];
}

const ACTIVE: BookingStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'];
const GUEST_COLUMNS = ['code', 'guest', 'roomType', 'room', 'checkIn', 'checkOut', 'nights', 'guests', 'status'];

export const REPORT_PRESETS: ReportPreset[] = [
  {
    id: 'arrivals',
    label: 'Arrivals',
    description: 'Guests due to arrive, with room and balance.',
    range: [0, 0],
    spec: { kind: 'list', dateField: 'checkIn', groupBy: 'date', statuses: ['PENDING', 'CONFIRMED', 'CHECKED_IN'], paymentMethods: [], columns: [...GUEST_COLUMNS, 'phone', 'paymentStatus', 'balance', 'notes'] },
  },
  {
    id: 'departures',
    label: 'Departures',
    description: 'Guests due to leave and what they still owe.',
    range: [0, 0],
    spec: { kind: 'list', dateField: 'checkOut', groupBy: 'date', statuses: ['CHECKED_IN', 'CHECKED_OUT'], paymentMethods: [], columns: [...GUEST_COLUMNS, 'total', 'paid', 'balance'] },
  },
  {
    id: 'inhouse',
    label: 'In house',
    description: 'Everyone checked in right now.',
    range: [0, 0],
    spec: { kind: 'list', dateField: 'stay', groupBy: 'date', statuses: ['CHECKED_IN'], paymentMethods: [], columns: [...GUEST_COLUMNS, 'phone', 'balance'] },
  },
  {
    id: 'cancellations',
    label: 'Cancellations & no-shows',
    description: 'Reservations cancelled or not shown, by arrival date.',
    range: [-7, 0],
    spec: { kind: 'list', dateField: 'checkIn', groupBy: 'date', statuses: ['CANCELLED', 'NO_SHOW'], paymentMethods: [], columns: ['code', 'guest', 'status', 'checkIn', 'checkOut', 'roomType', 'source', 'total', 'paid', 'bookedOn'] },
  },
  {
    id: 'occupancy',
    label: 'Occupancy',
    description: 'Rooms sold and occupancy for each night.',
    range: [0, 13],
    spec: { kind: 'summary', dateField: 'stay', groupBy: 'date', statuses: ACTIVE, paymentMethods: [], columns: ['group', 'roomNights', 'available', 'occupancy', 'arrivals', 'departures'] },
  },
  {
    id: 'revenue',
    label: 'Revenue',
    description: 'Room revenue, ADR and RevPAR for each night.',
    range: [-6, 0],
    spec: { kind: 'summary', dateField: 'stay', groupBy: 'date', statuses: ACTIVE, paymentMethods: [], columns: ['group', 'roomNights', 'occupancy', 'roomRevenue', 'taxes', 'totalRevenue', 'adr', 'revpar'] },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Pick the dates, filters and columns yourself.',
    range: [-6, 0],
    spec: { kind: 'list', dateField: 'stay', groupBy: 'date', statuses: [], paymentMethods: [], columns: ['code', 'guest', 'status', 'checkIn', 'checkOut', 'roomType', 'source', 'paymentMethod', 'total', 'balance'] },
  },
];

export const MAX_REPORT_DAYS = 366;
export const MAX_REPORT_ROWS = 5000;

export function columnsFor(kind: ReportKind): readonly ReportColumn[] {
  return kind === 'list' ? LIST_COLUMNS : SUMMARY_COLUMNS;
}

/** The requested columns that exist for this kind, in catalogue order; all of them when none are valid. */
export function resolveColumns(kind: ReportKind, requested: readonly string[]): ReportColumn[] {
  const all = columnsFor(kind);
  const picked = all.filter((c) => requested.includes(c.key));
  return picked.length ? picked : [...all];
}

export type ReportCell = string | number | null;

export interface ReportResult {
  spec: ReportSpec;
  property: { id: string; name: string; currency: string };
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Summary reports: the whole range. List reports: sums of the number and money columns. */
  totals: Record<string, ReportCell> | null;
  /** More rows matched than a report returns (MAX_REPORT_ROWS). */
  truncated: boolean;
  generatedAt: string;
  options: { roomTypes: { id: string; name: string }[]; sources: string[] };
}

/** RFC 4180 field: quoted when it holds a comma, quote or line break; formulas neutralised for spreadsheets. */
export function csvField(v: ReportCell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // A leading =, +, -, @ makes Excel and Sheets run the cell as a formula (CSV injection); numbers are safe.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The report as CSV, raw values (ISO dates, plain numbers) so spreadsheets can sort and sum them. */
export function toCsv(columns: readonly ReportColumn[], rows: readonly Record<string, ReportCell>[], totals?: Record<string, ReportCell> | null): string {
  const lines = [columns.map((c) => csvField(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvField(r[c.key] ?? null)).join(','));
  if (totals) lines.push(columns.map((c, i) => csvField(i === 0 && (totals[c.key] ?? null) === null ? 'Total' : (totals[c.key] ?? null))).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Report spec → query string for the API (and the page URL). */
export function specToQuery(spec: ReportSpec): Record<string, string> {
  const q: Record<string, string> = { kind: spec.kind, from: spec.from, to: spec.to };
  if (spec.kind === 'list') q.dateField = spec.dateField;
  else q.groupBy = spec.groupBy;
  if (spec.roomTypes.length) q.roomTypes = spec.roomTypes.join(',');
  if (spec.sources.length) q.sources = spec.sources.join(',');
  if (spec.statuses.length) q.statuses = spec.statuses.join(',');
  if (spec.paymentMethods.length) q.paymentMethods = spec.paymentMethods.join(',');
  if (spec.columns.length) q.columns = spec.columns.join(',');
  return q;
}

export function reportFileName(propertyName: string, title: string, from: ISODate, to: ISODate): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug(propertyName) || 'hotel'}-${slug(title) || 'report'}-${from}${to !== from ? `-to-${to}` : ''}.csv`;
}

/* ------------------------------------------------------------------ */
/* Summary arithmetic (pure, so it is unit-tested without a database). */
/* ------------------------------------------------------------------ */

export interface SummaryBooking {
  id: string;
  checkIn: ISODate;
  checkOut: ISODate;
  rooms: number;
  /** Room charges (before taxes and fees). */
  roomCharges: number;
  total: number;
  roomTypeId: string;
  source: string;
  paymentMethod: ReportPaymentMethod;
}

export interface SummaryInput {
  from: ISODate;
  /** Inclusive. */
  to: ISODate;
  groupBy: ReportGroupBy;
  bookings: readonly SummaryBooking[];
  /** Rooms of the room types in the report (after the room type filter). */
  roomTypes: readonly { id: string; name: string; totalRooms: number }[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function nextDay(day: ISODate): ISODate {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function daysInRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to && out.length <= MAX_REPORT_DAYS; d = nextDay(d)) out.push(d);
  return out;
}

interface Acc {
  key: string;
  label: string;
  roomNights: number;
  available: number;
  roomRevenue: number;
  taxes: number;
  arrivals: number;
  departures: number;
  ids: Set<string>;
}

function finish(a: Acc): Record<SummaryColumnKey, ReportCell> {
  return {
    group: a.label,
    roomNights: a.roomNights,
    available: a.available,
    occupancy: a.available ? Math.round((a.roomNights / a.available) * 1000) / 10 : 0,
    roomRevenue: round2(a.roomRevenue),
    taxes: round2(a.taxes),
    totalRevenue: round2(a.roomRevenue + a.taxes),
    adr: a.roomNights ? round2(a.roomRevenue / a.roomNights) : 0,
    revpar: a.available ? round2(a.roomRevenue / a.available) : 0,
    arrivals: a.arrivals,
    departures: a.departures,
    reservations: a.ids.size,
  };
}

/**
 * Room nights, occupancy and revenue for each night (or room type, source,
 * payment method) in [from, to]. Revenue is spread evenly over a stay's
 * nights; taxes and fees are kept apart from room revenue, ADR and RevPAR.
 * Rooms available: a room type's rooms × nights; for source and payment
 * method groups, the whole hotel's (so occupancy reads as share of rooms).
 */
export function summarize(input: SummaryInput): { rows: Record<SummaryColumnKey, ReportCell>[]; totals: Record<SummaryColumnKey, ReportCell> } {
  const days = daysInRange(input.from, input.to);
  const hotelRooms = input.roomTypes.reduce((s, r) => s + r.totalRooms, 0);
  const typeName = new Map(input.roomTypes.map((r) => [r.id, r.name]));
  const groups = new Map<string, Acc>();
  const acc = (key: string, label: string, available: number): Acc => {
    let a = groups.get(key);
    if (!a) {
      a = { key, label, roomNights: 0, available, roomRevenue: 0, taxes: 0, arrivals: 0, departures: 0, ids: new Set() };
      groups.set(key, a);
    }
    return a;
  };
  const groupOf = (b: SummaryBooking, day: ISODate): Acc => {
    switch (input.groupBy) {
      case 'date':
        return acc(day, day, hotelRooms);
      case 'roomType':
        return acc(b.roomTypeId, typeName.get(b.roomTypeId) ?? 'Other room type', (input.roomTypes.find((r) => r.id === b.roomTypeId)?.totalRooms ?? 0) * days.length);
      case 'source':
        return acc(b.source, sourceLabel(b.source), hotelRooms * days.length);
      case 'paymentMethod':
        return acc(b.paymentMethod, PAYMENT_METHOD_LABEL[b.paymentMethod], hotelRooms * days.length);
    }
  };
  // Every night (or room type) shows, even with nothing sold.
  if (input.groupBy === 'date') for (const d of days) acc(d, d, hotelRooms);
  if (input.groupBy === 'roomType') for (const r of input.roomTypes) acc(r.id, r.name, r.totalRooms * days.length);

  const total: Acc = { key: '', label: 'Total', roomNights: 0, available: hotelRooms * days.length, roomRevenue: 0, taxes: 0, arrivals: 0, departures: 0, ids: new Set() };
  for (const b of input.bookings) {
    const nights = Math.max(1, daysInRange(b.checkIn, b.checkOut).length - 1);
    const perNightRoom = b.roomCharges / nights;
    const perNightTax = (b.total - b.roomCharges) / nights;
    for (const day of days) {
      const staying = day >= b.checkIn && day < b.checkOut;
      const arriving = day === b.checkIn;
      const departing = day === b.checkOut;
      if (!staying && !departing) continue;
      for (const a of [groupOf(b, day), total]) {
        if (staying) {
          a.roomNights += b.rooms;
          a.roomRevenue += perNightRoom;
          a.taxes += perNightTax;
          a.ids.add(b.id);
        }
        if (arriving) a.arrivals += 1;
        if (departing) a.departures += 1;
      }
    }
  }
  const rows = [...groups.values()]
    .sort((x, y) => (input.groupBy === 'date' ? x.key.localeCompare(y.key) : y.roomRevenue - x.roomRevenue || x.label.localeCompare(y.label)))
    .map(finish);
  return { rows, totals: { ...finish(total), group: 'Total' } };
}
