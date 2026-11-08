/**
 * Custom reports: the rows behind a ReportQuery (src/lib/report-query.ts) for one hotel. Each dataset is read with the
 * query's date range, turned into flat rows, and shaped by the shared engine. Needs reports.view and access to the
 * hotel, like the ready-made reports.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toMinorUnits, currencyDigits } from '@/lib/currency';
import { METHOD_LABEL, KIND_LABEL, type PaymentMethod } from '@/lib/desk-payments';
import { MANUAL_CHARGE, stayModel } from '@/lib/folio';
import { cardBrandLabel } from '@/lib/card-authorization';
import { PAYMENT_METHOD_LABEL, sourceLabel } from '@/lib/reports';
import {
  MAX_QUERY_SOURCE_ROWS,
  checkQuery,
  eachDay,
  queryTitle,
  rangeField,
  shapeReport,
  type Inventory,
  type QueryResult,
  type QueryRow,
  type ReportQuery,
} from '@/lib/report-query';
import { paymentLabel } from '@/lib/status';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { addDaysISO, atNoonUTC, dayBounds, diffDays, toISODate } from '../dates';
import { badRequest, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { hotelLocale, todayAt } from './hotels';
import { bookingInclude, personName, toBookingSummary, type BookingWithRelations } from './mappers';
import { zonedStartOfDay } from './reports';

/** Reservations read for one report (rows beyond it are left out and the report says so). */
const MAX_BOOKINGS = 5_000;

const STATUS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

const PAYMENT_STATUS: Record<string, string> = {
  SUCCEEDED: 'Paid',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
  AUTHORIZED: 'Held on card',
};

/** The day a moment falls on at the hotel. */
function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Run a custom report for one hotel. */
export async function runQuery(actor: Actor, propertyId: string, raw: ReportQuery): Promise<QueryResult> {
  requirePermission(actor, 'reports.view');
  assertPropertyAccess(actor, propertyId);
  const query = normalize(raw);
  const problems = checkQuery(query);
  if (problems.length) throw badRequest(problems.join(' '));
  const [property, locale] = await Promise.all([prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } }), hotelLocale(propertyId)]);
  if (!property) throw notFound('Property');
  const { rows, truncated, inventory } = await sourceRows(propertyId, query, locale.timezone);
  const shaped = shapeReport(rows, query, inventory);
  return {
    query,
    title: queryTitle(query),
    property: { ...property, currency: locale.currency },
    ...shaped,
    truncated,
    generatedAt: new Date().toISOString(),
  };
}

/** A query as the model or a URL sent it, with lists where a single value was given and no empty parts. */
export function normalize(q: ReportQuery): ReportQuery {
  return {
    dataset: q.dataset,
    ...(q.title?.trim() ? { title: q.title.trim().slice(0, 80) } : {}),
    from: q.from,
    to: q.to,
    ...(q.dateField ? { dateField: q.dateField } : {}),
    ...(q.filters?.length
      ? { filters: q.filters.map((f) => ((f.op === 'in' || f.op === 'not_in') && !Array.isArray(f.value) && f.value !== undefined ? { ...f, value: [f.value] } : f)) }
      : {}),
    ...(q.groupBy?.length ? { groupBy: q.groupBy } : {}),
    ...(q.metrics?.length ? { metrics: q.metrics } : {}),
    ...(q.columns?.length ? { columns: q.columns } : {}),
    ...(q.sort?.length ? { sort: q.sort } : {}),
    ...(q.limit ? { limit: q.limit } : {}),
  };
}

