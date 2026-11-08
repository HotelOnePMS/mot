/**
 * Money at the desk, for the agent: recording a payment taken outside HotelOne's card flow (cash, the hotel's own
 * terminal, a bank transfer), refunding a guest, and asking a third party to authorize their card for someone's stay.
 *
 * Each is a step the person confirms, checked here against the same rules the Payments card uses and checked again
 * when it runs. Charging a card through HotelOne (the card reader, typing the card in) stays on the reservation's
 * Payments card: the agent never handles card numbers.
 */
import { prisma } from '@/lib/prisma';
import { CARD_NUMBER_REFUSED, containsCardNumber, deskAmountProblem, MAX_SECURITY_DEPOSIT, RECORDED_METHODS } from '@/lib/desk-payments';
import { fromCents, toCents } from '@/lib/payments';
import { money } from '@/lib/status';
import { isStripeConfigured } from '@/lib/stripe';
import { can } from '../authz';
import { formatDay } from '../dates';
import { paymentLines } from '../payments/record';
import { refundInfoFor } from '../payments/refunds';
import { stayBalance } from '../services/folio';
import { guestOf, memoryOf, type ResolvedBooking } from './folio-plan';
import { HarnessInputError } from './input-error';
import type { PlanStep } from './plan';
import type { PlanOutput, ToolCtx } from './tools';

const refused = (text: string): PlanOutput => ({ steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text }] });
const ENDED = ['CANCELLED', 'NO_SHOW'];
const fmt = (n: number, currency: string) => money(n, { cents: true, currency: currency.toUpperCase() });

// ---------------------------------------------------------------------------
// Recording a payment
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  amount?: number;
  method: 'cash' | 'own_terminal' | 'other';
  for?: 'stay' | 'deposit';
  tendered?: number;
  card_last4?: string;
  card_brand?: string;
  approval_code?: string;
  note?: string;
}

const METHOD = { cash: 'CASH', own_terminal: 'EXTERNAL_CARD', other: 'OTHER' } as const;

