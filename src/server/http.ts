import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod';
import { DomainError, badRequest } from './errors';
import { logError } from '@/server/log';

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
  logError('http', 'Unhandled route error:', e);
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
 * The caller's IP for rate limits. Vercel sets x-vercel-forwarded-for and
 * x-real-ip and overwrites X-Forwarded-For, so those can't be forged there.
 * Elsewhere, the first X-Forwarded-For hop is whatever the client sent, so
 * fall back to the LAST hop — the address the nearest proxy saw.
 */
export function clientIp(request: Request): string {
  const h = request.headers;
  const vercel = h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  if (vercel) return vercel;
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  const hops = h.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return hops[hops.length - 1] || 'unknown';
}
