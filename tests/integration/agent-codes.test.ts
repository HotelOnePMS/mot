import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { AgentBlock, AgentContextState } from '@/lib/agent/blocks';
import { confirmPlan, runAgent } from '@/server/agent/engine';
import { parseMessage } from '@/server/agent/nlu';
import { agentActor } from '@/server/agent/policy';
import { resolveBooking } from '@/server/agent/resolve';
import { parseShortcutArgs } from '@/server/agent/skills';
import type { Actor } from '@/server/authz';
import { addDaysISO, atNoonUTC } from '@/server/dates';
import { transitionBooking } from '@/server/services/bookings';
import { frontDeskSummary } from '@/server/services/frontdesk';
import { createDeskReservation } from '@/server/services/reservations';
import { fillPlaceholders, parametersFor, upsertSkill } from '@/server/skills';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

/** One message through the agent: what it showed and the plan it made (if any). */
async function ask(actor: Actor, propertyId: string, message: string) {
  const blocks: AgentBlock[] = [];
  let context: AgentContextState = {};
  for await (const e of runAgent({ actor, propertyId, message, memory: {} })) {
    if (e.type === 'block') blocks.push(e.block);
    if (e.type === 'context') context = e.context;
    if (e.type === 'error') blocks.push({ type: 'error', text: e.message });
  }
  const plan = blocks.find((b) => b.type === 'plan');
  return { blocks, context, text: JSON.stringify(blocks), token: plan?.type === 'plan' ? plan.plan.token : undefined };
}

/** A booking code without a digit (about 1 in 6 generated codes), optionally starting with a word the parser knows. Unused so far. */
async function letterCode(prefix = ''): Promise<string> {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  for (;;) {
    let code = prefix;
    while (code.length < Math.max(6, prefix.length + 2)) code += letters[Math.floor(Math.random() * letters.length)];
    if (!(await prisma.booking.findFirst({ where: { code }, select: { id: true } }))) return code;
  }
}

/** A hotel with an owner, a front desk person and a guest arriving today whose code has no digit. */
async function hotelWithLetterCode(status: 'PENDING' | 'CONFIRMED' = 'CONFIRMED') {
  const h = await makeHotel({ rooms: 3 });
  const pid = h.property.id;
  const owner = await actorFor((await makeUser({ role: 'OWNER', propertyIds: [pid] })).id);
  const desk = await actorFor((await makeUser({ role: 'FRONT_DESK', propertyIds: [pid] })).id);
  const b = await createDeskReservation(
    { actor: owner, source: 'classic' },
    { propertyId: pid, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 2), guests: 1, rooms: 1, guest: { firstName: `Grace${uid()}`, lastName: 'Okafor' } },
  );
  const code = await letterCode();
  await prisma.booking.update({ where: { id: b.id }, data: { code, status } });
  return { h, pid, owner, desk, booking: { ...b, code }, name: b.guest.name };
}

const statusOf = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

/** The commands offered in a booking card or a "which guest?" question. */
function offered(blocks: AgentBlock[]): { label: string; command: string }[] {
  return blocks.flatMap((b) => (b.type === 'booking' ? b.actions : b.type === 'clarify' ? b.options : []));
}

