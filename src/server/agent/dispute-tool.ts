/**
 * Disputes and chargebacks for the agent. "Lucas Silva raised a chargeback" finds the stay and any dispute Stripe
 * reported for it, and assembles the evidence document from the hotel's own records (the same evidence the Disputes
 * page shows): a summary for the bank that answers the cardholder's claim, the itemized folio, the policy the guest
 * accepted, ID check, registration card, check-in and check-out. The person downloads or prints it.
 *
 * Sending a Stripe dispute's evidence is a write they confirm (it can't be undone). A chargeback that reached the
 * hotel another way (a bank letter, the card terminal's processor) gets the same document to send themselves.
 */
import { prisma } from '@/lib/prisma';
import type { AgentBlock, AgentContextState } from '@/lib/agent/blocks';
import { money } from '@/lib/status';
import { can } from '../authz';
import { toISODate } from '../dates';
import { disputeCase, disputedBookingId, openDisputeOn, openDisputesAt } from '../payments/disputes';
import { disputeReasonLabel } from '../payments/evidence';
import { bookingInclude } from '../services/mappers';
import { guestOf, memoryOf, type ResolvedBooking } from './folio-plan';
import type { PlanOutput, ToolCtx } from './tools';

/** The claims a cardholder can make, as card networks (and Stripe) name them. */
export const DISPUTE_REASONS = ['fraudulent', 'unrecognized', 'product_not_received', 'product_unacceptable', 'credit_not_processed', 'duplicate', 'general'] as const;

export const DISPUTE_REASON_HELP =
  'What the cardholder claims, when the person said: fraudulent (didn’t authorize it, stolen card), unrecognized (doesn’t recognize the charge), ' +
  'product_not_received (says they didn’t stay or weren’t given the service), product_unacceptable (room not as described, poor service), ' +
  'credit_not_processed (cancelled, or was promised a refund), duplicate (charged twice), general (anything else). Leave out when Stripe already reported the dispute.';

const STATUS_WORDS: Record<string, string> = {
  reported: 'reported to the hotel outside Stripe',
  needs_response: 'needs the hotel’s response',
  warning_needs_response: 'early warning, needs the hotel’s response',
  under_review: 'evidence sent, under review by the bank',
  warning_under_review: 'early warning, under review',
  warning_closed: 'early warning closed',
  won: 'won',
  lost: 'lost',
};

const statusWords = (s: string) => STATUS_WORDS[s] ?? s.replace(/_/g, ' ');

export interface DisputeInput {
  reason?: string;
  amount?: number;
  respondBy?: string;
}

type ReadOut = { blocks: AgentBlock[]; forModel: string; memory?: Partial<AgentContextState>; isError?: boolean };

/**
 * The stay a dispute is about. A confirmation code is taken as given; for a name or a room, the guest's stay with a
 * Stripe dispute, or else the one they were charged for (see disputedBookingId).
 */
export async function disputedStay(ctx: ToolCtx, b: ResolvedBooking, exact: boolean): Promise<ResolvedBooking> {
  if (exact || !can(ctx.actor, 'disputes.view')) return b;
  const id = await disputedBookingId(ctx.actor, b);
  if (id === b.id) return b;
  return (await prisma.booking.findFirst({ where: { id, propertyId: ctx.propertyId }, include: bookingInclude })) ?? b;
}

