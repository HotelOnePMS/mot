import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

// The heartbeat would run alert rounds in the background mid-test.
vi.mock('@/server/agent/watch', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/agent/watch')>()), watchSoon: vi.fn() }));

const { handleInbound } = await import('@/server/whatsapp/staff');
const { startLink, cancelLinkCode, linkStatus, unlink } = await import('@/server/whatsapp/link');
const { whatsAppConfig } = await import('@/server/whatsapp/cloud');

let sent: { to: string; text: string }[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  Object.assign(process.env, { WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_ACCESS_TOKEN: 'token', WHATSAPP_APP_SECRET: 'secret', WHATSAPP_VERIFY_TOKEN: 'verify' });
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.type === 'text') sent.push({ to: body.to, text: body.text.body });
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
const phone = () => `1556${String(Date.now()).slice(-5)}${String(n++).padStart(2, '0')}`;
async function say(from: string, text: string): Promise<string> {
  const before = sent.length;
  await handleInbound(whatsAppConfig()!, { id: `wamid.${uid()}${uid()}`, from, text });
  return sent.slice(before).map((m) => m.text).join('\n---\n');
}

const linkLogs = (userId: string) => prisma.agentAuditLog.findMany({ where: { userId, action: { in: ['WHATSAPP_LINKED', 'WHATSAPP_UNLINKED'] } }, select: { propertyId: true, action: true } });

describe('linking a phone', () => {
  it('refuses a code shown before “sign out everywhere”', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const { code } = await startLink(await actorFor(owner.id));
    await prisma.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
    const number = phone();
    expect(await say(number, `LINK ${code}`)).toMatch(/didn’t work/);
    expect(await prisma.staffWhatsAppLink.findUnique({ where: { number } })).toBeNull();
  });

  it('stops a code when the person presses Cancel, and keeps an existing link', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const number = phone();
    const first = await startLink(await actorFor(owner.id));
    expect(await say(number, `LINK ${first.code}`)).toMatch(/Linked/);

    const second = await startLink(await actorFor(owner.id));
    await cancelLinkCode(await actorFor(owner.id));
    expect(await say(phone(), `LINK ${second.code}`)).toMatch(/didn’t work/);
    expect((await linkStatus(await actorFor(owner.id))).linked).not.toBeNull();
    expect(await say(number, 'brief me')).not.toMatch(/link your phone/);

    // With no link yet, Cancel leaves nothing behind.
    const other = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const third = await startLink(await actorFor(other.id));
    await cancelLinkCode(await actorFor(other.id));
    expect(await prisma.staffWhatsAppLink.findUnique({ where: { userId: other.id } })).toBeNull();
    expect(await say(phone(), `LINK ${third.code}`)).toMatch(/didn’t work/);
  });

  it('keeps the sign-in method of the console session that showed the code', async () => {
    const h = await makeHotel();
    const org = await prisma.organization.create({ data: { name: 'Group', slug: `g-${uid()}`, requireMfa: true, properties: { connect: { id: h.property.id } } } });
    const mfaRule = async (authMethod: 'password' | 'sso') => {
      // Has an SSO identity, but no two-step sign-in set up.
      const u = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
      await prisma.user.update({ where: { id: u.id }, data: { ssoIssuer: 'https://idp.example', ssoSubject: `sub-${uid()}`, organizations: { create: { organizationId: org.id } } } });
      const number = phone();
      const { code } = await startLink({ ...(await actorFor(u.id)), authMethod });
      expect(await say(number, `LINK ${code}`)).toMatch(/Linked/);
      return say(number, 'brief me');
    };
    // Linked from a password session: the organization's two-step rule applies on WhatsApp too.
    expect(await mfaRule('password')).toMatch(/requires two-step sign-in/);
    // Linked from an SSO session: the identity provider handles it.
    expect(await mfaRule('sso')).not.toMatch(/requires two-step sign-in/);
  });

  it('keeps a platform admin’s link out of customer hotels’ activity logs', async () => {
    const h = await makeHotel();
    const admin = await makeUser({ role: 'ADMIN' });
    const number = phone();
    const { code } = await startLink(await actorFor(admin.id));
    expect(await say(number, `LINK ${code}`)).toMatch(/Linked/);
    await prisma.staffWhatsAppLink.update({ where: { userId: admin.id }, data: { propertyId: h.property.id } });
    expect(await say(number, 'UNLINK')).toMatch(/nlinked/);
    expect(await linkLogs(admin.id)).toEqual([]);
  });

  it('logs an unlink at a hotel the person still works at', async () => {
    const a = await makeHotel();
    const b = await makeHotel();
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [a.property.id] });
    const { code } = await startLink(await actorFor(manager.id));
    expect(await say(phone(), `LINK ${code}`)).toMatch(/Linked/);
    await prisma.staffWhatsAppLink.update({ where: { userId: manager.id }, data: { propertyId: a.property.id } });
    // Moved from hotel A to hotel B; the chat still points at A.
    await prisma.user.update({ where: { id: manager.id }, data: { assignedProperties: { deleteMany: {}, create: { propertyId: b.property.id } } } });
    await unlink(await actorFor(manager.id), 'console');
    expect(await linkLogs(manager.id)).toEqual(expect.arrayContaining([{ propertyId: b.property.id, action: 'WHATSAPP_UNLINKED' }]));
    expect((await linkLogs(manager.id)).filter((l) => l.propertyId === a.property.id && l.action === 'WHATSAPP_UNLINKED')).toEqual([]);
  });
});
