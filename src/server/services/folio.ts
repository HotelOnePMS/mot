/**
 * The folio: a booking's charges and payments, with what the guest still owes.
 *
 * Room and tax lines are derived from the booking (src/lib/folio.ts), so a
 * changed stay can't leave a stale line behind. Payments are the reservation's
 * Payment rows: online card payments and everything taken at the desk (card
 * reader, typed-in or OTA virtual card, cash, the hotel's own terminal, or
 * recorded another way), with their refunds. Security deposits are listed
 * apart: they are held against incidentals, not paid toward the stay, so they
 * never move the balance. Allowances lower the charges: a manager takes an
 * amount off with a reason (service recovery, unused nights), and can remove
 * it again (it stays on record). Money is taken through the desk payments flow
 * (server/payments/desk.ts). Check-out needs the balance at zero, unless a
 * manager checks the guest out with it owing (bookings.ts).
 */
import { prisma } from '@/lib/prisma';
import { roundMoney } from '@/lib/currency';
import { cardBrandLabel } from '@/lib/card-authorization';
import { CARD_NUMBER_REFUSED, METHOD_LABEL, containsCardNumber, depositHeldCents, type PaymentMethod } from '@/lib/desk-payments';
import { folioTotals, stayLines, type FolioDeposit, type FolioLine, type FolioView } from '@/lib/folio';
import { fromCents, toCents } from '@/lib/payments';
import { money } from '@/lib/status';
import { requirePermission, type Actor } from '../authz';
import { diffDays, toISODate } from '../dates';
import { badRequest, conflict, notFound } from '../errors';
import { paymentLines, refreshPaymentStatus } from '../payments/record';
import { recordAudit, type OpContext } from './audit';
import { getBookingForStaff } from './bookings';
import { owedAfterAllowances, personName, toBookingSummary, type BookingWithRelations } from './mappers';

// The shapes live in lib/folio so client components can use them without server code.
export type { FolioDeposit, FolioView } from '@/lib/folio';

const COLLECTED = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

const cardOf = (p: { cardBrand: string | null; cardLast4: string | null }) => (p.cardLast4 ? `${cardBrandLabel(p.cardBrand)} ending ${p.cardLast4}` : null);

/** What a reservation of several room types still owes (signed), as the desk counts it: room types going ahead, after allowances. */
function reservationBalance(
  lines: { status: string; totalPrice: unknown; allowances: { amount: unknown }[] }[],
  toward: { amount: unknown; amountRefunded: unknown }[],
  currency: string,
): number {
  const active = lines.filter((l) => l.status !== 'CANCELLED' && l.status !== 'NO_SHOW');
  const owed = (active.length ? active : lines).reduce((s, l) => s + owedAfterAllowances(l.totalPrice, l.allowances), 0);
  const net = toward.reduce((s, p) => s + toCents(Number(p.amount)) - toCents(Number(p.amountRefunded)), 0);
  return roundMoney(fromCents(owed - net), currency);
}

/**
 * What the guest still owes for the stay (negative: owed back to them): the booking's balance, or for a room type of a
 * reservation paid together, the whole reservation's (a credit on one room type may be owed on another).
 */
export async function stayBalance(b: BookingWithRelations): Promise<number> {
  const lines = await paymentLines(b);
  if (lines.length < 2) return toBookingSummary(b).balance;
  const toward = await prisma.payment.findMany({
    where: { bookingId: { in: lines.map((l) => l.id) }, kind: { not: 'SECURITY_DEPOSIT' }, status: { in: COLLECTED } },
    select: { amount: true, amountRefunded: true },
  });
  return reservationBalance(lines, toward, b.currency);
}

/** Everything on a booking's folio. Front desk can see it (folio.view), unlike Stripe's payment details. */
export async function getFolio(actor: Actor, bookingId: string): Promise<FolioView> {
  requirePermission(actor, 'folio.view');
  const booking = await getBookingForStaff(actor, bookingId);
  return buildFolio(booking);
}