async function sourceRows(propertyId: string, q: ReportQuery, timeZone: string): Promise<{ rows: QueryRow[]; truncated: boolean; inventory?: Inventory }> {
  switch (q.dataset) {
    case 'reservations': {
      const { bookings, truncated } = await bookingsFor(propertyId, q, timeZone);
      const names = await staffNames(bookings.map((b) => b.createdById));
      return { rows: bookings.map((b) => reservationRow(b, timeZone, names)), truncated };
    }
    case 'nights': {
      const [{ bookings, truncated }, roomTypes] = await Promise.all([
        bookingsFor(propertyId, { ...q, dateField: 'stay' }, timeZone),
        prisma.roomType.findMany({ where: { propertyId, isActive: true }, select: { name: true, totalRooms: true } }),
      ]);
      const days = new Set(eachDay(q.from, q.to));
      const rows: QueryRow[] = [];
      for (const b of bookings) {
        for (const r of nightRows(b)) if (days.has(String(r.date))) rows.push(r);
        if (rows.length > MAX_QUERY_SOURCE_ROWS) break;
      }
      return { rows: rows.slice(0, MAX_QUERY_SOURCE_ROWS), truncated: truncated || rows.length > MAX_QUERY_SOURCE_ROWS, inventory: { roomTypes: roomTypes.map((t) => ({ name: t.name, rooms: t.totalRooms })) } };
    }
    case 'charges': {
      const field = rangeField(q);
      const { bookings, truncated } = await bookingsFor(propertyId, { ...q, dateField: field === 'date' ? 'stay' : field }, timeZone, { allowances: true });
      const rows: QueryRow[] = [];
      for (const b of bookings) rows.push(...chargeRows(b, timeZone));
      const inRange = field === 'date' ? rows.filter((r) => String(r.date) >= q.from && String(r.date) <= q.to) : rows;
      return { rows: inRange.slice(0, MAX_QUERY_SOURCE_ROWS), truncated: truncated || inRange.length > MAX_QUERY_SOURCE_ROWS };
    }
    case 'payments':
      return paymentRows(propertyId, q, timeZone);
  }
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

const withAllowances = { ...bookingInclude, allowances: { where: { voidedAt: null }, select: { amount: true, reason: true, createdAt: true } } } satisfies Prisma.BookingInclude;
type BookingRow = BookingWithRelations | Prisma.BookingGetPayload<{ include: typeof withAllowances }>;

async function bookingsFor(propertyId: string, q: ReportQuery, timeZone: string, opts: { allowances?: boolean } = {}): Promise<{ bookings: BookingRow[]; truncated: boolean }> {
  const end = addDaysISO(q.to, 1);
  let range: Prisma.BookingWhereInput;
  switch (rangeField(q)) {
    case 'checkIn':
      range = { checkIn: { gte: dayBounds(q.from).gte, lt: dayBounds(q.to).lt } };
      break;
    case 'checkOut':
      range = { checkOut: { gte: dayBounds(q.from).gte, lt: dayBounds(q.to).lt } };
      break;
    case 'bookedOn':
      range = { createdAt: { gte: zonedStartOfDay(q.from, timeZone), lt: zonedStartOfDay(end, timeZone) } };
      break;
    default: {
      const today = await todayAt(propertyId);
      range = {
        OR: [
          { checkIn: { lt: atNoonUTC(end) }, checkOut: { gt: atNoonUTC(q.from) } },
          // A guest still checked in past their check-out date is still staying.
          ...(q.from <= today ? [{ status: 'CHECKED_IN' as const, checkIn: { lt: atNoonUTC(end) } }] : []),
        ],
      };
    }
  }
  const found = await prisma.booking.findMany({
    where: { propertyId, ...range },
    include: opts.allowances ? withAllowances : bookingInclude,
    orderBy: [{ checkIn: 'asc' }, { createdAt: 'asc' }],
    take: MAX_BOOKINGS + 1,
  });
  return { bookings: found.slice(0, MAX_BOOKINGS), truncated: found.length > MAX_BOOKINGS };
}

async function staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const staff = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(staff.map((u) => [u.id, personName(u)]));
}

const fromMinor = (minor: number, currency: string) => (minor === 0 ? 0 : minor / 10 ** currencyDigits(currency));

