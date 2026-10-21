/**
 * The folio: a booking's charges and payments, with what the guest still owes.
 *
 * Room and tax lines are derived from the booking (src/lib/folio.ts), so a
 * changed stay can't leave a stale line behind. Payments are the reservation's
 * Payment rows: online card payments and everything taken at the desk (card
 * reader, typed-in or OTA virtual card, cash, the hotel's own terminal, or
 * recorded another way), with their refunds. Security deposits are listed
 * apart: they are held against incidentals, not paid toward the stay, so they
 * never move the balance. This is the read-only account for the check-in
 * screen and the reservation page; money is taken through the desk payments
 * flow (server/payments/desk.ts). Check-out needs the balance at zero.
 */
import { prisma } from '@/lib/prisma';
import { cardBrandLabel } from '@/lib/card-authorization';
import { METHOD_LABEL, depositHeldCents, type PaymentMethod } from '@/lib/desk-payments';
import { folioTotals, stayLines, type FolioDeposit, type FolioLine, type FolioView } from '@/lib/folio';
import { fromCents, toCents } from '@/lib/payments';
import { requirePermission, type Actor } from '../authz';
import { diffDays, toISODate } from '../dates';
import { paymentLines } from '../payments/record';
import { getBookingForStaff } from './bookings';
import { personName, toBookingSummary, type BookingWithRelations } from './mappers';

// The shapes live in lib/folio so client components can use them without server code.
export type { FolioDeposit, FolioView } from '@/lib/folio';

const COLLECTED = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

const cardOf = (p: { cardBrand: string | null; cardLast4: string | null }) => (p.cardLast4 ? `${cardBrandLabel(p.cardBrand)} ending ${p.cardLast4}` : null);

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
  const payments = await prisma.payment.findMany({ where: { bookingId: { in: lines.map((l) => l.id) } }, orderBy: { createdAt: 'asc' } });
  const recorders = [...new Set(payments.map((p) => p.recordedById).filter((id): id is string => !!id))];
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
    reservation: shared ? { code: lines[0].code ?? summary.code, roomTypes: lines.length } : null,
    checkOutDue: summary.checkOutDue,
    settled: summary.checkOutDue <= 0.004,
  };
}

