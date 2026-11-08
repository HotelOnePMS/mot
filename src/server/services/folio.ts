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
import { currencyDigits, toMinorUnits } from '@/lib/currency';
import {
  MANUAL_CHARGE,
  RECORDED_PAYMENT_METHODS,
  chargesJson,
  folioTotals,
  stayLines,
  stayModel,
  type FolioDeposit,
  type FolioEdit,
  type FolioEditTarget,
  type FolioLine,
  type FolioView,
  type StayCharge,
} from '@/lib/folio';
import { fromCents, toCents } from '@/lib/payments';
import { money } from '@/lib/status';
import { Prisma } from '@prisma/client';
import { canAtProperty, requirePermission, requirePropertyPermission, type Actor } from '../authz';
import { diffDays, toISODate } from '../dates';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { paymentLines, refreshPaymentStatus } from '../payments/record';
import { recordAudit, type OpContext } from './audit';
import { getBookingForStaff } from './bookings';
import { owedAfterAllowances, personName, toBookingSummary, type BookingWithRelations } from './mappers';

// The shapes live in lib/folio so client components can use them without server code.
export type { FolioDeposit, FolioView } from '@/lib/folio';

const COLLECTED = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

const cardOf = (p: { cardBrand: string | null; cardLast4: string | null }) => (p.cardLast4 ? `${cardBrandLabel(p.cardBrand)} ending ${p.cardLast4}` : null);


/**
 * What the guest still owes for the stay (negative: owed back to them): the booking's balance, or for a room type of a
 * reservation paid together, the whole reservation's (a credit on one room type may be owed on another).
 */
export function stayBalance(b: BookingWithRelations): number {
  const s = toBookingSummary(b);
  return s.reservationBalance ?? s.balance;
}

/** Everything on a booking's folio. Front desk can see it (folio.view), unlike Stripe's payment details. */
export async function getFolio(actor: Actor, bookingId: string): Promise<FolioView> {
  requirePermission(actor, 'folio.view');
  const booking = await getBookingForStaff(actor, bookingId);
  return buildFolio(booking, { canEdit: await mayEdit(actor, booking) });
}

const closed = (b: { status: string }) => b.status === 'CANCELLED' || b.status === 'NO_SHOW';

/** folio.edit at this booking's hotel (owners, or a role the owner allowed), on a stay that isn't cancelled or a no-show. */
async function mayEdit(actor: Actor, b: BookingWithRelations): Promise<boolean> {
  return !closed(b) && (await canAtProperty(actor, 'folio.edit', b.propertyId));
}

/** The folio as this person sees it after a change. */
async function folioFor(actor: Actor, bookingId: string): Promise<FolioView> {
  const booking = await getBookingForStaff(actor, bookingId);
  return buildFolio(booking, { canEdit: await mayEdit(actor, booking) });
}

const stayInput = (b: Pick<BookingWithRelations, 'totalPrice' | 'subtotalPrice' | 'charges' | 'folioRoomLabel' | 'checkIn' | 'checkOut' | 'rooms' | 'currency'> & { roomType: { name: string } }) => ({
  totalPrice: Number(b.totalPrice),
  subtotalPrice: b.subtotalPrice === null ? null : Number(b.subtotalPrice),
  charges: b.charges,
  roomTypeName: b.roomType.name,
  roomLabel: b.folioRoomLabel,
  nights: Math.max(1, diffDays(toISODate(b.checkIn), toISODate(b.checkOut))),
  rooms: b.rooms,
  currency: b.currency,
});

