/**
 * Vendors: each hotel's suppliers and third-party service partners (linen, food, maintenance, IT ...) with who to
 * contact. Owners see and manage the list. At their own hotel an owner can let managers, the front desk and
 * housekeepers see it (vendors.view), and let managers add, change and remove vendors (vendors.manage), under
 * Settings → Permissions. Managing implies seeing. Every change is written to the hotel's activity log.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { emailKey } from '@/lib/doNotRent';
import { VENDOR_CATEGORY_IDS, normalizeWebsite, type VendorCategory, type VendorEntry, type VendorInput, type VendorStatus } from '@/lib/vendors';
import { assertPropertyAccess, canAtProperty, type Actor } from '../authz';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { personName } from './mappers';

/** What this person may do with the vendor list at one hotel. Managing implies seeing. */
export async function vendorAccess(actor: Actor, propertyId: string): Promise<{ view: boolean; manage: boolean }> {
  if (!(actor.propertyIds === 'ALL' || actor.propertyIds.includes(propertyId))) return { view: false, manage: false };
  const [view, manage] = await Promise.all([canAtProperty(actor, 'vendors.view', propertyId), canAtProperty(actor, 'vendors.manage', propertyId)]);
  return { view: view || manage, manage };
}

function forbiddenVendors(what: 'see' | 'change') {
  return forbidden(
    what === 'see'
      ? 'Only the owner can see this hotel’s vendors, unless they allow your role under Settings → Permissions.'
      : 'Only the owner can change this hotel’s vendors, unless they allow managers under Settings → Permissions.',
  );
}

const optional = (max: number) => z.string().max(max).nullish();

/** What the API accepts for a vendor (all fields; PATCH takes any of them). */
export const vendorFields = {
  name: z.string().min(1).max(120),
  category: z.enum(VENDOR_CATEGORY_IDS),
  services: optional(300),
  contactName: optional(120),
  email: optional(200),
  phone: optional(40),
  website: optional(300),
  address: optional(300),
  accountNumber: optional(80),
  notes: optional(2000),
  preferred: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
};

const vendorSelect = {
  id: true,
  propertyId: true,
  name: true,
  category: true,
  services: true,
  contactName: true,
  email: true,
  phone: true,
  website: true,
  address: true,
  accountNumber: true,
  notes: true,
  preferred: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.VendorSelect;

type VendorRow = Prisma.VendorGetPayload<{ select: typeof vendorSelect }>;

function toEntry(r: VendorRow): VendorEntry {
  return {
    id: r.id,
    propertyId: r.propertyId,
    name: r.name,
    category: r.category as VendorCategory,
    services: r.services,
    contactName: r.contactName,
    email: r.email,
    phone: r.phone,
    website: r.website,
    address: r.address,
    accountNumber: r.accountNumber,
    notes: r.notes,
    preferred: r.preferred,
    status: r.status as VendorStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: { id: r.createdBy.id, name: personName(r.createdBy) },
  };
}

async function requireView(actor: Actor, propertyId: string): Promise<void> {
  assertPropertyAccess(actor, propertyId);
  if (!(await vendorAccess(actor, propertyId)).view) throw forbiddenVendors('see');
}

async function requireManage(actor: Actor, propertyId: string): Promise<void> {
  assertPropertyAccess(actor, propertyId);
  if (!(await canAtProperty(actor, 'vendors.manage', propertyId))) throw forbiddenVendors('change');
}

/** The hotel's vendors: preferred first, then by name. */
export async function listVendors(actor: Actor, propertyId: string): Promise<VendorEntry[]> {
  await requireView(actor, propertyId);
  const rows = await prisma.vendor.findMany({
    where: { propertyId },
    select: vendorSelect,
    orderBy: [{ preferred: 'desc' }, { name: 'asc' }],
  });
  return rows.map(toEntry);
}

const trimOrNull = (v: string | null | undefined, max: number) => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/** Clean what the form sent; refuses a vendor with no name or an unusable email or website. */
function clean(input: Partial<VendorInput>): Prisma.VendorUncheckedUpdateInput {
  const out: Prisma.VendorUncheckedUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw badRequest('Enter the vendor’s name.');
    out.name = name.slice(0, 120);
  }
  if (input.category !== undefined) out.category = input.category;
  if (input.services !== undefined) out.services = trimOrNull(input.services, 300);
  if (input.contactName !== undefined) out.contactName = trimOrNull(input.contactName, 120);
  if (input.email !== undefined) {
    const raw = trimOrNull(input.email, 200);
    const email = emailKey(raw);
    if (raw && !email) throw badRequest('That email address doesn’t look right.');
    out.email = email;
  }
  if (input.phone !== undefined) out.phone = trimOrNull(input.phone, 40);
  if (input.website !== undefined) {
    const raw = trimOrNull(input.website, 300);
    const website = normalizeWebsite(raw);
    if (raw && !website) throw badRequest('That website doesn’t look right.');
    out.website = website;
  }
  if (input.address !== undefined) out.address = trimOrNull(input.address, 300);
  if (input.accountNumber !== undefined) out.accountNumber = trimOrNull(input.accountNumber, 80);
  if (input.notes !== undefined) out.notes = trimOrNull(input.notes, 2000);
  if (input.preferred !== undefined) out.preferred = input.preferred;
  if (input.status !== undefined) out.status = input.status;
  return out;
}

