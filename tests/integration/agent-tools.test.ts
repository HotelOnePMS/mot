import { describe, expect, it, vi } from 'vitest';

// Card refunds go to Stripe; the card authorization form goes by email.
const stripe = vi.hoisted(() => {
  const create = vi.fn(async (params: { amount: number }, _opts?: unknown) => ({ id: `re_${params.amount}`, amount: params.amount }));
  return {
    refunds: { create },
    paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { amount_refunded: create.mock.calls.reduce((s, c) => s + c[0].amount, 0) } })) },
  };
});
vi.mock('@/lib/stripe', async (original) => ({ ...(await original<typeof import('@/lib/stripe')>()), getStripe: () => stripe, isStripeConfigured: () => true }));
const mail = vi.hoisted(() => ({ request: vi.fn(async (_m: { to: string; url: string }) => true) }));
vi.mock('@/server/email', async (original) => ({ ...(await original<typeof import('@/server/email')>()), sendCardAuthorizationRequest: mail.request }));

import type { BookingStatus, User, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AgentBlock } from '@/lib/agent/blocks';
import { NO_EM_DASHES } from '@/lib/writing-style';
import { addDaysISO, atNoonUTC } from '@/server/dates';
import { confirmPlan } from '@/server/agent/engine';
import { HOTEL_TOOLS, HOTEL_WRITE_TOOLS_FOR_ADVISOR, runHarness, type HarnessResult } from '@/server/agent/harness';
import { signPlan } from '@/server/agent/plan';
import { zonedStartOfDay } from '@/server/services/reports';
import { actorFor, makeHotel, uid } from './fixtures';
import { drain, scriptedClient, toolResults } from './scripted-client';

const TZ = 'America/Los_Angeles';

async function setup() {
  const h = await makeHotel({ timezone: TZ });
  const guest = (firstName: string, lastName: string) =>
    prisma.user.create({ data: { email: `${firstName.toLowerCase()}-${uid()}@example.org`, phone: `+1 831 555 ${String(1000 + Math.floor(Math.random() * 8999))}`, password: '', firstName, lastName, role: 'CUSTOMER' } });
  const book = (user: User, o: { checkIn: string; nights?: number; status?: BookingStatus; total?: number; createdAt?: Date }) =>
    prisma.booking.create({
      data: {
        userId: user.id,
        propertyId: h.property.id,
        roomTypeId: h.roomType.id,
        checkIn: atNoonUTC(o.checkIn),
        checkOut: atNoonUTC(addDaysISO(o.checkIn, o.nights ?? 2)),
        guests: 1,
        rooms: 1,
        totalPrice: o.total ?? 230,
        subtotalPrice: o.total ?? 230,
        status: o.status ?? 'CONFIRMED',
        code: `T${uid().toUpperCase().slice(0, 5)}`,
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      },
    });
  const staff = async (role: UserRole, firstName: string, lastName: string) => {
    const user = await prisma.user.create({
      data: { email: `${firstName.toLowerCase()}-${uid()}@example.com`, password: '', firstName, lastName, role, assignedProperties: { create: [{ propertyId: h.property.id }] } },
    });
    const actor = await actorFor(user.id);
    const ctx = (message: string) => ({ actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message });
    return { user, actor, ctx };
  };
  /** An instant on the hotel's clock. */
  const at = (day: string, hh: number, mm = 0) => new Date(zonedStartOfDay(day, TZ).getTime() + (hh * 60 + mm) * 60_000);
  const log = (user: User, action: string, summary: string, data: Record<string, unknown>, createdAt: Date, source = 'classic') =>
    prisma.agentAuditLog.create({ data: { propertyId: h.property.id, userId: user.id, action, detail: JSON.stringify({ source, summary, ...data }), createdAt } });
  return { h, guest, book, staff, at, log, yesterday: addDaysISO(h.today, -1) };
}

type Staff = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['staff']>>;