export async function buildFolio(b: BookingWithRelations, opts: { canEdit?: boolean } = {}): Promise<FolioView> {
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

  const folio: FolioLine[] = stayLines(stayInput(b));
  for (const a of allowances) {
    folio.push({ key: `allow-${a.id}`, section: 'CHARGES', kind: 'ALLOWANCE', label: 'Allowance', detail: [a.reason, `by ${nameOf(a.createdById) ?? 'a manager'}`].join(' · '), amount: -Number(a.amount), at: a.createdAt.toISOString(), ref: `allowance:${a.id}` });
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
      folio.push({ key: `pay-${p.id}`, section: 'PAYMENTS', kind: 'PAYMENT', label, detail, amount: -Number(p.amount), at: (p.paidAt ?? p.createdAt).toISOString(), ref: `payment:${p.id}` });
      if (Number(p.amountRefunded) > 0) {
        folio.push({ key: `refund-${p.id}`, section: 'PAYMENTS', kind: 'REFUND', label: p.method === 'CASH' ? 'Cash handed back' : p.method === 'EXTERNAL_CARD' || p.method === 'OTHER' ? 'Given back' : 'Refunded to the card', detail: cardOf(p), amount: Number(p.amountRefunded), at: null, ref: `payment:${p.id}` });
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
  const canEdit = !!opts.canEdit;
  const edits: Record<string, FolioEditTarget> = {};
  if (canEdit) {
    const model = stayModel(stayInput(b));
    const left = owedAfterAllowances(b.totalPrice, allowances);
    edits.room = { type: 'room', label: model.roomLabel, defaultLabel: b.roomType.name, amount: minorToAmount(model.roomMinor, b.currency) };
    model.charges.forEach((c, i) => {
      edits[`charge:${i}`] = { type: 'charge', index: i, name: c.name, amount: minorToAmount(c.minor, b.currency), date: c.date, extra: c.kind === MANUAL_CHARGE };
    });
    for (const a of allowances) {
      edits[`allowance:${a.id}`] = { type: 'allowance', id: a.id, amount: Number(a.amount), reason: a.reason, max: fromCents(left + toCents(Number(a.amount))) };
    }
    // Payments listed one by one (a shared reservation's folio shows this room type's share instead), and deposits.
    for (const p of [...(shared ? [] : toward), ...depositRows]) {
      edits[`payment:${p.id}`] = {
        type: 'payment',
        id: p.id,
        deposit: p.kind === 'SECURITY_DEPOSIT',
        recorded: isRecorded(p),
        amount: Number(p.amount),
        amountRefunded: Number(p.amountRefunded),
        method: p.method,
        paidAt: (p.paidAt ?? p.createdAt).toISOString(),
        note: p.note,
      };
    }
  }
  return {
    bookingId: b.id,
    code: summary.code,
    currency: b.currency,
    status: b.status,
    lines: folio,
    totals,
    deposits,
    depositHeld: fromCents(held),
    reservation: shared ? { code: lines[0].code ?? summary.code, roomTypes: lines.length, balance: summary.reservationBalance ?? summary.balance } : null,
    checkOutDue: summary.checkOutDue,
    settled: summary.checkOutDue <= 0.004,
    allowances: allowances.map((a) => ({ id: a.id, amount: Number(a.amount), reason: a.reason, by: nameOf(a.createdById), at: a.createdAt.toISOString() })),
    maxAllowance: Math.max(0, roundMoney(fromCents(owedAfterAllowances(b.totalPrice, b.allowances)), b.currency)),
    canEdit,
    edits,
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
  return folioFor(op.actor, booking.id);
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
  return folioFor(op.actor, booking.id);
}

// ---------------------------------------------------------------------------
// Editing the folio (folio.edit): owners, and the roles an owner allowed at their hotel.
// ---------------------------------------------------------------------------

const minorToAmount = (minor: number, currency: string): number => (minor === 0 ? 0 : minor / 10 ** currencyDigits(currency));

/** A payment only recorded at the desk (no money moved through HotelOne or Stripe): everything about it can be changed. */
function isRecorded(p: { method: string; stripePaymentIntentId: string | null; stripeChargeId: string | null }): boolean {
  return !p.stripePaymentIntentId && !p.stripeChargeId && (RECORDED_PAYMENT_METHODS as readonly string[]).includes(p.method);
}

const MAX_AMOUNT = 1_000_000;
const cleanText = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

function text(value: string, what: string, max = 120, min = 1): string {
  const t = cleanText(value, max);
  if (t.length < min) throw badRequest(`Enter ${what}.`);
  if (containsCardNumber(t)) throw badRequest(CARD_NUMBER_REFUSED);
  return t;
}

/** A typed amount in the hotel's currency, in its minor unit. */
function amountMinor(value: number, currency: string, opts: { allowZero?: boolean } = {}): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) throw badRequest('Enter an amount between 0 and 1,000,000.');
  const minor = toMinorUnits(roundMoney(value, currency), currency);
  if (minor === 0 && !opts.allowZero) throw badRequest('Enter an amount above zero (remove the line instead).');
  return minor;
}

function isoDay(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw badRequest('Enter the date as YYYY-MM-DD.');
  return value;
}

const fmt = (minorOrAmount: number, currency: string) => money(minorOrAmount, { currency });

/**
 * Change anything on a booking's folio: the room line's description and amount, a tax or fee, extra charges (add,
 * change, remove), an allowance, or a payment (recorded ones fully; card payments' notes). Owners, or a role the owner
 * gave folio.edit at this hotel. The room and its charges are written back to the booking (subtotal = room, total =
 * room + charges), so balances, reports and check-out all follow. Every change goes in the activity log with what it
 * was before and after, and the optional reason.
 */
export async function editFolio(op: OpContext, bookingId: string, edit: FolioEdit): Promise<FolioView> {
  requirePermission(op.actor, 'folio.view');
  const booking = await getBookingForStaff(op.actor, bookingId);
  await requirePropertyPermission(op.actor, 'folio.edit', booking.propertyId);
  if (closed(booking)) throw badRequest('This reservation is closed. Reinstate it before changing its folio.');
  const reason = edit.reason ? text(edit.reason, 'a reason', 200) : undefined;
  const code = booking.code ?? booking.id;

  let change: { summary: string; before: unknown; after: unknown } | null = null;
  switch (edit.target) {
    case 'room':
    case 'charge':
    case 'addCharge':
    case 'removeCharge':
      change = await editStay(booking, edit);
      break;
    case 'allowance':
      change = await editAllowance(booking, edit);
      break;
    case 'payment':
    case 'removePayment':
      change = await editPayment(booking, edit);
      break;
    default:
      throw badRequest('Unknown folio change.');
  }
  if (change) {
    await refreshPaymentStatus(booking);
    await recordAudit(op, booking.propertyId, 'FOLIO_EDIT', `Folio of ${code}: ${change.summary}${reason ? ` (${reason})` : ''}`, {
      bookingId: booking.id,
      target: edit.target,
      before: change.before,
      after: change.after,
      ...(reason ? { reason } : {}),
    });
  }
  return folioFor(op.actor, booking.id);
}

type StayEdit = Extract<FolioEdit, { target: 'room' | 'charge' | 'addCharge' | 'removeCharge' }>;

/** Room and charges: re-read under a lock, check the line is still what the editor saw, write the booking's prices back. */
async function editStay(booking: BookingWithRelations, edit: StayEdit) {
  const { currency } = booking;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "bookings" WHERE "id" = ${booking.id} FOR UPDATE`;
    const b = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { roomType: { select: { name: true } } } });
    const model = stayModel(stayInput(b));
    const before = { roomLabel: model.roomLabel, room: minorToAmount(model.roomMinor, currency), charges: chargesJson(model.charges, currency) };
    let roomLabel = b.folioRoomLabel;
    let roomMinor = model.roomMinor;
    const charges: StayCharge[] = model.charges.map((c) => ({ ...c }));
    const stale = () => conflict('The folio changed since you opened it. Check it again and redo your change.');
    const sameAmount = (minor: number, shown: number) => Math.abs(minorToAmount(minor, currency) - shown) < 0.0005;
    let summary: string;

    if (edit.target === 'room') {
      if (edit.expected.label !== model.roomLabel || !sameAmount(model.roomMinor, edit.expected.amount)) throw stale();
      const parts: string[] = [];
      if (edit.label !== undefined) {
        const label = edit.label === null || !edit.label.trim() ? null : text(edit.label, 'a description');
        // Back to the room type's name: nothing stored.
        roomLabel = label === null || label === b.roomType.name ? null : label;
        if ((roomLabel ?? b.roomType.name) !== model.roomLabel) parts.push(`room line now “${roomLabel ?? b.roomType.name}” (was “${model.roomLabel}”)`);
      }
      if (edit.amount !== undefined) {
        roomMinor = amountMinor(edit.amount, currency, { allowZero: true });
        if (roomMinor !== model.roomMinor) parts.push(`room ${fmt(minorToAmount(roomMinor, currency), currency)} (was ${fmt(minorToAmount(model.roomMinor, currency), currency)})`);
      }
      if (!parts.length) return null;
      summary = parts.join(', ');
    } else if (edit.target === 'addCharge') {
      const name = text(edit.name, 'what the charge is for', 80);
      const minor = amountMinor(edit.amount, currency);
      if (charges.length >= 50) throw badRequest('This folio already has 50 charges.');
      charges.push({ name, minor, kind: MANUAL_CHARGE, rate: null, date: isoDay(edit.date) });
      summary = `added “${name}” ${fmt(minorToAmount(minor, currency), currency)}`;
    } else {
      const current = charges[edit.index];
      if (!current || current.name !== edit.expected.name || !sameAmount(current.minor, edit.expected.amount)) throw stale();
      if (edit.target === 'removeCharge') {
        charges.splice(edit.index, 1);
        summary = `removed “${current.name}” ${fmt(minorToAmount(current.minor, currency), currency)}`;
      } else {
        const parts: string[] = [];
        if (edit.name !== undefined) {
          const name = text(edit.name, 'a description', 80);
          if (name !== current.name) parts.push(`“${current.name}” renamed “${name}”`);
          current.name = name;
        }
        if (edit.amount !== undefined) {
          const minor = amountMinor(edit.amount, currency);
          if (minor !== current.minor) {
            parts.push(`“${current.name}” ${fmt(minorToAmount(minor, currency), currency)} (was ${fmt(minorToAmount(current.minor, currency), currency)})`);
            // A percentage tax changed by hand is now a fixed amount.
            current.rate = null;
          }
          current.minor = minor;
        }
        if (edit.date !== undefined) {
          const date = isoDay(edit.date);
          if (date !== current.date) parts.push(`“${current.name}” dated ${date ?? 'none'} (was ${current.date ?? 'none'})`);
          current.date = date;
        }
        if (!parts.length) return null;
        summary = parts.join(', ');
      }
    }

    const totalMinor = roomMinor + charges.reduce((s, c) => s + c.minor, 0);
    if (minorToAmount(totalMinor, currency) > MAX_AMOUNT) throw badRequest('The stay would cost more than 1,000,000.');
    await tx.booking.update({
      where: { id: b.id },
      data: {
        folioRoomLabel: roomLabel,
        subtotalPrice: minorToAmount(roomMinor, currency),
        totalPrice: minorToAmount(totalMinor, currency),
        charges: charges.length ? (chargesJson(charges, currency) as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    const after = { roomLabel: roomLabel ?? b.roomType.name, room: minorToAmount(roomMinor, currency), charges: chargesJson(charges, currency) };
    return { summary, before, after };
  });
}

/** An allowance's amount or reason. At most the stay's charges less the other allowances. */
async function editAllowance(booking: BookingWithRelations, edit: Extract<FolioEdit, { target: 'allowance' }>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "bookings" WHERE "id" = ${booking.id} FOR UPDATE`;
    const a = await tx.folioAllowance.findFirst({ where: { id: edit.id, bookingId: booking.id, voidedAt: null } });
    if (!a) throw notFound('Allowance');
    const b = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { totalPrice: true } });
    const data: { amount?: number; reason?: string } = {};
    const parts: string[] = [];
    if (edit.allowanceReason !== undefined) {
      const why = text(edit.allowanceReason, 'why the stay costs less', 200, 3);
      if (why !== a.reason) {
        data.reason = why;
        parts.push(`allowance reason “${why}” (was “${a.reason}”)`);
      }
    }
    if (edit.amount !== undefined) {
      const cents = toCents(roundMoney(edit.amount, booking.currency));
      if (!Number.isFinite(cents) || cents <= 0) throw badRequest('Enter the amount to take off (remove the allowance instead).');
      const others = await tx.folioAllowance.aggregate({ where: { bookingId: booking.id, voidedAt: null, id: { not: a.id } }, _sum: { amount: true } });
      const leftCents = toCents(Number(b.totalPrice)) - toCents(Number(others._sum.amount ?? 0));
      if (cents > leftCents) throw badRequest(`At most ${money(fromCents(Math.max(0, leftCents)), { currency: booking.currency })} can be taken off: what’s left of the stay’s charges.`);
      if (cents !== toCents(Number(a.amount))) {
        data.amount = fromCents(cents);
        parts.push(`allowance ${money(fromCents(cents), { currency: booking.currency })} (was ${money(Number(a.amount), { currency: booking.currency })})`);
      }
    }
    if (!parts.length) return null;
    await tx.folioAllowance.update({ where: { id: a.id }, data });
    return { summary: parts.join(', '), before: { amount: Number(a.amount), reason: a.reason }, after: { amount: data.amount ?? Number(a.amount), reason: data.reason ?? a.reason } };
  });
}

