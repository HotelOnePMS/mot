import { describe, expect, it, vi } from 'vitest';

// Stripe takes the evidence and moves the dispute under review.
const stripe = vi.hoisted(() => ({ update: vi.fn(async (id: string, _params: unknown, _opts?: unknown) => ({ id, status: 'under_review' })) }));
vi.mock('@/lib/stripe', async (original) => ({
  ...(await original<typeof import('@/lib/stripe')>()),
  getStripe: () => ({ disputes: { update: stripe.update } }),
  isStripeConfigured: () => true,
}));

import { prisma } from '@/lib/prisma';
import type { AgentBlock } from '@/lib/agent/blocks';
import { addDaysISO, atNoonUTC } from '@/server/dates';
import { confirmPlan } from '@/server/agent/engine';
import { HOTEL_TOOLS, HOTEL_WRITE_TOOLS_FOR_ADVISOR, runHarness } from '@/server/agent/harness';
import { signPlan } from '@/server/agent/plan';
import { reportedChargebackEvidence } from '@/server/payments/disputes';
import { renderEvidenceText } from '@/server/payments/evidence';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';
import { drain, firstMessage, scriptedClient, toolResults } from './scripted-client';

type Role = 'OWNER' | 'MANAGER' | 'FRONT_DESK';

/**
 * Lucas Silva stayed two nights last week, paid 230 by Visa (3D Secure); he's also booked again next month, unpaid.
 * A chargeback is about the stay he paid for, not the one to come.
 */
async function setup() {
  const h = await makeHotel();
  const lucas = await prisma.user.create({ data: { email: `lucas-${uid()}@example.org`, password: '', firstName: 'Lucas', lastName: 'Silva', role: 'CUSTOMER' } });
  const booking = (checkIn: string, status: 'CHECKED_OUT' | 'CONFIRMED') =>
    prisma.booking.create({
      data: {
        userId: lucas.id,
        propertyId: h.property.id,
        roomTypeId: h.roomType.id,
        checkIn: atNoonUTC(checkIn),
        checkOut: atNoonUTC(addDaysISO(checkIn, 2)),
        guests: 1,
        rooms: 1,
        totalPrice: 230,
        subtotalPrice: 200,
        status,
        code: `L${uid().toUpperCase().slice(0, 5)}`,
        paymentStatus: status === 'CHECKED_OUT' ? 'PAID' : 'UNPAID',
      },
    });
  const stayed = await booking(addDaysISO(h.today, -7), 'CHECKED_OUT');
  const upcoming = await booking(addDaysISO(h.today, 30), 'CONFIRMED');
  await prisma.payment.create({
    data: {
      bookingId: stayed.id,
      propertyId: h.property.id,
      stripePaymentIntentId: `pi_${uid()}${uid()}`,
      status: 'SUCCEEDED',
      amount: 230,
      currency: 'usd',
      cardholderName: 'Lucas Silva',
      cardBrand: 'visa',
      cardLast4: '4242',
      threeDSecure: 'authenticated',
      paidAt: new Date(),
    },
  });
  const as = async (role: Role) => {
    const user = await makeUser({ role, propertyIds: [h.property.id] });
    const actor = await actorFor(user.id);
    const ctx = (message: string) => ({ actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message });
    return { actor, ctx };
  };
  return { h, stayed, upcoming, as };
}

const stripeDispute = (s: Awaited<ReturnType<typeof setup>>, extra: { status?: string; reason?: string } = {}) =>
  prisma.dispute.create({
    data: {
      stripeDisputeId: `dp_${uid()}`,
      bookingId: s.stayed.id,
      propertyId: s.h.property.id,
      amount: 230,
      currency: 'usd',
      status: extra.status ?? 'needs_response',
      reason: extra.reason ?? 'fraudulent',
      evidenceDueBy: atNoonUTC(addDaysISO(s.h.today, 6)),
    },
  });

const disputeBlock = (events: { type: string; block?: AgentBlock }[]) =>
  events.filter((e) => e.type === 'block').map((e) => e.block!).find((b): b is Extract<AgentBlock, { type: 'dispute' }> => b.type === 'dispute');

