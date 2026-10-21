import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { AgentBlock, AgentContextState } from '@/lib/agent/blocks';
import { draftFrom, POLICY_ROLES, type AgentAccessUpdate } from '@/lib/agent/access';
import { confirmPlan, runAgent } from '@/server/agent/engine';
import { accessView, agentActor, alertsFor, CAPABILITIES, DEFAULT_ALERTS, loadPolicy, saveAccess } from '@/server/agent/policy';
import { resolveBooking } from '@/server/agent/resolve';
import { roleCan, type Actor } from '@/server/authz';
import { addDaysISO } from '@/server/dates';
import { transitionBooking } from '@/server/services/bookings';
import { createDeskReservation } from '@/server/services/reservations';
import { parametersFor, upsertSkill } from '@/server/skills';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

/** One message through the agent: what it showed, the plan it made (if any) and what it remembers. */
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

/** Every switch at its default, then the changes. */
function access(propertyId: string, change: (u: Pick<AgentAccessUpdate, 'capabilities' | 'alerts'>) => void = () => {}): AgentAccessUpdate {
  const u = {
    capabilities: Object.fromEntries(POLICY_ROLES.map((r) => [r, Object.fromEntries(CAPABILITIES.map((c) => [c.key, c.perms.every((p) => roleCan(r, p))]))])) as AgentAccessUpdate['capabilities'],
    alerts: { OWNER: [...DEFAULT_ALERTS.OWNER], MANAGER: [...DEFAULT_ALERTS.MANAGER], FRONT_DESK: [...DEFAULT_ALERTS.FRONT_DESK], HOUSEKEEPER: [...DEFAULT_ALERTS.HOUSEKEEPER] },
  };
  change(u);
  return { propertyId, ...u };
}

/** A hotel with an owner, two guests arriving today (both "Smi…") and a person in the given role. */
async function hotelWith(role: 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPER') {
  const h = await makeHotel({ rooms: 3 });
  const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
  const person = await makeUser({ role, propertyIds: [h.property.id] });
  const guests = [];
  for (const [firstName, lastName] of [[`Ana${uid()}`, 'Smith'], [`Ben${uid()}`, 'Smithson']]) {
    guests.push(
      await createDeskReservation(
        { actor: await actorFor(owner.id), source: 'classic' },
        { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName, lastName } },
      ),
    );
  }
  return { h, pid: h.property.id, owner: await actorFor(owner.id), person: await actorFor(person.id), guests };
}

/** Nothing about these guests in what the agent said or remembered. */
function expectNoGuests(r: { text: string; context: AgentContextState }, guests: { guest: { name: string }; code: string }[]) {
  for (const g of guests) {
    expect(r.text).not.toContain(g.guest.name.split(' ')[0]);
    expect(r.text).not.toContain(g.code);
  }
  expect(r.context.lastGuestName).toBeUndefined();
  expect(r.context.lastBookingId).toBeUndefined();
}

