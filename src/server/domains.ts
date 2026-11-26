/**
 * Booking page domains. A hotel's own domain only reaches this app, and gets
 * its HTTPS certificate, once the host knows about it:
 *
 * - Cloudflare (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID): each domain is a
 *   Cloudflare for SaaS custom hostname on the hotelone.site zone. Owners
 *   CNAME it to CUSTOM_DOMAIN_CNAME_TARGET (the fallback origin, e.g.
 *   hotels.hotelone.site). Default subdomains need nothing: the zone's
 *   *.hotelone.site route already sends them to the Worker.
 * - Vercel (VERCEL_API_TOKEN + VERCEL_PROJECT_ID): the domain is added to the
 *   Vercel project. Default subdomains (oceanview-resort.hotelone.site) are
 *   added one by one too, unless PROPERTY_DOMAIN_WILDCARD=true says
 *   *.hotelone.site is already on the project.
 *
 * With neither, someone adds the domain by hand in the host's dashboard.
 * Cloudflare wins when both are configured (during the move).
 */
import { promises as dns } from 'node:dns';
import { prisma } from '@/lib/prisma';
import { getDefaultDomain, isRootDomain, isValidSubdomain, slugifySubdomain, toggleWww } from '@/lib/domain-utils';

// Vercel's documented targets: https://vercel.com/docs/domains/working-with-domains/add-a-domain
const DEFAULT_CNAME_TARGET = 'cname.vercel-dns.com';
const DEFAULT_APEX_A_RECORD = '76.76.21.21';
const VERCEL_API_URL = 'https://api.vercel.com';
const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';

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
  if (process.env.CUSTOM_DOMAIN_CNAME_TARGET) return process.env.CUSTOM_DOMAIN_CNAME_TARGET.toLowerCase();
  if (!getCloudflareConfig()) return DEFAULT_CNAME_TARGET;
  // Cloudflare for SaaS fallback origin, see CLOUDFLARE.md
  const base = process.env.PROPERTY_DOMAIN_BASE?.trim().toLowerCase();
  return base ? `hotels.${base}` : '';
}

/** The A record for root domains. Cloudflare has no fixed one unless CUSTOM_DOMAIN_A_RECORD is set. */
function getApexARecord(): string | null {
  return process.env.CUSTOM_DOMAIN_A_RECORD || (getCloudflareConfig() ? null : DEFAULT_APEX_A_RECORD);
}

/** DNS records the owner adds at their domain provider. */
export function getDnsInstructions(domain: string): DnsRecord[] {
  if (!isRootDomain(domain)) {
    return [{ type: 'CNAME', name: domain.split('.').slice(0, -2).join('.'), value: getCnameTarget() }];
  }
  const apex = getApexARecord();
  return [
    apex
      ? { type: 'A', name: '@', value: apex }
      : {
          type: 'CNAME',
          name: '@',
          value: getCnameTarget(),
          note: "Needs a provider that allows a CNAME on the root (CNAME flattening or ALIAS). If yours doesn't, use a subdomain like book." + domain,
        },
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

/**
 * DNS over HTTPS through Cloudflare's resolver. Used on Workers, where
 * node:dns resolvers aren't reliably available.
 */
async function resolveOverHttps(domain: string, type: 'CNAME' | 'A' | 'AAAA'): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`;
  const response = await fetch(url, { headers: { accept: 'application/dns-json' }, cache: 'no-store' });
  if (!response.ok) return [];
  const data = (await response.json()) as { Answer?: { type: number; data: string }[] };
  const code = { CNAME: 5, A: 1, AAAA: 28 }[type];
  return (data.Answer ?? []).filter((answer) => answer.type === code).map((answer) => answer.data.replace(/\.$/, ''));
}

/** Checks whether the domain's DNS already points at this app's host. */
export async function checkDomainDns(domain: string): Promise<DnsCheck> {
  const target = getCnameTarget();
  const overHttps = process.env.HOSTING === 'cloudflare';
  const [cnames, ips, ipv6] = await Promise.all([
    lookup(() => (overHttps ? resolveOverHttps(domain, 'CNAME') : dns.resolveCname(domain))),
    lookup(() => (overHttps ? resolveOverHttps(domain, 'A') : dns.resolve4(domain))),
    lookup(() => (overHttps ? resolveOverHttps(domain, 'AAAA') : dns.resolve6(domain))),
  ]);

  // Vercel also hands out project-specific targets like "abc123.vercel-dns-017.com"
  const cnamesToApp = cnames.some((cname) => {
    const name = cname.toLowerCase().replace(/\.$/, '');
    if (target && name === target) return true;
    return !getCloudflareConfig() && /(^|\.)vercel-dns(-\d+)?\.com$/.test(name);
  });

  const apex = getApexARecord();
  return {
    pointsToApp: cnamesToApp || (!!apex && ips.includes(apex)),
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

// --- Cloudflare for SaaS custom hostnames ---------------------------------

function getCloudflareConfig() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  return token && zoneId ? { token, zoneId } : null;
}

type CustomHostname = {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string; validation_records?: { txt_name?: string; txt_value?: string }[] };
  ownership_verification?: { type?: string; name?: string; value?: string };
};

type CloudflareResponse<T> = { success: boolean; result: T; errors?: { code: number; message: string }[] };

async function cloudflareRequest<T>(path: string, method = 'GET', body?: unknown): Promise<CloudflareResponse<T>> {
  const config = getCloudflareConfig();
  if (!config) throw new Error('Cloudflare API is not configured');
  const response = await fetch(`${CLOUDFLARE_API_URL}/zones/${encodeURIComponent(config.zoneId)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => null)) as CloudflareResponse<T> | null;
  if (!data) throw new Error(`Cloudflare API returned ${response.status}`);
  return data;
}