describe('the agent and chargebacks', () => {
  it('"Lucas raised a chargeback": picks the dispute tool on its own and builds the document for the stay he paid for', async () => {
    const s = await setup();
    const { ctx } = await s.as('MANAGER');
    const { client, create } = scriptedClient([
      [{ type: 'tool_use', id: 't1', name: 'get_dispute', input: { guest: { name: 'lucas silva' }, reason: 'product_not_received', amount: 230, respond_by: addDaysISO(s.h.today, 10) } }],
      [{ type: 'text', text: 'The chargeback evidence for Lucas Silva is ready to download.' }],
    ]);
    const { events, result } = await drain(runHarness(ctx('lucas silva raised a chargeback saying he never stayed, make a document so we can fight it'), { client }));

    const card = disputeBlock(events);
    expect(card).toMatchObject({
      bookingId: s.stayed.id,
      code: s.stayed.code,
      guestName: 'Lucas Silva',
      disputeId: null,
      status: 'reported',
      reason: 'product_not_received',
      amount: 230,
      currency: 'USD',
      respondBy: addDaysISO(s.h.today, 10),
      canSubmit: false,
      downloadHref: `/api/admin/bookings/${s.stayed.id}/dispute-evidence?reason=product_not_received&amount=230`,
      printHref: `/api/admin/bookings/${s.stayed.id}/dispute-evidence?reason=product_not_received&amount=230&format=html`,
      openHref: `/admin/bookings/${s.stayed.id}`,
    });
    expect(card?.points[0]).toMatch(/^Lucas Silva booked Queen at .+ confirmation code /);
    // No check-in was recorded for that stay: the hotel is told, the bank isn't.
    expect(card?.gaps).toContain('No check-in is recorded, though the stay has ended.');

    const facts = JSON.parse(toolResults(create, 1)[0].content);
    expect(facts).toMatchObject({ reservation: s.stayed.code, source: expect.stringMatching(/^not in Stripe/), amount: '$230.00', missingOrWeak: card?.gaps });
    expect(facts.documentSections).toEqual(expect.arrayContaining(['Dispute', 'Summary', 'Booking', 'Folio (itemized)']));
    expect(result.memory.lastBookingId).toBe(s.stayed.id);
    // Reading changes nothing.
    expect(result.steps).toHaveLength(0);
    expect(await prisma.dispute.count({ where: { propertyId: s.h.property.id } })).toBe(0);

    // The download is the same document.
    const doc = await reportedChargebackEvidence(ctx('').actor, s.stayed.id, { reason: 'product_not_received', amount: 230 });
    const text = renderEvidenceText(doc.summary);
    expect(text).toContain('Chargeback reported to the hotel (not received through Stripe)');
    expect(text).toContain('Amount disputed: 230.00 USD');
    expect(text).not.toContain('No check-in is recorded');
  });

  it('front desk staff can’t see disputes, in the agent or the download', async () => {
    const s = await setup();
    const { actor, ctx } = await s.as('FRONT_DESK');
    const { client, create } = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'get_dispute', input: { guest: { name: 'Silva' } } }]]);
    const { events } = await drain(runHarness(ctx('silva raised a dispute'), { client }));
    expect(toolResults(create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/aren’t part of this person’s role/) });
    expect(disputeBlock(events)).toBeUndefined();
    await expect(reportedChargebackEvidence(actor, s.stayed.id, {})).rejects.toThrow();
  });

  it('a dispute Stripe reported: found without a name, and sending it is a step only an owner confirms', async () => {
    const s = await setup();
    const d = await stripeDispute(s);
    const owner = await s.as('OWNER');

    const read = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'get_dispute', input: {} }]]);
    const seen = await drain(runHarness(owner.ctx('we got a chargeback, get the evidence ready'), { client: read.client }));
    expect(disputeBlock(seen.events)).toMatchObject({
      bookingId: s.stayed.id,
      disputeId: d.id,
      status: 'needs_response',
      reason: 'fraudulent',
      respondBy: addDaysISO(s.h.today, 6),
      canSubmit: true,
      downloadHref: `/api/admin/disputes/${d.id}/evidence`,
      printHref: `/api/admin/disputes/${d.id}/evidence?format=html`,
      openHref: `/admin/disputes?dispute=${d.id}`,
    });
    expect(disputeBlock(seen.events)?.points).toContain('The card payment was authenticated with 3D Secure by the cardholder’s bank.');
    expect(disputeBlock(seen.events)?.points).toContain('The cardholder’s name on the payment is the guest’s name.');

    // "Lucas" alone resolves to his upcoming booking; the dispute is on the stay, and that's what gets planned.
    const plan = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'submit_dispute_evidence', input: { guest: { name: 'Lucas' } } }]]);
    const planned = await drain(runHarness(owner.ctx('ok send it to stripe'), { client: plan.client }));
    expect(planned.result.risk).toBe('high');
    expect(planned.result.steps).toEqual([
      {
        tool: 'submit_dispute_evidence',
        args: { disputeId: d.id, bookingId: s.stayed.id },
        summary: `Submit the evidence for Lucas Silva’s $230.00 dispute (${s.stayed.code}) to Stripe`,
        detail: `Stripe passes it to the cardholder’s bank (due ${addDaysISO(s.h.today, 6)}). It can’t be undone, and a dispute is answered only once.`,
      },
    ]);
    // Planning sends nothing.
    expect(stripe.update).not.toHaveBeenCalled();

    // A manager may read it but not send it, and the advisor never gets the tool.
    const manager = await s.as('MANAGER');
    const refused = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'submit_dispute_evidence', input: { guest: { code: s.stayed.code } } }]]);
    const tried = await drain(runHarness(manager.ctx('submit the dispute evidence'), { client: refused.client }));
    expect(tried.result.steps).toHaveLength(0);
    expect(toolResults(refused.create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/Only owners can send dispute evidence/) });
    expect(HOTEL_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(['get_dispute', 'submit_dispute_evidence']));
    expect(HOTEL_WRITE_TOOLS_FOR_ADVISOR.map((t) => t.name)).not.toContain('submit_dispute_evidence');

    // Confirmed: Stripe gets the evidence once, and it's in the activity log.
    const { token } = signPlan({ userId: owner.actor.userId, propertyId: s.h.property.id, title: 'Send the dispute evidence', steps: planned.result.steps });
    const done = await confirmPlan(owner.actor, token);
    expect(done.blocks[0]).toMatchObject({ ok: true, lines: [`✓ Submitted the evidence for Lucas Silva’s $230.00 dispute (${s.stayed.code}) to Stripe`] });
    expect(stripe.update).toHaveBeenCalledTimes(1);
    expect(stripe.update.mock.calls[0][0]).toBe(d.stripeDisputeId);
    expect(stripe.update.mock.calls[0][1]).toMatchObject({ submit: true, evidence: { customer_name: 'Lucas Silva', service_date: expect.any(String) } });
    expect(await prisma.dispute.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: 'under_review', evidenceSubmittedById: owner.actor.userId, evidenceSubmittedAt: expect.any(Date) });
    const logged = await prisma.agentAuditLog.findMany({ where: { propertyId: s.h.property.id, action: 'DISPUTE_EVIDENCE_SUBMITTED' } });
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0].detail ?? '{}')).toMatchObject({ source: 'agent', disputeId: d.id, bookingId: s.stayed.id });

    // Answered once: there's nothing left to send.
    const again = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'submit_dispute_evidence', input: { guest: { code: s.stayed.code } } }]]);
    const twice = await drain(runHarness(owner.ctx('send it again'), { client: again.client }));
    expect(twice.result.steps).toHaveLength(0);
    expect(toolResults(again.create, 1)[0].content).toMatch(/no Stripe dispute waiting for evidence/);
  });

  it('several open disputes: asks which, with each one to pick', async () => {
    const s = await setup();
    await stripeDispute(s);
    const other = await setup();
    // Another hotel's dispute never shows up here.
    await stripeDispute(other);
    const second = await prisma.booking.create({
      data: { userId: s.stayed.userId, propertyId: s.h.property.id, roomTypeId: s.h.roomType.id, checkIn: atNoonUTC(addDaysISO(s.h.today, -20)), checkOut: atNoonUTC(addDaysISO(s.h.today, -18)), guests: 1, rooms: 1, totalPrice: 90, subtotalPrice: 90, status: 'CHECKED_OUT', code: `M${uid().toUpperCase().slice(0, 5)}` },
    });
    await prisma.dispute.create({ data: { stripeDisputeId: `dp_${uid()}`, bookingId: second.id, propertyId: s.h.property.id, amount: 90, status: 'warning_needs_response', reason: 'duplicate' } });
    const { ctx } = await s.as('OWNER');
    const { client, create } = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'get_dispute', input: {} }]]);
    const { events } = await drain(runHarness(ctx('someone raised a dispute'), { client }));
    const ask = events.find((e) => e.type === 'block' && e.block.type === 'clarify');
    expect(ask).toBeDefined();
    const options = (ask as { block: Extract<AgentBlock, { type: 'clarify' }> }).block.options;
    expect(options.map((o) => o.command)).toEqual([`Prepare the chargeback evidence for reservation ${s.stayed.code}`, `Prepare the chargeback evidence for reservation ${second.code}`]);
    expect(JSON.parse(toolResults(create, 1)[0].content.split('\n')[0]).openDisputes).toHaveLength(2);
  });

  it('knows the dispute open on the Disputes page, only at this hotel and for people who may see it', async () => {
    const s = await setup();
    const d = await stripeDispute(s);
    const page = `/admin/disputes?dispute=${d.id}`;
    const manager = await s.as('MANAGER');
    const seen = scriptedClient([[{ type: 'text', text: 'On it.' }]]);
    const r = await drain(runHarness(manager.ctx('prepare the evidence for this one'), { client: seen.client, page }));
    expect(firstMessage(seen.create)).toContain(`On screen: the card dispute on Lucas Silva’s reservation (#${s.stayed.code}): $230.00, fraudulent: the cardholder says they didn’t authorize the payment, needs the hotel’s response, respond by ${addDaysISO(s.h.today, 6)}.`);
    expect(r.result.memory.lastBookingId).toBe(s.stayed.id);

    const desk = await s.as('FRONT_DESK');
    const hidden = scriptedClient([[{ type: 'text', text: 'Which guest?' }]]);
    await drain(runHarness(desk.ctx('this one'), { client: hidden.client, page }));
    expect(firstMessage(hidden.create)).toContain('On screen: the Card disputes page.');
    expect(firstMessage(hidden.create)).not.toContain('Lucas');

    const other = await setup();
    const elsewhere = await other.as('OWNER');
    const leak = scriptedClient([[{ type: 'text', text: 'Which guest?' }]]);
    await drain(runHarness(elsewhere.ctx('this one'), { client: leak.client, page }));
    expect(firstMessage(leak.create)).not.toContain('Lucas');
  });
});