/** A reservation's dispute as a card for the person and facts for the model. */
export async function disputeRead(ctx: ToolCtx, b: ResolvedBooking, input: DisputeInput): Promise<ReadOut & { memory: Partial<AgentContextState> }> {
  const c = await disputeCase(ctx.actor, b, { reason: input.reason ?? null, amount: input.amount ?? null });
  const d = c.dispute;
  const guest = guestOf(b);
  const currency = c.currency.toUpperCase();
  const points = c.summary?.sections.find((s) => s.title === 'Summary')?.lines ?? [];
  // A Stripe dispute's evidence is stored with it; a reported chargeback's is rebuilt from what the person said.
  const base = d ? `/api/admin/disputes/${d.id}/evidence` : `/api/admin/bookings/${b.id}/dispute-evidence`;
  const href = (format?: 'html') => {
    const q = new URLSearchParams(d ? {} : { ...(c.reason ? { reason: c.reason } : {}), amount: String(c.amount) });
    if (format) q.set('format', format);
    const qs = q.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const status = d?.status ?? 'reported';
  const checkIn = toISODate(b.checkIn);
  const checkOut = toISODate(b.checkOut);
  const block: AgentBlock = {
    type: 'dispute',
    bookingId: b.id,
    code: b.code ?? '',
    guestName: guest,
    checkIn,
    checkOut,
    disputeId: d?.id ?? null,
    status,
    reason: c.reason,
    reasonLabel: disputeReasonLabel(c.reason),
    amount: c.amount,
    currency,
    respondBy: d?.evidenceDueBy?.slice(0, 10) ?? input.respondBy ?? null,
    submittedAt: d?.evidenceSubmittedAt ?? null,
    canSubmit: !!d?.canSubmit && can(ctx.actor, 'disputes.manage'),
    points,
    gaps: c.gaps,
    downloadHref: href(),
    printHref: href('html'),
    openHref: d ? `/admin/disputes?dispute=${d.id}` : `/admin/bookings/${b.id}`,
  };
  const forModel = JSON.stringify({
    reservation: b.code,
    guest,
    stay: `${checkIn} to ${checkOut}`,
    source: d ? 'Stripe reported this dispute' : 'not in Stripe: a chargeback the hotel heard about another way',
    status: statusWords(status),
    reason: block.reasonLabel,
    amount: money(c.amount, { cents: true, currency }),
    respondBy: block.respondBy ?? undefined,
    evidenceSubmitted: block.submittedAt ?? undefined,
    canSubmitToStripe: block.canSubmit,
    summaryForBank: points,
    missingOrWeak: c.gaps,
    documentSections: c.summary?.sections.map((s) => s.title) ?? [],
    shownToPerson: d
      ? 'A card with the summary, what’s missing, and buttons to download or print the evidence and open the dispute. Sending it to Stripe can’t be undone: use submit_dispute_evidence only when they ask.'
      : 'A card with the summary, what’s missing, and buttons to download or print the document. Stripe didn’t report this one, so they send it to their card processor or the bank themselves, before the deadline.',
  });
  return { blocks: [block], forModel, memory: memoryOf(b) };
}

/** "We got a chargeback" without a name: the one dispute Stripe reported, or a choice between them. */
export async function openDisputesRead(ctx: ToolCtx, input: DisputeInput): Promise<ReadOut> {
  const open = await openDisputesAt(ctx.actor, ctx.propertyId);
  const linked = open.filter((d) => d.booking);
  if (linked.length === 1) {
    const b = await prisma.booking.findFirst({ where: { id: linked[0].booking!.id, propertyId: ctx.propertyId }, include: bookingInclude });
    if (b) return disputeRead(ctx, b, input);
  }
  const elsewhere = open.length - linked.length;
  const unlinked = elsewhere ? ` Stripe also reported ${elsewhere} that ${elsewhere === 1 ? 'isn’t' : 'aren’t'} linked to a reservation here: answer ${elsewhere === 1 ? 'it' : 'those'} in the Stripe dashboard.` : '';
  if (linked.length > 1) {
    const facts = linked.map((d) => ({
      guest: d.booking!.guestName,
      reservation: d.booking!.code,
      amount: money(d.amount, { cents: true, currency: d.currency.toUpperCase() }),
      reason: disputeReasonLabel(d.reason),
      respondBy: d.evidenceDueBy?.slice(0, 10),
    }));
    return {
      blocks: [
        {
          type: 'clarify',
          question: 'Which dispute is it?',
          options: linked.slice(0, 5).map((d, i) => ({
            label: d.booking!.guestName,
            hint: `${facts[i].amount} · ${facts[i].reason}${facts[i].respondBy ? ` · respond by ${facts[i].respondBy}` : ''}`,
            command: `Prepare the chargeback evidence for reservation ${d.booking!.code ?? d.booking!.id}`,
          })),
        },
      ],
      forModel: `${JSON.stringify({ openDisputes: facts })}\nThe person sees these as options to pick from. Ask which one in one short sentence, unless they already said who.${unlinked}`,
    };
  }
  return {
    blocks: [],
    forModel:
      'No dispute from Stripe is waiting for a response at this hotel.' +
      unlinked +
      ' Ask the person which guest or reservation the chargeback is about (name, room or confirmation code), and what the bank says it is for if they know.',
  };
}

/** The dispute open on the Disputes page, for "prepare the evidence for this one". */
export async function disputeOnScreen(ctx: ToolCtx, disputeId: string): Promise<{ text: string; memory?: Partial<AgentContextState> } | null> {
  if (!can(ctx.actor, 'disputes.view')) return null;
  const d = await prisma.dispute.findFirst({
    where: { id: disputeId.slice(0, 40), propertyId: ctx.propertyId },
    select: {
      amount: true,
      currency: true,
      reason: true,
      status: true,
      evidenceDueBy: true,
      evidenceSubmittedAt: true,
      booking: { select: { id: true, code: true, user: { select: { firstName: true, lastName: true } }, room: { select: { roomNumber: true } } } },
    },
  });
  if (!d) return null;
  const amount = money(Number(d.amount), { cents: true, currency: d.currency.toUpperCase() });
  const name = d.booking ? `${d.booking.user.firstName} ${d.booking.user.lastName}`.trim() : null;
  const due = d.evidenceDueBy && !d.evidenceSubmittedAt ? `, respond by ${d.evidenceDueBy.toISOString().slice(0, 10)}` : '';
  const what = `${amount}, ${disputeReasonLabel(d.reason).toLowerCase()}, ${statusWords(d.status)}${due}`;
  if (!d.booking || !name) return { text: `On screen: a card dispute from Stripe that isn’t linked to a reservation (${what}).` };
  return {
    text: `On screen: the card dispute on ${name}’s reservation (#${d.booking.code}): ${what}. “This dispute”, “this chargeback” or “this guest” mean this one unless the person names someone else.`,
    memory: { lastBookingId: d.booking.id, lastBookingCode: d.booking.code ?? undefined, lastGuestName: name, lastRoomNumber: d.booking.room?.roomNumber },
  };
}

const refused = (text: string): PlanOutput => ({ steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text }] });