/** One scripted tool call, then what the harness sent back for it. */
async function call(who: Staff, message: string, name: string, input: unknown) {
  const { client, create } = scriptedClient([[{ type: 'tool_use', id: 't1', name, input }]]);
  const { events, result } = await drain(runHarness(who.ctx(message), { client }));
  const res = toolResults(create, 1)[0];
  const blocks = events.filter((e) => e.type === 'block').map((e) => (e as { block: AgentBlock }).block);
  return { res, blocks, result, create };
}

async function confirm(who: Staff, propertyId: string, result: HarnessResult) {
  const { token } = signPlan({ userId: who.actor.userId, propertyId, title: 'Test plan', steps: result.steps });
  return (await confirmPlan(who.actor, token)).blocks[0] as Extract<AgentBlock, { type: 'result' }>;
}

describe('the agent reads the logs', () => {
  it('"anything I should look at this week?": what deserves a second look, why, and the patterns', async () => {
    const s = await setup();
    const maria = await s.staff('MANAGER', 'Maria', 'Lopez');
    const sam = await s.staff('FRONT_DESK', 'Sam', 'Reyes');
    const owner = await s.staff('OWNER', 'Olivia', 'Grant');
    const a = await s.book(await s.guest('Ana', 'Patel'), { checkIn: addDaysISO(s.h.today, -2), status: 'CHECKED_IN' });
    const b = await s.book(await s.guest('Ben', 'Cole'), { checkIn: addDaysISO(s.h.today, -3), status: 'CHECKED_OUT' });
    const y = s.yesterday;
    await s.log(maria.user, 'PAYMENT_REFUND', `Refunded 80.00 USD on ${a.code} (AC broken)`, { bookingId: a.id }, s.at(y, 2, 30));
    await s.log(maria.user, 'FOLIO_ALLOWANCE', `Allowance of $40.00 on ${a.code}: noisy room`, { bookingId: a.id }, s.at(y, 10));
    await s.log(maria.user, 'PAYMENT_OTHER', `Payment of 230.00 USD taken another way (paid to Expedia), recorded by Maria Lopez · ${b.code}`, { bookingId: b.id }, s.at(y, 11));
    await s.log(sam.user, 'BOOKING_CHECKED_IN', `Checked in Ana Patel (${a.code})`, { bookingId: a.id }, s.at(y, 15), 'agent');
    await s.log(owner.user, 'COMMAND', 'Asked: “brief me”', { message: 'brief me' }, s.at(y, 9), 'agent');
    await s.log(maria.user, 'PAYMENT_REFUND', 'Refunded 10.00 USD on an old stay', {}, s.at(addDaysISO(s.h.today, -20), 12));
    const expedia = await prisma.channelConnection.create({ data: { propertyId: s.h.property.id, channel: 'EXPEDIA', status: 'ERROR' } });
    await prisma.channelSyncLog.create({ data: { connectionId: expedia.id, action: 'ARI_PUSH', status: 'FAILED', message: 'Authentication failed', createdAt: s.at(y, 6) } });

    const { res, blocks, result } = await call(owner, 'anything i should look at this week?', 'search_activity_log', { worth_checking: true });
    const facts = JSON.parse(res.content);
    expect(facts.window).toMatchObject({ from: addDaysISO(s.h.today, -6), to: s.h.today, timezone: TZ, days: 7 });
    // Newest first, on the hotel's clock; the old refund, the plain check-in and what people asked the agent aren't in it.
    expect(facts.entries.map((e: { who: string; flag: string; at: string }) => [e.who, e.flag, e.at])).toEqual([
      ['Maria Lopez', 'Marked paid another way (no card or cash in the system)', `${y} 11:00`],
      ['Maria Lopez', 'Money taken off a stay', `${y} 10:00`],
      ['Expedia', 'Channel sync failed', `${y} 06:00`],
      ['Maria Lopez', 'Money handed back, overnight', `${y} 02:30`],
    ]);
    expect(facts.entries[3]).toMatchObject({ kind: 'payments', via: 'screens', reservation: a.code });
    expect(facts.patterns).toEqual([
      'Maria Lopez made 3 of the refunds, discounts, “paid another way” payments or lowered amounts.',
      `Reservation #${a.code} had 2 money-reducing entries (Maria Lopez).`,
    ]);
    expect(facts.byPerson).toEqual([
      { name: 'Maria Lopez', entries: 3, worthChecking: 3 },
      { name: 'Expedia', entries: 1, worthChecking: 1 },
    ]);
    const card = blocks.find((x): x is Extract<AgentBlock, { type: 'activity' }> => x.type === 'activity');
    expect(card).toMatchObject({ title: 'Worth a look', total: 4, href: '/admin/activity' });
    expect(card?.items.map((i) => i.flag)).toEqual(facts.entries.map((e: { flag: string }) => e.flag));
    // Reading the log changes nothing.
    expect(result.steps).toHaveLength(0);
  });

  it('"who cancelled the Okafor booking?": the reservation’s whole history, the log and the status changes it has no row for', async () => {
    const s = await setup();
    const maria = await s.staff('MANAGER', 'Maria', 'Lopez');
    const created = s.at(addDaysISO(s.h.today, -10), 9);
    const c = await s.book(await s.guest('James', 'Okafor'), { checkIn: addDaysISO(s.h.today, 5), status: 'CANCELLED', createdAt: created });
    await prisma.bookingStatusHistory.create({ data: { bookingId: c.id, status: 'CONFIRMED', notes: 'Paid online', createdAt: s.at(addDaysISO(s.h.today, -10), 9, 1) } });
    await prisma.bookingStatusHistory.create({ data: { bookingId: c.id, status: 'CANCELLED', notes: 'Guest called', createdAt: s.at(s.yesterday, 14) } });
    await s.log(maria.user, 'BOOKING_CANCELLED', `Cancelled James Okafor (${c.code})`, { bookingId: c.id }, s.at(s.yesterday, 14));

    const { res, result } = await call(maria, 'who cancelled the okafor booking', 'search_activity_log', { guest: { name: 'okafor' } });
    const facts = JSON.parse(res.content);
    expect(facts.window.from).toBe(addDaysISO(s.h.today, -10));
    expect(facts.filters.guest).toBe(`James Okafor (#${c.code})`);
    // The cancellation once (the log's row, with who did it), and the confirmation only the status history has.
    expect(facts.entries.map((e: { who: string; what: string }) => [e.who, e.what])).toEqual([
      ['Maria Lopez', `Cancelled James Okafor (${c.code})`],
      ['Reservation history', 'Reservation confirmed: Paid online'],
    ]);
    expect(result.memory.lastBookingId).toBe(c.id);
  });

  it('filters by person, kind, room and words; says who has entries when a name matches nobody; front desk can’t read it', async () => {
    const s = await setup();
    const maria = await s.staff('MANAGER', 'Maria', 'Lopez');
    const sam = await s.staff('FRONT_DESK', 'Sam', 'Reyes');
    const a = await s.book(await s.guest('Ana', 'Patel'), { checkIn: addDaysISO(s.h.today, -2), status: 'CHECKED_IN' });
    const y = s.yesterday;
    await s.log(maria.user, 'PAYMENT_REFUND', `Refunded 80.00 USD on ${a.code} (AC broken)`, { bookingId: a.id }, s.at(y, 12));
    await s.log(maria.user, 'FOLIO_ALLOWANCE', `Allowance of $40.00 on ${a.code}: noisy room`, { bookingId: a.id }, s.at(y, 13));
    await s.log(sam.user, 'ROOM_OUT_OF_ORDER', 'Room 101 out of order: broken AC', { roomId: s.h.rooms[0].id }, s.at(y, 8));
    await s.log(sam.user, 'ROOM_STATUS', 'Room 1012: Dirty → Clean', {}, s.at(y, 9));

    const mine = JSON.parse((await call(maria, 'what payments did maria handle', 'search_activity_log', { person: 'maria', kinds: ['payments'] })).res.content);
    expect(mine.entries.map((e: { what: string }) => e.what)).toEqual([`Refunded 80.00 USD on ${a.code} (AC broken)`]);
    expect(mine.byKind).toEqual({ payments: 1 });

    const room = JSON.parse((await call(maria, 'why is 101 out of order', 'search_activity_log', { room_number: '101' })).res.content);
    expect(room.entries.map((e: { what: string }) => e.what)).toEqual(['Room 101 out of order: broken AC']);

    // Words from the start of a word, in what the entries say: "ac" is the AC, not part of a code or a field name.
    const words = JSON.parse((await call(maria, 'anything about the AC?', 'search_activity_log', { text: 'ac' })).res.content);
    expect(words.entries.map((e: { what: string }) => e.what)).toEqual([`Refunded 80.00 USD on ${a.code} (AC broken)`, 'Room 101 out of order: broken AC']);
    const refunds = JSON.parse((await call(maria, 'any refunds', 'search_activity_log', { text: 'refund' })).res.content);
    expect(refunds.total).toBe(1);

    const nobody = await call(maria, 'what did zed do', 'search_activity_log', { person: 'zed' });
    expect(nobody.res.content).toMatch(/^Nobody called “zed” has entries .*People with entries then: .*(Maria Lopez|Sam Reyes)/);

    const desk = await call(sam, 'who refunded patel', 'search_activity_log', { guest: { name: 'patel' } });
    expect(desk.res).toMatchObject({ is_error: true, content: expect.stringMatching(/activity log is for managers and owners/) });
    expect(desk.blocks.some((b) => b.type === 'activity')).toBe(false);
  });
});