/** "She paid the rest in cash", "took $200 on our terminal, card ending 4242", "they paid by bank transfer". */
export async function planRecordPayment(ctx: ToolCtx, b: ResolvedBooking, a: RecordPaymentInput): Promise<PlanOutput> {
  if (!can(ctx.actor, 'payments.collect')) return refused('Your role can’t take payments.');
  const guest = guestOf(b);
  if (ENDED.includes(b.status)) return refused(`${guest}’s reservation (${b.code}) is ${b.status === 'NO_SHOW' ? 'a no-show' : 'cancelled'}. Reinstate it before taking a payment.`);
  const currency = b.currency;
  const kind = a.for === 'deposit' ? 'SECURITY_DEPOSIT' : 'PAYMENT';
  const balance = stayBalance(b);
  let amount = a.amount;
  if (amount === undefined) {
    if (kind === 'PAYMENT') {
      if (balance <= 0.004) return refused(`Nothing is left to pay on ${guest}’s reservation (${b.code}).`);
      amount = balance;
    } else {
      const p = await prisma.property.findUnique({ where: { id: ctx.propertyId }, select: { securityDepositAmount: true } });
      const usual = Number(p?.securityDepositAmount ?? 0);
      if (!(usual > 0)) throw new HarnessInputError('The hotel has no usual security deposit amount: ask how much to take.');
      amount = usual;
    }
  }
  const problem = deskAmountProblem({ kind, amountCents: toCents(amount), balanceCents: toCents(balance), currency });
  if (problem) throw new HarnessInputError(problem);
  if (kind === 'SECURITY_DEPOSIT' && amount > MAX_SECURITY_DEPOSIT) throw new HarnessInputError(`A security deposit can be at most ${MAX_SECURITY_DEPOSIT}.`);
  if ([a.note, a.approval_code, a.card_last4].some((t) => containsCardNumber(t))) throw new HarnessInputError(CARD_NUMBER_REFUSED);

  const method = METHOD[a.method];
  const last4 = (a.card_last4 ?? '').replace(/\D/g, '');
  const note = a.note?.replace(/\s+/g, ' ').trim() || undefined;
  if (method === 'EXTERNAL_CARD' && last4.length !== 4) throw new HarnessInputError('Ask for the last four digits of the card the hotel’s terminal charged.');
  if (method === 'OTHER' && (!note || note.length < 3)) throw new HarnessInputError('Say how it was paid in `note` (for example “bank transfer” or “paid to Expedia”).');
  if (method === 'CASH' && a.tendered !== undefined && a.tendered < amount) throw new HarnessInputError(`The guest handed over less than ${fmt(amount, currency)}.`);

  const what = kind === 'SECURITY_DEPOSIT' ? `a ${fmt(amount, currency)} security deposit` : fmt(amount, currency);
  const how = method === 'CASH' ? 'in cash' : method === 'EXTERNAL_CARD' ? `on the hotel’s own terminal (card ending ${last4})` : `paid another way (${note})`;
  const left = Math.max(0, balance - amount);
  const detail = [
    kind === 'PAYMENT' ? (left > 0.004 ? `Leaves ${fmt(left, currency)} to pay` : 'Pays the stay in full') : 'Held until check-out, then returned or kept for incidentals',
    method === 'CASH' && a.tendered !== undefined && a.tendered > amount ? `change ${fmt(a.tendered - amount, currency)}` : '',
    method === 'EXTERNAL_CARD' && a.approval_code ? `approval ${a.approval_code}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    steps: [
      {
        tool: 'record_payment',
        args: {
          bookingId: b.id,
          kind,
          method,
          amount,
          ...(method === 'CASH' && a.tendered !== undefined ? { tendered: a.tendered } : {}),
          ...(method === 'EXTERNAL_CARD' ? { cardLast4: last4, ...(a.card_brand ? { cardBrand: a.card_brand } : {}), ...(a.approval_code ? { reference: a.approval_code } : {}) } : {}),
          ...(note ? { note } : {}),
        },
        summary: `Record ${what} ${how} from ${guest} (${b.code})`,
        detail,
      },
    ],
    warnings: method === 'CASH' ? [] : ['It’s recorded as paid: make sure the money actually came in.'],
    risk: 'medium',
    memory: memoryOf(b),
  };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

export interface RefundToolInput {
  amount?: number;
  full?: boolean;
  from?: 'card' | 'cash' | 'other';
  reason: string;
  also_discount?: boolean;
}

interface Refundable {
  id: string;
  from: 'card' | 'cash' | 'other';
  refundable: number;
  label: string;
}

/** Everything on a reservation that can still be refunded: card payments first (newest first), then desk payments. */
async function refundables(ctx: ToolCtx, b: ResolvedBooking): Promise<{ list: Refundable[]; suggested: number; deadline: string; passed: boolean }> {
  const info = await refundInfoFor(ctx.actor, b.id);
  const lines = await paymentLines(b);
  const desk = await prisma.payment.findMany({
    where: { bookingId: { in: lines.map((l) => l.id) }, method: { in: [...RECORDED_METHODS] }, kind: 'PAYMENT', status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, method: true, amount: true, amountRefunded: true, cardLast4: true, note: true },
  });
  const list: Refundable[] = [
    ...(isStripeConfigured() ? info.payments : [])
      .filter((p) => p.refundable > 0.004)
      .map((p) => ({ id: p.id, from: 'card' as const, refundable: p.refundable, label: `card${p.cardLast4 ? ` ending ${p.cardLast4}` : ''}` })),
    ...desk
      .map((p) => ({
        id: p.id,
        from: p.method === 'CASH' ? ('cash' as const) : ('other' as const),
        refundable: fromCents(toCents(Number(p.amount)) - toCents(Number(p.amountRefunded))),
        label: p.method === 'CASH' ? 'cash' : p.method === 'EXTERNAL_CARD' ? `the hotel’s own terminal (card ending ${p.cardLast4 ?? '?'})` : `paid another way${p.note ? ` (${p.note.slice(0, 40)})` : ''}`,
      }))
      .filter((p) => p.refundable > 0.004),
  ];
  return { list, suggested: info.suggested, deadline: info.deadlineLabel, passed: info.deadlinePassed };
}

/** "Refund $50 to Lucas, the AC was broken", "give her the deposit back in cash", "full refund for the cancelled Patel booking". */
export async function planRefund(ctx: ToolCtx, b: ResolvedBooking, a: RefundToolInput): Promise<PlanOutput> {
  if (!can(ctx.actor, 'payments.refund')) return refused('Refunds are given by managers and owners. Ask one to do it.');
  if (a.also_discount && !can(ctx.actor, 'folio.adjust')) return refused('Lowering what a stay costs is for managers and owners.');
  const guest = guestOf(b);
  const currency = b.currency;
  const reason = a.reason.replace(/\s+/g, ' ').trim();
  if (reason.length < 3) throw new HarnessInputError('Say why the money goes back, for the activity log (for example “AC broken, one night” or “cancelled in time”).');
  if (containsCardNumber(reason)) throw new HarnessInputError(CARD_NUMBER_REFUSED);
  if (a.also_discount && ENDED.includes(b.status)) throw new HarnessInputError('This reservation is closed, so there’s nothing to take off what it costs: refund without also_discount.');

  const { list, suggested, deadline, passed } = await refundables(ctx, b);
  const pool = a.from ? list.filter((p) => p.from === a.from) : list;
  const describe = (ps: Refundable[]) => ps.map((p) => `${fmt(p.refundable, currency)} ${p.from === 'cash' ? 'in cash' : `from ${p.label}`}`).join(', ');
  if (!list.length) return refused(`Nothing is left to refund on ${guest}’s reservation (${b.code}).`);
  if (!pool.length) throw new HarnessInputError(`No ${a.from} payment to refund on this reservation. What can be refunded: ${describe(list)}.`);
  const total = pool.reduce((s, p) => s + toCents(p.refundable), 0);

  let parts: { p: Refundable; cents: number }[];
  if (a.full) {
    parts = pool.map((p) => ({ p, cents: toCents(p.refundable) }));
  } else if (a.amount !== undefined) {
    const want = toCents(a.amount);
    if (want <= 0) throw new HarnessInputError('Refund a positive amount.');
    if (want > total) throw new HarnessInputError(`Only ${fmt(fromCents(total), currency)} can be refunded here: ${describe(pool)}.`);
    // One payment that covers it, or the newest ones in turn.
    const one = pool.find((p) => toCents(p.refundable) >= want);
    if (one) parts = [{ p: one, cents: want }];
    else {
      parts = [];
      let left = want;
      for (const p of pool) {
        if (left <= 0) break;
        const cents = Math.min(left, toCents(p.refundable));
        parts.push({ p, cents });
        left -= cents;
      }
    }
  } else {
    const policy = suggested > 0 ? ` The cancellation policy suggests ${fmt(suggested, currency)} (${passed ? 'after' : 'before'} the deadline: ${deadline}).` : '';
    throw new HarnessInputError(`Ask how much to refund: up to ${fmt(fromCents(total), currency)} (${describe(pool)}).${policy} Pass full: true to refund all of it.`);
  }

  const steps: PlanStep[] = parts.map(({ p, cents }) => {
    const amount = fromCents(cents);
    return {
      tool: 'refund_payment',
      args: { bookingId: b.id, paymentId: p.id, via: p.from === 'card' ? 'card' : 'desk', amount, reason, allowance: !!a.also_discount },
      summary:
        p.from === 'card'
          ? `Refund ${fmt(amount, currency)} to ${guest}’s ${p.label} (${b.code})`
          : p.from === 'cash'
            ? `Hand back ${fmt(amount, currency)} in cash to ${guest} (${b.code})`
            : `Record ${fmt(amount, currency)} given back to ${guest} for the payment ${p.label} (${b.code})`,
      detail: `${reason}${a.also_discount ? ` · the stay also costs ${fmt(amount, currency)} less` : ''}`,
    };
  });
  const warnings = [
    ...(parts.some((x) => x.p.from === 'card') ? ['A card refund goes back through Stripe and can’t be undone.'] : []),
    ...(parts.some((x) => x.p.from === 'cash') ? ['Hand the cash over when you confirm.'] : []),
    ...(parts.some((x) => x.p.from === 'other') ? ['Give the money back the way it was paid (terminal, transfer): this only records it.'] : []),
    ...(parts.length > 1 ? [`No single payment had that much left, so it comes off ${parts.length} payments.`] : []),
  ];
  return { steps, warnings, risk: 'high', memory: memoryOf(b) };
}

// ---------------------------------------------------------------------------
// Third-party card authorization
// ---------------------------------------------------------------------------

export interface CardAuthInput {
  cardholder_name: string;
  cardholder_email: string;
  guest_names?: string[];
  covers_incidentals?: boolean;
  incidentals_limit?: number;
}

/** "Send Acme Corp's travel desk the card form for Mr Okafor's stay": the cardholder signs, adds their ID and card. */
export async function planCardAuthorization(ctx: ToolCtx, b: ResolvedBooking, a: CardAuthInput): Promise<PlanOutput> {
  if (!can(ctx.actor, 'booking.cardAuth')) return refused('Your role can’t ask for card authorizations.');
  const guest = guestOf(b);
  if (ENDED.includes(b.status)) return refused(`${guest}’s reservation (${b.code}) is closed. Reinstate it before asking for a card authorization.`);
  const name = a.cardholder_name.replace(/\s+/g, ' ').trim();
  if (name.length < 2) throw new HarnessInputError('Give the cardholder’s name.');
  const guests = (a.guest_names?.length ? a.guest_names : [guest]).map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const covers = !!a.covers_incidentals;
  const limit = covers && a.incidentals_limit ? a.incidentals_limit : null;
  // Requests are kept on the reservation's lead line; only the newest link works.
  const lines = await paymentLines(b);
  const pending = await prisma.cardAuthorization.count({ where: { bookingId: { in: lines.map((l) => l.id) }, status: 'PENDING' } });
  return {
    steps: [
      {
        tool: 'request_card_authorization',
        args: { bookingId: b.id, cardholderName: name, cardholderEmail: a.cardholder_email.trim(), guestNames: guests, coversIncidentals: covers, incidentalsLimit: limit },
        summary: `Email ${name} (${a.cardholder_email.trim()}) the card authorization form for ${guest}’s stay (${b.code}, ${formatDay(b.checkIn.toISOString().slice(0, 10))})`,
        detail: `${covers ? `Covers the stay and incidentals${limit ? ` up to ${fmt(limit, b.currency)}` : ''}` : 'Covers the stay only'} · for ${guests.join(', ')} · they sign online and add their ID${pending ? ' · replaces the link sent earlier' : ''}`,
      },
    ],
    warnings: [],
    risk: 'medium',
    memory: memoryOf(b),
  };
}
