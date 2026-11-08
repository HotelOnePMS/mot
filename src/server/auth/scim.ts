/**
 * SCIM 2.0 user provisioning (RFC 7643/7644) for an organization's identity
 * provider: Okta, Microsoft Entra ID, OneLogin, JumpCloud… create, update and
 * deactivate staff accounts here when people join or leave.
 *
 * Bearer token per organization (Organization → SCIM, shown once). The
 * provider sees and changes only that organization's members. Accounts it
 * creates sign in through SSO (no password), get the organization's default
 * role and every one of its hotels. An existing account joins only when its
 * email is in one of the organization's SSO domains. Deleting a user turns
 * the account off and removes it from the organization; history is kept.
 */
import type { Organization, User } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assignOrgHotels, mayClaimExistingAccount } from './sso';
import { sha256 } from '../vault';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export class ScimError extends Error {
  constructor(
    public status: number,
    message: string,
    public scimType?: string,
  ) {
    super(message);
  }
}

export function scimErrorBody(e: ScimError) {
  return { schemas: [ERROR_SCHEMA], status: String(e.status), ...(e.scimType ? { scimType: e.scimType } : {}), detail: e.message };
}

/** The organization a SCIM bearer token belongs to. */
export async function scimOrganization(authorization: string | null): Promise<Organization> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new ScimError(401, 'Send the SCIM token as a Bearer token.');
  const org = await prisma.organization.findUnique({ where: { scimTokenHash: sha256(token) } });
  if (!org) throw new ScimError(401, 'That SCIM token isn’t valid. Create a new one in Organization → SCIM.');
  return org;
}

type ScimUserInput = {
  userName?: string;
  externalId?: string;
  active?: boolean | string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: { value?: string; primary?: boolean; type?: string }[];
  displayName?: string;
};

export function toScimUser(u: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'isActive' | 'scimExternalId' | 'createdAt' | 'updatedAt'>, base: string) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: u.id,
    ...(u.scimExternalId ? { externalId: u.scimExternalId } : {}),
    userName: u.email,
    name: { givenName: u.firstName, familyName: u.lastName, formatted: `${u.firstName} ${u.lastName}`.trim() },
    displayName: `${u.firstName} ${u.lastName}`.trim(),
    emails: [{ value: u.email, type: 'work', primary: true }],
    active: u.isActive,
    meta: { resourceType: 'User', created: u.createdAt.toISOString(), lastModified: u.updatedAt.toISOString(), location: `${base}/Users/${u.id}` },
  };
}

const bool = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() === 'true' : !!v);

function emailOf(input: ScimUserInput): string {
  const email = (input.emails?.find((e) => e.primary)?.value ?? input.emails?.[0]?.value ?? input.userName ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ScimError(400, 'userName must be the person’s email address.', 'invalidValue');
  return email;
}

function names(input: ScimUserInput, email: string) {
  const formatted = input.name?.formatted || input.displayName || '';
  const [first, ...rest] = formatted.split(' ').filter(Boolean);
  return {
    firstName: (input.name?.givenName || first || email.split('@')[0]).slice(0, 60),
    lastName: (input.name?.familyName || rest.join(' ') || 'Member').slice(0, 60),
  };
}

const memberWhere = (org: Organization) => ({ organizations: { some: { organizationId: org.id } } });

async function memberOrThrow(org: Organization, id: string) {
  const u = await prisma.user.findFirst({ where: { id, ...memberWhere(org) } });
  if (!u) throw new ScimError(404, 'No such user in this organization.');
  return u;
}

// ---------------------------------------------------------------------------
// Filters: userName eq "…", externalId eq "…", emails.value eq "…"
// ---------------------------------------------------------------------------

export function parseFilter(filter: string | null): { field: 'email' | 'externalId'; value: string } | null {
  if (!filter) return null;
  const m = filter.trim().match(/^(userName|externalId|emails(?:\.value|\[type eq "work"\]\.value))\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  if (!m) throw new ScimError(400, 'Only filters like userName eq "name@example.com" or externalId eq "…" are supported.', 'invalidFilter');
  const value = m[2].replace(/\\(.)/g, '$1');
  return { field: m[1].toLowerCase() === 'externalid' ? 'externalId' : 'email', value };
}

export async function listUsers(org: Organization, q: { filter: string | null; startIndex: number; count: number }, base: string) {
  const f = parseFilter(q.filter);
  const where = {
    ...memberWhere(org),
    ...(f?.field === 'email' ? { email: { equals: f.value, mode: 'insensitive' as const } } : {}),
    ...(f?.field === 'externalId' ? { scimExternalId: f.value } : {}),
  };
  const start = Math.max(1, q.startIndex);
  const count = Math.min(Math.max(0, q.count), 200);
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: { createdAt: 'asc' }, skip: start - 1, take: count }),
  ]);
  return { schemas: [LIST_SCHEMA], totalResults: total, startIndex: start, itemsPerPage: users.length, Resources: users.map((u) => toScimUser(u, base)) };
}