describe('the agent handles money at the desk', () => {
  it('records cash for the balance (with change), and asks for what each other way needs', async () => {
    const s = await setup();
    const desk = await s.staff('FRONT_DESK', 'Sam', 'Reyes');
    const a = await s.book(await s.guest('Ana', 'Patel'), { checkIn: s.h.today, status: 'CHECKED_IN', total: 230 });

    const planned = await call(desk, 'patel paid the rest in cash, gave me 250', 'record_payment', { guest: { name: 'patel' }, method: 'cash', tendered: 250 });
    expect(planned.result.risk).toBe('medium');
    expect(planned.result.steps).toEqual([
      {
        tool: 'record_payment',
        args: { bookingId: a.id, kind: 'PAYMENT', method: 'CASH', amount: 230, tendered: 250 },
        summary: `Record $230.00 in cash from Ana Patel (${a.code})`,
        detail: 'Pays the stay in full · change $20.00',
      },
    ]);
    expect(await prisma.payment.count({ where: { bookingId: a.id } })).toBe(0);
    const done = await confirm(desk, s.h.property.id, planned.result);
    expect(done).toMatchObject({ ok: true, lines: [`✓ Recorded $230.00 in cash from Ana Patel (${a.code})`] });
    expect(await prisma.payment.findFirst({ where: { bookingId: a.id } })).toMatchObject({ method: 'CASH', kind: 'PAYMENT', status: 'SUCCEEDED', cashTendered: expect.anything() });
    const logged = await prisma.agentAuditLog.findFirstOrThrow({ where: { propertyId: s.h.property.id, action: 'PAYMENT_CASH' } });
    expect(JSON.parse(logged.detail!)).toMatchObject({ source: 'agent', bookingId: a.id });

    const b = await s.book(await s.guest('Ben', 'Cole'), { checkIn: s.h.today, status: 'CHECKED_IN', total: 100 });
    const noDigits = await call(desk, 'cole paid on our terminal', 'record_payment', { guest: { name: 'cole' }, method: 'own_terminal' });
    expect(noDigits.res).toMatchObject({ is_error: true, content: expect.stringMatching(/last four digits/) });
    const noNote = await call(desk, 'cole paid another way', 'record_payment', { guest: { name: 'cole' }, method: 'other' });
    expect(noNote.res).toMatchObject({ is_error: true, content: expect.stringMatching(/Say how it was paid/) });
    const tooMuch = await call(desk, 'cole paid 500 cash', 'record_payment', { guest: { name: 'cole' }, method: 'cash', amount: 500 });
    expect(tooMuch.res).toMatchObject({ is_error: true, content: expect.stringMatching(/Collect at most that/) });
    expect(await prisma.payment.count({ where: { bookingId: b.id } })).toBe(0);
  });

  it('refunds: asks how much when not told, refunds the card through Stripe with the discount, and only for managers and owners', async () => {
    const s = await setup();
    const manager = await s.staff('MANAGER', 'Maria', 'Lopez');
    const desk = await s.staff('FRONT_DESK', 'Sam', 'Reyes');
    const a = await s.book(await s.guest('Lucas', 'Silva'), { checkIn: addDaysISO(s.h.today, -1), status: 'CHECKED_IN', total: 230 });
    await prisma.booking.update({ where: { id: a.id }, data: { paymentStatus: 'PAID' } });
    const pay = await prisma.payment.create({
      data: { bookingId: a.id, propertyId: s.h.property.id, stripePaymentIntentId: `pi_${uid()}${uid()}`, status: 'SUCCEEDED', amount: 230, currency: 'usd', cardBrand: 'visa', cardLast4: '4242', paidAt: new Date() },
    });

    const ask = await call(manager, 'refund lucas, the ac was broken', 'refund_payment', { guest: { name: 'lucas' }, reason: 'AC broken' });
    expect(ask.res).toMatchObject({ is_error: true, content: expect.stringMatching(/^Ask how much to refund: up to \$230\.00 \(\$230\.00 from card ending 4242\)/) });
    expect(ask.result.steps).toHaveLength(0);

    const planned = await call(manager, 'refund lucas $80, the ac was broken, and take it off the stay', 'refund_payment', {
      guest: { name: 'lucas' },
      amount: 80,
      reason: 'AC broken one night',
      also_discount: true,
    });
    expect(planned.result.risk).toBe('high');
    expect(planned.result.steps).toEqual([
      {
        tool: 'refund_payment',
        args: { bookingId: a.id, paymentId: pay.id, via: 'card', amount: 80, reason: 'AC broken one night', allowance: true },
        summary: `Refund $80.00 to Lucas Silva’s card ending 4242 (${a.code})`,
        detail: 'AC broken one night · the stay also costs $80.00 less',
      },
    ]);
    expect(planned.result.warnings).toContain('A card refund goes back through Stripe and can’t be undone.');
    expect(stripe.refunds.create).not.toHaveBeenCalled();

    const done = await confirm(manager, s.h.property.id, planned.result);
    expect(done).toMatchObject({ ok: true, lines: [`✓ Refunded $80.00 to Lucas Silva’s card ending 4242 (${a.code})`] });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create.mock.calls[0][0]).toMatchObject({ amount: 8000 });
    expect(Number((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).amountRefunded)).toBe(80);
    expect(await prisma.folioAllowance.count({ where: { bookingId: a.id } })).toBe(1);

    const refused = await call(desk, 'refund lucas 20', 'refund_payment', { guest: { name: 'lucas' }, amount: 20, reason: 'goodwill' });
    expect(refused.result.steps).toHaveLength(0);
    expect(refused.res).toMatchObject({ is_error: true, content: expect.stringMatching(/Refunds are given by managers and owners/) });
  });

  it('cash back at the desk, and the card authorization form emailed to whoever pays', async () => {
    process.env.NEXT_PUBLIC_SITE_URL ||= 'https://hotel.example.org';
    const s = await setup();
    const owner = await s.staff('OWNER', 'Olivia', 'Grant');
    const a = await s.book(await s.guest('Ana', 'Patel'), { checkIn: s.h.today, status: 'CHECKED_IN', total: 230 });
    await prisma.payment.create({ data: { bookingId: a.id, propertyId: s.h.property.id, method: 'CASH', kind: 'PAYMENT', status: 'SUCCEEDED', amount: 230, currency: 'usd', paidAt: new Date() } });

    const cash = await call(owner, 'give patel 30 back in cash', 'refund_payment', { guest: { name: 'patel' }, amount: 30, from: 'cash', reason: 'Late breakfast' });
    expect(cash.result.steps[0]).toMatchObject({ args: { via: 'desk', amount: 30 }, summary: `Hand back $30.00 in cash to Ana Patel (${a.code})` });
    expect(await confirm(owner, s.h.property.id, cash.result)).toMatchObject({ ok: true, lines: [`✓ Handed back $30.00 in cash to Ana Patel (${a.code})`] });

    const form = await call(owner, 'send acme the card form for patel, ap@acme.example covers incidentals up to 200', 'request_card_authorization', {
      guest: { name: 'patel' },
      cardholder_name: 'Acme Travel',
      cardholder_email: 'ap@acme.example',
      covers_incidentals: true,
      incidentals_limit: 200,
    });
    expect(form.result.steps[0]).toMatchObject({
      tool: 'request_card_authorization',
      summary: expect.stringMatching(new RegExp(`^Email Acme Travel \\(ap@acme\\.example\\) the card authorization form for Ana Patel’s stay \\(${a.code}, `)),
      detail: 'Covers the stay and incidentals up to $200.00 · for Ana Patel · they sign online and add their ID',
    });
    const sent = await confirm(owner, s.h.property.id, form.result);
    expect(sent.ok).toBe(true);
    expect(mail.request).toHaveBeenCalledTimes(1);
    expect(mail.request.mock.calls[0][0]).toMatchObject({ to: 'ap@acme.example' });
    // The link's token goes to the cardholder, never into the conversation.
    expect(sent.lines.join(' ')).not.toContain(mail.request.mock.calls[0][0].url);
    expect(await prisma.cardAuthorization.findFirst({ where: { bookingId: a.id } })).toMatchObject({ status: 'PENDING', cardholderEmail: 'ap@acme.example', coversIncidentals: true });
  });
});

