import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { CAPABILITIES } from '@/server/agent/policy';
import { roleCan } from '@/server/authz';
import { addDaysISO, hotelToday, hourIn } from '@/server/dates';
import { createDeskReservation } from '@/server/services/reservations';
import { POLICY_ROLES, type AgentAccessUpdate } from '@/lib/agent/access';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

// The heartbeat would run alert rounds in the background mid-test; rounds are run explicitly below instead.
vi.mock('@/server/agent/watch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/agent/watch')>()), watchSoon: vi.fn() }));
// Watched, to see whose accounts an alert round reads.
vi.mock('@/server/authz', async (importOriginal) => {
  const authz = await importOriginal<typeof import('@/server/authz')>();
  return { ...authz, actorForLinkedChannel: vi.fn(authz.actorForLinkedChannel) };
});

const { handleInbound } = await import('@/server/whatsapp/staff');
const { startLink, linkStatus } = await import('@/server/whatsapp/link');
const { runWatch } = await import('@/server/agent/watch');
const { saveAccess } = await import('@/server/agent/policy');
const { whatsAppConfig } = await import('@/server/whatsapp/cloud');
const { choiceAt } = await import('@/server/whatsapp/format');
const { recordDispute } = await import('@/server/payments/disputes');
const { actorForLinkedChannel } = await import('@/server/authz');

/** What we sent through the Cloud API, newest last. */
let sent: { to: string; text?: string; template?: string; params?: string[] }[] = [];
/** Numbers the Cloud API refuses to deliver to. */
const failing = new Set<string>();
const realFetch = globalThis.fetch;

beforeAll(() => {
  Object.assign(process.env, { WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_ACCESS_TOKEN: 'token', WHATSAPP_APP_SECRET: 'secret', WHATSAPP_VERIFY_TOKEN: 'verify', WHATSAPP_ALERT_TEMPLATE: 'hotel_alert' });
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (failing.has(body.to)) return new Response('{"error":{"message":"Internal error"}}', { status: 500 });
    if (body.type === 'text') sent.push({ to: body.to, text: body.text.body });
    if (body.type === 'template') sent.push({ to: body.to, template: body.template.name, params: body.template.components[0].parameters.map((p: { text: string }) => p.text) });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  sent = [];
});

let n = 0;
const phone = () => `1555${String(Date.now()).slice(-5)}${String(n++).padStart(2, '0')}`;
/** A message from this phone; resolves once the reply has been sent. */
async function say(from: string, text: string): Promise<string> {
  const before = sent.length;
  await handleInbound(whatsAppConfig()!, { id: `wamid.${uid()}${uid()}`, from, text });
  return sent.slice(before).map((m) => m.text ?? `[template ${m.template}] ${m.params?.join(' | ')}`).join('\n---\n');
}

async function linked(userId: string): Promise<string> {
  const number = phone();
  const { code } = await startLink(await actorFor(userId));
  expect(await say(number, `LINK ${code}`)).toMatch(/Linked/);
  return number;
}

/** Every switch at its default, then the changes. */
function access(propertyId: string, change: (u: Pick<AgentAccessUpdate, 'capabilities' | 'alerts'>) => void): AgentAccessUpdate {
  const u = {
    capabilities: Object.fromEntries(POLICY_ROLES.map((r) => [r, Object.fromEntries(CAPABILITIES.map((c) => [c.key, c.perms.every((p) => roleCan(r, p))]))])) as AgentAccessUpdate['capabilities'],
    alerts: { OWNER: ['brief', 'frontdesk', 'guestRequests', 'disputes', 'pms', 'channels'], MANAGER: ['brief', 'frontdesk', 'housekeeping', 'guestRequests', 'pms', 'channels'], FRONT_DESK: ['frontdesk', 'guestRequests'], HOUSEKEEPER: ['housekeeping'] },
  } as Pick<AgentAccessUpdate, 'capabilities' | 'alerts'>;
  change(u);
  return { propertyId, ...u };
}

