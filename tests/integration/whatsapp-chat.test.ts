import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { InboundMessage } from '@/server/whatsapp/cloud';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

// The heartbeat would run alert rounds in the background mid-test.
vi.mock('@/server/agent/watch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/agent/watch')>()), watchSoon: vi.fn() }));

const { handleInbound } = await import('@/server/whatsapp/staff');
const { startLink } = await import('@/server/whatsapp/link');
const { whatsAppConfig } = await import('@/server/whatsapp/cloud');
const { choiceAt } = await import('@/server/whatsapp/format');

/** What we sent through the Cloud API, newest last. */
let sent: { to: string; text?: string; template?: string; params?: string[] }[] = [];
/** Messages we marked read (with "typing…"). */
let read: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  Object.assign(process.env, { WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_ACCESS_TOKEN: 'token', WHATSAPP_APP_SECRET: 'secret', WHATSAPP_VERIFY_TOKEN: 'verify', WHATSAPP_ALERT_TEMPLATE: 'hotel_alert' });
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.status === 'read') read.push(body.message_id);
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
  read = [];
});

let n = 0;
const phone = () => `1556${String(Date.now()).slice(-5)}${String(n++).padStart(2, '0')}`;
/** A message from this phone; resolves once the replies have been sent (several are joined with ---). */
async function say(from: string, text: string | null, more: Partial<InboundMessage> = {}): Promise<string> {
  const before = sent.length;
  await handleInbound(whatsAppConfig()!, { id: `wamid.${uid()}${uid()}`, from, text, ...more });
  return sent.slice(before).map((m) => m.text ?? `[template ${m.template}] ${m.params?.join(' | ')}`).join('\n---\n');
}
/** A reaction to one of our messages; an empty emoji takes it back. */
const react = (from: string, emoji: string) => say(from, null, { type: 'reaction', emoji });

async function linked(userId: string): Promise<string> {
  const number = phone();
  const { code } = await startLink(await actorFor(userId));
  expect(await say(number, `LINK ${code}`)).toMatch(/Linked/);
  return number;
}

const linkOf = (userId: string) => prisma.staffWhatsAppLink.findUniqueOrThrow({ where: { userId } });
const roomStatus = async (id: string) => (await prisma.room.findUniqueOrThrow({ where: { id } })).status;
const YES_OR_NO = 'Reply *YES* to go ahead or *NO* to cancel.';

/** An owner of one hotel, with a linked phone. */
async function ownerOnWhatsApp() {
  const h = await makeHotel();
  const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
  return { h, owner, room: h.rooms[0], number: await linked(owner.id) };
}

describe('confirming on WhatsApp', () => {
  it('keeps a plan waiting through “thanks” and a question, and “yes please” confirms it', async () => {
    const { owner, room, number } = await ownerOnWhatsApp();
    expect(await say(number, `mark room ${room.roomNumber} dirty`)).toMatch(/Please confirm/);
    const plan = (await linkOf(owner.id)).pendingPlan;
    expect(plan).toBeTruthy();

    expect(await say(number, 'who’s arriving today?')).not.toMatch(/Please confirm/);
    expect((await linkOf(owner.id)).pendingPlan).toBe(plan);
    expect(await say(number, 'thanks')).toBe(YES_OR_NO);
    expect((await linkOf(owner.id)).pendingPlan).toBe(plan);
    expect(await roomStatus(room.id)).toBe('CLEAN');

    expect(await say(number, 'yes please')).toMatch(/✅/);
    expect(await roomStatus(room.id)).toBe('DIRTY');
  });

  it('doesn’t take “ok” or “sure” for YES', async () => {
    const { owner, room, number } = await ownerOnWhatsApp();
    expect(await say(number, `mark room ${room.roomNumber} dirty`)).toMatch(/Please confirm/);
    expect(await say(number, 'ok')).toBe(YES_OR_NO);
    expect(await say(number, 'Sure!')).toBe(YES_OR_NO);
    expect(await roomStatus(room.id)).toBe('CLEAN');
    expect((await linkOf(owner.id)).pendingPlan).toBeTruthy();

    expect(await say(number, 'no, cancel')).toMatch(/nothing was changed/);
    expect(await say(number, 'yes, go ahead')).toMatch(/nothing waiting/);
    expect(await roomStatus(room.id)).toBe('CLEAN');
  });

  it('answers thanks itself, so nothing is sent to a hotel’s own PMS', async () => {
    const h = await makeHotel();
    await prisma.property.update({ where: { id: h.property.id }, data: { setupPath: 'BRIDGE' } });
    await prisma.pmsConnection.create({ data: { propertyId: h.property.id, system: 'Opera', mode: 'DESKTOP', status: 'CONNECTED' } });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = await linked(owner.id);

    expect(await say(number, 'thanks')).toBe('👍 Message me whenever you need something.');
    expect(await say(number, '🙏')).toBe('👍 Message me whenever you need something.');
    expect(await prisma.bridgeTask.count({ where: { propertyId: h.property.id } })).toBe(0);
    expect(await prisma.agentAuditLog.count({ where: { propertyId: h.property.id, action: 'COMMAND' } })).toBe(0);
  });
});