export async function addVendor(ctx: OpContext, propertyId: string, input: VendorInput): Promise<VendorEntry> {
  await requireManage(ctx.actor, propertyId);
  const data = clean(input) as Prisma.VendorUncheckedCreateInput;
  const dupe = await prisma.vendor.findFirst({
    where: { propertyId, name: { equals: data.name as string, mode: 'insensitive' } },
    select: { id: true },
  });
  if (dupe) throw conflict(`${data.name} is already on your vendor list.`);
  const row = await prisma.vendor.create({
    data: { ...data, propertyId, createdById: ctx.actor.userId },
    select: vendorSelect,
  });
  await recordAudit(ctx, propertyId, 'VENDOR_ADD', `Added vendor ${row.name}`, { vendorId: row.id });
  return toEntry(row);
}

/** Fields compared for the activity log's before and after (notes and account number are named, not quoted). */
const AUDITED: (keyof VendorInput)[] = ['name', 'category', 'services', 'contactName', 'email', 'phone', 'website', 'address', 'preferred', 'status'];

export async function updateVendor(ctx: OpContext, id: string, input: Partial<VendorInput>): Promise<VendorEntry> {
  const before = await prisma.vendor.findUnique({ where: { id }, select: vendorSelect });
  if (!before) throw notFound('Vendor');
  await requireManage(ctx.actor, before.propertyId);
  const data = clean(input);
  if (typeof data.name === 'string' && data.name.toLowerCase() !== before.name.toLowerCase()) {
    const dupe = await prisma.vendor.findFirst({
      where: { propertyId: before.propertyId, id: { not: id }, name: { equals: data.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (dupe) throw conflict(`${data.name} is already on your vendor list.`);
  }
  const row = await prisma.vendor.update({ where: { id }, data, select: vendorSelect });
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of AUDITED) if (k in data && before[k] !== row[k]) changes[k] = { from: before[k], to: row[k] };
  const quiet = (['notes', 'accountNumber'] as const).filter((k) => k in data && before[k] !== row[k]);
  const changed = [...Object.keys(changes), ...quiet];
  if (changed.length) {
    await recordAudit(ctx, row.propertyId, 'VENDOR_UPDATE', `Changed vendor ${row.name}: ${changed.join(', ')}`, { vendorId: id, changes, ...(quiet.length ? { alsoChanged: quiet } : {}) });
  }
  return toEntry(row);
}

export async function removeVendor(ctx: OpContext, id: string): Promise<{ id: string }> {
  const row = await prisma.vendor.findUnique({ where: { id }, select: { id: true, propertyId: true, name: true } });
  if (!row) throw notFound('Vendor');
  await requireManage(ctx.actor, row.propertyId);
  await prisma.vendor.delete({ where: { id } });
  await recordAudit(ctx, row.propertyId, 'VENDOR_REMOVE', `Removed vendor ${row.name}`, { vendorId: id });
  return { id };
}