type PaymentEdit = Extract<FolioEdit, { target: 'payment' | 'removePayment' }>;

/**
 * A payment or deposit of the reservation. Recorded ones (cash, the hotel's own terminal, paid another way): amount,
 * what was handed back, method, date and note; removing one cancels it (kept on record). Card payments through Stripe
 * keep Stripe's amounts and dates (a refund goes through Refund): only their note can change here.
 */
async function editPayment(booking: BookingWithRelations, edit: PaymentEdit) {
  const lines = await paymentLines(booking);
  const p = await prisma.payment.findFirst({ where: { id: edit.id, bookingId: { in: lines.map((l) => l.id) } } });
  if (!p) throw notFound('Payment');
  const currency = booking.currency;
  const recorded = isRecorded(p);
  const label = `${METHOD_LABEL[p.method as PaymentMethod] ?? p.method} ${p.kind === 'SECURITY_DEPOSIT' ? 'deposit' : 'payment'} of ${money(Number(p.amount), { currency })}`;
  const before = { amount: Number(p.amount), amountRefunded: Number(p.amountRefunded), method: p.method, paidAt: (p.paidAt ?? p.createdAt).toISOString(), note: p.note, status: p.status };

  if (edit.target === 'removePayment') {
    if (!recorded) throw forbidden('Card payments go back through Refund, so the card is paid back too.');
    if (p.status === 'CANCELED') throw conflict('This payment was already removed.');
    const done = await prisma.payment.updateMany({ where: { id: p.id, status: p.status }, data: { status: 'CANCELED' } });
    if (!done.count) throw conflict('This payment changed since you opened the folio. Check it again.');
    return { summary: `removed the ${label}`, before, after: { ...before, status: 'CANCELED' } };
  }

  const data: Prisma.PaymentUpdateInput = {};
  const parts: string[] = [];
  if (edit.note !== undefined) {
    const note = edit.note === null || !edit.note.trim() ? null : text(edit.note, 'a note', 200);
    if (note !== p.note) {
      data.note = note;
      parts.push(note ? `note “${note}”` : 'note removed');
    }
  }
  const money_ = edit.amount !== undefined || edit.amountRefunded !== undefined || edit.method !== undefined || edit.paidAt !== undefined;
  if (money_ && !recorded) throw forbidden('A card payment’s amount and date are Stripe’s: refund it to change what was paid. Only its note can change here.');
  if (money_) {
    const amountCents = edit.amount !== undefined ? toCents(roundMoney(edit.amount, currency)) : toCents(Number(p.amount));
    if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > toCents(MAX_AMOUNT)) throw badRequest('Enter the amount paid (remove the payment instead of setting it to zero).');
    const refundedCents = edit.amountRefunded !== undefined ? toCents(roundMoney(edit.amountRefunded, currency)) : toCents(Number(p.amountRefunded));
    if (!Number.isFinite(refundedCents) || refundedCents < 0 || refundedCents > amountCents) throw badRequest('What was handed back can’t be more than what was paid.');
    if (p.kind === 'SECURITY_DEPOSIT' && p.settledAt && (amountCents !== toCents(Number(p.amount)) || refundedCents !== toCents(Number(p.amountRefunded)))) {
      throw badRequest('This deposit was already settled at check-out: its amounts can’t change.');
    }
    if (amountCents !== toCents(Number(p.amount))) {
      data.amount = fromCents(amountCents);
      parts.push(`amount ${money(fromCents(amountCents), { currency })} (was ${money(Number(p.amount), { currency })})`);
    }
    if (refundedCents !== toCents(Number(p.amountRefunded))) {
      data.amountRefunded = fromCents(refundedCents);
      parts.push(`handed back ${money(fromCents(refundedCents), { currency })} (was ${money(Number(p.amountRefunded), { currency })})`);
    }
    if (p.status !== 'CANCELED' && p.status !== 'FAILED' && p.status !== 'PENDING' && p.status !== 'AUTHORIZED') {
      data.status = refundedCents === 0 ? 'SUCCEEDED' : refundedCents >= amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }
    if (edit.method !== undefined && edit.method !== p.method) {
      if (!(RECORDED_PAYMENT_METHODS as readonly string[]).includes(edit.method)) throw badRequest('A recorded payment can be cash, the hotel’s own card terminal, or paid another way.');
      data.method = edit.method;
      if (edit.method !== 'CASH') data.cashTendered = null;
      parts.push(`method ${METHOD_LABEL[edit.method as PaymentMethod]} (was ${METHOD_LABEL[p.method as PaymentMethod] ?? p.method})`);
    }
    if (edit.paidAt !== undefined) {
      const at = new Date(edit.paidAt);
      if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 86_400_000) throw badRequest('Enter when it was paid (not in the future).');
      if (at.getTime() !== (p.paidAt ?? p.createdAt).getTime()) {
        data.paidAt = at;
        parts.push(`paid ${at.toISOString()} (was ${(p.paidAt ?? p.createdAt).toISOString()})`);
      }
    }
  }
  if (!parts.length) return null;
  const done = await prisma.payment.updateMany({ where: { id: p.id, updatedAt: p.updatedAt }, data: data as Prisma.PaymentUpdateManyMutationInput });
  if (!done.count) throw conflict('This payment changed since you opened the folio. Check it again.');
  const after = { ...before, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) };
  return { summary: `${label}: ${parts.join(', ')}`, before, after };
}