describe('agent access: booking changes', () => {
  it('shows no guests to someone with the agent but not look-ups', async () => {
    const { pid, owner, person: housekeeper, guests } = await hotelWith('HOUSEKEEPER');
    await saveAccess(owner, access(pid, (u) => (u.capabilities.HOUSEKEEPER.agent = true)));

    const cancel = await ask(housekeeper, pid, 'cancel smi');
    expect(cancel.text).toMatch(/can’t cancel reservations\. The owner can change this under Agent access/);
    expectNoGuests(cancel, guests);
    for (const message of ['confirm smi', 'mark smi as no-show']) {
      const r = await ask(housekeeper, pid, message);
      expect(r.token).toBeUndefined();
      expect(r.text).toMatch(/under Agent access/);
      expectNoGuests(r, guests);
    }

    // Matching itself needs look-ups, whoever asks for it.
    const r = await resolveBooking({ actor: await agentActor(housekeeper, pid), propertyId: pid, propertyName: 'Test', today: guests[0].checkIn, memory: {}, message: 'cancel smi' }, { name: 'smi' }, 'any');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/can’t look up reservations/);
    expectNoGuests({ text: JSON.stringify(r), context: {} }, guests);
  });

  it('offers guests for a shortcut only to people who may see them', async () => {
    const { pid, owner, person: housekeeper, guests } = await hotelWith('HOUSEKEEPER');
    const desk = await actorFor((await makeUser({ role: 'FRONT_DESK', propertyIds: [pid] })).id);
    const body = { steps: [{ command: 'add a note to {guest}: late checkout' }] };
    await upsertSkill({ propertyId: pid, title: 'Late checkout', description: 'Notes a late checkout', kind: 'MACRO', audience: 'STAFF', parameters: parametersFor('MACRO', body), body, status: 'ACTIVE' });
    await saveAccess(owner, access(pid, (u) => (u.capabilities.HOUSEKEEPER.agent = true)));

    expect((await ask(desk, pid, 'run late checkout')).text).toContain(guests[0].guest.name);
    const r = await ask(housekeeper, pid, 'run late checkout');
    expect(r.text).toMatch(/needs a guest/);
    expectNoGuests(r, guests);
  });

  it('turning off confirm, cancel and no-shows also stops reinstating', async () => {
    const { pid, owner, person: manager, guests } = await hotelWith('MANAGER');
    const b = guests[0];
    await transitionBooking({ actor: owner, source: 'classic' }, b.id, 'CANCELLED');
    const status = async () => (await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status;

    await saveAccess(owner, access(pid, (u) => (u.capabilities.MANAGER.reservations = false)));
    const refused = await ask(manager, pid, `confirm reservation ${b.code}`);
    expect(refused.token).toBeUndefined();
    expect(refused.text).toMatch(/can’t confirm reservations\. The owner can change this under Agent access/);

    // A plan made while it was on doesn't run once it's off.
    await saveAccess(owner, access(pid));
    const planned = await ask(manager, pid, `confirm reservation ${b.code}`);
    expect(planned.token).toBeDefined();
    await saveAccess(owner, access(pid, (u) => (u.capabilities.MANAGER.reservations = false)));
    const result = await confirmPlan(manager, planned.token!);
    expect(result.blocks[0]).toMatchObject({ type: 'result', ok: false });
    expect(JSON.stringify(result.blocks[0])).toMatch(/can’t confirm reservations/);
    expect(await status()).toBe('CANCELLED');
  });

  it('gives booking changes only together with look-ups', async () => {
    const { pid, owner, person: housekeeper, guests } = await hotelWith('HOUSEKEEPER');
    const name = guests[0].guest.name;

    await saveAccess(owner, access(pid, (u) => Object.assign(u.capabilities.HOUSEKEEPER, { agent: true, checkin: true })));
    expect((await loadPolicy(pid)).HOUSEKEEPER?.granted).toEqual(['agent.use']);
    const cell = (await accessView(owner, pid)).capabilities.find((c) => c.key === 'checkin')!.cells.HOUSEKEEPER;
    expect(cell).toEqual({ on: false, byDefault: false, locked: 'Turn on “Look up guests and bookings” for housekeeping first.' });
    expect((await ask(housekeeper, pid, `check in ${name}`)).token).toBeUndefined();

    await saveAccess(owner, access(pid, (u) => Object.assign(u.capabilities.HOUSEKEEPER, { agent: true, lookup: true, checkin: true })));
    const planned = await ask(housekeeper, pid, `check in ${name}`);
    expect(planned.token).toBeDefined();
    expect((await confirmPlan(housekeeper, planned.token!)).blocks[0]).toMatchObject({ type: 'result', ok: true });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: guests[0].id } })).status).toBe('CHECKED_IN');
  });

  it('makes no plan that would fail on YES when look-ups are off', async () => {
    const { pid, person: desk, guests } = await hotelWith('FRONT_DESK');
    // Stored before switches needed look-ups: front desk keeps notes and check-in without them.
    await prisma.agentPolicy.create({ data: { propertyId: pid, roles: { FRONT_DESK: { revoke: ['frontdesk.view', 'booking.view'] } } } });
    for (const message of [`add a note to ${guests[0].guest.name}: late arrival`, 'assign rooms for today’s arrivals']) {
      const r = await ask(desk, pid, message);
      expect(r.token).toBeUndefined();
      expect(r.text).toMatch(/can’t look up reservations, so it can’t change them either\. The owner can change this under Agent access/);
      expectNoGuests(r, guests);
    }

    // Without the arrivals list, "check in" with nobody named lists nobody.
    await prisma.agentPolicy.update({ where: { propertyId: pid }, data: { roles: { FRONT_DESK: { revoke: ['frontdesk.view'] } } } });
    const pick = await ask(desk, pid, 'check in a guest');
    expect(pick.text).toMatch(/can’t see arrivals\. The owner can change this under Agent access/);
    expectNoGuests(pick, guests);
  });
});

describe('agent access: the page', () => {
  it('keeps alerts that look-ups lock, and logs only real changes', async () => {
    const h = await makeHotel();
    const pid = h.property.id;
    const owner = await actorFor((await makeUser({ role: 'OWNER', propertyIds: [pid] })).id);
    const seen: string[] = [];
    /** The changes the next save logged. */
    const logged = async () => {
      const log = await prisma.agentAuditLog.findFirstOrThrow({ where: { propertyId: pid, action: 'AGENT_ACCESS', id: { notIn: seen } } });
      seen.push(log.id);
      return JSON.parse(log.detail ?? '{}').changes as string[];
    };

    await saveAccess(owner, access(pid, (u) => (u.capabilities.FRONT_DESK.lookup = false)));
    const off = await logged();
    expect(off).toContain('Look up guests and bookings: off for front desk');
    expect(off.filter((c) => c.includes('alerts'))).toEqual([]);

    // The page saves what it shows; turning look-ups back on brings the front desk alert back with them.
    const draft = draftFrom(await accessView(owner, pid));
    draft.capabilities.FRONT_DESK.lookup = true;
    await saveAccess(owner, { propertyId: pid, ...draft });
    expect(await logged()).toEqual(['Look up guests and bookings: on for front desk']);
    expect(alertsFor(await loadPolicy(pid), 'FRONT_DESK')).toEqual(DEFAULT_ALERTS.FRONT_DESK);
  });
});
