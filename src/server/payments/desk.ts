/**
 * Front desk payments: collecting the balance and the security deposit at
 * check-in (or any time during the stay), by card on a Stripe Terminal reader,
 * by card typed into Stripe's payment page (including an OTA's virtual card),
 * or in cash, recorded as a ledger entry.
 *
 * Card payments are direct charges on the hotel's connected account, like
 * online payments (checkout.ts): the hotel is the merchant and HotelOne never
 * sees a card number. A security deposit is a card hold (captured only for
 * what is owed at check-out) or a charge refunded at check-out: the hotel's
 * setting decides by default, and the desk can choose for each deposit.
 *
 * Every desk payment is a Payment row created before Stripe is called, so the
 * webhook (payment_intent.*, checkout.session.*) and the desk's own polling
 * (`refreshDeskPayment`) both land on it; either may arrive first, and both
 * are idempotent. For a reservation of several room types, payments are
 * recorded on the lead line, like the online payment.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { getStripe, isStripeConfigured, platformFeePercent } from '@/lib/stripe';
import { fromCents, platformFeeCents, toCents } from '@/lib/payments';
import {
  CARD_NUMBER_REFUSED,
  cashChangeCents,
  containsCardNumber,
  depositDueCents,
  depositHeldCents,
  depositSettlement,
  deskAmountProblem,
  KIND_LABEL,
  METHOD_LABEL,
  RECORDED_METHODS,
  type DeskKind,
  type DeskPaymentLike,
  type PaymentMethod,
  type SecurityDepositMode,
} from '@/lib/desk-payments';
import { assertPropertyAccess, can, requirePermission, type Actor } from '../authz';
import { virtualCardWindow, type OtaPaymentCard } from '../channels/cards';
import { CHANNEL_LABELS } from '../channels/types';
import { badRequest, conflict, DomainError, notFound } from '../errors';
import { recordAudit, type OpContext } from '../services/audit';
import { getBookingForStaff } from '../services/bookings';
import { todayAt } from '../services/hotels';
import { owedAfterAllowances, reservationAccount } from '../services/mappers';
import { CHECKOUT_SESSION_SECONDS } from './config';
import { paymentLines, planRefundShares, recordRefundShares, refreshPaymentStatus } from './record';

/** Test-mode keys get a simulated card reader and the "simulate tap" button. */
export function isStripeTestMode(): boolean {
  return /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '');
}

/** Holds on typed-in cards ask for extended authorization (up to 30 days for lodging) only where the platform has it (Stripe IC+ pricing). */
const extendedAuthOnline = () => process.env.STRIPE_EXTENDED_AUTHORIZATION === '1';

