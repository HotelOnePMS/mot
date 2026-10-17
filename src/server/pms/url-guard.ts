/**
 * Where HotelOne's server may connect when a hotel pastes a PMS MCP address.
 *
 * The URL comes from a hotel manager, and our server fetches it, so it must
 * not become a way to reach our own network (SSRF): cloud metadata
 * (169.254.169.254), localhost, private ranges. Rules:
 *
 *  • production: https only, and the host must resolve to public addresses
 *    only — checked up front for a clean error AND again at connect time
 *    (see `guardedLookup`), so a DNS answer that changes between the two
 *    (rebinding) can't slip through.
 *  • development (NODE_ENV !== 'production'): http and private/loopback
 *    hosts are allowed so a mock PMS on localhost works — but link-local
 *    (cloud metadata) stays blocked.
 *  • PMS_MCP_ALLOWED_HOSTS (comma-separated host names or IPs) lifts both
 *    checks for hosts a platform admin trusts (e.g. a vendor on a private link).
 *
 * Redirects are never followed by the client, and user:pass@ URLs are refused.
 */
import { lookup as dnsLookup, type LookupAddress } from 'dns';
import { isIP } from 'net';
import { McpError } from './errors';

const isProduction = () => process.env.NODE_ENV === 'production';

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.PMS_MCP_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean),
  );
}

const hostOf = (u: URL) => u.hostname.toLowerCase().replace(/^\[|\]$/g, '');

export function hostAllowlisted(host: string): boolean {
  return allowedHosts().has(host.toLowerCase().replace(/^\[|\]$/g, ''));
}

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

const V4_BLOCKS: [string, number, 'private' | 'linklocal'][] = [
  ['0.0.0.0', 8, 'private'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'private'], // carrier-grade NAT
  ['127.0.0.0', 8, 'private'],
  ['169.254.0.0', 16, 'linklocal'], // cloud metadata lives here
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'private'],
  ['192.0.2.0', 24, 'private'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'private'],
  ['198.51.100.0', 24, 'private'],
  ['203.0.113.0', 24, 'private'],
  ['224.0.0.0', 4, 'private'], // multicast
  ['240.0.0.0', 4, 'private'], // reserved + broadcast
];

/** 'public', or why an address is off limits. */
export function classifyAddress(ip: string): 'public' | 'private' | 'linklocal' {
  const family = isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip);
    for (const [base, bits, kind] of V4_BLOCKS) {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((n & mask) === (v4ToInt(base) & mask)) return kind;
    }
    return 'public';
  }
  if (family === 6) {
    const a = ip.toLowerCase().split('%')[0];
    // IPv4-mapped / NAT64 forms carry an IPv4 address: judge that.
    const embedded = a.match(/^(?:::ffff:(?:0:)?|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (embedded) return classifyAddress(embedded[1]);
    const hexMapped = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return classifyAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (a === '::' || a === '::1') return 'private';
    if (/^fe[89ab][0-9a-f]:/.test(a)) return 'linklocal';
    if (/^f[cd][0-9a-f]{2}:/.test(a)) return 'private'; // unique local fc00::/7
    if (/^ff[0-9a-f]{2}:/.test(a)) return 'private'; // multicast
    if (/^2001:0?db8:/.test(a)) return 'private'; // documentation
    if (/^2002:/.test(a)) {
      // 6to4 embeds an IPv4 address in the next 32 bits.
      const parts = a.split(':');
      const hi = parseInt(parts[1] || '0', 16);
      const lo = parseInt(parts[2] || '0', 16);
      return classifyAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return 'public';
  }
  return 'private';
}

/** Throws McpError('BLOCKED_URL') if this address may not be contacted. */
export function assertAddressAllowed(ip: string, host: string): void {
  if (hostAllowlisted(host) || hostAllowlisted(ip)) return;
  const kind = classifyAddress(ip);
  if (kind === 'public') return;
  if (kind === 'private' && !isProduction()) return;
  throw new McpError('BLOCKED_URL', `That address points inside a private network (${host} → ${ip}). Use your PMS’s public MCP address.`);
}

/** Parse and check a PMS MCP URL (syntax, scheme, IP literals). DNS is checked by `assertSafeMcpUrl`. */
export function parseMcpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new McpError('BLOCKED_URL', 'That isn’t a valid web address. Paste the full MCP URL, starting with https://');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new McpError('BLOCKED_URL', 'The MCP address must start with https://');
  if (u.username || u.password) throw new McpError('BLOCKED_URL', 'Don’t put a username or password in the address — use the token field instead.');
  const host = hostOf(u);
  if (u.protocol === 'http:' && isProduction() && !hostAllowlisted(host)) {
    throw new McpError('BLOCKED_URL', 'The MCP address must use https://');
  }
  if (!host) throw new McpError('BLOCKED_URL', 'The MCP address has no host name.');
  if (isIP(host)) assertAddressAllowed(host, host);
  else if (isProduction() && !hostAllowlisted(host) && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.'))) {
    throw new McpError('BLOCKED_URL', `“${host}” isn’t a public address. Use your PMS’s public MCP address.`);
  }
  return u;
}

function resolveAll(host: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
  });
}

/** Full check, including DNS: every address the host resolves to must be allowed. */
export async function assertSafeMcpUrl(raw: string): Promise<URL> {
  const u = parseMcpUrl(raw);
  const host = hostOf(u);
  if (isIP(host)) return u;
  let addresses: LookupAddress[];
  try {
    addresses = await resolveAll(host);
  } catch {
    throw new McpError('NETWORK', `Couldn’t find ${host} — check the MCP address.`);
  }
  if (!addresses.length) throw new McpError('NETWORK', `Couldn’t find ${host} — check the MCP address.`);
  for (const a of addresses) assertAddressAllowed(a.address, host);
  return u;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` for http(s).request that re-checks the addresses at connect
 * time, so the IP we connect to is the IP we checked.
 */
export function guardedLookup(hostname: string, options: { all?: boolean; family?: number } | number | LookupCallback, callback?: LookupCallback): void {
  const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
  const opts = typeof options === 'object' && options ? options : {};
  dnsLookup(hostname, { all: true, verbatim: true, family: opts.family ?? 0 }, (err, addresses) => {
    if (err) return cb(err, opts.all ? [] : '', undefined);
    try {
      if (!addresses.length) throw new McpError('NETWORK', `Couldn’t find ${hostname}.`);
      for (const a of addresses) assertAddressAllowed(a.address, hostname);
    } catch (e) {
      return cb(e as NodeJS.ErrnoException, opts.all ? [] : '', undefined);
    }
    if (opts.all) return cb(null, addresses);
    cb(null, addresses[0].address, addresses[0].family);
  });
}

/** For views: the address without query values (some servers carry keys in the query). */
export function displayUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const q = [...u.searchParams.keys()];
    return `${u.origin}${u.pathname}${q.length ? `?${q.map((k) => `${k}=…`).join('&')}` : ''}`;
  } catch {
    return null;
  }
}
