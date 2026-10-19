/**
 * Hotel groups. An organization holds hotels; its administrators see and
 * manage every one of them (authz.ts adds the group's hotels to their scope),
 * and its sign-in policy covers its staff: two-step sign-in, OpenID Connect
 * single sign-on for its email domains, and SCIM provisioning.
 *
 * Platform admins manage every organization. Owners can start one from the
 * hotels they already run and administer it from then on.
 */
import type { OrgRole, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertCanManageOrg, requirePermission, type Actor } from '../authz';
import { assertSafeIssuer } from '../auth/sso';
import { demoHotelLocked } from '../demo';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { randomToken, seal, sha256, vaultAvailable } from '../vault';
import { recordAudit, type OpContext } from './audit';

export const SCIM_TOKEN_PREFIX = 'ho_scim_';

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'hotel-group';

const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function normaliseDomains(domains: string[]): string[] {
  const out = [...new Set(domains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
  for (const d of out) if (!DOMAIN.test(d)) throw badRequest(`“${d}” isn’t an email domain. Use the part after @, like hotelgroup.com.`);
  return out;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  hotels: number;
  members: number;
}

export interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  billingEmail: string | null;
  requireMfa: boolean;
  defaultRole: UserRole;
  hotels: { id: string; name: string; city: string; state: string }[];
  members: { userId: string; name: string; email: string; role: UserRole; orgRole: OrgRole; mfaEnabled: boolean; isActive: boolean; sso: boolean }[];
  sso: { enabled: boolean; enforced: boolean; issuer: string | null; clientId: string | null; hasSecret: boolean; domains: string[] };
  scim: { enabled: boolean; tokenPrefix: string | null };
  /** Hotels the viewer could add (ones they can access that aren't in another organization). */
  addableHotels: { id: string; name: string }[];
}

export async function listOrganizations(actor: Actor): Promise<OrganizationSummary[]> {
  const orgs = await prisma.organization.findMany({
    where: actor.role === 'ADMIN' ? {} : { id: { in: actor.orgAdminOf } },
    select: { id: true, name: true, slug: true, _count: { select: { properties: true, members: true } } },
    orderBy: { name: 'asc' },
  });
  return orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, hotels: o._count.properties, members: o._count.members }));
}