function cloudflareError(data: CloudflareResponse<unknown>): Error {
  return new Error(data.errors?.[0]?.message || 'Cloudflare API request failed');
}

const SSL_SETTINGS = { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } };

async function getCustomHostname(hostname: string): Promise<CustomHostname | null> {
  const data = await cloudflareRequest<CustomHostname[]>(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  if (!data.success) throw cloudflareError(data);
  return data.result.find((entry) => entry.hostname === hostname) ?? null;
}

async function addCustomHostname(hostname: string): Promise<void> {
  const data = await cloudflareRequest<CustomHostname>('/custom_hostnames', 'POST', { hostname, ssl: SSL_SETTINGS });
  if (data.success) return;
  // 1406: duplicate custom hostname, i.e. it's already on this zone
  if (data.errors?.some((error) => error.code === 1406) && (await getCustomHostname(hostname))) return;
  throw cloudflareError(data);
}

async function removeCustomHostname(hostname: string): Promise<void> {
  try {
    const existing = await getCustomHostname(hostname);
    if (!existing) return;
    const data = await cloudflareRequest(`/custom_hostnames/${encodeURIComponent(existing.id)}`, 'DELETE');
    if (!data.success) console.error(`Failed to remove ${hostname} from Cloudflare:`, cloudflareError(data).message);
  } catch (error) {
    console.error(`Failed to remove ${hostname} from Cloudflare:`, error);
  }
}

async function checkCustomHostname(domain: string): Promise<HostingStatus> {
  let entry = await getCustomHostname(domain);
  if (!entry) {
    // Removed by hand; add it back so validation can start
    await addDomainToHosting(domain);
    entry = await getCustomHostname(domain);
  } else if (entry.status !== 'active' || entry.ssl?.status !== 'active') {
    // Asks Cloudflare to re-check ownership and the certificate now
    await cloudflareRequest(`/custom_hostnames/${encodeURIComponent(entry.id)}`, 'PATCH', { ssl: SSL_SETTINGS }).catch(() => null);
  }

  const verification: DnsRecord[] = [];
  const ownership = entry?.ownership_verification;
  if (entry && entry.status !== 'active' && ownership?.type === 'txt' && ownership.name && ownership.value) {
    verification.push({ type: 'TXT', name: ownership.name, value: ownership.value, note: 'Proves you own the domain' });
  }
  return { live: entry?.status === 'active' && entry.ssl?.status === 'active', verification };
}

export function isHostingManaged(): boolean {
  return getCloudflareConfig() !== null || getVercelConfig() !== null;
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
  if (getCloudflareConfig()) {
    await addCustomHostname(domain);
    if (isRootDomain(domain)) {
      await addCustomHostname(toggleWww(domain)).catch((error) =>
        console.error(`Failed to add ${toggleWww(domain)} to Cloudflare:`, error)
      );
    }
    return;
  }
  if (!getVercelConfig()) return;
  await addProjectDomain(domain);
  if (isRootDomain(domain)) {
    await addProjectDomain(toggleWww(domain), domain).catch((error) =>
      console.error(`Failed to add ${toggleWww(domain)} to Vercel:`, error)
    );
  }
}

export async function removeDomainFromHosting(domain: string): Promise<void> {
  if (getCloudflareConfig()) {
    if (isRootDomain(domain)) await removeCustomHostname(toggleWww(domain));
    await removeCustomHostname(domain);
    return;
  }
  if (!getVercelConfig()) return;
  // Redirect first: Vercel won't remove a domain that others redirect to
  if (isRootDomain(domain)) await removeProjectDomain(toggleWww(domain));
  await removeProjectDomain(domain);
}

export type HostingStatus = {
  /** The host routes the domain here and has issued (or can issue) its certificate. */
  live: boolean;
  /** TXT records the host wants first, to prove the owner controls the domain. */
  verification: DnsRecord[];
};

/**
 * Asks the host (Cloudflare or Vercel) whether the domain is verified and its DNS configured.
 * Null when hosting isn't managed from here.
 */
export async function checkDomainWithHosting(domain: string): Promise<HostingStatus | null> {
  if (getCloudflareConfig()) return checkCustomHostname(domain);
  if (!getVercelConfig()) return null;

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

/** Subdomains of the platform domain need no registration: a wildcard (or Cloudflare's zone route) covers them. */
function wildcardHosted(): boolean {
  return process.env.PROPERTY_DOMAIN_WILDCARD === 'true' || getCloudflareConfig() !== null;
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
  if (!domain || wildcardHosted() || !getVercelConfig()) return;
  await addProjectDomain(domain);
}

export async function unhostPropertySubdomain(subdomain: string): Promise<void> {
  const domain = getDefaultDomain(subdomain);
  if (!domain || wildcardHosted() || !getVercelConfig()) return;
  await removeProjectDomain(domain);
}
