/**
 * Front desk reports: reservation lists and night-by-night summaries for one
 * hotel, filtered by dates, room type, source, status and payment method.
 * The catalogue (columns, ready-made reports, CSV) is in src/lib/reports.ts.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { BookingStatus } from '@/lib/dto';
import { BOOKING_STATUS, paymentLabel } from '@/lib/status';
import {
  GROUP_LABEL,
  MAX_REPORT_DAYS,
  MAX_REPORT_ROWS,
  PAYMENT_METHOD_LABEL,
  SOURCE_LABEL,
  resolveColumns,
  sourceLabel,
  summarize,
  type ReportCell,
  type ReportPaymentMethod,
  type ReportResult,
  type ReportSpec,
} from '@/lib/reports';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { addDaysISO, atNoonUTC, dayBounds, diffDays, toISODate } from '../dates';
import { badRequest, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { hotelLocale, todayAt } from './hotels';
import { bookingInclude, personName, toBookingSummary } from './mappers';

const OCCUPYING: BookingStatus[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'];

// Card money taken online (Payment rows): on the booking itself, or on the lead line of a multi-room-type reservation.
const COLLECTED = { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } satisfies Prisma.PaymentWhereInput;
const PAID_ONLINE: Prisma.BookingWhereInput = {
  OR: [{ payments: { some: COLLECTED } }, { reservationLead: { payments: { some: COLLECTED } } }],
};

/** Midnight at the start of `day` on the hotel's clock, as an instant (for "booked on" ranges). */
export function zonedStartOfDay(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00.000Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

function validate(spec: ReportSpec): void {
  if (spec.from > spec.to) throw badRequest('The report’s start date is after its end date.');
  if (diffDays(spec.from, spec.to) + 1 > MAX_REPORT_DAYS) throw badRequest(`A report covers at most ${MAX_REPORT_DAYS} days.`);
}

function filters(spec: ReportSpec): Prisma.BookingWhereInput[] {
  const and: Prisma.BookingWhereInput[] = [];
  if (spec.roomTypes.length) and.push({ roomTypeId: { in: spec.roomTypes } });
  if (spec.sources.length) {
    // Bookings made before sources were recorded came from the website.
    and.push({ OR: [{ source: { in: spec.sources } }, ...(spec.sources.includes('WEB') ? [{ source: null }] : [])] });
  }
  const methods = new Set(spec.paymentMethods);
  if (methods.size === 1) and.push(methods.has('CARD_ONLINE') ? PAID_ONLINE : { NOT: PAID_ONLINE });
  return and;
}

function paymentMethodOf(b: { payments: unknown[]; reservationLead: { payments: unknown[] } | null }): ReportPaymentMethod {
  return b.payments.length || b.reservationLead?.payments.length ? 'CARD_ONLINE' : 'PAY_AT_PROPERTY';
}

async function reportOptions(propertyId: string): Promise<ReportResult['options']> {
  const [roomTypes, sources] = await Promise.all([
    prisma.roomType.findMany({ where: { propertyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.booking.findMany({ where: { propertyId, source: { not: null } }, distinct: ['source'], select: { source: true } }),
  ]);
  const seen = new Set<string>([...Object.keys(SOURCE_LABEL), ...sources.map((s) => s.source!).filter(Boolean)]);
  return { roomTypes, sources: [...seen] };
}

/** Run a report for one hotel. Needs `reports.view` and access to the hotel. */
export async function runReport(actor: Actor, propertyId: string, spec: ReportSpec): Promise<ReportResult> {
  requirePermission(actor, 'reports.view');
  assertPropertyAccess(actor, propertyId);
  validate(spec);
  const [property, locale, options] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } }),
    hotelLocale(propertyId),
    reportOptions(propertyId),
  ]);
  if (!property) throw notFound('Property');
  // A summary's first column is named for what it groups by ("Night", "Room type"…).
  const columns = resolveColumns(spec.kind, spec.columns).map((c) => (c.key === 'group' ? { ...c, label: GROUP_LABEL[spec.groupBy] } : c));
  const base = { spec: { ...spec, columns: columns.map((c) => c.key) }, property: { ...property, currency: locale.currency }, columns, generatedAt: new Date().toISOString(), options };
  return spec.kind === 'list'
    ? { ...base, ...(await listRows(propertyId, spec, locale.timezone)) }
    : { ...base, ...(await summaryRows(propertyId, spec)), truncated: false };
}

