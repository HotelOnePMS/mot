import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff, type Actor } from '@/server/authz';
import { assertNotDemoHotel } from '@/server/demo';
import { DomainError, badRequest, conflict, notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import {
  addDomainToHosting,
  checkDomainDns,
  checkDomainWithHosting,
  getDnsInstructions,
  hostPropertySubdomain,
  isHostingManaged,
  removeDomainFromHosting,
  unhostPropertySubdomain,
} from '@/server/domains';
import {
  getDefaultDomain,
  isAppHost,
  isPlatformDomain,
  isValidSubdomain,
  normalizeDomain,
  toggleWww,
} from '@/lib/domain-utils';

type Params = { params: Promise<{ propertyId: string }> };

const domainFields = {
  name: true,
  isDemo: true,
  subdomain: true,
  customDomain: true,
  customDomainVerified: true,
  customDomainVerifiedAt: true,
} as const;

type DomainFields = Prisma.PropertyGetPayload<{ select: typeof domainFields }>;

const hostingError = (action: string, error: unknown) =>
  new DomainError(502, 'HOSTING', `${action}: ${error instanceof Error ? error.message : 'unknown error'}`);

function domainStatus(property: DomainFields) {
  return {
    subdomain: property.subdomain,
    defaultDomain: getDefaultDomain(property.subdomain),
    domain: property.customDomain,
    verified: property.customDomainVerified,
    verifiedAt: property.customDomainVerifiedAt,
    dnsRecords: property.customDomain ? getDnsInstructions(property.customDomain) : [],
    hostingManaged: isHostingManaged(),
  };
}

async function loadProperty(propertyId: string) {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: domainFields });
  if (!property) throw notFound('Property');
  return property;
}

/** Owners and platform admins, on a property they manage; not the shared demo. */
async function manager(propertyId: string): Promise<{ actor: Actor; property: DomainFields }> {
  const actor = await requireStaff('property.write');
  assertPropertyAccess(actor, propertyId);
  const property = await loadProperty(propertyId);
  assertNotDemoHotel(actor, property.isDemo, 'The demo hotels keep the demo address. Set up your own hotel to give it a domain.');
  return { actor, property };
}

/** GET — the property's booking page addresses and the DNS records its own domain needs. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff();
  assertPropertyAccess(actor, propertyId);
  return json(domainStatus(await loadProperty(propertyId)));
});

/** PUT — connect the property's own domain (or replace the current one). */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const { actor, property } = await manager(propertyId);
  const body = await parseJson(request, z.object({ domain: z.string().max(260) }));
  const domain = normalizeDomain(body.domain);

  if (!domain) throw badRequest('Enter a valid domain, like book.yourmotel.com');
  if (isAppHost(domain) || isPlatformDomain(domain)) {
    throw badRequest('That domain belongs to the booking site itself. To change the default address, edit it above.');
  }
  if (property.customDomain === domain) return json(domainStatus(property));

  // A root domain brings its www counterpart along, so both are taken
  const inUse = await prisma.property.findFirst({
    where: { customDomain: { in: [domain, toggleWww(domain)] }, id: { not: propertyId } },
    select: { id: true },
  });
  if (inUse) throw conflict('Another property is already using this domain');

  try {
    await addDomainToHosting(domain);
  } catch (error) {
    console.error('Error adding domain to Vercel:', error);
    throw hostingError(`Couldn't set up hosting for ${domain}`, error);
  }
  if (property.customDomain) await removeDomainFromHosting(property.customDomain);

  try {
    const updated = await prisma.property.update({
      where: { id: propertyId },
      data: { customDomain: domain, customDomainVerified: false, customDomainVerifiedAt: null },
      select: domainFields,
    });
    await recordAudit({ actor, source: 'classic' }, propertyId, 'PROPERTY_DOMAIN_SET', `Connected ${domain} to ${property.name}`);
    return json(domainStatus(updated));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw conflict('Another property is already using this domain');
    }
    throw e;
  }
});

/** PATCH — change the default address, e.g. "oceanview-resort" in oceanview-resort.hotelone.site. */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const { actor, property } = await manager(propertyId);
  const body = await parseJson(request, z.object({ subdomain: z.string().max(80) }));
  const subdomain = body.subdomain.trim().toLowerCase();

  if (!isValidSubdomain(subdomain)) {
    throw badRequest('Use 3-63 letters, numbers or hyphens (not at the start or end). Some names, like www or admin, are reserved.');
  }
  if (property.subdomain === subdomain) return json(domainStatus(property));

  let updated: DomainFields;
  try {
    updated = await prisma.property.update({ where: { id: propertyId }, data: { subdomain }, select: domainFields });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw conflict('That address is taken. Try another one.');
    }
    throw e;
  }

  try {
    await hostPropertySubdomain(subdomain);
  } catch (error) {
    // The address is saved; the next deploy's subdomain sync adds it to Vercel
    console.error('Error adding subdomain to Vercel:', error);
  }
  if (property.subdomain) await unhostPropertySubdomain(property.subdomain);

  await recordAudit(
    { actor, source: 'classic' },
    propertyId,
    'PROPERTY_SUBDOMAIN_SET',
    `Changed the default address of ${property.name} to ${getDefaultDomain(subdomain) ?? subdomain}`
  );
  return json(domainStatus(updated));
});

/** POST — check the domain's DNS and turn it on once it reaches this site. */
export const POST = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const { property } = await manager(propertyId);
  if (!property.customDomain) throw badRequest('Add a domain first');

  const dnsCheck = await checkDomainDns(property.customDomain);

  let hosting;
  try {
    hosting = await checkDomainWithHosting(property.customDomain);
  } catch (error) {
    console.error('Error checking domain with Vercel:', error);
    throw hostingError("Couldn't check the domain with the hosting provider", error);
  }

  // When hosting isn't managed from here (null), DNS pointing here is all we can check
  const verified = hosting ? hosting.live : dnsCheck.pointsToApp;

  const updated = await prisma.property.update({
    where: { id: propertyId },
    data: {
      customDomainVerified: verified,
      customDomainVerifiedAt: verified ? (property.customDomainVerifiedAt ?? new Date()) : null,
    },
    select: domainFields,
  });

  const status = domainStatus(updated);
  return json({
    ...status,
    dnsRecords: [...status.dnsRecords, ...(hosting?.verification ?? [])],
    check: { ...dnsCheck, hostingVerified: hosting ? hosting.live : null },
  });
});

/** DELETE — disconnect the property's own domain. */
export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const { actor, property } = await manager(propertyId);

  if (property.customDomain) await removeDomainFromHosting(property.customDomain);

  const updated = await prisma.property.update({
    where: { id: propertyId },
    data: { customDomain: null, customDomainVerified: false, customDomainVerifiedAt: null },
    select: domainFields,
  });
  if (property.customDomain) {
    await recordAudit({ actor, source: 'classic' }, propertyId, 'PROPERTY_DOMAIN_REMOVE', `Disconnected ${property.customDomain} from ${property.name}`);
  }
  return json(domainStatus(updated));
});