export interface DeskPaymentRow {
  id: string;
  method: string;
  methodLabel: string;
  kind: string;
  kindLabel: string;
  status: string;
  amount: number;
  amountAuthorized: number | null;
  amountRefunded: number;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
  cashTendered: number | null;
  captureBefore: string | null;
  settledAt: string | null;
  failureMessage: string | null;
  note: string | null;
  recordedBy: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface DeskReader {
  id: string;
  label: string;
  deviceType: string;
  status: string | null;
  simulated: boolean;
}

export interface DeskPaymentState {
  bookingId: string;
  code: string;
  currency: string;
  /** Reservation totals: every room type booked together, cancelled ones left out. */
  total: number;
  paid: number;
  balance: number;
  reservation: { code: string; roomTypes: number } | null;
  deposit: { mode: SecurityDepositMode; amount: number; held: number; due: number };
  payments: DeskPaymentRow[];
  /** Card payments need the hotel's Stripe account; cash always works. */
  card: { available: boolean; reason: string | null };
  readers: DeskReader[];
  /** The card an OTA sent with this booking, without its number. */
  otaCard: (OtaPaymentCard & { channel: string; chargeable: boolean; reason: string | null }) | null;
  testMode: boolean;
  canRefund: boolean;
}

const rowSelect = {
  id: true,
  method: true,
  kind: true,
  status: true,
  amount: true,
  amountAuthorized: true,
  amountRefunded: true,
  currency: true,
  cardBrand: true,
  cardLast4: true,
  cashTendered: true,
  captureBefore: true,
  settledAt: true,
  failureMessage: true,
  note: true,
  recordedById: true,
  paidAt: true,
  createdAt: true,
} as const;

type RowData = { [K in keyof typeof rowSelect]: unknown } & {
  id: string;
  method: string;
  kind: string;
  status: string;
  amount: unknown;
  amountAuthorized: unknown;
  amountRefunded: unknown;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
  cashTendered: unknown;
  captureBefore: Date | null;
  settledAt: Date | null;
  failureMessage: string | null;
  note: string | null;
  recordedById: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toRow(p: RowData, names: Map<string, string>): DeskPaymentRow {
  return {
    id: p.id,
    method: p.method,
    methodLabel: METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method,
    kind: p.kind,
    kindLabel: KIND_LABEL[p.kind] ?? p.kind,
    status: p.status,
    amount: Number(p.amount),
    amountAuthorized: num(p.amountAuthorized),
    amountRefunded: Number(p.amountRefunded),
    currency: p.currency.toUpperCase(),
    cardBrand: p.cardBrand,
    cardLast4: p.cardLast4,
    cashTendered: num(p.cashTendered),
    captureBefore: p.captureBefore?.toISOString() ?? null,
    settledAt: p.settledAt?.toISOString() ?? null,
    failureMessage: p.failureMessage,
    note: p.note,
    recordedBy: p.recordedById ? (names.get(p.recordedById) ?? null) : null,
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

const like = (p: { kind: string; status: string; amount: unknown; amountAuthorized: unknown; amountRefunded: unknown; settledAt: Date | null }): DeskPaymentLike => ({
  kind: p.kind,
  status: p.status,
  settled: !!p.settledAt,
  amountCents: toCents(Number(p.amount)),
  authorizedCents: p.amountAuthorized === null ? null : toCents(Number(p.amountAuthorized)),
  refundedCents: toCents(Number(p.amountRefunded)),
});

const PAID = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

/** The reservation a desk payment is for: its lines (lead first), the hotel, and what has been paid toward it. */
async function loadContext(actor: Actor, bookingId: string) {
  const booking = await getBookingForStaff(actor, bookingId);
  const lines = await paymentLines(booking);
  const lead = lines[0];
  const property = await prisma.property.findUniqueOrThrow({
    where: { id: booking.propertyId },
    select: {
      id: true,
      name: true,
      isDemo: true,
      currency: true,
      stripeAccountId: true,
      stripeChargesEnabled: true,
      securityDepositMode: true,
      securityDepositAmount: true,
      stripeTerminalLocationId: true,
    },
  });
  const payments = await prisma.payment.findMany({ where: { bookingId: { in: lines.map((l) => l.id) } }, orderBy: { createdAt: 'asc' } });
  const toward = payments.filter((p) => p.kind !== 'SECURITY_DEPOSIT' && PAID.includes(p.status));
  const grossCents = toward.reduce((s, p) => s + toCents(Number(p.amount)), 0);
  const refundedCents = toward.reduce((s, p) => s + toCents(Number(p.amountRefunded)), 0);
  // What the stay costs after allowances and what was paid toward it; for several room types, the reservation's account
  // (mappers.ts), where a cancelled room type keeps what it holds.
  const account =
    lines.length > 1
      ? reservationAccount({ paidCents: grossCents, refundedCents, lines })
      : { owedCents: owedAfterAllowances(lines[0].totalPrice, lines[0].allowances), paidCents: grossCents - refundedCents };
  const totalCents = account.owedCents;
  const paidCents = account.paidCents;
  return { booking, lines, lead, property, payments, totalCents, paidCents, balanceCents: Math.max(0, totalCents - paidCents) };
}

type Context = Awaited<ReturnType<typeof loadContext>>;

function cardUnavailable(property: Context['property']): string | null {
  if (!isStripeConfigured()) return 'Card payments aren’t enabled on this deployment yet. Take cash, or set up Stripe.';
  if (!property.stripeAccountId || !property.stripeChargesEnabled) return 'Connect the hotel’s Stripe account in Settings → Online payments to take cards at the desk.';
  return null;
}

const accountOpts = (property: { stripeAccountId: string | null }) => ({ stripeAccount: property.stripeAccountId! });

async function listReaders(property: Context['property']): Promise<DeskReader[]> {
  if (cardUnavailable(property) || !property.stripeTerminalLocationId) return [];
  try {
    const readers = await getStripe().terminal.readers.list({ location: property.stripeTerminalLocationId, limit: 50 }, accountOpts(property));
    return readers.data.map(toReader);
  } catch (e) {
    console.error('[payments] Could not list card readers:', e);
    return [];
  }
}

export function toReader(r: Stripe.Terminal.Reader): DeskReader {
  return { id: r.id, label: r.label || r.serial_number, deviceType: r.device_type, status: r.status ?? null, simulated: r.device_type.startsWith('simulated') || r.serial_number?.startsWith('SIMULATOR') };
}

async function otaCardFor(ctx: Context): Promise<DeskPaymentState['otaCard']> {
  const channel = await prisma.channelReservation.findFirst({
    where: { bookingId: { in: ctx.lines.map((l) => l.id) }, paymentCard: { not: { equals: null } } },
    select: { paymentCard: true, connection: { select: { channel: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  const card = channel?.paymentCard as OtaPaymentCard | null | undefined;
  if (!channel || !card) return null;
  const window = virtualCardWindow(card, await todayAt(ctx.property.id));
  return { ...card, channel: CHANNEL_LABELS[channel.connection.channel], chargeable: window.open, reason: window.reason };
}

async function staffNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
}

/** GET — the reservation's balance, security deposit, everything collected so far and how the desk can collect more. */
export async function getDeskPayments(actor: Actor, bookingId: string): Promise<DeskPaymentState> {
  requirePermission(actor, 'payments.collect');
  let ctx = await loadContext(actor, bookingId);
  // Card payments started in the last day that are still waiting (Stripe's page in another tab, a reader): catch up first.
  const waiting = ctx.payments.filter((p) => p.method !== 'CASH' && p.status === 'PENDING' && Date.now() - p.createdAt.getTime() < 24 * 3600_000);
  if (waiting.length) {
    for (const p of waiting) await syncFromStripe({ ...p, property: { id: ctx.property.id, stripeAccountId: ctx.property.stripeAccountId } });
    ctx = await loadContext(actor, bookingId);
  }
  const { property, payments, lines } = ctx;
  const mode = property.securityDepositMode as SecurityDepositMode;
  const depositCents = toCents(Number(property.securityDepositAmount));
  const likes = payments.map(like);
  const unavailable = cardUnavailable(property);
  const [readers, otaCard, names] = await Promise.all([listReaders(property), otaCardFor(ctx), staffNames(payments.map((p) => p.recordedById))]);
  return {
    bookingId: ctx.booking.id,
    code: ctx.lead.code ?? ctx.booking.code ?? ctx.booking.id,
    currency: ctx.booking.currency,
    total: fromCents(ctx.totalCents),
    paid: fromCents(ctx.paidCents),
    balance: fromCents(ctx.balanceCents),
    reservation: lines.length > 1 ? { code: ctx.lead.code ?? ctx.booking.id, roomTypes: lines.length } : null,
    deposit: { mode, amount: fromCents(depositCents), held: fromCents(depositHeldCents(likes)), due: fromCents(depositDueCents({ mode, amountCents: depositCents, payments: likes })) },
    // Abandoned attempts stay out of the list; failed ones show so staff know why.
    payments: payments.filter((p) => !(p.status === 'CANCELED' && !p.paidAt && p.kind !== 'SECURITY_DEPOSIT')).map((p) => toRow(p, names)).reverse(),
    card: { available: !unavailable, reason: unavailable },
    readers,
    otaCard,
    testMode: isStripeTestMode(),
    canRefund: can(actor, 'payments.refund'),
  };
}

function assertCanCollect(ctx: Context, kind: DeskKind, amountCents: number) {
  const problem = deskAmountProblem({ kind, amountCents, balanceCents: ctx.balanceCents, currency: ctx.booking.currency });
  if (problem) throw badRequest(problem);
  if (ctx.booking.status === 'CANCELLED' || ctx.booking.status === 'NO_SHOW') throw badRequest('This reservation is closed. Reinstate it before taking a payment.');
}

const money = (cents: number, currency: string) => `${fromCents(cents).toFixed(2)} ${currency.toUpperCase()}`;

/**
 * Whether a card deposit is a hold (authorized now, captured at check-out only for what is owed) or a charge
 * (refunded at check-out). The desk may choose per deposit; otherwise the hotel's setting decides, and a hotel
 * without a deposit policy gets the hold, which is kinder to the guest. A payment toward the stay is never a hold.
 */
function holdsDeposit(kind: DeskKind, mode: string, hold: boolean | undefined): boolean {
  if (kind !== 'SECURITY_DEPOSIT') return false;
  return hold ?? mode !== 'CHARGE';
}

/** What a desk card payment is, for the audit log and the Stripe description. */
const whatFor = (kind: DeskKind, hold: boolean) => (hold ? 'Security deposit hold' : KIND_LABEL[kind]);

async function historyNote(lines: Context['lines'], note: string) {
  await prisma.bookingStatusHistory.createMany({ data: lines.map((l) => ({ bookingId: l.id, status: l.status, notes: note })) });
}

/** POST — cash received at the desk: a ledger entry, nothing goes to Stripe. */
export async function recordCashPayment(op: OpContext, bookingId: string, input: { kind: DeskKind; amount: number; tendered?: number; note?: string }): Promise<DeskPaymentRow> {
  requirePermission(op.actor, 'payments.collect');
  const ctx = await loadContext(op.actor, bookingId);
  const amountCents = toCents(input.amount);
  assertCanCollect(ctx, input.kind, amountCents);
  const tenderedCents = input.tendered === undefined ? amountCents : toCents(input.tendered);
  const change = cashChangeCents(tenderedCents, amountCents);
  if (change === null) throw badRequest('The cash handed over is less than the amount. Enter what the guest gave you.');
  if (containsCardNumber(input.note)) throw badRequest(CARD_NUMBER_REFUSED);
  const currency = ctx.booking.currency;
  const payment = await prisma.payment.create({
    data: {
      bookingId: ctx.lead.id,
      propertyId: ctx.property.id,
      method: 'CASH',
      kind: input.kind,
      status: 'SUCCEEDED',
      amount: fromCents(amountCents),
      currency: currency.toLowerCase(),
      cashTendered: fromCents(tenderedCents),
      recordedById: op.actor.userId,
      note: input.note?.trim().slice(0, 200) || null,
      paidAt: new Date(),
    },
    select: rowSelect,
  });
  const label = input.kind === 'SECURITY_DEPOSIT' ? 'Security deposit' : 'Payment';
  const note = `${label} of ${money(amountCents, currency)} received in cash by ${op.actor.name}${change > 0 ? ` (change given ${money(change, currency)})` : ''}`;
  if (input.kind === 'PAYMENT') await refreshPaymentStatus(ctx.lead, note);
  else await historyNote(ctx.lines, note);
  await recordAudit(op, ctx.property.id, 'PAYMENT_CASH', `${note} · ${ctx.lead.code ?? ctx.booking.id}`, { bookingId: ctx.booking.id, paymentId: payment.id });
  return toRow(payment, new Map([[op.actor.userId, op.actor.name]]));
}

/**
 * Record money taken outside HotelOne: a card on the hotel's own terminal (last four digits and the approval code
 * as the terminal shows them), or another way (bank transfer, paid to the OTA, an invoice), with a note saying how.
 */
export async function recordExternalPayment(
  op: OpContext,
  bookingId: string,
  input: { kind: DeskKind; method: 'EXTERNAL_CARD' | 'OTHER'; amount: number; cardBrand?: string | null; cardLast4?: string | null; reference?: string | null; note?: string | null },
): Promise<DeskPaymentRow> {
  requirePermission(op.actor, 'payments.collect');
  const ctx = await loadContext(op.actor, bookingId);
  const amountCents = toCents(input.amount);
  assertCanCollect(ctx, input.kind, amountCents);
  const last4 = (input.cardLast4 ?? '').replace(/\D/g, '');
  if (input.method === 'EXTERNAL_CARD' && last4.length !== 4) throw badRequest('Enter the last four digits of the card the terminal charged.');
  const note = input.note?.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  if (input.method === 'OTHER' && (!note || note.length < 3)) throw badRequest('Say how it was paid (for example “bank transfer” or “paid to Expedia”).');
  if (containsCardNumber(note) || containsCardNumber(input.reference)) throw badRequest(CARD_NUMBER_REFUSED);
  const currency = ctx.booking.currency;
  const payment = await prisma.payment.create({
    data: {
      bookingId: ctx.lead.id,
      propertyId: ctx.property.id,
      method: input.method,
      kind: input.kind,
      status: 'SUCCEEDED',
      amount: fromCents(amountCents),
      currency: currency.toLowerCase(),
      cardBrand: input.method === 'EXTERNAL_CARD' ? input.cardBrand?.trim().toLowerCase() || null : null,
      cardLast4: input.method === 'EXTERNAL_CARD' ? last4 : null,
      // Kept where the card's details go; the terminal's approval code goes in the note with any text.
      note: [input.reference?.trim() ? `Approval ${input.reference.trim().slice(0, 40)}` : null, note].filter(Boolean).join(' · ') || null,
      recordedById: op.actor.userId,
      paidAt: new Date(),
    },
    select: rowSelect,
  });
  const label = input.kind === 'SECURITY_DEPOSIT' ? 'Security deposit' : 'Payment';
  const how = input.method === 'EXTERNAL_CARD' ? `on the hotel’s own terminal (card ending ${last4})` : `another way (${note})`;
  const text = `${label} of ${money(amountCents, currency)} taken ${how}, recorded by ${op.actor.name}`;
  if (input.kind === 'PAYMENT') await refreshPaymentStatus(ctx.lead);
  await recordAudit(op, ctx.property.id, input.method === 'EXTERNAL_CARD' ? 'PAYMENT_EXTERNAL_CARD' : 'PAYMENT_OTHER', `${text} · ${ctx.lead.code ?? ctx.booking.id}`, { bookingId: ctx.booking.id, paymentId: payment.id });
  return toRow(payment, new Map([[op.actor.userId, op.actor.name]]));
}

/** Loads a desk payment the actor may act on (their hotel's, on a reservation they can see). */
async function loadDeskPayment(actor: Actor, paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { property: { select: { id: true, stripeAccountId: true } } } });
  if (!payment) throw notFound('Payment');
  assertPropertyAccess(actor, payment.propertyId);
  return payment;
}

/**
 * POST — start a card payment on a card reader. The reader shows the amount
 * and the guest taps, inserts or swipes; the result arrives by webhook and by
 * the desk polling `refreshDeskPayment`.
 */
export async function startReaderPayment(op: OpContext, bookingId: string, input: { kind: DeskKind; amount: number; readerId: string; hold?: boolean }): Promise<DeskPaymentRow> {
  requirePermission(op.actor, 'payments.collect');
  const ctx = await loadContext(op.actor, bookingId);
  const amountCents = toCents(input.amount);
  assertCanCollect(ctx, input.kind, amountCents);
  const unavailable = cardUnavailable(ctx.property);
  if (unavailable) throw badRequest(unavailable);
  const stripe = getStripe();
  const opts = accountOpts(ctx.property);
  const reader = await stripe.terminal.readers.retrieve(input.readerId, {}, opts).catch(() => null);
  if (!reader || reader.deleted || reader.location !== ctx.property.stripeTerminalLocationId) throw badRequest('That card reader isn’t registered to this hotel. Add it in Settings → Online payments.');
  if (reader.action && reader.action.status === 'in_progress') throw conflict(`${reader.label || 'The reader'} is busy with another payment. Finish or cancel it first.`);

  const hold = holdsDeposit(input.kind, ctx.property.securityDepositMode, input.hold);
  const payment = await prisma.payment.create({
    data: { bookingId: ctx.lead.id, propertyId: ctx.property.id, method: 'TERMINAL', kind: input.kind, status: 'PENDING', amount: fromCents(amountCents), currency: ctx.booking.currency.toLowerCase(), terminalReaderId: reader.id, recordedById: op.actor.userId },
  });
  try {
    const fee = input.kind === 'PAYMENT' ? platformFeeCents(amountCents, platformFeePercent()) : 0;
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: ctx.booking.currency.toLowerCase(),
        payment_method_types: ['card_present'],
        capture_method: hold ? 'manual' : 'automatic',
        // Hotels may keep a card-present hold up to 30 days (lodging), and raise it if the stay grows.
        ...(hold ? { payment_method_options: { card_present: { request_extended_authorization: true, request_incremental_authorization_support: true } } } : {}),
        description: `${ctx.property.name} · ${whatFor(input.kind, hold)} · ${ctx.lead.code ?? ctx.booking.id}`,
        metadata: { deskPaymentId: payment.id, bookingId: ctx.lead.id, propertyId: ctx.property.id, kind: input.kind },
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      { ...opts, idempotencyKey: `desk-intent-${payment.id}` }
    );
    await prisma.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: intent.id } });
    await stripe.terminal.readers.processPaymentIntent(reader.id, { payment_intent: intent.id }, { ...opts, idempotencyKey: `desk-reader-${payment.id}` });
  } catch (e) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureMessage: stripeMessage(e).slice(0, 300) } });
    console.error('[payments] Card reader payment failed to start:', e);
    throw new DomainError(502, 'PAYMENT_UNAVAILABLE', `The card reader couldn’t start the payment: ${stripeMessage(e)}`);
  }
  await recordAudit(op, ctx.property.id, 'PAYMENT_TERMINAL', `Sent ${money(amountCents, ctx.booking.currency)} ${whatFor(input.kind, hold).toLowerCase()} to ${reader.label || reader.id} · ${ctx.lead.code ?? ctx.booking.id}`, { bookingId: ctx.booking.id, paymentId: payment.id });
  return refreshDeskPayment(op.actor, payment.id);
}

