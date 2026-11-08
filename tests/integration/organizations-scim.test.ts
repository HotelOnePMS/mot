import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createUser, deleteUser, listUsers, patchUser, scimOrganization } from '@/server/auth/scim';
import { provisionSsoUser } from '@/server/auth/sso';
import { createOrganization, getOrganization, rotateScimToken, setOrganizationHotels, updateSso, upsertMember } from '@/server/services/organizations';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

const BASE = 'https://hotelone.test/api/scim/v2';

async function groupWithOwner() {
  const [a, b] = await Promise.all([makeHotel(), makeHotel()]);
  const owner = await makeUser({ role: 'OWNER', propertyIds: [a.property.id, b.property.id] });
  const ctx = { actor: await actorFor(owner.id), source: 'classic' as const };
  const { id } = await createOrganization(ctx, { name: `Harbor Group ${uid()}`, propertyIds: [a.property.id, b.property.id] });
  return { a, b, owner, id, ctx: { actor: await actorFor(owner.id), source: 'classic' as const } };
}

describe('organizations', () => {
  it('makes the founder an administrator who sees every hotel', async () => {
    const g = await groupWithOwner();
    expect(g.ctx.actor.orgAdminOf).toEqual([g.id]);
    const org = await getOrganization(g.ctx.actor, g.id);
    expect(org.hotels).toHaveLength(2);
    expect(org.members[0]).toMatchObject({ userId: g.owner.id, orgRole: 'ADMIN' });

    // A hotel added later is in the administrator's scope without a new assignment.
    const c = await makeHotel();
    await prisma.userPropertyAssignment.create({ data: { userId: g.owner.id, propertyId: c.property.id } });
    await setOrganizationHotels({ actor: await actorFor(g.owner.id), source: 'classic' }, g.id, [g.a.property.id, g.b.property.id, c.property.id]);
    await prisma.userPropertyAssignment.deleteMany({ where: { userId: g.owner.id, propertyId: c.property.id } });
    expect((await actorFor(g.owner.id)).propertyIds).toContain(c.property.id);
  });

  it('won’t take hotels the owner doesn’t run', async () => {
    const other = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [] });
    await expect(createOrganization({ actor: await actorFor(owner.id), source: 'classic' }, { name: 'Grab', propertyIds: [other.property.id] })).rejects.toThrow(/hotels you run/);
  });

  it('managers can’t see an organization they don’t administer', async () => {
    const g = await groupWithOwner();
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [g.a.property.id] });
    await expect(getOrganization(await actorFor(manager.id), g.id)).rejects.toThrow(/administrators/);
  });
});

describe('SCIM provisioning', () => {
  async function scimOrg() {
    const g = await groupWithOwner();
    const domain = `scim-${uid()}.example`;
    await prisma.organization.update({ where: { id: g.id }, data: { ssoDomains: [domain], defaultRole: 'FRONT_DESK' } });
    const { token } = await rotateScimToken(g.ctx, g.id);
    return { ...g, domain, org: await scimOrganization(`Bearer ${token}`) };
  }

  it('refuses a wrong token', async () => {
    await expect(scimOrganization('Bearer ho_scim_nope')).rejects.toMatchObject({ status: 401 });
    await expect(scimOrganization(null)).rejects.toMatchObject({ status: 401 });
  });

  it('creates, finds, deactivates and removes a person', async () => {
    const s = await scimOrg();
    const created = await createUser(s.org, { userName: `jo@${s.domain}`, name: { givenName: 'Jo', familyName: 'Kim' }, externalId: '00u1', active: true }, BASE);
    expect(created).toMatchObject({ userName: `jo@${s.domain}`, active: true, externalId: '00u1' });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: created.id }, include: { assignedProperties: true } });
    expect(u.role).toBe('FRONT_DESK');
    expect(u.password).toBe('');
    expect(u.assignedProperties).toHaveLength(2);

    const found = await listUsers(s.org, { filter: `userName eq "JO@${s.domain.toUpperCase()}"`, startIndex: 1, count: 10 }, BASE);
    expect(found.totalResults).toBe(1);

    await expect(createUser(s.org, { userName: `jo@${s.domain}` }, BASE)).rejects.toMatchObject({ status: 409 });

    // Entra ID style: "False" as a string, no path.
    const off = await patchUser(s.org, created.id, { Operations: [{ op: 'Replace', value: { active: 'False' } }] }, BASE);
    expect(off.active).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).sessionVersion).toBe(1);

    await deleteUser(s.org, created.id);
    expect(await prisma.organizationMember.count({ where: { userId: created.id } })).toBe(0);
    expect(await prisma.userPropertyAssignment.count({ where: { userId: created.id } })).toBe(0);
  });

  it('won’t claim an existing account outside the organization’s domains', async () => {
    const s = await scimOrg();
    const outsider = await makeUser({ role: 'CUSTOMER', email: `guest-${uid()}@gmail.example` });
    await expect(createUser(s.org, { userName: outsider.email }, BASE)).rejects.toMatchObject({ status: 409 });
  });

  it('won’t claim staff of another hotel or a platform admin on its domain', async () => {
    const s = await scimOrg();
    const elsewhere = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', email: `owner-${uid()}@${s.domain}`, propertyIds: [elsewhere.property.id] });
    const admin = await makeUser({ role: 'ADMIN', email: `admin-${uid()}@${s.domain}` });
    for (const u of [owner, admin]) {
      await expect(createUser(s.org, { userName: u.email, active: false }, BASE)).rejects.toMatchObject({ status: 409 });
      const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(after.isActive).toBe(true);
      expect(await prisma.organizationMember.count({ where: { userId: u.id, organizationId: s.id } })).toBe(0);
    }
  });

  it('claims an existing account that already works at one of its hotels', async () => {
    const s = await scimOrg();
    const desk = await makeUser({ role: 'FRONT_DESK', email: `desk-${uid()}@${s.domain}`, propertyIds: [s.a.property.id] });
    const claimed = await createUser(s.org, { userName: desk.email }, BASE);
    expect(claimed.id).toBe(desk.id);
  });

  it('only sees its own members', async () => {
    const [s1, s2] = await Promise.all([scimOrg(), scimOrg()]);
    const p = await createUser(s1.org, { userName: `pat@${s1.domain}` }, BASE);
    await expect(patchUser(s2.org, p.id, { Operations: [{ op: 'replace', path: 'active', value: false }] }, BASE)).rejects.toMatchObject({ status: 404 });
  });
});