async function listRows(propertyId: string, spec: ReportSpec, timeZone: string) {
  const end = addDaysISO(spec.to, 1);
  let range: Prisma.BookingWhereInput;
  switch (spec.dateField) {
    case 'checkIn':
      range = { checkIn: { gte: dayBounds(spec.from).gte, lt: dayBounds(spec.to).lt } };
      break;
    case 'checkOut':
      range = { checkOut: { gte: dayBounds(spec.from).gte, lt: dayBounds(spec.to).lt } };
      break;
    case 'created':
      range = { createdAt: { gte: zonedStartOfDay(spec.from, timeZone), lt: zonedStartOfDay(end, timeZone) } };
      break;
    default: {
      const today = await todayAt(propertyId);
      range = {
        OR: [
          { checkIn: { lt: atNoonUTC(end) }, checkOut: { gt: atNoonUTC(spec.from) } },
          // A guest still checked in past their check-out date is still staying.
          ...(spec.from <= today ? [{ status: 'CHECKED_IN' as const, checkIn: { lt: atNoonUTC(end) } }] : []),
        ],
      };
    }
  }
  const where: Prisma.BookingWhereInput = {
    propertyId,
    AND: [range, ...filters(spec)],
    ...(spec.statuses.length ? { status: { in: spec.statuses } } : {}),
  };
  const orderBy: Prisma.BookingOrderByWithRelationInput[] =
    spec.dateField === 'checkOut' ? [{ checkOut: 'asc' }, { createdAt: 'asc' }] : spec.dateField === 'created' ? [{ createdAt: 'asc' }] : [{ checkIn: 'asc' }, { createdAt: 'asc' }];
  const found = await prisma.booking.findMany({ where, include: bookingInclude, orderBy, take: MAX_REPORT_ROWS + 1 });
  const truncated = found.length > MAX_REPORT_ROWS;
  const bookings = found.slice(0, MAX_REPORT_ROWS);

  const staffIds = [...new Set(bookings.map((b) => b.createdById).filter((id): id is string => !!id))];
  const staff = staffIds.length ? await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const names = new Map(staff.map((u) => [u.id, personName(u)]));

  const rows = bookings.map((b): Record<string, ReportCell> => {
    const s = toBookingSummary(b);
    const total = Number(b.totalPrice);
    const roomCharges = Number(b.subtotalPrice ?? b.totalPrice);
    const ended = s.status === 'CANCELLED' || s.status === 'NO_SHOW';
    // Marked paid at the desk (no online payment behind it): settled in full.
    const paid = s.paymentStatus === 'PAID' ? Math.max(s.amountPaid, total) : s.amountPaid;
    return {
      code: s.reservationCode && s.reservationCode !== s.code ? `${s.reservationCode} (${s.code})` : s.code,
      guest: s.guest.name,
      email: s.guest.email,
      phone: s.guest.phone,
      status: BOOKING_STATUS[s.status]?.label ?? s.status,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      nights: s.nights,
      guests: s.guests,
      rooms: s.rooms,
      roomType: s.roomType.name,
      room: s.room?.number ?? null,
      source: sourceLabel(b.source ?? 'WEB'),
      paymentMethod: PAYMENT_METHOD_LABEL[paymentMethodOf(b)],
      paymentStatus: paymentLabel(s.paymentStatus).label,
      roomRevenue: roomCharges,
      taxes: Math.round((total - roomCharges) * 100) / 100,
      total,
      paid,
      // Nothing is owed on a cancelled or no-show reservation (any refund is handled with the payment).
      balance: ended ? 0 : Math.max(0, Math.round((total - paid) * 100) / 100),
      bookedOn: b.createdAt.toISOString(),
      bookedBy: b.createdById ? (names.get(b.createdById) ?? null) : null,
      notes: s.notes,
    };
  });
  const totals: Record<string, ReportCell> = { code: `${rows.length} reservation${rows.length === 1 ? '' : 's'}` };
  for (const key of ['nights', 'guests', 'rooms', 'roomRevenue', 'taxes', 'total', 'paid', 'balance']) {
    totals[key] = Math.round(rows.reduce((sum, r) => sum + Number(r[key] ?? 0), 0) * 100) / 100;
  }
  return { rows, totals, truncated };
}

async function summaryRows(propertyId: string, spec: ReportSpec) {
  const end = addDaysISO(spec.to, 1);
  const statuses = spec.statuses.length ? spec.statuses : OCCUPYING;
  const [roomTypes, bookings] = await Promise.all([
    prisma.roomType.findMany({
      where: { propertyId, isActive: true, ...(spec.roomTypes.length ? { id: { in: spec.roomTypes } } : {}) },
      select: { id: true, name: true, totalRooms: true },
      orderBy: { name: 'asc' },
    }),
    prisma.booking.findMany({
      where: {
        propertyId,
        status: { in: statuses },
        // Stays with a night in the range, and departures on its first day.
        checkIn: { lt: atNoonUTC(end) },
        checkOut: { gte: atNoonUTC(spec.from) },
        AND: filters(spec),
      },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        rooms: true,
        totalPrice: true,
        subtotalPrice: true,
        roomTypeId: true,
        source: true,
        payments: { where: COLLECTED, select: { id: true }, take: 1 },
        reservationLead: { select: { payments: { where: COLLECTED, select: { id: true }, take: 1 } } },
      },
    }),
  ]);
  return summarize({
    from: spec.from,
    to: spec.to,
    groupBy: spec.groupBy,
    roomTypes,
    bookings: bookings.map((b) => ({
      id: b.id,
      checkIn: toISODate(b.checkIn),
      checkOut: toISODate(b.checkOut),
      rooms: b.rooms,
      roomCharges: Number(b.subtotalPrice ?? b.totalPrice),
      total: Number(b.totalPrice),
      roomTypeId: b.roomTypeId,
      source: b.source ?? 'WEB',
      paymentMethod: paymentMethodOf(b),
    })),
  });
}

/** CSV downloads take guest details off the system: each one goes in the hotel's activity log. */
export async function recordReportExport(ctx: OpContext, propertyId: string, title: string, result: ReportResult): Promise<void> {
  await recordAudit(ctx, propertyId, 'REPORT_EXPORTED', `Exported the ${title} report (${result.spec.from}${result.spec.to !== result.spec.from ? ` to ${result.spec.to}` : ''}, ${result.rows.length} rows)`, {
    report: { kind: result.spec.kind, from: result.spec.from, to: result.spec.to, columns: result.spec.columns },
  });
}