describe('the agent on WhatsApp', () => {
  it('links a phone with a one-time code from the console', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = phone();
    const { code } = await startLink(await actorFor(owner.id));
    expect(await say(number, 'brief me')).toMatch(/link your phone/);
    expect(await say(number, `link ${code.toLowerCase()}`)).toMatch(/Linked, Test/);
    // Single use.
    expect(await say(phone(), `LINK ${code}`)).toMatch(/didn’t work/);
    const status = await linkStatus(await actorFor(owner.id));
    expect(status.linked?.number).toMatch(/^\+1 ••• \d{4}$/);
    const log = await prisma.agentAuditLog.findFirst({ where: { propertyId: h.property.id, userId: owner.id, action: 'WHATSAPP_LINKED' } });
    expect(log).not.toBeNull();
  });

  it('answers look-ups and changes nothing until YES', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const guestName = `Rosa${uid()}`;
    const b = await createDeskReservation(
      { actor: await actorFor(owner.id), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 2), guests: 1, rooms: 1, guest: { firstName: guestName, lastName: 'Diaz' } },
    );
    const number = await linked(owner.id);

    expect(await say(number, 'who’s arriving today?')).toContain(`${guestName} Diaz`);

    const plan = await say(number, `check in ${guestName} Diaz`);
    expect(plan).toMatch(/Please confirm/);
    expect(plan).toMatch(/Reply \*YES\*/);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED');

    expect(await say(number, 'yes')).toMatch(/✅/);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CHECKED_IN');
    // A second YES runs nothing.
    expect(await say(number, 'YES')).toMatch(/nothing waiting/);

    const executed = await prisma.agentAuditLog.findFirst({ where: { propertyId: h.property.id, userId: owner.id, action: 'PLAN_EXECUTED' } });
    expect(JSON.parse(executed?.detail ?? '{}').channel).toBe('whatsapp');
  });

  it('handles each WhatsApp message once', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);
    const msg = { id: `wamid.${uid()}`, from: number, text: 'brief me' };
    await handleInbound(whatsAppConfig()!, msg);
    const after = sent.length;
    await handleInbound(whatsAppConfig()!, msg);
    expect(sent.length).toBe(after);
  });

  it('cancels a plan on NO', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);
    expect(await say(number, `mark room ${h.rooms[0].roomNumber} dirty`)).toMatch(/Please confirm/);
    expect(await say(number, 'no')).toMatch(/nothing was changed/);
    expect(await say(number, 'yes')).toMatch(/nothing waiting/);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: h.rooms[0].id } })).status).toBe('CLEAN');
  });

  it('ends the link when the person signs out everywhere', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);
    await prisma.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await say(number, 'brief me')).toMatch(/link to your account has ended/);
    expect(await say(number, 'brief me')).toMatch(/link your phone/);
  });

  it('follows the hotel’s agent access, set by the owner', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const housekeeper = await makeUser({ role: 'HOUSEKEEPER', propertyIds: [h.property.id] });
    const guestName = `Ana${uid()}`;
    await createDeskReservation(
      { actor: await actorFor(owner.id), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: guestName, lastName: 'Smith' } },
    );

    // Housekeepers can't use the agent by default, so they can't link a phone.
    await expect(startLink(await actorFor(housekeeper.id))).rejects.toThrow(/Agent access/);

    const deskPhone = await linked(desk.id);
    expect(await say(deskPhone, 'occupancy this week')).toMatch(/managers and owners/);

    await saveAccess(
      await actorFor(owner.id),
      access(h.property.id, (u) => {
        u.capabilities.FRONT_DESK.checkin = false;
        u.capabilities.FRONT_DESK.reports = true;
        u.capabilities.HOUSEKEEPER.agent = true;
        u.capabilities.HOUSEKEEPER.whatsapp = true;
      }),
    );
    expect(await say(deskPhone, `check in ${guestName} Smith`)).toMatch(/can’t check guests in/);
    const occupancy = await say(deskPhone, 'occupancy this week');
    expect(occupancy).toMatch(/Average \d+% · revenue/);
    expect(occupancy).not.toMatch(/managers and owners/);

    // Room 102 is on the housekeeper's cleaning list (housekeepers only change rooms on their list).
    await prisma.room.update({ where: { id: h.rooms[1].id }, data: { status: 'DIRTY' } });
    await prisma.roomHousekeeping.create({ data: { roomId: h.rooms[1].id, assignedTo: housekeeper.id } });
    const hkPhone = await linked(housekeeper.id);
    expect(await say(hkPhone, `mark room ${h.rooms[1].roomNumber} clean`)).toMatch(/Please confirm/);
    expect(await say(hkPhone, 'YES')).toMatch(/✅/);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: h.rooms[1].id } })).status).toBe('CLEAN');

    // Turning WhatsApp off for front desk stops their chat (the console agent keeps working).
    await saveAccess(await actorFor(owner.id), access(h.property.id, (u) => (u.capabilities.FRONT_DESK.whatsapp = false)));
    expect(await say(deskPhone, 'brief me')).toMatch(/off for your role/);

    const log = await prisma.agentAuditLog.findFirst({ where: { propertyId: h.property.id, action: 'AGENT_ACCESS' }, orderBy: { createdAt: 'asc' } });
    expect(JSON.parse(log?.detail ?? '{}').summary).toMatch(/Check guests in and out: off for front desk/);
  });

  it('shows who is in each room only to people who may look up guests', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const guestName = `Hidden${uid()}`;
    const b = await createDeskReservation(
      { actor: await actorFor(owner.id), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 2), guests: 1, rooms: 1, guest: { firstName: guestName, lastName: 'Guest' } },
    );
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CHECKED_IN', roomId: h.rooms[0].id } });
    const deskPhone = await linked(desk.id);
    expect(await say(deskPhone, 'room board')).toContain(guestName);

    await saveAccess(await actorFor(owner.id), access(h.property.id, (u) => (u.capabilities.FRONT_DESK.lookup = false)));
    const board = await say(deskPhone, 'room board');
    expect(board).toContain(h.rooms[0].roomNumber);
    expect(board).not.toContain(guestName);
    expect(board).not.toContain(b.code);
  });

  it('can’t be used for a hotel the person isn’t on', async () => {
    const [mine, theirs] = await Promise.all([makeHotel(), makeHotel()]);
    const owner = await makeUser({ role: 'OWNER', propertyIds: [mine.property.id] });
    const number = await linked(owner.id);
    expect(await say(number, `switch to ${theirs.property.name}`)).toMatch(/None of your hotels/);
  });
});