/** The stay's room, taxes and extras as the folio shows them (lib/folio stayModel), in minor units. */
function stayParts(b: BookingRow) {
  const nights = Math.max(1, diffDays(toISODate(b.checkIn), toISODate(b.checkOut)));
  const model = stayModel({
    totalPrice: Number(b.totalPrice),
    subtotalPrice: b.subtotalPrice === null ? null : Number(b.subtotalPrice),
    charges: b.charges,
    roomTypeName: b.roomType.name,
    roomLabel: b.folioRoomLabel,
    nights,
    rooms: b.rooms,
    currency: b.currency,
  });
  const extras = model.charges.filter((c) => c.kind === MANUAL_CHARGE);
  const taxes = model.charges.filter((c) => c.kind !== MANUAL_CHARGE);
  return { nights, model, extras, taxes, taxMinor: taxes.reduce((s, c) => s + c.minor, 0), extraMinor: extras.reduce((s, c) => s + c.minor, 0) };
}

const onlinePaid = (b: BookingRow) => [...b.payments, ...(b.reservationLead?.payments ?? [])].some((p) => p.method === 'ONLINE');

function stayBase(b: BookingRow) {
  const s = toBookingSummary(b as BookingWithRelations);
  return {
    s,
    base: {
      code: s.reservationCode && s.reservationCode !== s.code ? `${s.reservationCode} (${s.code})` : s.code,
      guest: s.guest.name,
      status: STATUS[s.status] ?? s.status,
      roomType: s.roomType.name,
      room: s.room?.number ?? null,
      source: sourceLabel(b.source ?? 'WEB'),
      paymentMethod: PAYMENT_METHOD_LABEL[onlinePaid(b) ? 'CARD_ONLINE' : 'PAY_AT_PROPERTY'],
    } satisfies QueryRow,
  };
}

function reservationRow(b: BookingRow, timeZone: string, staff: Map<string, string>): QueryRow {
  const { s, base } = stayBase(b);
  const { nights, model, extras, taxMinor, extraMinor } = stayParts(b);
  const total = Number(b.totalPrice);
  const ended = s.status === 'CANCELLED' || s.status === 'NO_SHOW';
  // Marked paid at the desk (no payment recorded behind it): settled in full.
  const paid = s.paymentStatus === 'PAID' ? Math.max(s.amountPaid, total - s.allowances) : s.amountPaid;
  const bookedDate = localDay(b.createdAt, timeZone);
  return {
    ...base,
    email: s.guest.email,
    phone: s.guest.phone,
    country: b.user.country ?? null,
    checkIn: s.checkIn,
    checkOut: s.checkOut,
    nights,
    guests: s.guests,
    rooms: s.rooms,
    roomNights: nights * s.rooms,
    paymentStatus: paymentLabel(s.paymentStatus).label,
    roomRevenue: fromMinor(model.roomMinor, b.currency),
    taxes: fromMinor(taxMinor, b.currency),
    extras: fromMinor(extraMinor, b.currency),
    extraCharges: extras.map((c) => c.name).join(', ') || null,
    total,
    allowances: s.allowances,
    paid: Math.round(paid * 100) / 100,
    // Nothing is owed on a cancelled or no-show reservation (any refund is handled with the payment).
    balance: ended ? 0 : Math.max(0, Math.round((total - s.allowances - paid) * 100) / 100),
    bookedOn: b.createdAt.toISOString(),
    bookedDate,
    bookedBy: b.createdById ? (staff.get(b.createdById) ?? null) : null,
    leadDays: Math.max(0, diffDays(bookedDate, s.checkIn)),
    notes: s.notes,
  };
}

/** One row per night of the stay, each with its share of the room and taxes (in minor units, so they add up). */
function nightRows(b: BookingRow): QueryRow[] {
  const { base } = stayBase(b);
  const { nights, model, taxMinor } = stayParts(b);
  const checkIn = toISODate(b.checkIn);
  const share = (minor: number, i: number) => Math.floor(minor / nights) + (i < minor % nights ? 1 : 0);
  return Array.from({ length: nights }, (_, i) => ({
    date: addDaysISO(checkIn, i),
    ...base,
    rooms: b.rooms,
    roomRevenue: fromMinor(share(model.roomMinor, i), b.currency),
    taxes: fromMinor(share(taxMinor, i), b.currency),
  }));
}