describe('booking codes without a digit', () => {
  it('the quick actions confirm, check in and check out work end to end', async () => {
    const { pid, desk, booking, name } = await hotelWithLetterCode('PENDING');

    // The booking card's "Confirm" button.
    const card = await ask(desk, pid, `show reservation ${booking.code}`);
    const confirm = offered(card.blocks).find((a) => a.label === 'Confirm')!;
    expect(parseMessage(confirm.command, booking.checkIn)).toEqual([{ kind: 'confirm', ref: { code: booking.code } }]);
    const confirming = await ask(desk, pid, confirm.command);
    expect(confirming.text).toContain(name);
    expect((await confirmPlan(desk, confirming.token!)).blocks[0]).toMatchObject({ type: 'result', ok: true });
    expect(await statusOf(booking.id)).toBe('CONFIRMED');

    // "Check in a guest" with nobody named offers today's arrivals (also the numbered replies on WhatsApp).
    const pick = await ask(desk, pid, 'check in a guest');
    const checkIn = offered(pick.blocks).find((o) => o.label === `Check in ${name}`)!;
    expect(parseMessage(checkIn.command, booking.checkIn)).toMatchObject([{ kind: 'checkIn', ref: { code: booking.code } }]);
    const checkingIn = await ask(desk, pid, checkIn.command);
    expect(checkingIn.token).toBeDefined();
    expect((await confirmPlan(desk, checkingIn.token!)).blocks[0]).toMatchObject({ type: 'result', ok: true });
    expect(await statusOf(booking.id)).toBe('CHECKED_IN');

    // The card's "Check out" button.
    const checkOut = offered((await ask(desk, pid, `show reservation ${booking.code}`)).blocks).find((a) => a.label === 'Check out')!;
    const checkingOut = await ask(desk, pid, checkOut.command);
    expect((await confirmPlan(desk, checkingOut.token!)).blocks[0]).toMatchObject({ type: 'result', ok: true });
    expect(await statusOf(booking.id)).toBe('CHECKED_OUT');
  });

  it('finds the booking when the code is typed by hand, at this hotel only', async () => {
    const { pid, desk, booking, name } = await hotelWithLetterCode();
    const elsewhere = await hotelWithLetterCode();

    const r = await ask(desk, pid, `check in ${booking.code}`);
    expect(r.token).toBeDefined();
    expect(r.text).toContain(`Check in ${name}`);
    expect((await confirmPlan(desk, r.token!)).blocks[0]).toMatchObject({ type: 'result', ok: true });
    expect(await statusOf(booking.id)).toBe('CHECKED_IN');

    // Another hotel's code is nothing here.
    const other = await ask(desk, pid, `check in ${elsewhere.booking.code}`);
    expect(other.token).toBeUndefined();
    expect(other.text).toContain(`I couldn’t find a guest called “${elsewhere.booking.code}”`);
    expect(other.text).not.toContain(elsewhere.name);

    // Look-ups are still checked first.
    const housekeeper = await actorFor((await makeUser({ role: 'HOUSEKEEPER', propertyIds: [pid] })).id);
    const ctx = { actor: await agentActor(housekeeper, pid), propertyId: pid, propertyName: 'Test', today: booking.checkIn, memory: {}, message: `show ${booking.code}` };
    const refused = await resolveBooking(ctx, { name: booking.code }, 'any');
    expect(refused).toMatchObject({ ok: false, block: { type: 'error', text: 'Your role can’t look up reservations. The owner can change this under Agent access.' } });
  });

  it('keeps the code in the other commands it offers', async () => {
    const { h, pid, owner, desk, booking } = await hotelWithLetterCode();
    // A second "Okafor" arriving today: "check in okafor" asks which one.
    const twin = await createDeskReservation(
      { actor: owner, source: 'classic' },
      { propertyId: pid, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: `Ada${uid()}`, lastName: 'Okafor' } },
    );
    const which = offered((await ask(desk, pid, 'check in okafor')).blocks);
    const refs = which.map((o) => parseMessage(o.command, h.today)).map(([i]) => (i.kind === 'checkIn' ? i.ref : i.kind));
    expect(refs).toHaveLength(2);
    expect(refs).toEqual(expect.arrayContaining([{ code: booking.code }, { code: twin.code }]));

    // A shortcut's "who for?" answers.
    const body = { steps: [{ command: 'add a note to {guest}: late checkout' }] };
    await upsertSkill({ propertyId: pid, title: 'Late checkout', description: 'Notes a late checkout', kind: 'MACRO', audience: 'STAFF', parameters: parametersFor('MACRO', body), body, status: 'ACTIVE' });
    const who = offered((await ask(desk, pid, 'run late checkout')).blocks).find((o) => o.command.endsWith(booking.code))!;
    expect(who.command).toBe(`run late checkout for #${booking.code}`);
    const step = fillPlaceholders('late-checkout', body.steps[0].command, parseShortcutArgs(who.command.replace(/^run late checkout\s+/, ''), parametersFor('MACRO', body)));
    expect(parseMessage(step, h.today)).toEqual([{ kind: 'note', ref: { code: booking.code }, text: 'Late checkout' }]);
    const noting = await ask(desk, pid, who.command);
    expect(noting.token).toBeDefined();

    // The front desk alert about a late arrival, even for a code that starts like "departures".
    const late = await createDeskReservation(
      { actor: owner, source: 'classic' },
      { propertyId: pid, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: `Lee${uid()}`, lastName: 'Late' } },
    );
    const lateCode = await letterCode('DEPART');
    // Due yesterday and not here yet.
    await prisma.booking.update({ where: { id: late.id }, data: { code: lateCode, checkIn: atNoonUTC(addDaysISO(h.today, -1)) } });
    const alert = (await frontDeskSummary(owner, pid, h.today)).alerts.find((a) => a.id === 'late')!;
    expect(parseMessage(alert.command!, h.today)).toEqual([{ kind: 'find', ref: { code: lateCode } }]);
    expect((await ask(desk, pid, alert.command!)).text).toContain(`"code":"${lateCode}"`);
  });
});

