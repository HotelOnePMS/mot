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

const { handleInbound } = await import('@/server/whatsapp/staff');
const { startLink, linkStatus } = await import('@/server/whatsapp/link');
const { runWatch } = await import('@/server/agent/watch');
const { saveAccess } = await import('@/server/agent/policy');
const { whatsAppConfig } = await import('@/server/whatsapp/cloud');

/** What we sent through the Cloud API, newest last. */
let sent: { to: string; text?: string; template?: string; params?: string[] }[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  Object.assign(process.env, { WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_ACCESS_TOKEN: 'token', WHATSAPP_APP_SECRET: 'secret', WHATSAPP_VERIFY_TOKEN: 'verify', WHATSAPP_ALERT_TEMPLATE: 'hotel_alert' });
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
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
    expect(await say(deskPhone, 'occupancy this week')).toMatch(/Occupancy/);

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
    const guestName = `Omar${uid()}`;
    await createDeskReservation(
      { actor: await actorFor(owner.id), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: guestName, lastName: 'Ali' } },
    );
    await prisma.booking.updateMany({ where: { propertyId: h.property.id }, data: { roomId: null } });
    const number = await linked(owner.id);
    // Owners don't get housekeeping alerts by default; "arrivals need a room" is a front desk alert.
    await runWatch({ propertyId: h.property.id, now: at(h.today, 8) }); // the morning brief
    const brief = sent.find((m) => m.to === number && m.text?.includes('Good morning'));
    expect(brief?.text).toContain('1 arrival needs a room');
    expect(await say(number, '1')).toMatch(/Please confirm/);
  });

  it('uses the approved template when the person hasn’t written for a day', async () => {
    const h = await makeHotel({ timezone: 'America/Los_Angeles' });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);
    const now = afternoon(h.today);
    await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { lastInboundAt: new Date(now.getTime() - 2 * 24 * 3600_000) } });
    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Kai Moana', message: 'Booking request: 2 nights from Friday', source: 'PHONE', createdAt: new Date(now.getTime() - 3600_000) } });
    await runWatch({ propertyId: h.property.id, now });
    const t = sent.find((m) => m.to === number && m.template);
    expect(t?.template).toBe('hotel_alert');
    expect(t?.params?.[0]).toBe(h.property.name);
    expect(t?.params?.[1]).toContain('Booking request from Kai Moana');
    // The template's "Show me" button (or any reply) gets the full alert.
    expect(await say(number, 'Show me')).toContain('Booking request: 2 nights from Friday');
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
});