/** Send a Stripe dispute's evidence: one high-risk step the person confirms (owners, or roles allowed to). */
export async function planSubmitDispute(ctx: ToolCtx, b: ResolvedBooking): Promise<PlanOutput> {
  if (!can(ctx.actor, 'disputes.manage')) return refused('Only owners can send dispute evidence to Stripe, from the Disputes page or here.');
  const d = await openDisputeOn(ctx.actor, b);
  if (!d) {
    return refused(
      `There’s no Stripe dispute waiting for evidence on ${guestOf(b)}’s reservation (${b.code}). For a chargeback that came another way, get the document with get_dispute and send it to the card processor or the bank.`
    );
  }
  const amount = money(d.amount, { cents: true, currency: d.currency.toUpperCase() });
  return {
    steps: [
      {
        tool: 'submit_dispute_evidence',
        args: { disputeId: d.id, bookingId: b.id },
        summary: `Submit the evidence for ${guestOf(b)}’s ${amount} dispute (${b.code}) to Stripe`,
        detail: `Stripe passes it to the cardholder’s bank${d.evidenceDueBy ? ` (due ${d.evidenceDueBy.slice(0, 10)})` : ''}. It can’t be undone, and a dispute is answered only once.`,
      },
    ],
    warnings: ['Sending the evidence can’t be undone: check it first.'],
    risk: 'high',
    memory: memoryOf(b),
  };
}
