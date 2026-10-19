/**
 * HTTP plumbing shared by the MCP server and the REST API: CORS for
 * browser-based assistants, Origin checks, client IPs, this deployment's
 * public origin, byte-capped request bodies, rate limits (per client IP, or
 * per API key and per hotel) and a route wrapper that turns every failure
 * into the usual JSON error with CORS headers.
 */
import { NextResponse } from 'next/server';
import { PRODUCT_URL } from '@/config/product';
import { consumeRateLimit, type RateLimitResult } from '../concierge';
import { DomainError } from '../errors';
import { errorResponse } from '../http';
import { publicSiteUrl } from '../public-url';
import { agentKeyFromRequest, type AgentKeyContext } from './keys';
import { clientIp as sharedClientIp } from '../http';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/** The caller's IP for rate limits (see clientIp in src/server/http.ts for which header is trusted). */
export const clientIp = sharedClientIp;

const isLoopbackHost = (host: string) => /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i.test(host.replace(/:\d+$/, '')) || host.toLowerCase().endsWith('.localhost');

/**
 * This deployment's public origin, for absolute URLs in discovery documents
 * (llms.txt, OpenAPI, agent card, MCP manifest): publicSiteUrl() — the same
 * origin booking links use — else the product domain. Never the request's
 * Host or X-Forwarded-* headers: a client can set those, and these documents
 * are publicly cacheable, so a reflected host could point every assistant
 * behind a shared cache at someone else's server.
 */
export function publicOrigin(): string {
  const configured = publicSiteUrl();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* not a URL: fall through */
    }
  }
  return PRODUCT_URL;
}

/** Kept for existing callers: the configured public origin (publicOrigin); the request isn't consulted. */
export function requestOrigin(_request?: Request): string {
  return publicOrigin();
}