describe('the always-on agent', () => {
  /** That hour on that day in Los Angeles (summer or winter time). */
  const at = (day: string, hour: number) => {
    for (let h = 0; h < 48; h++) {
      const d = new Date(`${day}T00:30:00Z`);
      d.setUTCHours(d.getUTCHours() + h);
      if (hourIn('America/Los_Angeles', d) === hour && hotelToday(d, 'America/Los_Angeles') === day) return d;
    }
    throw new Error('no such hour');
  };
  const afternoon = (day: string) => at(day, 15);
  const LA = 'America/Los_Angeles';

  /** An arrival today with no room yet: the brief offers "assign rooms" as a numbered reply. */
  async function arrivalWithoutRoom(h: Awaited<ReturnType<typeof makeHotel>>, ownerId: string): Promise<void> {
    await createDeskReservation(
      { actor: await actorFor(ownerId), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: `Omar${uid()}`, lastName: 'Ali' } },
    );
    await prisma.booking.updateMany({ where: { propertyId: h.property.id }, data: { roomId: null } });
  }

  it('messages the owner about a guest message once, and keeps quiet at night', async () => {
    const h = await makeHotel({ timezone: 'America/Los_Angeles' });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);
    sent = [];

    const night = at(h.today, 0);
    const req = await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Lena Park', phone: '+15550001111', message: 'Can we check in early tomorrow?', source: 'WHATSAPP', createdAt: night } });
    await runWatch({ propertyId: h.property.id, now: night });
    expect(sent.filter((m) => m.to === number)).toEqual([]);

    await runWatch({ propertyId: h.property.id, now: afternoon(h.today) });
    const alert = sent.find((m) => m.to === number && m.text?.includes('Lena Park'));
    expect(alert?.text).toContain('Can we check in early tomorrow?');

    sent = [];
    await runWatch({ propertyId: h.property.id, now: afternoon(h.today) });
    expect(sent.filter((m) => m.text?.includes('Lena Park'))).toEqual([]);
    const notice = await prisma.agentNotice.findUnique({ where: { propertyId_key: { propertyId: h.property.id, key: `guestRequest:${req.id}` } } });
    expect(notice?.sentTo).toEqual([owner.id]);
  });

  it('offers the fix as a numbered reply that goes through the agent', async () => {
    const h = await makeHotel({ timezone: 'America/Los_Angeles' });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    await arrivalWithoutRoom(h, owner.id);
    const number = await linked(owner.id);
    // Owners don't get housekeeping alerts by default; "arrivals need a room" is a front desk alert.
    await runWatch({ propertyId: h.property.id, now: at(h.today, 8) }); // the morning brief
    const brief = sent.find((m) => m.to === number && m.text?.includes('Good morning'));
    expect(brief?.text).toContain('1 arrival needs a room');
    expect(await say(number, '1')).toMatch(/Please confirm/);
  });

  it('keeps the brief’s numbered replies when a later alert has none', async () => {
    const h = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    await arrivalWithoutRoom(h, owner.id);
    const number = await linked(owner.id);
    await runWatch({ propertyId: h.property.id, now: at(h.today, 8) });
    expect(sent.find((m) => m.to === number && m.text?.includes('Good morning'))?.text).toContain('(reply 1)');

    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Noor Haddad', message: 'Do you have a crib?', source: 'PHONE', createdAt: at(h.today, 9) } });
    sent = [];
    await runWatch({ propertyId: h.property.id, now: at(h.today, 10) });
    expect(sent.filter((m) => m.to === number).map((m) => m.text)).toEqual([expect.stringContaining('Noor Haddad')]);
    const link = await prisma.staffWhatsAppLink.findUniqueOrThrow({ where: { userId: owner.id } });
    expect(link.lastAlert).toContain('Do you have a crib?');
    // "Needs a room" was in the brief: it doesn't come again.
    expect(link.lastAlert).not.toContain('needs a room');
    expect(link.alertUnseen).toBe(false);
    expect(await say(number, '1')).toMatch(/Please confirm/);
  });

  it('uses the approved template when the person hasn’t written for a day, and keeps the whole message for the chat', async () => {
    const h = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    await arrivalWithoutRoom(h, owner.id);
    const number = await linked(owner.id);
    const now = at(h.today, 8);
    await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { lastInboundAt: new Date(now.getTime() - 2 * 24 * 3600_000) } });
    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Kai Moana', message: 'Booking request: 2 nights from Friday', source: 'PHONE', createdAt: new Date(now.getTime() - 3600_000) } });
    sent = [];
    await runWatch({ propertyId: h.property.id, now });
    const mine = sent.filter((m) => m.to === number);
    expect(mine).toHaveLength(1);
    expect(mine[0].template).toBe('hotel_alert');
    expect(mine[0].params).toEqual([h.property.name, 'your morning brief is ready; Booking request from Kai Moana']);
    // The chat shows the whole message on their next one, and its numbers work.
    const link = await prisma.staffWhatsAppLink.findUniqueOrThrow({ where: { userId: owner.id } });
    expect(link.alertUnseen).toBe(true);
    expect(link.lastAlert).toContain(`Good morning — ${h.property.name}`);
    expect(link.lastAlert).toContain('Booking request: 2 nights from Friday');
    expect(link.choices).toEqual([choiceAt(h.property.id, 'assign rooms for today’s arrivals')]);
    // The template's "Show me" button (or any reply) gets the full alert.
    expect(await say(number, 'Show me')).toContain('Booking request: 2 nights from Friday');
    expect(await say(number, '1')).toMatch(/Please confirm/);
  });

  it('adds a second template to the one the person hasn’t read, numbered on from it, and keeps nothing from a send that failed', async () => {
    const h = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    await arrivalWithoutRoom(h, owner.id);
    const number = await linked(owner.id);
    const linkOf = () => prisma.staffWhatsAppLink.findUniqueOrThrow({ where: { userId: owner.id } });
    const morning = at(h.today, 8);
    await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { lastInboundAt: new Date(morning.getTime() - 2 * 24 * 3600_000) } });
    await runWatch({ propertyId: h.property.id, now: morning }); // the brief, as a template: "1" assigns rooms
    const first = await linkOf();
    expect(first.alertUnseen).toBe(true);
    expect(first.choices).toEqual([choiceAt(h.property.id, 'assign rooms for today’s arrivals')]);

    // Before they reply, an arrival turns up that still needs confirming.
    const guest = `Ines${uid()} Lopez`;
    const b = await createDeskReservation(
      { actor: await actorFor(owner.id), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: guest.split(' ')[0], lastName: 'Lopez' } },
    );
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'PENDING' } });
    const later = at(h.today, 9);
    const sentTo = async () => (await prisma.agentNotice.findUniqueOrThrow({ where: { propertyId_key: { propertyId: h.property.id, key: `frontdesk:pending:${h.today}` } } })).sentTo;

    // A template that doesn't go out changes nothing, and the alert is tried again.
    failing.add(number);
    try {
      await runWatch({ propertyId: h.property.id, now: later });
    } finally {
      failing.delete(number);
    }
    expect(await linkOf()).toMatchObject({ lastAlert: first.lastAlert, choices: first.choices, alertUnseen: true });
    expect(await sentTo()).toEqual([]);

    sent = [];
    await runWatch({ propertyId: h.property.id, now: later });
    // The template is about the new alert only.
    expect(sent.filter((m) => m.to === number)).toEqual([{ to: number, template: 'hotel_alert', params: [h.property.name, '1 arrival is still unconfirmed'] }]);
    expect(await sentTo()).toEqual([owner.id]);
    const both = await linkOf();
    expect(both.alertUnseen).toBe(true);
    expect(both.choices).toEqual([choiceAt(h.property.id, 'assign rooms for today’s arrivals'), choiceAt(h.property.id, `confirm ${guest}`)]);

    // Their reply gets both, the brief first, numbered straight through, and the second one's number works.
    const shown = await say(number, 'Show me');
    expect(shown).toBe(both.lastAlert);
    expect(shown.startsWith(`${first.lastAlert}\n\n`)).toBe(true);
    expect(shown).toMatch(/needs a room[^\n]*\(reply 1\)[\s\S]*1 arrival is still unconfirmed[\s\S]*Reply \*2\* to: Confirm Ines/);
    expect(shown.match(/Good morning/g)).toHaveLength(1);
    expect(await say(number, '2')).toMatch(new RegExp(`Please confirm: .*${guest.split(' ')[0]}`));
  });

  it('tries a failed send again next round, and the other owner still gets it', async () => {
    const h = await makeHotel({ timezone: LA });
    const ana = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const ben = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const anaNumber = await linked(ana.id);
    const benNumber = await linked(ben.id);
    const now = afternoon(h.today);
    const req = await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Mia Chen', message: 'Is parking free?', source: 'PHONE', createdAt: now } });
    const sentTo = async () => (await prisma.agentNotice.findUniqueOrThrow({ where: { propertyId_key: { propertyId: h.property.id, key: `guestRequest:${req.id}` } } })).sentTo;
    sent = [];
    failing.add(anaNumber);
    try {
      await runWatch({ propertyId: h.property.id, now });
    } finally {
      failing.delete(anaNumber);
    }
    expect(sent.filter((m) => m.to === anaNumber)).toEqual([]);
    expect(sent.filter((m) => m.to === benNumber && m.text?.includes('Mia Chen'))).toHaveLength(1);
    expect(await sentTo()).toEqual([ben.id]);

    sent = [];
    await runWatch({ propertyId: h.property.id, now });
    expect(sent.filter((m) => m.to === anaNumber && m.text?.includes('Mia Chen'))).toHaveLength(1);
    expect(sent.filter((m) => m.to === benNumber)).toEqual([]);
    expect((await sentTo()).sort()).toEqual([ana.id, ben.id].sort());
  });

  it('keeps an alert it can’t deliver yet for when the person writes again', async () => {
    const h = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);
    const now = afternoon(h.today);
    // No template, and they last wrote 30 hours ago: WhatsApp won't take a free-form message.
    await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { lastInboundAt: new Date(now.getTime() - 30 * 3600_000) } });
    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Theo Grant', message: 'We’ll arrive after midnight.', source: 'PHONE', createdAt: now } });
    sent = [];
    delete process.env.WHATSAPP_ALERT_TEMPLATE;
    try {
      await runWatch({ propertyId: h.property.id, now });
    } finally {
      process.env.WHATSAPP_ALERT_TEMPLATE = 'hotel_alert';
    }
    expect(sent.filter((m) => m.to === number)).toEqual([]);

    await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { lastInboundAt: now } });
    await runWatch({ propertyId: h.property.id, now });
    expect(sent.find((m) => m.to === number)?.text).toContain('Theo Grant');
  });

  it('sends one message a round across the person’s hotels, numbered straight through', async () => {
    const a = await makeHotel({ timezone: LA });
    const b = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [a.property.id, b.property.id] });
    await arrivalWithoutRoom(a, owner.id);
    await arrivalWithoutRoom(b, owner.id);
    const number = await linked(owner.id);
    expect(await say(number, `switch to ${b.property.name}`)).toMatch(/Now working on/);
    sent = [];
    await runWatch({ now: at(a.today, 8) }); // every hotel's morning brief
    const mine = sent.filter((m) => m.to === number);
    expect(mine).toHaveLength(1);
    const text = mine[0].text ?? '';
    expect(text).toContain(`Good morning — ${a.property.name}`);
    expect(text.indexOf(`Good morning — ${a.property.name}`)).toBeLessThan(text.indexOf(`Good morning — ${b.property.name}`));
    expect(text).toMatch(/needs a room[^\n]*\(reply 1\)[\s\S]*needs a room[^\n]*\(reply 2\)/);
    const link = await prisma.staffWhatsAppLink.findUniqueOrThrow({ where: { userId: owner.id } });
    expect(link.choices).toEqual([choiceAt(a.property.id, 'assign rooms for today’s arrivals'), choiceAt(b.property.id, 'assign rooms for today’s arrivals')]);
    // "1" is the first hotel's: it acts there, though the chat is on the second.
    const reply = await say(number, '1');
    expect(reply).toContain(`_${a.property.name}_`);
    expect(reply).toMatch(/Please confirm/);
  });

  it('keeps each hotel’s own night and morning for someone at hotels in different time zones', async () => {
    const la = await makeHotel({ timezone: LA });
    const tokyo = await makeHotel({ timezone: 'Asia/Tokyo' });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [la.property.id, tokyo.property.id] });
    const number = await linked(owner.id);
    // 11pm in Los Angeles is the next afternoon in Tokyo.
    const night = at(la.today, 23);
    expect(hourIn('Asia/Tokyo', night)).toBe(15);
    const ask = (h: typeof la, name: string, createdAt: Date) => prisma.guestRequest.create({ data: { propertyId: h.property.id, name, message: 'Is the pool open?', source: 'PHONE', createdAt } });
    await ask(la, 'Lou Harbor', night);
    await ask(tokyo, 'Taro Yamada', night);
    const round = async (now: Date) => {
      sent = [];
      await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { lastInboundAt: now } });
      for (const h of [la, tokyo]) await runWatch({ propertyId: h.property.id, now });
      return sent.filter((m) => m.to === number).map((m) => m.text ?? '');
    };

    const first = await round(night);
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('Taro Yamada');
    expect(first[0]).not.toContain('Lou Harbor');

    // 8am in Los Angeles is midnight in Tokyo: the Los Angeles brief and the message that waited, nothing from Tokyo.
    const morning = new Date(night.getTime() + 9 * 3600_000);
    expect(hourIn(LA, morning)).toBe(8);
    const second = await round(morning);
    expect(second).toHaveLength(1);
    expect(second[0]).toContain(`Good morning — ${la.property.name}`);
    expect(second[0]).toContain('Lou Harbor');
    expect(second[0]).not.toContain(tokyo.property.name);

    // Tokyo's brief comes at 8am there.
    const tokyoMorning = new Date(morning.getTime() + 8 * 3600_000);
    expect(hourIn('Asia/Tokyo', tokyoMorning)).toBe(8);
    const third = await round(tokyoMorning);
    expect(third).toHaveLength(1);
    expect(third[0]).toContain(`Good morning — ${tokyo.property.name}`);
    expect(third[0]).not.toContain(`Good morning — ${la.property.name}`);
  });

  it('alerts the newest guest messages first, six to a message, however many are waiting', async () => {
    const h = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);
    const now = afternoon(h.today);
    const guest = (i: number) => `Guest ${String(i).padStart(2, '0')}`;
    const ask = (i: number) =>
      prisma.guestRequest.create({ data: { propertyId: h.property.id, name: guest(i), message: 'Is breakfast included?', source: 'PHONE', createdAt: new Date(now.getTime() - (60 - i) * 60_000) } });
    const round = async () => {
      sent = [];
      await runWatch({ propertyId: h.property.id, now });
      return sent.filter((m) => m.to === number).map((m) => m.text).join('\n');
    };
    const guests = (text: string) => Array.from({ length: 11 }, (_, i) => i + 1).filter((i) => text.includes(guest(i)));
    for (let i = 1; i <= 10; i++) await ask(i);

    const first = await round();
    expect(guests(first)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(first).toContain('…and 4 more. I’ll send them in my next message.');
    expect(first).not.toContain('brief me');
    const second = await round();
    expect(guests(second)).toEqual([1, 2, 3, 4]);
    expect(second).not.toContain('next message');
    // Ten messages already alerted don't hide an eleventh.
    await ask(11);
    expect(guests(await round())).toEqual([11]);
  });

  it('reads only the accounts of people at the hotel when something happens there', async () => {
    const h = await makeHotel({ timezone: LA });
    const other = await makeHotel({ timezone: LA });
    // The group's administrator works at the hotel without being assigned to it.
    const org = await prisma.organization.create({ data: { name: 'Group', slug: `g-${uid()}`, properties: { connect: { id: h.property.id } } } });
    const chain = await makeUser({ role: 'OWNER' });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: chain.id, role: 'ADMIN' } });
    const elsewhere = await makeUser({ role: 'OWNER', propertyIds: [other.property.id] });
    const chainNumber = await linked(chain.id);
    await linked(elsewhere.id);
    const now = afternoon(h.today);
    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Ravi Shah', message: 'Can I bring my dog?', source: 'PHONE', createdAt: now } });
    vi.mocked(actorForLinkedChannel).mockClear();
    await runWatch({ propertyId: h.property.id, now });
    expect(vi.mocked(actorForLinkedChannel).mock.calls.map(([userId]) => userId)).toEqual([chain.id]);
    expect(sent.find((m) => m.to === chainNumber && m.text?.includes('Ravi Shah'))?.text).toContain('Can I bring my dog?');
  });

  it('tells the owner about a card dispute at night, with evidence that keeps the real stay', async () => {
    const h = await makeHotel({ timezone: 'America/Los_Angeles' });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
    const b = await createDeskReservation(
      { actor: await actorFor(owner.id), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 2), guests: 1, rooms: 1, guest: { firstName: `Alex${uid()}`, lastName: 'Rivera' } },
    );
    // A stay that is long over: booked, checked in, checked out.
    await prisma.bookingStatusHistory.updateMany({ where: { bookingId: b.id }, data: { createdAt: new Date('2026-01-01T12:00:00Z') } });
    await prisma.bookingStatusHistory.createMany({
      data: [
        { bookingId: b.id, status: 'CHECKED_IN', notes: 'Checked in', createdAt: new Date('2026-01-10T23:30:00Z') },
        { bookingId: b.id, status: 'CHECKED_OUT', notes: 'Checked out', createdAt: new Date('2026-01-12T18:30:00Z') },
      ],
    });
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CHECKED_OUT', paymentStatus: 'PAID' } });
    const charge = `ch_${uid()}${uid()}`;
    await prisma.payment.create({ data: { bookingId: b.id, propertyId: h.property.id, stripePaymentIntentId: `pi_${uid()}${uid()}`, stripeChargeId: charge, status: 'SUCCEEDED', amount: 378, paidAt: new Date('2026-01-01T12:00:00Z') } });
    const ownerNumber = await linked(owner.id);
    const managerNumber = await linked(manager.id);
    sent = [];

    await recordDispute({ id: `dp_${uid()}${uid()}`, charge, payment_intent: null, amount: 37800, currency: 'usd', reason: 'fraudulent', status: 'needs_response', evidence_details: { due_by: Math.floor(Date.now() / 1000) + 9 * 86400 } } as unknown as Parameters<typeof recordDispute>[0]);
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { bookingId: b.id } });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).paymentStatus).toBe('DISPUTED');
    // The dispute adds a note to the history; the evidence still has the real check-out.
    const stay = (dispute.evidenceSummary as { sections: { title: string; lines: string[] }[] }).sections.find((s) => s.title === 'Stay and check-in');
    expect(stay?.lines).toContain('Checked out: 2026-01-12 18:30 UTC');
    expect(stay?.lines[0]).toBe('Checked in: 2026-01-10 23:30 UTC');

    // Card disputes are urgent: they come through at night. Managers don't get them by default.
    await runWatch({ propertyId: h.property.id, now: at(h.today, 23) });
    const alert = sent.find((m) => m.to === ownerNumber && m.text?.includes('Card dispute: $378 (fraudulent)'));
    expect(alert?.text).toContain(`/admin/disputes?dispute=${dispute.id}`);
    expect(sent.filter((m) => m.to === managerNumber)).toEqual([]);
  });

  it('sends each role the alerts the owner chose for it, and only disputes at night', async () => {
    const h = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    await saveAccess(
      await actorFor(owner.id),
      access(h.property.id, (u) => {
        u.alerts.MANAGER = ['disputes'];
        u.alerts.FRONT_DESK = ['frontdesk'];
      }),
    );
    const [ownerNumber, managerNumber, deskNumber] = [await linked(owner.id), await linked(manager.id), await linked(desk.id)];
    const night = at(h.today, 23);
    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Ada Stone', message: 'Late check-out please', source: 'PHONE', createdAt: night } });
    await prisma.dispute.create({ data: { propertyId: h.property.id, stripeDisputeId: `dp_${uid()}${uid()}`, amount: 120, reason: 'fraudulent', status: 'needs_response', createdAt: night } });
    const round = async (now: Date) => {
      sent = [];
      for (const userId of [owner.id, manager.id, desk.id]) await prisma.staffWhatsAppLink.update({ where: { userId }, data: { lastInboundAt: now } });
      await runWatch({ propertyId: h.property.id, now });
      return (to: string) => sent.filter((m) => m.to === to).map((m) => m.text ?? '').join('\n');
    };

    const atNight = await round(night);
    for (const to of [ownerNumber, managerNumber]) {
      expect(atNight(to)).toContain('Card dispute: $120 (fraudulent)');
      expect(atNight(to)).not.toContain('Ada Stone');
    }
    expect(atNight(deskNumber)).toBe('');

    const afternoon = await round(new Date(night.getTime() + 16 * 3600_000));
    expect(afternoon(ownerNumber)).toContain('Ada Stone');
    expect(afternoon(ownerNumber)).not.toContain('Card dispute');
    expect(afternoon(managerNumber)).toBe('');
    expect(afternoon(deskNumber)).toBe('');
  });

  it('stays quiet for people who turned alerts off', async () => {
    const h = await makeHotel({ timezone: 'America/Los_Angeles' });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);
    expect(await say(number, 'alerts off')).toMatch(/Alerts are off/);
    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Quiet Please', message: 'Hello', source: 'PHONE', createdAt: afternoon(h.today) } });
    await runWatch({ propertyId: h.property.id, now: afternoon(h.today) });
    expect(sent.filter((m) => m.to === number && m.text?.includes('Quiet Please'))).toEqual([]);
  });
  it('shows an unread template alert with the next alert, so it’s never lost', async () => {
    const h = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    await arrivalWithoutRoom(h, owner.id);
    const number = await linked(owner.id);
    const morning = at(h.today, 8);
    await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { lastInboundAt: new Date(morning.getTime() - 2 * 24 * 3600_000) } });
    await runWatch({ propertyId: h.property.id, now: morning }); // the brief, as a template
    const brief = (await prisma.staffWhatsAppLink.findUniqueOrThrow({ where: { userId: owner.id } })).lastAlert!;
    // A YES doesn't show the alert (it answers a plan), but it opens the 24-hour window.
    expect(await say(number, 'yes')).toMatch(/nothing waiting/);

    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Noor Haddad', message: 'Do you have a crib?', source: 'PHONE', createdAt: at(h.today, 9) } });
    sent = [];
    await runWatch({ propertyId: h.property.id, now: at(h.today, 10) });
    const text = sent.filter((m) => m.to === number).map((m) => m.text).join('');
    expect(text.startsWith(brief)).toBe(true);
    expect(text).toContain('Do you have a crib?');
    expect((await prisma.staffWhatsAppLink.findUniqueOrThrow({ where: { userId: owner.id } })).alertUnseen).toBe(false);
    expect(await say(number, '1')).toMatch(/Please confirm/);
  });

  it('numbers an unread alert from 1, whatever the chat offered before', async () => {
    const h = await makeHotel({ timezone: LA });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    await arrivalWithoutRoom(h, owner.id);
    const number = await linked(owner.id);
    const early = at(h.today, 7);
    // Yesterday's chat left three numbered replies; they haven't written since.
    await prisma.staffWhatsAppLink.update({
      where: { userId: owner.id },
      data: { lastInboundAt: new Date(early.getTime() - 2 * 24 * 3600_000), choices: ['who’s arriving today?', 'forecast', 'brief me'] },
    });
    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Lena Park', message: 'Is breakfast included?', source: 'PHONE', createdAt: early } });
    await runWatch({ propertyId: h.property.id, now: early }); // a template with no numbered reply
    expect((await prisma.staffWhatsAppLink.findUniqueOrThrow({ where: { userId: owner.id } })).choices).toEqual([]);

    await runWatch({ propertyId: h.property.id, now: at(h.today, 8) }); // the brief, added to it
    const shown = await say(number, 'Show me');
    expect(shown).toMatch(/Is breakfast included\?[\s\S]*Good morning[\s\S]*\(reply 1\)/);
    expect(await say(number, '1')).toMatch(/Please confirm/);
  });

  it('doesn’t show a held alert to someone no longer at the hotel', async () => {
    const h = await makeHotel({ timezone: LA });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const number = await linked(desk.id);
    await prisma.staffWhatsAppLink.update({ where: { userId: desk.id }, data: { alertUnseen: true, lastAlert: '💬 Message from Priya Secret: my card ends 4242', choices: [] } });
    await prisma.user.update({ where: { id: desk.id }, data: { assignedProperties: { deleteMany: {} } } });
    const answer = await say(number, 'hi');
    expect(answer).not.toContain('Priya');
    expect(answer).toMatch(/No hotel is assigned/);
    expect(await say(number, 'DETAILS')).not.toContain('Priya');
  });
});