/**
 * POST — open Stripe's payment page for a card the desk types in: a card the
 * guest reads out or hands over, or the OTA's virtual card copied from the
 * extranet. The card goes straight to Stripe.
 */
export async function startCardEntry(op: OpContext, bookingId: string, input: { kind: DeskKind; amount: number; virtualCard?: boolean; hold?: boolean; siteUrl: string }): Promise<DeskPaymentRow & { url: string }> {
  requirePermission(op.actor, 'payments.collect');
  const ctx = await loadContext(op.actor, bookingId);
  const amountCents = toCents(input.amount);
  assertCanCollect(ctx, input.kind, amountCents);
  const unavailable = cardUnavailable(ctx.property);
  if (unavailable) throw badRequest(unavailable);
  let otaCard: DeskPaymentState['otaCard'] = null;
  if (input.virtualCard) {
    otaCard = await otaCardFor(ctx);
    if (!otaCard) throw badRequest('No card came with this booking from the OTA.');
    if (!otaCard.chargeable) throw badRequest(otaCard.reason ?? 'This virtual card can’t be charged today.');
    if (otaCard.balance !== null && amountCents > toCents(otaCard.balance)) throw badRequest(`The virtual card’s balance is ${otaCard.balance.toFixed(2)} ${otaCard.currency ?? ctx.booking.currency}. Charge at most that.`);
  }
  const hold = holdsDeposit(input.kind, ctx.property.securityDepositMode, input.hold);
  const method = input.virtualCard ? 'VIRTUAL_CARD' : 'CARD_ENTRY';
  const payment = await prisma.payment.create({
    data: { bookingId: ctx.lead.id, propertyId: ctx.property.id, method, kind: input.kind, status: 'PENDING', amount: fromCents(amountCents), currency: ctx.booking.currency.toLowerCase(), recordedById: op.actor.userId },
  });
  // Whoever paid (staff in a new tab, or the guest on their phone from the QR code) lands on a page without booking details;
  // the desk's own screen follows the payment by polling and the webhook.
  const done = `${input.siteUrl}/pay/done?for=${input.kind === 'PAYMENT' ? 'payment' : hold ? 'hold' : 'deposit'}`;
  const metadata = { deskPaymentId: payment.id, bookingId: ctx.lead.id, propertyId: ctx.property.id, kind: input.kind };
  const fee = input.kind === 'PAYMENT' ? platformFeeCents(amountCents, platformFeePercent()) : 0;
  // The guest may pay on their own phone: say what a deposit is.
  const depositNote = input.kind !== 'SECURITY_DEPOSIT' ? '' : hold ? ' · Held on the card and released at check-out; only what’s owed is charged' : ' · Refunded at check-out';
  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        client_reference_id: payment.id,
        line_items: [
          {
            price_data: {
              currency: ctx.booking.currency.toLowerCase(),
              product_data: {
                name: `${KIND_LABEL[input.kind]} at ${ctx.property.name}`,
                description: `Reservation ${ctx.lead.code ?? ctx.booking.id}${otaCard ? ` · ${otaCard.channel} virtual card${otaCard.last4 ? ` ending ${otaCard.last4}` : ''}` : ''}${depositNote}`,
              },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        payment_method_options: {
          card: {
            // 3D Secure is requested on every guest card, as online; the guest answers any bank challenge on the desk screen or their phone.
            // An OTA's virtual card has no cardholder to answer one, so its bank decides.
            request_three_d_secure: input.virtualCard ? 'automatic' : 'any',
            ...(hold && extendedAuthOnline() ? { request_extended_authorization: 'if_available' as const } : {}),
          },
        },
        payment_intent_data: {
          capture_method: hold ? 'manual' : 'automatic',
          description: `${ctx.property.name} · ${whatFor(input.kind, hold)} · ${ctx.lead.code ?? ctx.booking.id}${otaCard ? ` · ${otaCard.channel} virtual card` : ''}`,
          metadata,
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
        },
        metadata,
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_SECONDS,
        success_url: done,
        cancel_url: `${input.siteUrl}/pay/done?cancelled=1`,
      },
      { ...accountOpts(ctx.property), idempotencyKey: `desk-checkout-${payment.id}` }
    );
  } catch (e) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureMessage: stripeMessage(e).slice(0, 300) } });
    throw new DomainError(502, 'PAYMENT_UNAVAILABLE', `Stripe’s payment page couldn’t be opened: ${stripeMessage(e)}`);
  }
  const row = await prisma.payment.update({ where: { id: payment.id }, data: { stripeCheckoutSessionId: session.id }, select: rowSelect });
  await recordAudit(op, ctx.property.id, method === 'VIRTUAL_CARD' ? 'PAYMENT_VIRTUAL_CARD' : 'PAYMENT_CARD_ENTRY', `Opened Stripe’s page for ${money(amountCents, ctx.booking.currency)} ${whatFor(input.kind, hold).toLowerCase()}${otaCard ? ` on the ${otaCard.channel} virtual card` : ''} · ${ctx.lead.code ?? ctx.booking.id}`, { bookingId: ctx.booking.id, paymentId: payment.id });
  return { ...toRow(row, new Map([[op.actor.userId, op.actor.name]])), url: session.url! };
}

function stripeMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function chargeDetails(charge: Stripe.Charge | null) {
  const details = charge?.payment_method_details;
  const card = details?.card_present ?? details?.card ?? null;
  const captureBefore = details?.card_present?.capture_before ?? details?.card?.capture_before ?? null;
  return {
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    cardCountry: card?.country ?? null,
    cardholderName: charge?.billing_details?.name || (details?.card_present?.cardholder_name ?? null),
    billingEmail: charge?.billing_details?.email || null,
    billingCountry: charge?.billing_details?.address?.country || null,
    threeDSecure: details?.card ? (details.card.three_d_secure?.result ?? 'not_attempted') : null,
    riskLevel: charge?.outcome?.risk_level || null,
    riskScore: typeof charge?.outcome?.risk_score === 'number' ? charge.outcome.risk_score : null,
    stripeChargeId: charge?.id ?? null,
    captureBefore: captureBefore ? new Date(captureBefore * 1000) : null,
    applicationFee: charge?.application_fee_amount != null ? fromCents(charge.application_fee_amount) : null,
  };
}

/**
 * Write what Stripe says about a desk payment's PaymentIntent onto its row,
 * and onto the reservation when money arrived. Safe to call any number of
 * times, from the webhook or from the desk's polling, in any order.
 */
export async function applyDeskIntent(paymentId: string, intent: Stripe.PaymentIntent, account: string | null): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { property: { select: { stripeAccountId: true } } } });
  if (!payment) return;
  // A hotel's payments arrive on its own account; ignore an event that names someone else's payment.
  if (account && payment.property.stripeAccountId !== account) {
    console.error(`[payments] Ignoring ${intent.id}: account ${account} does not own desk payment ${payment.id}`);
    return;
  }
  if (payment.stripePaymentIntentId && payment.stripePaymentIntentId !== intent.id) return;
  const charge = typeof intent.latest_charge === 'object' && intent.latest_charge ? intent.latest_charge : null;
  const details = chargeDetails(charge);
  const base = { stripePaymentIntentId: intent.id, ...Object.fromEntries(Object.entries(details).filter(([, v]) => v !== null)) };

  let next: { status: string; data: Record<string, unknown> } | null = null;
  switch (intent.status) {
    case 'succeeded': {
      const received = intent.amount_received || intent.amount;
      const refunded = charge?.amount_refunded ?? toCents(Number(payment.amountRefunded));
      const status = refunded >= received && refunded > 0 ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : 'SUCCEEDED';
      next = {
        status,
        data: {
          amount: fromCents(received),
          amountRefunded: fromCents(Math.min(refunded, received)),
          // A captured hold: keep what was authorized for the record.
          ...(intent.capture_method === 'manual' ? { amountAuthorized: payment.amountAuthorized ?? fromCents(intent.amount) } : {}),
          paidAt: payment.paidAt ?? new Date(),
          failureMessage: null,
        },
      };
      break;
    }
    case 'requires_capture':
      next = { status: 'AUTHORIZED', data: { amountAuthorized: fromCents(intent.amount_capturable || intent.amount), amount: fromCents(intent.amount_capturable || intent.amount), paidAt: payment.paidAt ?? new Date(), failureMessage: null } };
      break;
    case 'canceled':
      // A released hold is settled; an attempt that never went through is just over.
      next = payment.status === 'AUTHORIZED' || payment.amountAuthorized !== null
        ? { status: 'CANCELED', data: { amount: 0, settledAt: payment.settledAt ?? new Date() } }
        : { status: payment.status === 'FAILED' ? 'FAILED' : 'CANCELED', data: {} };
      break;
    case 'requires_payment_method':
      // Declined on the reader (the guest can try another card) or never presented.
      if (intent.last_payment_error) next = { status: 'FAILED', data: { failureMessage: (intent.last_payment_error.message ?? 'The card was declined.').slice(0, 300) } };
      break;
    default:
      break;
  }

  // Money never "un-arrives": a late event can't move a paid or released payment back.
  const settledStates = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELED'];
  if (!next || (settledStates.includes(payment.status) && !settledStates.includes(next.status))) {
    await prisma.payment.update({ where: { id: payment.id }, data: base });
    return;
  }
  const moved = await prisma.payment.updateMany({ where: { id: payment.id, status: payment.status, updatedAt: payment.updatedAt }, data: { ...base, ...next.data, status: next.status } });
  if (!moved.count || next.status === payment.status) return;

  const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId }, select: { id: true, groupCode: true, currency: true } });
  if (!booking) return;
  // The guest reads these on their booking page, and whoever paid may not be the guest: no card details here (they're on
  // the payment, for staff).
  const how = METHOD_LABEL[payment.method as keyof typeof METHOD_LABEL]?.toLowerCase() ?? 'card';
  const label = KIND_LABEL[payment.kind] ?? 'Payment';
  const amount = next.status === 'AUTHORIZED' ? toCents(intent.amount_capturable || intent.amount) : intent.amount_received || intent.amount;
  const notes: Record<string, string> = {
    SUCCEEDED: `${label} of ${money(amount, booking.currency)} paid by ${how}`,
    AUTHORIZED: `${label} of ${money(amount, booking.currency)} held on the card by ${how}${details.captureBefore ? `, until ${details.captureBefore.toISOString().slice(0, 10)}` : ''}`,
    FAILED: `${label} by ${how} declined: ${String(next.data.failureMessage ?? 'card declined')}`,
  };
  const note = notes[next.status];
  if (payment.kind === 'PAYMENT' && next.status === 'SUCCEEDED') {
    await refreshPaymentStatus(booking, note);
  } else if (note) {
    const lines = await paymentLines(booking);
    await historyNote(lines, note);
  }
}

