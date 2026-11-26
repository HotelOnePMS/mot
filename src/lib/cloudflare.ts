/**
 * Access to Cloudflare bindings (R2, Hyperdrive, the Worker's own service
 * binding) when the app runs on Cloudflare Workers through OpenNext.
 *
 * OpenNext's worker puts each request's `{ env, ctx, cf }` behind this global
 * symbol (an AsyncLocalStorage store, so it is per request). Reading the
 * symbol directly, instead of importing `@opennextjs/cloudflare`, keeps this
 * file safe to bundle for Vercel, the Edge middleware, scripts and tests,
 * where it simply returns undefined.
 */

export type R2ObjectBody = { body: ReadableStream; httpMetadata?: { contentType?: string } };
export type R2Bucket = {
  put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
};
export type Fetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

export type CloudflareEnv = {
  /** R2 bucket for property and room photos (wrangler.jsonc → r2_buckets). */
  MEDIA?: R2Bucket;
  /** Hyperdrive config in front of Neon (wrangler.jsonc → hyperdrive). */
  HYPERDRIVE?: { connectionString: string };
  /** This Worker, so it can call its own routes without going back out through the zone. */
  WORKER_SELF_REFERENCE?: Fetcher;
  [key: string]: unknown;
};

export type CloudflareContext = {
  env: CloudflareEnv;
  ctx: { waitUntil(promise: Promise<unknown>): void };
  cf?: unknown;
};

const CONTEXT = Symbol.for('__cloudflare-context__');

/** This request's Cloudflare context, or undefined when not running on Workers. */
export function cloudflareContext(): CloudflareContext | undefined {
  try {
    return (globalThis as Record<symbol, CloudflareContext | undefined>)[CONTEXT];
  } catch {
    return undefined;
  }
}

/** True on the Cloudflare deployment (HOSTING=cloudflare is set in wrangler.jsonc vars). */
export function onCloudflare(): boolean {
  return process.env.HOSTING === 'cloudflare';
}