describe('an alert sent as a template', () => {
  /** What watch.ts stores when an alert goes out as a template: the whole text and its numbered replies, not yet seen. */
  async function unseenAlert(userId: string, propertyId: string, roomNumber: string): Promise<string> {
    const text = `🔔 *Front desk*: room ${roomNumber} needs a look\nReply *1* to: mark room ${roomNumber} dirty`;
    await prisma.staffWhatsAppLink.update({ where: { userId }, data: { alertUnseen: true, lastAlert: text, choices: [choiceAt(propertyId, `mark room ${roomNumber} dirty`)] } });
    return text;
  }

  it('is shown first on the next message, which is then answered too, and its number still works', async () => {
    const { h, owner, room, number } = await ownerOnWhatsApp();
    const alert = await unseenAlert(owner.id, h.property.id, room.roomNumber);

    const parts = (await say(number, 'what?')).split('\n---\n');
    expect(parts[0]).toBe(alert);
    expect(parts).toHaveLength(2);
    // The answer's own numbered replies come after the alert's.
    expect(parts[1]).not.toMatch(/^1\. /m);
    expect((await linkOf(owner.id)).alertUnseen).toBe(false);

    expect(await say(number, '1')).toMatch(/Please confirm: Mark room/i);
  });

  it('is all a number, “ok” or the template’s button gets, so nothing runs unread', async () => {
    const { h, owner, room, number } = await ownerOnWhatsApp();
    const alert = await unseenAlert(owner.id, h.property.id, room.roomNumber);
    expect(await say(number, '1')).toBe(alert);
    expect((await linkOf(owner.id)).pendingPlan).toBeNull();
    expect(await prisma.agentAuditLog.count({ where: { propertyId: h.property.id, userId: owner.id, action: 'COMMAND' } })).toBe(0);

    await unseenAlert(owner.id, h.property.id, room.roomNumber);
    expect(await say(number, 'ok')).toBe(alert);
    await unseenAlert(owner.id, h.property.id, room.roomNumber);
    expect(await say(number, 'View alert', { type: 'button' })).toBe(alert);
    expect(await prisma.agentAuditLog.count({ where: { propertyId: h.property.id, userId: owner.id, action: 'COMMAND' } })).toBe(0);

    // Now they've read it, "1" goes through the agent (and still asks first).
    expect(await say(number, '1')).toMatch(/Please confirm: Mark room/i);
    expect(await roomStatus(room.id)).toBe('CLEAN');
  });

  it('waits behind YES and NO, and keeps its numbered replies', async () => {
    const { h, owner, room, number } = await ownerOnWhatsApp();
    const alert = await unseenAlert(owner.id, h.property.id, room.roomNumber);
    expect(await say(number, 'yes')).toMatch(/nothing waiting/);
    expect(await say(number, 'no')).toBe('OK. What would you like to do?');
    expect((await linkOf(owner.id)).alertUnseen).toBe(true);
    expect(await say(number, 'show me')).toBe(alert);
    expect(await say(number, '1')).toMatch(/Please confirm: Mark room/i);
  });
});