/** The folio's lines: the room, each tax and fee, each extra charge, and each allowance (negative). */
function chargeRows(b: BookingRow, timeZone: string): QueryRow[] {
  const { base } = stayBase(b);
  const { model } = stayParts(b);
  const checkIn = toISODate(b.checkIn);
  const checkOut = toISODate(b.checkOut);
  const stay = { code: base.code, guest: base.guest, status: base.status, roomType: base.roomType, room: base.room, source: base.source, checkIn, checkOut };
  const rows: QueryRow[] = [{ ...stay, date: checkIn, type: 'Room', name: model.roomLabel, amount: fromMinor(model.roomMinor, b.currency) }];
  for (const c of model.charges) {
    const extra = c.kind === MANUAL_CHARGE;
    rows.push({ ...stay, date: extra ? (c.date ?? checkIn) : checkIn, type: extra ? 'Extra charge' : 'Tax or fee', name: c.name, amount: fromMinor(c.minor, b.currency) });
  }
  for (const a of b.allowances as { amount: unknown; reason?: string; createdAt?: Date }[]) {
    rows.push({ ...stay, date: a.createdAt ? localDay(a.createdAt, timeZone) : checkIn, type: 'Allowance', name: a.reason ?? 'Allowance', amount: -fromMinor(toMinorUnits(Number(a.amount), b.currency), b.currency) });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

async function paymentRows(propertyId: string, q: ReportQuery, timeZone: string): Promise<{ rows: QueryRow[]; truncated: boolean }> {
  const gte = zonedStartOfDay(q.from, timeZone);
  const lt = zonedStartOfDay(addDaysISO(q.to, 1), timeZone);
  const found = await prisma.payment.findMany({
    where: {
      propertyId,
      status: { in: Object.keys(PAYMENT_STATUS) },
      OR: [{ paidAt: { gte, lt } }, { paidAt: null, createdAt: { gte, lt } }],
    },
    include: { booking: { select: { code: true, groupCode: true, user: { select: { firstName: true, lastName: true } } } } },
    orderBy: { createdAt: 'asc' },
    take: MAX_QUERY_SOURCE_ROWS + 1,
  });
  const staff = await staffNames(found.map((p) => p.recordedById));
  const rows = found.slice(0, MAX_QUERY_SOURCE_ROWS).map((p): QueryRow => {
    const at = p.paidAt ?? p.createdAt;
    const amount = p.status === 'AUTHORIZED' ? Number(p.amountAuthorized ?? p.amount) : Number(p.amount);
    const refunded = Number(p.amountRefunded);
    const code = p.booking.groupCode && p.booking.groupCode !== p.booking.code ? `${p.booking.groupCode} (${p.booking.code})` : (p.booking.code ?? '');
    return {
      date: localDay(at, timeZone),
      paidAt: at.toISOString(),
      code,
      guest: `${p.booking.user.firstName} ${p.booking.user.lastName}`.trim(),
      method: METHOD_LABEL[p.method as PaymentMethod] ?? p.method,
      kind: KIND_LABEL[p.kind] ?? p.kind,
      status: PAYMENT_STATUS[p.status] ?? p.status,
      amount,
      refunded,
      net: Math.round((amount - refunded) * 100) / 100,
      card: p.cardLast4 ? `${cardBrandLabel(p.cardBrand)} ending ${p.cardLast4}` : null,
      recordedBy: p.recordedById ? (staff.get(p.recordedById) ?? null) : null,
      note: p.note,
    };
  });
  return { rows, truncated: found.length > MAX_QUERY_SOURCE_ROWS };
}

/** CSV downloads take guest details off the system: each one goes in the hotel's activity log. */
export async function recordQueryExport(ctx: OpContext, propertyId: string, result: QueryResult): Promise<void> {
  const q = result.query;
  await recordAudit(ctx, propertyId, 'REPORT_EXPORTED', `Exported the ${result.title} report (${q.from}${q.to !== q.from ? ` to ${q.to}` : ''}, ${result.rows.length} rows)`, {
    report: { dataset: q.dataset, from: q.from, to: q.to, groupBy: q.groupBy, metrics: q.metrics, filters: q.filters },
  });
}