/** The Host the request was sent to (only ever used to make the Origin check stricter, never for URLs). */
function requestHost(request: Request): string {
  try {
    return request.headers.get('host') || new URL(request.url).host;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Origin checks and CORS
// ---------------------------------------------------------------------------

/**
 * Whether a browser Origin may call these endpoints. They hold no cookie
 * authority (keys travel in the Authorization header), so browser-based
 * assistants on any https site are welcome. Following the MCP transport's
 * security guidance against DNS rebinding:
 * - no Origin (server-to-server: Claude, ChatGPT, Grok, SDKs) → allowed;
 * - the site's own origin → allowed;
 * - AGENT_API_ALLOWED_ORIGINS (comma-separated origins) set → only those;
 * - otherwise https origins, and http only from localhost (developer tools);
 * - when this server itself runs on localhost, only localhost origins, so
 *   a web page can't drive a developer's local copy;
 * - "null" and non-web origins never.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  // "Our own origin" comes from configuration, never from the Host header: after DNS rebinding a
  // hostile page sends a matching Host and Origin, which must not unlock a developer's local copy.
  if (configuredOrigins().has(parsed.origin)) return true;
  const list = process.env.AGENT_API_ALLOWED_ORIGINS?.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  if (list?.length) return list.includes('*') || list.includes(parsed.origin);
  const local = isLoopbackHost(parsed.host);
  // A copy configured for (or reached on) localhost only takes localhost pages; the Host header can only tighten this.
  if (isLoopbackHost(new URL(publicOrigin()).host) || isLoopbackHost(requestHost(request))) return local;
  return parsed.protocol === 'https:' || local;
}

/** Origins this deployment is configured to serve (product domain, public/site URL, Vercel URLs). */
function configuredOrigins(): Set<string> {
  const urls = [PRODUCT_URL, publicSiteUrl(), process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXTAUTH_URL];
  if (process.env.VERCEL_URL) urls.push(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) urls.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  const out = new Set<string>();
  for (const u of urls) {
    try {
      if (u) out.add(new URL(u).origin);
    } catch {
      /* not a URL */
    }
  }
  return out;
}

const ALLOW_HEADERS = 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID';
const EXPOSE_HEADERS = 'Mcp-Protocol-Version, Mcp-Session-Id, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, WWW-Authenticate';

/** CORS headers for a response to this request (no credentials; the Origin is echoed when allowed). */
export function corsHeaders(request: Request, methods: string): Record<string, string> {
  const origin = request.headers.get('origin');
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Expose-Headers': EXPOSE_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (!origin) return { ...base, 'Access-Control-Allow-Origin': '*' };
  return originAllowed(request) ? { ...base, 'Access-Control-Allow-Origin': origin } : base;
}

/** The OPTIONS (preflight) answer: 204 with CORS headers, or 403 for an origin that isn't allowed. */
export function preflight(request: Request, methods: string): Response {
  const headers = corsHeaders(request, methods);
  return new Response(null, { status: originAllowed(request) ? 204 : 403, headers });
}

/** Public, cacheable documents (llms.txt, OpenAPI, agent card): readable from any site. */
export function publicDocHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300, s-maxage=3600',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  };
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** Largest JSON body the REST API reads (its bodies are a few hundred bytes). */
export const MAX_REST_BODY_BYTES = 64 * 1024;
/** Largest body the MCP endpoint reads (a batch of up to 20 messages). */
export const MAX_MCP_BODY_BYTES = 256 * 1024;

/**
 * Reads a request body as UTF-8 text, refusing anything over `maxBytes`
 * bytes: a Content-Length over the cap is refused before reading, and the
 * stream is read with a running byte count (so a missing or understated
 * Content-Length doesn't help), stopping as soon as the cap is passed.
 * Shared by the MCP server and the REST API. DomainError 413
 * PAYLOAD_TOO_LARGE.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const tooLarge = () => new DomainError(413, 'PAYLOAD_TOO_LARGE', `Request body is too large (at most ${Math.floor(maxBytes / 1024)} KB).`);
  const declared = request.headers.get('content-length')?.trim();
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw tooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

/** What a call costs: every call is a read; booking requests, direct bookings and lookups also count separately. */
export type RateCategory = 'read' | 'lookup' | 'request' | 'book';

/**
 * A positive whole number from the environment, else the default. Big
 * assistants (ChatGPT, Claude…) call from a few shared IP addresses, so a
 * busy deployment may need higher per-IP limits than the defaults.
 */
function envLimit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

interface LimitRule {
  /** Per client IP without a key; null = keys only. */
  anon: [number, number] | null;
  /** Per API key. */
  key: [number, number];
  /** All of one hotel's keys together, so revoking and re-creating keys never starts a fresh allowance. */
  keyHotel: [number, number] | null;
  message: string;
  keyHotelMessage?: string;
}

const LIMITS: Record<RateCategory, LimitRule> = {
  read: { anon: [envLimit('AGENT_API_READS_PER_MINUTE', 120), MINUTE], key: [600, MINUTE], keyHotel: null, message: 'Too many requests from this connection — wait a minute and try again.' },
  lookup: {
    anon: [envLimit('AGENT_API_LOOKUPS_PER_HOUR', 20), HOUR],
    key: [200, HOUR],
    keyHotel: [envLimit('AGENT_API_KEY_HOTEL_LOOKUPS_PER_HOUR', 300), HOUR],
    message: 'Too many booking lookups from this connection — try again later, or ask the guest to use the link in their confirmation email.',
    keyHotelMessage: 'Too many booking lookups with this hotel’s API keys this hour — try again later.',
  },
  request: {
    anon: [envLimit('AGENT_API_REQUESTS_PER_HOUR', 10), HOUR],
    key: [60, HOUR],
    keyHotel: [envLimit('AGENT_API_KEY_HOTEL_REQUESTS_PER_HOUR', 100), HOUR],
    message: 'That’s a lot of booking requests this hour — send the guest a booking link instead (get_booking_link), or try again later.',
    keyHotelMessage: 'That’s a lot of booking requests with this hotel’s API keys this hour — send the guest a booking link instead (get_booking_link), or try again later.',
  },
  book: {
    anon: null,
    key: [60, HOUR],
    keyHotel: [envLimit('AGENT_API_KEY_HOTEL_BOOKINGS_PER_HOUR', 100), HOUR],
    message: 'That’s a lot of bookings with this API key this hour — try again later.',
    keyHotelMessage: 'That’s a lot of bookings with this hotel’s API keys this hour — try again later.',
  },
};

type Published = { max: number; minutes: number };
const published = (l: [number, number] | null): Published | null => l && { max: l[0], minutes: l[1] / MINUTE };

/** Published limits (llms.txt, OpenAPI, the public page): max and window in minutes per category. */
export const PUBLISHED_LIMITS = Object.fromEntries(
  (Object.keys(LIMITS) as RateCategory[]).map((c) => [c, { anonymous: published(LIMITS[c].anon), withKey: published(LIMITS[c].key)!, perHotelWithKeys: published(LIMITS[c].keyHotel) }]),
) as Record<RateCategory, { anonymous: Published | null; withKey: Published; perHotelWithKeys: Published | null }>;

/**
 * Counts one call in a category: per client IP without a key; with a key,
 * per key and (for lookups, requests and bookings) per the key's hotel, all
 * of its keys together, so churning keys doesn't reset anything (all-hotel
 * keys share one pool). The MCP server and the REST API share the buckets.
 * Returns the tighter allowance; throws DomainError 429 RATE_LIMITED with
 * details.retryAfterSeconds.
 */
export async function consumeAgentLimit(category: RateCategory, who: { key: AgentKeyContext | null; ip: string }): Promise<RateLimitResult> {
  const rule = LIMITS[category];
  if (!who.key) {
    const [max, windowMs] = rule.anon ?? rule.key;
    return consumeRateLimit(`agents:${category}:ip:${who.ip}`, max, windowMs, rule.message);
  }
  const perKey = await consumeRateLimit(`agents:${category}:key:${who.key.id}`, rule.key[0], rule.key[1], rule.message);
  if (!rule.keyHotel) return perKey;
  const perHotel = await consumeRateLimit(`agents:${category}:keyhotel:${who.key.propertyId ?? 'all-hotels'}`, rule.keyHotel[0], rule.keyHotel[1], rule.keyHotelMessage ?? rule.message);
  return perHotel.remaining < perKey.remaining ? perHotel : perKey;
}

// ---------------------------------------------------------------------------
// Route wrapper
// ---------------------------------------------------------------------------

/** What an agent route handler gets. */
export interface AgentRequestContext {
  /** The verified API key, or null for public calls. */
  key: AgentKeyContext | null;
  ip: string;
  /** This deployment's configured public origin (publicOrigin). */
  origin: string;
  /** Counts a call in another category (the 'read' hit is already counted). */
  limit: (category: RateCategory) => Promise<void>;
}

/** Text safe inside a quoted header value: ASCII only (curly quotes and dashes straightened), no quotes or backslashes. */
const headerSafe = (text: string) =>
  text
    .replace(/[‘’]/g, "'")
    .replace(/[“”"\\]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '');

/** Headers for a failed agent call: WWW-Authenticate on 401, Retry-After on 429. */
export function errorHeaders(e: unknown): Record<string, string> {
  if (!(e instanceof DomainError)) return {};
  if (e.status === 401 && e.code === 'API_KEY_REQUIRED') return { 'WWW-Authenticate': 'Bearer realm="HotelOne"' };
  if (e.status === 401) return { 'WWW-Authenticate': `Bearer realm="HotelOne", error="invalid_token", error_description="${headerSafe(e.message)}"` };
  if (e.status === 429 && typeof e.details?.retryAfterSeconds === 'number') return { 'Retry-After': String(e.details.retryAfterSeconds) };
  return {};
}

function rateHeaders(results: RateLimitResult[]): Record<string, string> {
  const tightest = results.reduce<RateLimitResult | null>((m, r) => (!m || r.remaining < m.remaining ? r : m), null);
  return tightest ? { 'X-RateLimit-Limit': String(tightest.limit), 'X-RateLimit-Remaining': String(Math.max(0, tightest.remaining)) } : {};
}

/**
 * Wraps a REST route handler: checks the Origin, verifies an API key when
 * one is sent (401 when it's bad), counts the call ('read', per key or IP),
 * then runs the handler. DomainErrors and validation errors become the
 * standard JSON error (`{ error, message, code, details? }`); every response
 * carries CORS and X-RateLimit headers.
 */
export function agentRoute<R>(methods: string, handler: (request: Request, ctx: AgentRequestContext, route: R) => Promise<Response>): (request: Request, route: R) => Promise<Response> {
  return async (request, route) => {
    const results: RateLimitResult[] = [];
    let res: Response;
    try {
      if (!originAllowed(request)) throw new DomainError(403, 'ORIGIN_NOT_ALLOWED', 'Requests from this website aren’t allowed.');
      const key = await agentKeyFromRequest(request);
      const ip = clientIp(request);
      const ctx: AgentRequestContext = {
        key,
        ip,
        origin: publicOrigin(),
        limit: async (category) => {
          results.push(await consumeAgentLimit(category, { key, ip }));
        },
      };
      await ctx.limit('read');
      res = await handler(request, ctx, route);
    } catch (e) {
      res = errorResponse(e);
      for (const [k, v] of Object.entries(errorHeaders(e))) res.headers.set(k, v);
    }
    for (const [k, v] of Object.entries({ ...corsHeaders(request, methods), ...rateHeaders(results) })) res.headers.set(k, v);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };
}

/** JSON response helper for agent routes. */
export const agentJson = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);