/** A desk Checkout page finished or expired: link its PaymentIntent and apply it. */
export async function applyDeskSession(paymentId: string, session: Stripe.Checkout.Session, account: string | null): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { property: { select: { stripeAccountId: true } } } });
  if (!payment || payment.stripeCheckoutSessionId !== session.id) return;
  if (account && payment.property.stripeAccountId !== account) return;
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (intentId) {
    const intent = await getStripe().paymentIntents.retrieve(intentId, { expand: ['latest_charge'] }, accountOpts(payment.property));
    await applyDeskIntent(payment.id, intent, account);
    return;
  }
  if (session.status === 'expired') {
    await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'CANCELED', failureMessage: 'Stripe’s payment page expired before the card was entered.' } });
  }
}

type PaymentWithAccount = Awaited<ReturnType<typeof loadDeskPayment>>;

/** Read a card payment that may have moved (paid, held, declined) back from Stripe. */
async function syncFromStripe(payment: PaymentWithAccount): Promise<void> {
  const open = ['PENDING', 'AUTHORIZED', 'FAILED'].includes(payment.status);
  if (!open || payment.method === 'CASH' || !payment.property.stripeAccountId || !isStripeConfigured()) return;
  const stripe = getStripe();
  const opts = accountOpts(payment.property);
  try {
    if (payment.stripePaymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, { expand: ['latest_charge'] }, opts);
      await applyDeskIntent(payment.id, intent, null);
    } else if (payment.stripeCheckoutSessionId) {
      await applyDeskSession(payment.id, await stripe.checkout.sessions.retrieve(payment.stripeCheckoutSessionId, {}, opts), null);
    }
  } catch (e) {
    console.error('[payments] Could not refresh desk payment from Stripe:', e);
  }
}