describe('reactions', () => {
  it('get no reply, and a 👍 on a plan doesn’t confirm it', async () => {
    const { owner, room, number } = await ownerOnWhatsApp();
    expect(await react(number, '👍')).toBe('');
    expect(await react(number, '')).toBe('');
    expect(read).toEqual([]);

    expect(await say(number, `mark room ${room.roomNumber} dirty`)).toMatch(/Please confirm/);
    expect(await react(number, '👍')).toBe(YES_OR_NO);
    expect(await react(number, '')).toBe('');
    expect(await roomStatus(room.id)).toBe('CLEAN');
    expect((await linkOf(owner.id)).pendingPlan).toBeTruthy();
    expect(await say(number, 'yes')).toMatch(/✅/);
  });
});

describe('switching hotel', () => {
  it('prefers the exact name over a longer one that contains it', async () => {
    const [a, b] = await Promise.all([makeHotel(), makeHotel()]);
    const name = `Harbor Inn ${uid()}`;
    await prisma.property.update({ where: { id: a.property.id }, data: { name } });
    await prisma.property.update({ where: { id: b.property.id }, data: { name: `${name} Downtown` } });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [a.property.id, b.property.id] });
    const number = await linked(owner.id);

    expect(await say(number, `switch to ${name.toLowerCase()}`)).toBe(`Now working on *${name}*. What would you like to know?`);
    expect(await say(number, `Switch to ${name} downtown?`)).toBe(`Now working on *${name} Downtown*. What would you like to know?`);
    expect(await say(number, `switch to ${name}?`)).toBe(`Now working on *${name}*. What would you like to know?`);
    expect(await say(number, `switch to ${name.slice(0, -2)}`)).toMatch(/More than one hotel matches/);
  });

  it('finds any of the person’s hotels, however many they have', async () => {
    const tag = uid();
    const start = Date.now() - 3600_000;
    await prisma.property.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        name: `Lodge ${tag} ${String(i).padStart(2, '0')}`,
        address: '1 Harbor Way',
        city: 'Santa Cruz',
        state: 'CA',
        zipCode: '95060',
        phone: '+1 831 555 0100',
        createdAt: new Date(start + i * 1000),
      })),
    });
    const lodges = await prisma.property.findMany({ where: { name: { startsWith: `Lodge ${tag} ` } }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
    const owner = await makeUser({ role: 'OWNER', propertyIds: lodges.map((l) => l.id) });
    const number = await linked(owner.id);

    expect(await say(number, `switch to ${lodges[59].name}`)).toBe(`Now working on *${lodges[59].name}*. What would you like to know?`);
    expect(await say(number, 'who’s arriving today?')).toMatch(new RegExp(`^_${lodges[59].name}_`));

    await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { choices: [`#hotel:${lodges[55].id}`] } });
    expect(await say(number, '1')).toBe(`Now working on *${lodges[55].name}*. What would you like to know?`);
    await prisma.staffWhatsAppLink.update({ where: { userId: owner.id }, data: { choices: [choiceAt(lodges[57].id, 'who’s arriving today?')] } });
    expect(await say(number, '1')).toMatch(new RegExp(`^_${lodges[57].name}_`));

    const list = await say(number, 'hotels');
    expect(list).toContain(`9. ${lodges[8].name}`);
    expect(list).not.toContain(lodges[9].name);
    expect(list).toContain('…and 51 more. For those, send “switch to” and the hotel’s name.');
  });
});
