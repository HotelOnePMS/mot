import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod';
import { DomainError, badRequest } from './errors';

/**
 * Wraps a route handler so DomainErrors and validation errors become
 * consistent JSON responses: `{ error, message, code, details? }`, where
 * `error` and `message` are the same user-safe string (existing clients
 * read either field).
 */
export function handleRoute<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof DomainError) {
    return NextResponse.json(
      { error: e.message, message: e.message, code: e.code, details: e.details },
      { status: e.status }
    );
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const msg = first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input';
    return NextResponse.json({ error: msg, message: msg, code: 'VALIDATION', details: { issues: e.issues } }, { status: 400 });
  }
  console.error('Unhandled route error:', e);
  return NextResponse.json(
    { error: 'Something went wrong on our side. Please try again.', message: 'Internal server error', code: 'INTERNAL' },
    { status: 500 }
  );
}

export async function parseJson<S extends ZodTypeAny>(request: Request, schema: S): Promise<ZodInfer<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
  return schema.parse(body);
}

export function parseQuery<S extends ZodTypeAny>(request: Request, schema: S): ZodInfer<S> {
  const url = new URL(request.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

export const json = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);

/**
 * Proxies in front of this app that append the address they saw to
 * X-Forwarded-For: TRUSTED_PROXY_HOPS (1–10), default 1 (the nearest proxy,
 * or Next.js itself, which fills the header with the socket address when the
 * client sent none).
 */
function trustedProxyHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 10) : 1;
}

/**
 * The caller's IP for rate limits.
 * - On Vercel (process.env.VERCEL), x-vercel-forwarded-for, then x-real-ip:
 *   Vercel's edge sets and overwrites both, so they can't be forged there.
 * - Anywhere else those two headers are whatever the client sent, so they're
 *   ignored. The address comes from X-Forwarded-For, counted
 *   TRUSTED_PROXY_HOPS entries from the right: each trusted proxy appends the
 *   address it saw, and anything further left was written by the client.
 */
export function clientIp(request: Request): string {
  const h = request.headers;
  if (process.env.VERCEL) {
    const vercel = h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
    if (vercel) return vercel;
    const real = h.get('x-real-ip')?.trim();
    if (real) return real;
  }
  const hops = h.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  if (!hops.length) return 'unknown';
  return hops[Math.max(0, hops.length - trustedProxyHops())];
}