describe('the agent and guests', () => {
  it('the do-not-rent list: checks a guest, asks for the reason, adds them, finds them by name and takes them off', async () => {
    const s = await setup();
    const manager = await s.staff('MANAGER', 'Maria', 'Lopez');
    const user = await s.guest('Rick', 'Moran');
    const a = await s.book(user, { checkIn: addDaysISO(s.h.today, -3), status: 'CHECKED_OUT' });

    const clean = JSON.parse((await call(manager, 'is moran on the dnr list', 'check_do_not_rent', { guest: { name: 'moran' } })).res.content);
    expect(clean).toMatchObject({ onTheList: false, guest: 'Rick Moran', reservation: a.code });

    const why = await call(manager, 'add moran to do not rent', 'update_do_not_rent', { action: 'add', guest: { name: 'moran' } });
    expect(why.res).toMatchObject({ is_error: true, content: expect.stringMatching(/^Ask why Rick Moran shouldn’t be rented to again/) });

    const add = await call(manager, 'add moran to do not rent, he smoked in the room', 'update_do_not_rent', { action: 'add', guest: { name: 'moran' }, reason: 'Smoked in the room' });
    expect(add.result.steps[0]).toMatchObject({ tool: 'add_do_not_rent', summary: 'Add Rick Moran to the do-not-rent list', detail: '“Smoked in the room” · recognised by email and phone on future bookings' });
    expect(await confirm(manager, s.h.property.id, add.result)).toMatchObject({ ok: true, lines: ['✓ Added Rick Moran to the do-not-rent list'] });
    expect(await prisma.doNotRent.findFirst({ where: { propertyId: s.h.property.id } })).toMatchObject({ guestName: 'Rick Moran', email: user.email, reason: 'Smoked in the room' });

    const listed = JSON.parse((await call(manager, 'is rick moran on it', 'check_do_not_rent', { name: 'rick moran' })).res.content);
    expect(listed).toMatchObject({ onTheList: true, entries: [{ name: 'Rick Moran', reason: 'Smoked in the room', addedBy: 'Maria Lopez' }] });

    const remove = await call(manager, 'take rick off the list', 'update_do_not_rent', { action: 'remove', name: 'rick' });
    expect(remove.result.steps[0]).toMatchObject({ tool: 'remove_do_not_rent', summary: 'Take Rick Moran off the do-not-rent list' });
    expect(await confirm(manager, s.h.property.id, remove.result)).toMatchObject({ ok: true, lines: ['✓ Took Rick Moran off the do-not-rent list'] });
    expect(await prisma.doNotRent.count({ where: { propertyId: s.h.property.id } })).toBe(0);
    expect(await prisma.agentAuditLog.count({ where: { propertyId: s.h.property.id, action: { in: ['DNR_ADD', 'DNR_REMOVE'] } } })).toBe(2);
  });

  it('guest messages: lists what’s waiting and marks one handled', async () => {
    const s = await setup();
    const desk = await s.staff('FRONT_DESK', 'Sam', 'Reyes');
    const priya = await prisma.guestRequest.create({ data: { propertyId: s.h.property.id, name: 'Priya Shah', phone: '+1 831 555 0199', message: 'Please call back about a late check-out', source: 'PHONE' } });
    await prisma.guestRequest.create({ data: { propertyId: s.h.property.id, name: 'Tom Lee', message: 'Is parking free?', source: 'WHATSAPP' } });

    const list = JSON.parse((await call(desk, 'any messages?', 'list_guest_requests', {})).res.content);
    expect(list.open).toBe(2);
    expect(list.requests).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: priya.id, from: 'Priya Shah', via: 'Phone call', status: 'open', message: 'Please call back about a late check-out' })])
    );

    const mark = await call(desk, 'i called priya back', 'mark_guest_request', { from: 'priya' });
    expect(mark.result.steps).toEqual([
      { tool: 'mark_guest_request', args: { requestId: priya.id, status: 'DONE' }, summary: 'Mark Priya Shah’s message handled', detail: '“Please call back about a late check-out”' },
    ]);
    expect(await confirm(desk, s.h.property.id, mark.result)).toMatchObject({ ok: true, lines: ['✓ Marked Priya Shah’s message handled'] });
    expect(await prisma.guestRequest.findUniqueOrThrow({ where: { id: priya.id } })).toMatchObject({ status: 'DONE', handledById: desk.actor.userId });
  });
});

