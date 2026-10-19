/**
 * Booking page domains on Vercel. A domain only reaches this app, and gets
 * its HTTPS certificate, once it is added to the Vercel project. With
 * VERCEL_API_TOKEN and VERCEL_PROJECT_ID set that happens here; otherwise
 * someone adds it by hand in Vercel → Settings → Domains.
 *
 * Default subdomains (oceanview-resort.hotelone.site) are added one by one
 * too, unless PROPERTY_DOMAIN_WILDCARD=true says *.hotelone.site is already
 * on the project (which needs the domain on Vercel's nameservers).
 */
import { promises as dns } from 'node:dns';
import { prisma } from '@/lib/prisma';
import { getDefaultDomain, isRootDomain, isValidSubdomain, slugifySubdomain, toggleWww } from '@/lib/domain-utils';

// Vercel's documented targets: https://vercel.com/docs/domains/working-with-domains/add-a-domain
const DEFAULT_CNAME_TARGET = 'cname.vercel-dns.com';
const DEFAULT_APEX_A_RECORD = '76.76.21.21';
const VERCEL_API_URL = 'https://api.vercel.com';

export type DnsRecord = {
  type: 'CNAME' | 'A' | 'TXT';
  name: string;
  value: string;
  note?: string;
};

export type DnsCheck = {
  pointsToApp: boolean;
  cnames: string[];
  ips: string[];
  hasIpv6: boolean;
};

function getCnameTarget(): string {
  return (process.env.CUSTOM_DOMAIN_CNAME_TARGET || DEFAULT_CNAME_TARGET).toLowerCase();
}

function getApexARecord(): string {
  return process.env.CUSTOM_DOMAIN_A_RECORD || DEFAULT_APEX_A_RECORD;
}

/** DNS records the owner adds at their domain provider. */
export function getDnsInstructions(domain: string): DnsRecord[] {
  if (!isRootDomain(domain)) {
    return [{ type: 'CNAME', name: domain.split('.').slice(0, -2).join('.'), value: getCnameTarget() }];
  }
  return [
    { type: 'A', name: '@', value: getApexARecord() },
    { type: 'CNAME', name: 'www', value: getCnameTarget(), note: `Sends www.${domain} to the same page` },
  ];
}

async function lookup(resolve: () => Promise<string[]>): Promise<string[]> {
  try {
    return await resolve();
  } catch {
    // ENOTFOUND / ENODATA just mean there is no such record yet
    return [];
  }
}

/** Checks whether the domain's DNS already points at Vercel. */
export async function checkDomainDns(domain: string): Promise<DnsCheck> {
  const target = getCnameTarget();
  const [cnames, ips, ipv6] = await Promise.all([
    lookup(() => dns.resolveCname(domain)),
    lookup(() => dns.resolve4(domain)),
    lookup(() => dns.resolve6(domain)),
  ]);

  // Vercel also hands out project-specific targets like "abc123.vercel-dns-017.com"
  const cnamesToApp = cnames.some((cname) => {
    const name = cname.toLowerCase().replace(/\.$/, '');
    return name === target || /(^|\.)vercel-dns(-\d+)?\.com$/.test(name);
  });

  return {
    pointsToApp: cnamesToApp || ips.includes(getApexARecord()),
    cnames,
    ips,
    hasIpv6: ipv6.length > 0,
  };
}

// --- Vercel project domains -------------------------------------------------

function getVercelConfig() {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  return token && projectId ? { token, projectId, teamId: process.env.VERCEL_TEAM_ID } : null;
}

export function isHostingManaged(): boolean {
  return getVercelConfig() !== null;
}

type VercelDomain = {
  name: string;
  verified: boolean;
  verification?: { type: string; domain: string; value: string; reason?: string }[];
};

async function vercelRequest(path: string, method = 'GET', body?: unknown): Promise<Response> {
  const config = getVercelConfig();
  if (!config) throw new Error('Vercel API is not configured');

  const url = new URL(path.replace('{project}', encodeURIComponent(config.projectId)), VERCEL_API_URL);
  if (config.teamId) url.searchParams.set('teamId', config.teamId);

  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
}

async function vercelError(response: Response): Promise<Error> {
  const data = await response.json().catch(() => null);
  return new Error(data?.error?.message || `Vercel API returned ${response.status}`);
}

