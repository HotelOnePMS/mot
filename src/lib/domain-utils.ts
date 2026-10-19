/**
 * Booking page domain helpers: a property's own domain ("book.mymotel.com")
 * and its default address on the platform domain ("oceanview-resort.hotelone.site").
 * Env reads only, no Node APIs, so middleware (edge runtime) can use them.
 */

// Labels of letters, digits and hyphens (not at either end), ending in a real-looking TLD
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Turns what an owner types ("https://Book.MyMotel.com/") into a bare hostname
 * ("book.mymotel.com"). Returns null if it isn't a valid domain.
 */
export function normalizeDomain(input: string): string | null {
  const hostname = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');

  return HOSTNAME_PATTERN.test(hostname) ? hostname : null;
}

/** "mymotel.com" <-> "www.mymotel.com" */
export function toggleWww(domain: string): string {
  return domain.startsWith('www.') ? domain.slice(4) : `www.${domain}`;
}

/** A guess: without a public suffix list, "mymotel.co.uk" looks like a subdomain. */
export function isRootDomain(domain: string): boolean {
  return domain.split('.').length === 2;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Origin of the main site, where sign-in and staff pages live: NEXT_PUBLIC_SITE_URL,
 * else HOTELONE_PUBLIC_URL, else the Vercel production domain, else NEXTAUTH_URL.
 */
export function getAppOrigin(): string | null {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.HOTELONE_PUBLIC_URL ||
    process.env.STAYOS_PUBLIC_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXTAUTH_URL;
  const host = hostOf(url);
  if (!url || !host) return null;
  return url.includes('://') ? new URL(url).origin : `https://${host}`;
}

/** Whether a hostname is the main site itself rather than a property's domain. */
export function isAppHost(hostname: string): boolean {
  if (hostname.endsWith('.vercel.app')) return true;

  const hosts = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.HOTELONE_PUBLIC_URL,
    process.env.STAYOS_PUBLIC_URL,
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.PROPERTY_DOMAIN_BASE,
    ...(process.env.APP_HOSTNAMES || '').split(','),
  ]
    .map((value) => hostOf(value?.trim()))
    .filter((host): host is string => !!host);

  return hosts.some((host) => host === hostname || toggleWww(host) === hostname);
}

// Default property addresses on the platform's own domain, e.g. "oceanview-resort.hotelone.site"

const SUBDOMAIN_PATTERN = /^(?!xn--)[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
// Keep in step with the list in the 20261023_property_domains migration
const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'dashboard', 'login', 'auth', 'account', 'book', 'booking', 'bookings',
  'mail', 'email', 'smtp', 'imap', 'ftp', 'ns1', 'ns2', 'cdn', 'static', 'assets', 'media',
  'help', 'support', 'status', 'docs', 'blog', 'dev', 'staging', 'test', 'demo',
]);

/** Domain whose subdomains are properties' default booking pages, e.g. "hotelone.site". */
export function getPropertyDomainBase(): string | null {
  return process.env.PROPERTY_DOMAIN_BASE?.trim().toLowerCase() || null;
}

/** "oceanview-resort.hotelone.site" -> "oceanview-resort"; null for any other host. */
export function getPropertySubdomain(hostname: string): string | null {
  const base = getPropertyDomainBase();
  if (!base || !hostname.endsWith(`.${base}`)) return null;

  const subdomain = hostname.slice(0, -(base.length + 1));
  return subdomain.includes('.') || RESERVED_SUBDOMAINS.has(subdomain) ? null : subdomain;
}

/** "oceanview-resort" -> "oceanview-resort.hotelone.site", once PROPERTY_DOMAIN_BASE is set. */
export function getDefaultDomain(subdomain: string | null): string | null {
  const base = getPropertyDomainBase();
  return base && subdomain ? `${subdomain}.${base}` : null;
}

/** The platform domain or anything under it, which a property can't claim as its own domain. */
export function isPlatformDomain(hostname: string): boolean {
  const base = getPropertyDomainBase();
  return base !== null && (hostname === base || hostname.endsWith(`.${base}`));
}

export function isValidSubdomain(subdomain: string): boolean {
  return SUBDOMAIN_PATTERN.test(subdomain) && !RESERVED_SUBDOMAINS.has(subdomain);
}

/** "Oceanview Résort & Spa" -> "oceanview-resort-spa" */
export function slugifySubdomain(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}