describe('taking a room out of order', () => {
  it('names the guest in the room only to people who may look up reservations', async () => {
    const { h, pid, owner, desk, booking, name } = await hotelWithLetterCode();
    await transitionBooking({ actor: owner, source: 'classic' }, booking.id, 'CHECKED_IN', { roomId: h.rooms[0].id });
    const arriving = await createDeskReservation(
      { actor: owner, source: 'classic' },
      { propertyId: pid, roomTypeId: h.roomType.id, checkIn: addDaysISO(h.today, 1), checkOut: addDaysISO(h.today, 2), guests: 1, rooms: 1, roomId: h.rooms[1].id, guest: { firstName: `Ben${uid()}`, lastName: 'Arriving' } },
    );
    // Housekeeping may use the agent and take rooms out of order, but not look up guests.
    const housekeeper = await actorFor((await makeUser({ role: 'HOUSEKEEPER', propertyIds: [pid] })).id);
    await prisma.agentPolicy.create({ data: { propertyId: pid, roles: { HOUSEKEEPER: { grant: ['agent.use', 'room.outOfOrder'] } } } });
    const room = (n: number) => h.rooms[n].roomNumber;

    const occupied = await ask(housekeeper, pid, `take room ${room(0)} out of order`);
    expect(occupied.token).toBeUndefined();
    expect(occupied.text).toContain(`Room ${room(0)} is occupied. The guest needs to move to another room first.`);
    const assigned = await ask(housekeeper, pid, `take room ${room(1)} out of order`);
    expect(assigned.token).toBeDefined();
    expect(assigned.text).toContain('A guest is assigned this room for');
    for (const r of [occupied, assigned]) {
      for (const secret of [name.split(' ')[0], booking.code, arriving.guest.name.split(' ')[0], arriving.code]) expect(r.text).not.toContain(secret);
      expect(r.context.lastGuestName).toBeUndefined();
    }

    // The front desk is told who it is, and how to move them.
    const told = await ask(desk, pid, `take room ${room(0)} out of order`);
    expect(told.text).toContain(`Room ${room(0)} is occupied by ${name}. Move them first (“move #${booking.code} to another room”).`);
    expect((await ask(desk, pid, `take room ${room(1)} out of order`)).text).toContain(`${arriving.guest.name} (${arriving.code}) is assigned this room`);
  });
});