export async function getOrganization(actor: Actor, id: string): Promise<OrganizationDetail> {
  assertCanManageOrg(actor, id);
  const o = await prisma.organization.findUnique({
    where: { id },
    include: {
      properties: { select: { id: true, name: true, city: true, state: true }, orderBy: { name: 'asc' } },
      members: {
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true, mfaEnabled: true, isActive: true, ssoSubject: true } } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!o) throw notFound('Organization');
  const addable = await prisma.property.findMany({
    where: { organizationId: null, ...(actor.propertyIds === 'ALL' ? {} : { id: { in: actor.propertyIds } }) },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    billingEmail: o.billingEmail,
    requireMfa: o.requireMfa,
    defaultRole: o.defaultRole,
    hotels: o.properties,
    members: o.members.map((m) => ({
      userId: m.user.id,
      name: `${m.user.firstName} ${m.user.lastName}`.trim(),
      email: m.user.email,
      role: m.user.role,
      orgRole: m.role,
      mfaEnabled: m.user.mfaEnabled,
      isActive: m.user.isActive,
      sso: !!m.user.ssoSubject,
    })),
    sso: { enabled: o.ssoEnabled, enforced: o.ssoEnforced, issuer: o.ssoIssuer, clientId: o.ssoClientId, hasSecret: !!o.ssoClientSecretCipher, domains: o.ssoDomains },
    scim: { enabled: !!o.scimTokenHash, tokenPrefix: o.scimTokenPrefix },
    addableHotels: addable,
  };
}

/** Owners start an organization from hotels they run and become its administrator. */
export async function createOrganization(ctx: OpContext, input: { name: string; propertyIds: string[] }): Promise<{ id: string }> {
  const { actor } = ctx;
  requirePermission(actor, 'org.manage');
  const ids = [...new Set(input.propertyIds)];
  if (actor.role !== 'ADMIN' && !ids.length) throw badRequest('Choose at least one of your hotels for the organization.');
  if (actor.propertyIds !== 'ALL') {
    const foreign = ids.filter((pid) => !(actor.propertyIds as string[]).includes(pid));
    if (foreign.length) throw forbidden('You can only add hotels you run.');
  }
  const taken = await prisma.property.findMany({ where: { id: { in: ids }, organizationId: { not: null } }, select: { name: true } });
  if (taken.length) throw conflict(`${taken.map((t) => t.name).join(', ')} already belong to an organization.`);
  // Public demo: a group policy (required two-step sign-in, SSO) would lock other visitors out of the shared logins.
  const demoHotels = await prisma.property.count({ where: { id: { in: ids }, isDemo: true } });
  if (demoHotelLocked(actor, demoHotels > 0)) throw forbidden('Organizations aren’t available on the demo hotels or with the shared demo logins. Set up your own hotel to try them.');

  const base = slugify(input.name);
  let slug = base;
  for (let i = 2; await prisma.organization.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${base}-${i}`;

  const org = await prisma.$transaction(async (tx) => {
    const o = await tx.organization.create({ data: { name: input.name.trim(), slug } });
    if (ids.length) await tx.property.updateMany({ where: { id: { in: ids } }, data: { organizationId: o.id } });
    // The founder administers it (platform admins see every organization anyway).
    if (actor.role !== 'ADMIN') await tx.organizationMember.create({ data: { organizationId: o.id, userId: actor.userId, role: 'ADMIN' } });
    return o;
  });
  for (const pid of ids) await recordAudit(ctx, pid, 'ORG_HOTEL_ADDED', `Added to organization ${org.name}`, { organizationId: org.id });
  return { id: org.id };
}

export async function updateOrganization(
  ctx: OpContext,
  id: string,
  input: { name?: string; billingEmail?: string | null; requireMfa?: boolean; defaultRole?: UserRole },
): Promise<void> {
  assertCanManageOrg(ctx.actor, id);
  if (input.defaultRole === 'ADMIN' || input.defaultRole === 'CUSTOMER') throw badRequest('New staff can be owners, managers, front desk or housekeeping.');
  if (input.defaultRole === 'OWNER' && ctx.actor.role !== 'ADMIN' && ctx.actor.role !== 'OWNER') throw forbidden('Only owners can make new staff owners.');
  const org = await prisma.organization.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.billingEmail !== undefined ? { billingEmail: input.billingEmail || null } : {}),
      ...(input.requireMfa !== undefined ? { requireMfa: input.requireMfa } : {}),
      ...(input.defaultRole !== undefined ? { defaultRole: input.defaultRole } : {}),
    },
    include: { properties: { select: { id: true }, take: 1 } },
  });
  const anchor = org.properties[0]?.id;
  if (anchor) await recordAudit(ctx, anchor, 'ORG_UPDATED', `Updated organization ${org.name}${input.requireMfa !== undefined ? ` · two-step sign-in ${input.requireMfa ? 'required' : 'optional'}` : ''}`, { organizationId: id, ...input });
}

/** Add or remove hotels. Hotels you add must be ones you run and not in another organization. */
export async function setOrganizationHotels(ctx: OpContext, id: string, propertyIds: string[]): Promise<void> {
  const { actor } = ctx;
  assertCanManageOrg(actor, id);
  const want = new Set(propertyIds);
  const current = await prisma.property.findMany({ where: { organizationId: id }, select: { id: true } });
  const adding = [...want].filter((pid) => !current.some((c) => c.id === pid));
  const removing = current.filter((c) => !want.has(c.id)).map((c) => c.id);
  if (actor.propertyIds !== 'ALL') {
    const foreign = adding.filter((pid) => !(actor.propertyIds as string[]).includes(pid));
    if (foreign.length) throw forbidden('You can only add hotels you run.');
  }
  const taken = await prisma.property.findMany({ where: { id: { in: adding }, organizationId: { not: null } }, select: { name: true } });
  if (taken.length) throw conflict(`${taken.map((t) => t.name).join(', ')} already belong to another organization.`);
  await prisma.$transaction([
    prisma.property.updateMany({ where: { id: { in: adding } }, data: { organizationId: id } }),
    prisma.property.updateMany({ where: { id: { in: removing }, organizationId: id }, data: { organizationId: null } }),
  ]);
  for (const pid of adding) await recordAudit(ctx, pid, 'ORG_HOTEL_ADDED', 'Added to an organization', { organizationId: id });
  for (const pid of removing) await recordAudit(ctx, pid, 'ORG_HOTEL_REMOVED', 'Removed from its organization', { organizationId: id });
}

/** Add a person (an existing staff account) or change their organization role. */
export async function upsertMember(ctx: OpContext, id: string, input: { email: string; role: OrgRole }): Promise<void> {
  assertCanManageOrg(ctx.actor, id);
  const user = await prisma.user.findFirst({ where: { email: { equals: input.email.trim(), mode: 'insensitive' } }, select: { id: true, role: true } });
  if (!user) throw notFound('Account with that email');
  if (user.role === 'CUSTOMER') throw badRequest('That’s a guest account. Add them to your team first (Team → Add member).');
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: id, userId: user.id } },
    create: { organizationId: id, userId: user.id, role: input.role },
    update: { role: input.role },
  });
}

export async function removeMember(ctx: OpContext, id: string, userId: string): Promise<void> {
  assertCanManageOrg(ctx.actor, id);
  const m = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: id, userId } } });
  if (!m) throw notFound('Member');
  if (m.role === 'ADMIN') {
    const admins = await prisma.organizationMember.count({ where: { organizationId: id, role: 'ADMIN' } });
    if (admins <= 1 && ctx.actor.role !== 'ADMIN') throw badRequest('An organization needs at least one administrator. Make someone else an administrator first.');
  }
  await prisma.organizationMember.delete({ where: { id: m.id } });
}

/** Single sign-on settings. The client secret is sealed; leave it out to keep the stored one. */
export async function updateSso(
  ctx: OpContext,
  id: string,
  input: { enabled: boolean; enforced: boolean; issuer: string | null; clientId: string | null; clientSecret?: string | null; domains: string[] },
): Promise<void> {
  assertCanManageOrg(ctx.actor, id);
  const domains = normaliseDomains(input.domains);
  const current = await prisma.organization.findUniqueOrThrow({ where: { id }, select: { ssoClientSecretCipher: true } });
  const issuer = input.issuer?.trim().replace(/\/$/, '') || null;
  if (input.enabled) {
    if (!issuer || !input.clientId?.trim()) throw badRequest('Enter the issuer URL and client ID from your identity provider.');
    if (!input.clientSecret && !current.ssoClientSecretCipher) throw badRequest('Enter the client secret from your identity provider.');
    if (input.clientSecret && !vaultAvailable()) throw badRequest('Single sign-on needs HOTELONE_VAULT_KEY on the server to store the client secret (platform admin).');
    if (!domains.length) throw badRequest('Add at least one email domain that signs in through SSO.');
    await assertSafeIssuer(issuer);
  }
  if (domains.length) {
    const clash = await prisma.organization.findFirst({ where: { id: { not: id }, ssoDomains: { hasSome: domains } }, select: { name: true } });
    if (clash) throw conflict(`Another organization already signs in people with one of these domains (${clash.name}).`);
  }
  await prisma.organization.update({
    where: { id },
    data: {
      ssoEnabled: input.enabled,
      ssoEnforced: input.enabled && input.enforced,
      ssoIssuer: issuer,
      ssoClientId: input.clientId?.trim() || null,
      ...(input.clientSecret ? { ssoClientSecretCipher: seal(input.clientSecret.trim(), `sso:${id}`) } : {}),
      ssoDomains: domains,
    },
  });
}

/** A new SCIM bearer token (shown once); the previous one stops working. */
export async function rotateScimToken(ctx: OpContext, id: string): Promise<{ token: string }> {
  assertCanManageOrg(ctx.actor, id);
  const token = `${SCIM_TOKEN_PREFIX}${randomToken(32)}`;
  await prisma.organization.update({ where: { id }, data: { scimTokenHash: sha256(token), scimTokenPrefix: token.slice(0, 14) } });
  return { token };
}

export async function revokeScimToken(ctx: OpContext, id: string): Promise<void> {
  assertCanManageOrg(ctx.actor, id);
  await prisma.organization.update({ where: { id }, data: { scimTokenHash: null, scimTokenPrefix: null } });
}