/** GET — the payment's current state, read from Stripe (the desk polls this while the guest pays). */
export async function refreshDeskPayment(actor: Actor, paymentId: string): Promise<DeskPaymentRow> {
  requirePermission(actor, 'payments.collect');
  const payment = await loadDeskPayment(actor, paymentId);
  await syncFromStripe(payment);
  const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: rowSelect });
  return toRow(row, await staffNames([row.recordedById]));
}

/** POST — stop a card payment that hasn't gone through: clears the reader's screen or closes the Stripe page. */
export async function cancelDeskPayment(op: OpContext, paymentId: string): Promise<DeskPaymentRow> {
  requirePermission(op.actor, 'payments.collect');
  const payment = await loadDeskPayment(op.actor, paymentId);
  if (!['PENDING', 'FAILED'].includes(payment.status)) throw badRequest('Only a payment that hasn’t gone through can be cancelled. Refund or release it instead.');
  if (payment.method !== 'CASH' && payment.property.stripeAccountId && isStripeConfigured()) {
    const stripe = getStripe();
    const opts = accountOpts(payment.property);
    if (payment.terminalReaderId) await stripe.terminal.readers.cancelAction(payment.terminalReaderId, {}, opts).catch(() => undefined);
    if (payment.stripePaymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, {}, opts);
      if (intent.status === 'succeeded' || intent.status === 'requires_capture') {
        // The guest finished paying a moment ago: keep the payment.
        return refreshDeskPayment(op.actor, payment.id);
      }
      if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id, {}, opts);
    } else if (payment.stripeCheckoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(payment.stripeCheckoutSessionId, {}, opts);
      if (session.status === 'complete') return refreshDeskPayment(op.actor, payment.id);
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id, {}, opts);
    }
  }
  await prisma.payment.updateMany({ where: { id: payment.id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELED', failureMessage: `Cancelled at the desk by ${op.actor.name}` } });
  return refreshDeskPayment(op.actor, payment.id);
}

/** POST — test mode only: the simulated reader "taps" a test card, as a guest would. */
export async function simulateReaderTap(actor: Actor, paymentId: string, opts: { decline?: boolean } = {}): Promise<DeskPaymentRow> {
  requirePermission(actor, 'payments.collect');
  if (!isStripeTestMode()) throw badRequest('Simulated card taps only work with Stripe test keys.');
  const payment = await loadDeskPayment(actor, paymentId);
  if (!payment.terminalReaderId || payment.status !== 'PENDING' && payment.status !== 'FAILED') throw badRequest('This payment isn’t waiting on a card reader.');
  await getStripe().testHelpers.terminal.readers.presentPaymentMethod(
    payment.terminalReaderId,
    // Stripe's test card numbers for card-present payments: 4242… approves, 4000 0000 0000 0002 is declined.
    { type: 'card_present', card_present: { number: opts.decline ? '4000000000000002' : '4242424242424242' } },
    accountOpts(payment.property)
  );
  return refreshDeskPayment(actor, paymentId);
}

/**
 * POST — settle a security deposit (usually at check-out): keep `keep` for
 * incidentals and return the rest. A hold is captured for `keep` or released;
 * a charged deposit is refunded down to `keep`; cash is recorded as handed back.
 */
export async function settleDeposit(op: OpContext, paymentId: string, input: { keep: number; note?: string }): Promise<DeskPaymentRow> {
  requirePermission(op.actor, 'payments.collect');
  const payment = await loadDeskPayment(op.actor, paymentId);
  if (payment.kind !== 'SECURITY_DEPOSIT') throw badRequest('Only a security deposit can be settled here.');
  if (payment.settledAt) throw badRequest('This deposit has already been settled.');
  const plan = depositSettlement({ ...like(payment), status: payment.status, keepCents: toCents(input.keep) });
  if ('error' in plan) throw badRequest(plan.error);
  const currency = payment.currency;
  const recorded = RECORDED_METHODS.includes(payment.method as PaymentMethod);
  const stripe = recorded ? null : getStripe();
  const opts = accountOpts(payment.property);
  const reason = input.note?.trim().slice(0, 200) || null;

  if (plan.action === 'capture' || plan.action === 'release') {
    if (!stripe || !payment.stripePaymentIntentId) throw badRequest('This hold isn’t on a card.');
    const intent =
      plan.action === 'capture'
        ? await stripe.paymentIntents.capture(payment.stripePaymentIntentId, { amount_to_capture: plan.captureCents, expand: ['latest_charge'] }, { ...opts, idempotencyKey: `desk-capture-${payment.id}-${plan.captureCents}` })
        : await stripe.paymentIntents.cancel(payment.stripePaymentIntentId, { expand: ['latest_charge'] }, { ...opts, idempotencyKey: `desk-release-${payment.id}` });
    await applyDeskIntent(payment.id, intent, null);
  } else if (plan.action === 'refund') {
    if (recorded) {
      // Cash handed back, or refunded on the hotel's own terminal: HotelOne records it.
      await prisma.payment.update({ where: { id: payment.id }, data: { amountRefunded: { increment: fromCents(plan.refundCents) }, status: toCents(input.keep) > 0 ? 'PARTIALLY_REFUNDED' : 'REFUNDED' } });
    } else {
      if (!stripe || !payment.stripePaymentIntentId) throw badRequest('This deposit isn’t on a card.');
      await stripe.refunds.create(
        { payment_intent: payment.stripePaymentIntentId, amount: plan.refundCents, reason: 'requested_by_customer', metadata: { deskPaymentId: payment.id, refundedBy: op.actor.userId } },
        { ...opts, idempotencyKey: `desk-deposit-refund-${payment.id}-${plan.refundCents}` }
      );
      const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, { expand: ['latest_charge'] }, opts);
      await applyDeskIntent(payment.id, intent, null);
    }
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { settledAt: new Date(), ...(reason ? { note: reason } : {}) } });

  const keepText = toCents(input.keep) > 0 ? `kept ${money(toCents(input.keep), currency)} for incidentals` : 'returned in full';
  const how =
    plan.action === 'release'
      ? 'hold released'
      : plan.action === 'capture'
        ? 'hold captured'
        : payment.method === 'CASH'
          ? 'cash handed back'
          : recorded && plan.action === 'refund'
            ? 'returned outside HotelOne'
            : plan.action === 'refund'
              ? 'refunded to the card'
              : 'kept';
  const note = `Security deposit settled by ${op.actor.name}: ${keepText} (${how})${reason ? ` · ${reason}` : ''}`;
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: payment.bookingId }, select: { id: true, groupCode: true } });
  await historyNote(await paymentLines(booking), note);
  await recordAudit(op, payment.propertyId, 'PAYMENT_DEPOSIT_SETTLED', note, { bookingId: booking.id, paymentId: payment.id });
  return refreshDeskPayment(op.actor, payment.id);
}