export async function buildFolio(b: BookingWithRelations): Promise<FolioView> {
  const summary = toBookingSummary(b);
  const lines = await paymentLines(b);
  const shared = lines.length > 1;
  // Payments and deposits sit on the reservation's lead line.
  const [payments, allowances, override] = await Promise.all([
    prisma.payment.findMany({ where: { bookingId: { in: lines.map((l) => l.id) } }, orderBy: { createdAt: 'asc' } }),
    // Allowances are this room type's own (each line is priced on its own).
    prisma.folioAllowance.findMany({ where: { bookingId: b.id, voidedAt: null }, orderBy: { createdAt: 'asc' } }),
    prisma.checkoutOverride.findUnique({ where: { bookingId: b.id } }),
  ]);
  const recorders = [
    ...new Set([...payments.map((p) => p.recordedById), ...allowances.map((a) => a.createdById), override?.approvedById].filter((id): id is string => !!id)),
  ];
  const staff = recorders.length ? await prisma.user.findMany({ where: { id: { in: recorders } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const nameOf = (id: string | null) => {
    const u = staff.find((x) => x.id === id);
    return u ? personName(u) : null;
  };

  const folio: FolioLine[] = stayLines({
    totalPrice: Number(b.totalPrice),
    subtotalPrice: b.subtotalPrice === null ? null : Number(b.subtotalPrice),
    charges: b.charges,
    roomTypeName: b.roomType.name,
    nights: Math.max(1, diffDays(toISODate(b.checkIn), toISODate(b.checkOut))),
    rooms: b.rooms,
    currency: b.currency,
  });
  for (const a of allowances) {
    folio.push({ key: `allow-${a.id}`, section: 'CHARGES', kind: 'ALLOWANCE', label: 'Allowance', detail: [a.reason, `by ${nameOf(a.createdById) ?? 'a manager'}`].join(' · '), amount: -Number(a.amount), at: a.createdAt.toISOString() });
  }
  // The stay was repriced below its allowances since: the part above the charges doesn't count (it costs nothing, never less).
  const beyondCents = allowances.reduce((s, a) => s + toCents(Number(a.amount)), 0) - toCents(Number(b.totalPrice));
  if (allowances.length && beyondCents > 0) {
    folio.push({ key: 'allow-beyond', section: 'CHARGES', kind: 'ALLOWANCE', label: 'Allowances above the charges', detail: 'Not counted: the stay now costs less than the allowances given', amount: fromCents(beyondCents), at: null });
  }
  const toward = payments.filter((p) => p.kind !== 'SECURITY_DEPOSIT' && COLLECTED.includes(p.status));
  if (shared) {
    // One set of payments for every room type: this line's share, as the balance counts it.
    if (summary.amountPaid > 0) folio.push({ key: 'share', section: 'PAYMENTS', kind: 'PAYMENT', label: 'Paid', detail: 'This room type’s share of the reservation’s payments', amount: -summary.amountPaid, at: toward[0]?.paidAt?.toISOString() ?? null });
  } else {
    for (const p of toward) {
      const method = METHOD_LABEL[p.method as PaymentMethod] ?? p.method;
      const label = p.method === 'ONLINE' ? (p.kind === 'DEPOSIT' ? 'Booking deposit paid online' : 'Paid online') : `Paid · ${method}`;
      const detail = [cardOf(p), p.note, p.method !== 'ONLINE' && p.recordedById ? `by ${nameOf(p.recordedById) ?? 'staff'}` : null].filter(Boolean).join(' · ') || null;
      folio.push({ key: `pay-${p.id}`, section: 'PAYMENTS', kind: 'PAYMENT', label, detail, amount: -Number(p.amount), at: (p.paidAt ?? p.createdAt).toISOString() });
      if (Number(p.amountRefunded) > 0) {
        folio.push({ key: `refund-${p.id}`, section: 'PAYMENTS', kind: 'REFUND', label: p.method === 'CASH' ? 'Cash handed back' : p.method === 'EXTERNAL_CARD' || p.method === 'OTHER' ? 'Given back' : 'Refunded to the card', detail: cardOf(p), amount: Number(p.amountRefunded), at: null });
      }
    }
  }

  const depositRows = payments.filter((p) => p.kind === 'SECURITY_DEPOSIT' && ['AUTHORIZED', 'CANCELED', ...COLLECTED].includes(p.status) && (p.status !== 'CANCELED' || p.settledAt !== null));
  const deposits: FolioDeposit[] = depositRows.map((p) => {
    const hold = p.status === 'AUTHORIZED' || (p.status === 'CANCELED' && p.amountAuthorized !== null);
    const amount = Number(p.amountAuthorized ?? p.amount);
    const kept = p.settledAt && COLLECTED.includes(p.status) ? Math.max(0, Number(p.amount) - Number(p.amountRefunded)) : 0;
    return {
      id: p.id,
      method: p.method,
      methodLabel: METHOD_LABEL[p.method as PaymentMethod] ?? p.method,
      state: p.status === 'CANCELED' ? 'RELEASED' : p.settledAt ? 'SETTLED' : 'HELD',
      hold,
      amount,
      kept,
      card: cardOf(p),
      at: p.createdAt.toISOString(),
      settledAt: p.settledAt?.toISOString() ?? null,
    };
  });
  const held = depositHeldCents(
    payments.map((p) => ({ kind: p.kind, status: p.status, settled: !!p.settledAt, amountCents: toCents(Number(p.amount)), authorizedCents: p.amountAuthorized === null ? null : toCents(Number(p.amountAuthorized)), refundedCents: toCents(Number(p.amountRefunded)) })),
  );
  const totals = folioTotals(folio, b.currency);
  return {
    bookingId: b.id,
    code: summary.code,
    currency: b.currency,
    status: b.status,
    lines: folio,
    totals,
    deposits,
    depositHeld: fromCents(held),
    reservation: shared ? { code: lines[0].code ?? summary.code, roomTypes: lines.length, balance: reservationBalance(lines, toward, b.currency) } : null,
    checkOutDue: summary.checkOutDue,
    settled: summary.checkOutDue <= 0.004,
    allowances: allowances.map((a) => ({ id: a.id, amount: Number(a.amount), reason: a.reason, by: nameOf(a.createdById), at: a.createdAt.toISOString() })),
    maxAllowance: Math.max(0, roundMoney(fromCents(owedAfterAllowances(b.totalPrice, b.allowances)), b.currency)),
    checkoutOverride: override ? { amount: Number(override.amount), reason: override.reason, by: nameOf(override.approvedById), at: override.createdAt.toISOString() } : null,
  };
}


/**
 * Lower what the stay costs: an allowance with a reason (service recovery, unused nights, a rate correction). Managers
 * only (folio.adjust). At most the stay's charges less the allowances already given; it lowers the balance and, when
 * that is now covered, marks the stay paid.
 */
export async function addAllowance(op: OpContext, bookingId: string, input: { amount: number; reason: string; id?: string }): Promise<FolioView> {
  requirePermission(op.actor, 'folio.adjust');
  const booking = await getBookingForStaff(op.actor, bookingId);
  if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') throw badRequest('This reservation is closed. Reinstate it before changing what it costs.');
  const reason = input.reason.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (reason.length < 3) throw badRequest('Say why the stay costs less (for example “air conditioning broken” or “left a night early”).');
  if (containsCardNumber(reason)) throw badRequest(CARD_NUMBER_REFUSED);
  // In the hotel's currency: whole yen, two decimals for dollars.
  const cents = toCents(roundMoney(input.amount, booking.currency));
  if (!Number.isFinite(cents) || cents <= 0) throw badRequest('Enter the amount to take off.');
  const added = await prisma.$transaction(async (tx) => {
    // One at a time per booking, so two allowances at once can't together take off more than the stay costs.
    await tx.$queryRaw`SELECT "id" FROM "bookings" WHERE "id" = ${booking.id} FOR UPDATE`;
    // Given with a fixed id (one per refund) and already there: the same request sent twice, nothing more to do.
    if (input.id && (await tx.folioAllowance.findUnique({ where: { id: input.id }, select: { id: true } }))) return false;
    const given = await tx.folioAllowance.aggregate({ where: { bookingId: booking.id, voidedAt: null }, _sum: { amount: true } });
    const leftCents = toCents(Number(booking.totalPrice)) - toCents(Number(given._sum.amount ?? 0));
    if (cents > leftCents) throw badRequest(`At most ${money(fromCents(Math.max(0, leftCents)), { currency: booking.currency })} can be taken off: what’s left of the stay’s charges.`);
    await tx.folioAllowance.create({ data: { ...(input.id ? { id: input.id } : {}), bookingId: booking.id, propertyId: booking.propertyId, amount: fromCents(cents), currency: booking.currency, reason, createdById: op.actor.userId } });
    return true;
  });
  if (added) {
    await refreshPaymentStatus(booking);
    await recordAudit(op, booking.propertyId, 'FOLIO_ALLOWANCE', `Allowance of ${money(fromCents(cents), { currency: booking.currency })} on ${booking.code ?? booking.id}: ${reason}`, { bookingId: booking.id });
  }
  return buildFolio(await getBookingForStaff(op.actor, booking.id));
}

/** Remove an allowance: the stay costs what it did before. It stays on record (who removed it, and when). */
export async function voidAllowance(op: OpContext, bookingId: string, allowanceId: string): Promise<FolioView> {
  requirePermission(op.actor, 'folio.adjust');
  const booking = await getBookingForStaff(op.actor, bookingId);
  if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') throw badRequest('This reservation is closed. Reinstate it before changing what it costs.');
  const allowance = await prisma.folioAllowance.findFirst({ where: { id: allowanceId, bookingId: booking.id } });
  if (!allowance) throw notFound('Allowance');
  const voided = await prisma.folioAllowance.updateMany({ where: { id: allowance.id, voidedAt: null }, data: { voidedAt: new Date(), voidedById: op.actor.userId } });
  if (!voided.count) throw conflict('This allowance was already removed.');
  await refreshPaymentStatus(booking);
  await recordAudit(op, booking.propertyId, 'FOLIO_ALLOWANCE_REMOVED', `Removed the allowance of ${money(Number(allowance.amount), { currency: booking.currency })} on ${booking.code ?? booking.id} (${allowance.reason})`, { bookingId: booking.id });
  return buildFolio(await getBookingForStaff(op.actor, booking.id));
}