describe('organization members', () => {
  it('won’t pull in staff of other hotels, and answers the same as for no account', async () => {
    const g = await groupWithOwner();
    const elsewhere = await makeHotel();
    const victim = await makeUser({ role: 'OWNER', propertyIds: [elsewhere.property.id] });
    const admin = await makeUser({ role: 'ADMIN' });
    const missing = upsertMember(g.ctx, g.id, { email: `nobody-${uid()}@example.com`, role: 'MEMBER' });
    await expect(missing).rejects.toThrow(/team of one of this organization/);
    await expect(upsertMember(g.ctx, g.id, { email: victim.email, role: 'ADMIN' })).rejects.toThrow(/team of one of this organization/);
    await expect(upsertMember(g.ctx, g.id, { email: admin.email, role: 'MEMBER' })).rejects.toThrow(/team of one of this organization/);
    expect(await prisma.organizationMember.count({ where: { organizationId: g.id, userId: { in: [victim.id, admin.id] } } })).toBe(0);
  });

  it('adds someone who works at one of its hotels', async () => {
    const g = await groupWithOwner();
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [g.a.property.id] });
    await upsertMember(g.ctx, g.id, { email: manager.email, role: 'MEMBER' });
    expect(await prisma.organizationMember.count({ where: { organizationId: g.id, userId: manager.id } })).toBe(1);
  });

  it('won’t take a public email domain for SSO', async () => {
    const g = await groupWithOwner();
    await expect(updateSso(g.ctx, g.id, { enabled: false, enforced: false, issuer: null, clientId: null, domains: ['Gmail.com'] })).rejects.toThrow(/public email service/);
  });
});

describe('SSO provisioning', () => {
  it('won’t sign in as an existing account outside the organization', async () => {
    const g = await groupWithOwner();
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: g.id } });
    const elsewhere = await makeHotel();
    const domain = `victim-${uid()}.example`;
    const victims = [
      await makeUser({ role: 'OWNER', email: `owner@${domain}`, propertyIds: [elsewhere.property.id] }),
      await makeUser({ role: 'ADMIN', email: `ops@${domain}` }),
      await makeUser({ role: 'CUSTOMER', email: `guest@${domain}` }),
    ];
    for (const v of victims) {
      await expect(provisionSsoUser(org, { issuer: 'https://evil-idp.example', subject: `sub-${uid()}`, email: v.email })).rejects.toMatchObject({ code: 'SSO_EXISTING_ACCOUNT' });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: v.id } })).ssoSubject).toBeNull();
    }
  });

  it('links an existing account that works at one of its hotels', async () => {
    const g = await groupWithOwner();
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: g.id } });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [g.b.property.id] });
    expect(await provisionSsoUser(org, { issuer: 'https://idp.example', subject: `sub-${uid()}`, email: desk.email })).toBe(desk.id);
  });

  it('creates a person once, then finds them by issuer and subject', async () => {
    const g = await groupWithOwner();
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: g.id } });
    const who = { issuer: 'https://idp.example', subject: `sub-${uid()}`, email: `lee-${uid()}@harbor.example`, claims: { given_name: 'Lee', family_name: 'Park' } };
    const first = await provisionSsoUser(org, who);
    const again = await provisionSsoUser(org, { ...who, email: who.email.toUpperCase() });
    expect(again).toBe(first);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: first } });
    expect(u).toMatchObject({ firstName: 'Lee', lastName: 'Park', role: 'FRONT_DESK', ssoSubject: who.subject });
    expect(u.emailVerifiedAt).not.toBeNull();
  });
});