/** POST — hand back cash paid toward the stay (a refund of a cash payment). Needs refund rights, like card refunds. */
export async function refundCash(op: OpContext, paymentId: string, input: { amount?: number; note?: string }): Promise<DeskPaymentRow> {
  requirePermission(op.actor, 'payments.refund');
  const payment = await loadDeskPayment(op.actor, paymentId);
  if (!RECORDED_METHODS.includes(payment.method as PaymentMethod) || payment.kind !== 'PAYMENT' || !['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
    throw badRequest('Only cash and payments recorded at the desk can be handed back here. Refund cards from the Payment card.');
  }
  const left = toCents(Number(payment.amount)) - toCents(Number(payment.amountRefunded));
  const cents = input.amount === undefined ? left : toCents(input.amount);
  if (!(cents > 0) || cents > left) throw badRequest(`Hand back between 0.01 and ${fromCents(left).toFixed(2)} ${payment.currency.toUpperCase()}.`);
  const refunded = toCents(Number(payment.amountRefunded)) + cents;
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: payment.bookingId }, select: { id: true, groupCode: true, code: true } });
  // Which room types of a reservation booked together it comes off: a credit first (refunds.ts says more).
  const shares = await planRefundShares(booking, cents);
  const moved = await prisma.payment.updateMany({
    where: { id: payment.id, amountRefunded: payment.amountRefunded },
    data: { amountRefunded: fromCents(refunded), status: refunded >= toCents(Number(payment.amount)) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  });
  if (!moved.count) throw conflict('This payment just changed. Reload and try again.');
  await recordRefundShares(payment.id, `cash-${payment.id}-${refunded - cents}-${cents}`, shares);
  const note = `${money(cents, payment.currency)} ${payment.method === 'CASH' ? 'cash handed back' : 'given back outside HotelOne'} by ${op.actor.name}${input.note?.trim() ? ` · ${input.note.trim().slice(0, 120)}` : ''}`;
  await refreshPaymentStatus(booking, note);
  await recordAudit(op, payment.propertyId, 'PAYMENT_REFUND', `${note} · ${booking.code ?? booking.id}`, { bookingId: booking.id, paymentId: payment.id });
  return refreshDeskPayment(op.actor, payment.id);
}