export async function getUser(org: Organization, id: string, base: string) {
  return toScimUser(await memberOrThrow(org, id), base);
}

export async function createUser(org: Organization, input: ScimUserInput, base: string) {
  const email = emailOf(input);
  const active = input.active === undefined ? true : bool(input.active);
  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, include: { organizations: { select: { organizationId: true } } } });
  if (existing) {
    if (existing.organizations.some((m) => m.organizationId === org.id)) throw new ScimError(409, 'A user with that userName already exists.', 'uniqueness');
    // Only claim an existing account when the organization owns the email domain.
    // The organization chose its own domains (they aren't verified), so it may only take over someone who already works there.
    if (!org.ssoDomains.includes(email.split('@')[1]) || !(await mayClaimExistingAccount(org.id, existing))) {
      throw new ScimError(409, 'An account with that email already exists outside this organization.', 'uniqueness');
    }
    const u = await prisma.user.update({
      where: { id: existing.id },
      data: { scimExternalId: input.externalId ?? existing.scimExternalId, emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), ...(active ? {} : { isActive: false, sessionVersion: { increment: 1 } }) },
    });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: u.id, role: 'MEMBER' } });
    return toScimUser(u, base);
  }
  const u = await prisma.user.create({
    data: {
      email,
      password: '', // signs in through SSO
      ...names(input, email),
      role: org.defaultRole,
      isActive: active,
      emailVerifiedAt: new Date(),
      scimExternalId: input.externalId ?? null,
      organizations: { create: { organizationId: org.id, role: 'MEMBER' } },
    },
  });
  await assignOrgHotels(org.id, u.id);
  return toScimUser(u, base);
}

async function applyChanges(org: Organization, user: User, changes: { email?: string; firstName?: string; lastName?: string; externalId?: string | null; active?: boolean }) {
  if (user.role === 'ADMIN') throw new ScimError(403, 'Platform administrators can’t be changed through SCIM.');
  if (changes.email && changes.email !== user.email.toLowerCase()) {
    if (!org.ssoDomains.includes(changes.email.split('@')[1])) throw new ScimError(400, 'The new email must be in one of the organization’s SSO domains.', 'invalidValue');
    if (await prisma.user.findFirst({ where: { email: { equals: changes.email, mode: 'insensitive' }, id: { not: user.id } }, select: { id: true } })) {
      throw new ScimError(409, 'Another account already uses that email.', 'uniqueness');
    }
  }
  const deactivate = changes.active === false && user.isActive;
  return prisma.user.update({
    where: { id: user.id },
    data: {
      ...(changes.email ? { email: changes.email } : {}),
      ...(changes.firstName ? { firstName: changes.firstName.slice(0, 60) } : {}),
      ...(changes.lastName ? { lastName: changes.lastName.slice(0, 60) } : {}),
      ...(changes.externalId !== undefined ? { scimExternalId: changes.externalId } : {}),
      ...(changes.active !== undefined ? { isActive: changes.active } : {}),
      // Turning someone off ends their sessions at once.
      ...(deactivate ? { sessionVersion: { increment: 1 } } : {}),
    },
  });
}