describe('the agent runs the hotel', () => {
  it('the night audit: shows what’s open, asks about no-shows, then closes the day', async () => {
    const s = await setup();
    const desk = await s.staff('FRONT_DESK', 'Sam', 'Reyes');
    const late = await s.book(await s.guest('Nora', 'Quinn'), { checkIn: s.yesterday, status: 'CONFIRMED' });

    const status = await call(desk, 'what’s left before i close yesterday', 'night_audit_status', { date: s.yesterday });
    expect(status.blocks.filter((b) => b.type !== 'text').map((b) => b.type)).toEqual(['stats', 'bookings']);
    expect(status.blocks[1]).toMatchObject({ title: 'Never arrived (possible no-shows)', items: [expect.objectContaining({ id: late.id })] });
    expect(JSON.parse(status.res.content)).toMatchObject({ businessDate: s.yesterday, closed: false, possibleNoShows: [{ guest: 'Nora Quinn', reservation: late.code }] });

    const ask = await call(desk, 'close the day', 'close_business_day', { date: s.yesterday });
    expect(ask.res).toMatchObject({ is_error: true, content: expect.stringMatching(/^1 arrival never checked in: Nora Quinn .* Ask whether to mark them as no-shows/) });

    const close = await call(desk, 'mark her no show and close the day', 'close_business_day', { date: s.yesterday, no_shows: 'all' });
    expect(close.result.risk).toBe('high');
    expect(close.result.steps[0]).toMatchObject({ tool: 'close_business_day', args: { businessDate: s.yesterday, noShowBookingIds: [late.id], flagOccupiedRooms: true } });
    const done = await confirm(desk, s.h.property.id, close.result);
    expect(done.ok).toBe(true);
    expect(done.lines[0]).toMatch(/^✓ Closed .+: 1 no-show marked, \d+% occupancy$/);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: late.id } })).status).toBe('NO_SHOW');
    expect(await prisma.nightAudit.count({ where: { propertyId: s.h.property.id } })).toBe(1);
  });

  it('a room type’s base price, logged before and after; front desk can’t', async () => {
    const s = await setup();
    const manager = await s.staff('MANAGER', 'Maria', 'Lopez');
    const desk = await s.staff('FRONT_DESK', 'Sam', 'Reyes');

    const planned = await call(manager, 'raise the queen base price to 120', 'update_room_type', { room_type: 'queen', base_price: 120 });
    expect(planned.result.steps).toEqual([{ tool: 'update_room_type', args: { roomTypeId: s.h.roomType.id, basePrice: 120 }, summary: 'Queen: base price $100.00 → $120.00', detail: 'Room type settings' }]);
    expect(planned.result.warnings[0]).toMatch(/^The base price is used on nights without their own rate/);
    expect(await confirm(manager, s.h.property.id, planned.result)).toMatchObject({ ok: true, lines: ['✓ Updated Queen: base price $100.00 → $120.00'] });
    expect(Number((await prisma.roomType.findUniqueOrThrow({ where: { id: s.h.roomType.id } })).basePrice)).toBe(120);
    const logged = await prisma.agentAuditLog.findFirstOrThrow({ where: { propertyId: s.h.property.id, action: 'ROOM_TYPE_UPDATE' } });
    expect(JSON.parse(logged.detail!)).toMatchObject({ source: 'agent', summary: 'Updated room type Queen: base price $120.00 (was $100.00)', before: { basePrice: 100 }, after: { basePrice: 120 } });

    const refused = await call(desk, 'make the queen 90', 'update_room_type', { room_type: 'queen', base_price: 90 });
    expect(refused.res).toMatchObject({ is_error: true, content: expect.stringMatching(/managers and owners/) });
  });

  it('the booking channels: connected, syncing and their recent failures', async () => {
    const s = await setup();
    const owner = await s.staff('OWNER', 'Olivia', 'Grant');
    const c = await prisma.channelConnection.create({ data: { propertyId: s.h.property.id, channel: 'BOOKING_COM', status: 'ACTIVE', mode: 'LIVE', lastError: 'Rate push rejected' } });
    await prisma.channelSyncLog.create({ data: { connectionId: c.id, action: 'ARI_PUSH', status: 'FAILED', message: 'Rate push rejected' } });
    await prisma.channelSyncLog.create({ data: { connectionId: c.id, action: 'RESERVATION_PULL', status: 'SUCCESS', message: '2 reservations' } });
    const facts = JSON.parse((await call(owner, 'is booking.com syncing ok', 'channel_status', {})).res.content);
    expect(facts.channels).toEqual([
      expect.objectContaining({ channel: 'Booking.com', status: 'active', mode: 'live', lastError: 'Rate push rejected', failuresLast7Days: 1, recentFailures: [expect.objectContaining({ action: 'ari push', message: 'Rate push rejected' })] }),
    ]);
  });
});