async function getProjectDomain(domain: string): Promise<VercelDomain | null> {
  const response = await vercelRequest(`/v9/projects/{project}/domains/${encodeURIComponent(domain)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await vercelError(response);
  return response.json();
}

async function addProjectDomain(name: string, redirect?: string): Promise<void> {
  const response = await vercelRequest('/v10/projects/{project}/domains', 'POST', redirect ? { name, redirect } : { name });
  if (response.ok) return;
  // 409: already on a project; fine if it's this one
  if (response.status === 409 && (await getProjectDomain(name))) return;
  throw await vercelError(response);
}

async function removeProjectDomain(domain: string): Promise<void> {
  try {
    const response = await vercelRequest(`/v9/projects/{project}/domains/${encodeURIComponent(domain)}`, 'DELETE');
    if (!response.ok && response.status !== 404) {
      console.error(`Failed to remove ${domain} from Vercel:`, (await vercelError(response)).message);
    }
  } catch (error) {
    console.error(`Failed to remove ${domain} from Vercel:`, error);
  }
}

/** Adds the domain to the Vercel project. A root domain's www counterpart is added as a redirect to it. */
export async function addDomainToHosting(domain: string): Promise<void> {
  if (!isHostingManaged()) return;
  await addProjectDomain(domain);
  if (isRootDomain(domain)) {
    await addProjectDomain(toggleWww(domain), domain).catch((error) =>
      console.error(`Failed to add ${toggleWww(domain)} to Vercel:`, error)
    );
  }
}

export async function removeDomainFromHosting(domain: string): Promise<void> {
  if (!isHostingManaged()) return;
  // Redirect first: Vercel won't remove a domain that others redirect to
  if (isRootDomain(domain)) await removeProjectDomain(toggleWww(domain));
  await removeProjectDomain(domain);
}

export type HostingStatus = {
  /** Vercel routes the domain here and can issue its certificate. */
  live: boolean;
  /** TXT records Vercel wants first, when the domain was used on another Vercel account. */
  verification: DnsRecord[];
};

/**
 * Asks Vercel whether the domain is verified and its DNS configured.
 * Null when hosting isn't managed from here.
 */
export async function checkDomainWithHosting(domain: string): Promise<HostingStatus | null> {
  if (!isHostingManaged()) return null;

  let project = await getProjectDomain(domain);
  if (!project) {
    // Removed from Vercel by hand; add it back so verification can start
    await addDomainToHosting(domain);
    project = await getProjectDomain(domain);
  }
  if (project && !project.verified) {
    // Re-checks the TXT record; 400 just means it isn't there yet
    const verify = await vercelRequest(`/v9/projects/{project}/domains/${encodeURIComponent(domain)}/verify`, 'POST');
    if (verify.ok) project = await verify.json();
  }

  const config = await vercelRequest(`/v6/domains/${encodeURIComponent(domain)}/config`);
  if (!config.ok) throw await vercelError(config);
  const { misconfigured } = (await config.json()) as { misconfigured: boolean };

  const verification = (project?.verification ?? [])
    .filter((record) => record.type === 'TXT')
    .map((record) => ({
      type: 'TXT' as const,
      name: record.domain,
      value: record.value,
      note: 'Proves you own the domain',
    }));

  return { live: !!project?.verified && !misconfigured, verification };
}

// --- Default subdomains -----------------------------------------------------

function wildcardHosted(): boolean {
  return process.env.PROPERTY_DOMAIN_WILDCARD === 'true';
}

/** An unused subdomain based on the property's name, e.g. "oceanview-resort" or "oceanview-resort-2". */
export async function findAvailableSubdomain(name: string): Promise<string> {
  let slug = slugifySubdomain(name);
  if (slug.length < 3) slug = slug ? `${slug}-hotel` : 'hotel';

  const candidates = [slug, ...Array.from({ length: 8 }, (_, i) => `${slug}-${i + 2}`)].filter(isValidSubdomain);
  const taken = await prisma.property.findMany({
    where: { subdomain: { in: candidates } },
    select: { subdomain: true },
  });
  const takenSubdomains = new Set(taken.map((property) => property.subdomain));

  return candidates.find((candidate) => !takenSubdomains.has(candidate)) ?? `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function hostPropertySubdomain(subdomain: string): Promise<void> {
  const domain = getDefaultDomain(subdomain);
  if (!domain || wildcardHosted() || !isHostingManaged()) return;
  await addProjectDomain(domain);
}

export async function unhostPropertySubdomain(subdomain: string): Promise<void> {
  const domain = getDefaultDomain(subdomain);
  if (!domain || wildcardHosted()) return;
  await removeProjectDomain(domain);
}