export async function replaceUser(org: Organization, id: string, input: ScimUserInput, base: string) {
  const user = await memberOrThrow(org, id);
  const email = emailOf(input);
  const n = names(input, email);
  const u = await applyChanges(org, user, { email, ...n, externalId: input.externalId ?? null, active: input.active === undefined ? true : bool(input.active) });
  return toScimUser(u, base);
}

interface PatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

/** PATCH with replace/add on active, name, userName, emails and externalId (Okta and Entra ID styles). */
export async function patchUser(org: Organization, id: string, body: { schemas?: string[]; Operations?: PatchOperation[] }, base: string) {
  if (!Array.isArray(body.Operations)) throw new ScimError(400, `Send a ${PATCH_SCHEMA} with Operations.`, 'invalidSyntax');
  const user = await memberOrThrow(org, id);
  const changes: { email?: string; firstName?: string; lastName?: string; externalId?: string | null; active?: boolean } = {};
  const set = (path: string, value: unknown) => {
    const p = path.toLowerCase();
    if (p === 'active') changes.active = bool(value);
    else if (p === 'name.givenname') changes.firstName = String(value ?? '');
    else if (p === 'name.familyname') changes.lastName = String(value ?? '');
    else if (p === 'username' || p === 'emails[type eq "work"].value' || p === 'emails.value') changes.email = String(value ?? '').trim().toLowerCase();
    else if (p === 'externalid') changes.externalId = value === null ? null : String(value);
    else if (p === 'name' && value && typeof value === 'object') {
      const v = value as { givenName?: string; familyName?: string };
      if (v.givenName) changes.firstName = v.givenName;
      if (v.familyName) changes.lastName = v.familyName;
    } else if (p === 'emails' && Array.isArray(value)) {
      const primary = (value as { value?: string; primary?: boolean }[]).find((e) => e.primary) ?? (value as { value?: string }[])[0];
      if (primary?.value) changes.email = primary.value.trim().toLowerCase();
    }
    // Attributes HotelOne doesn't keep (title, phone numbers…) are ignored.
  };
  for (const op of body.Operations) {
    const kind = String(op.op).toLowerCase();
    if (kind === 'remove') {
      if (op.path?.toLowerCase() === 'externalid') changes.externalId = null;
      continue;
    }
    if (kind !== 'replace' && kind !== 'add') throw new ScimError(400, `Unsupported operation “${op.op}”.`, 'invalidSyntax');
    if (op.path) set(op.path, op.value);
    else if (op.value && typeof op.value === 'object') for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) set(k, v);
  }
  const u = await applyChanges(org, user, changes);
  return toScimUser(u, base);
}

/** DELETE: turn the account off and take it out of the organization and its hotels. */
export async function deleteUser(org: Organization, id: string): Promise<void> {
  const user = await memberOrThrow(org, id);
  if (user.role === 'ADMIN') throw new ScimError(403, 'Platform administrators can’t be removed through SCIM.');
  const hotels = await prisma.property.findMany({ where: { organizationId: org.id }, select: { id: true } });
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { isActive: false, sessionVersion: { increment: 1 } } }),
    prisma.organizationMember.deleteMany({ where: { organizationId: org.id, userId: user.id } }),
    prisma.userPropertyAssignment.deleteMany({ where: { userId: user.id, propertyId: { in: hotels.map((h) => h.id) } } }),
  ]);
}

export function serviceProviderConfig(base: string) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: `${base.replace(/\/api\/scim\/v2$/, '')}/admin/organization`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'The organization’s SCIM token, from Organization → SCIM.', primary: true }],
    meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` },
  };
}

export function resourceTypes(base: string) {
  return {
    schemas: [LIST_SCHEMA],
    totalResults: 1,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: SCIM_USER_SCHEMA,
        meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
      },
    ],
  };
}