describe('every tool, and when to use it', () => {
  it('the routing guide names every tool; the advisor never gets the guest and money writes', async () => {
    const names = HOTEL_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'search_activity_log',
        'check_do_not_rent',
        'list_guest_requests',
        'night_audit_status',
        'channel_status',
        'record_payment',
        'refund_payment',
        'request_card_authorization',
        'update_do_not_rent',
        'mark_guest_request',
        'close_business_day',
        'update_room_type',
      ])
    );
    expect(names).not.toContain('recent_activity');
    const advisor = HOTEL_WRITE_TOOLS_FOR_ADVISOR.map((t) => t.name);
    expect(advisor).toContain('update_room_type');
    for (const n of ['record_payment', 'refund_payment', 'request_card_authorization', 'update_do_not_rent', 'mark_guest_request', 'close_business_day', 'edit_folio']) expect(advisor).not.toContain(n);

    const s = await setup();
    const owner = await s.staff('OWNER', 'Olivia', 'Grant');
    const { client, create } = scriptedClient([[{ type: 'text', text: 'Hello.' }]]);
    await drain(runHarness(owner.ctx('hi'), { client }));
    const system = (create.mock.calls[0][0] as unknown as { system: string }).system;
    for (const n of names) expect(system, `the guide doesn’t mention ${n}`).toMatch(new RegExp(`\\b${n}\\b`));
    // No em dashes in what the model reads (besides the rule against them), so none in what it writes.
    expect(system).toContain(NO_EM_DASHES);
    expect(system.replace(NO_EM_DASHES, '')).not.toContain('—');
    for (const t of HOTEL_TOOLS) expect(`${t.name}: ${t.description}`).not.toContain('—');
  });
});
