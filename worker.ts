/**
 * Cloudflare Worker entry: OpenNext's Next.js handler, plus a `scheduled`
 * handler for Cron Triggers (wrangler.jsonc → triggers.crons), which replace
 * the Vercel Cron in vercel.json. Each cron calls the same route Vercel did,
 * with CRON_SECRET as the bearer token, by handing a request straight to the
 * Next.js handler (no trip back out through the internet).
 */
// @ts-expect-error: built by `opennextjs-cloudflare build`
import { default as nextHandler } from './.open-next/worker.js';

// Durable Objects OpenNext may use (queues, tag cache); harmless when unused.
// @ts-expect-error: built by `opennextjs-cloudflare build`
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

type Env = Record<string, unknown> & {
  CRON_SECRET?: string;
  HOTELONE_PUBLIC_URL?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  CRON_EXPIRE_BOOKINGS?: string;
};
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void };
type ScheduledController = { cron: string; scheduledTime: number };

/** Cron expression (as in wrangler.jsonc) -> routes it runs. */
function routesFor(cron: string, env: Env): string[] {
  switch (cron) {
    case '0 10 * * *':
      return ['/api/channels/cron?full=1'];
    case '*/15 * * * *':
      // Releases unpaid holds and deletes expired ID photos. Off until CRON_EXPIRE_BOOKINGS=true.
      return env.CRON_EXPIRE_BOOKINGS === 'true' ? ['/api/cron/expire-bookings'] : [];
    default:
      return [];
  }
}

export default {
  fetch: nextHandler.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (!env.CRON_SECRET) {
      console.warn(`cron ${controller.cron}: CRON_SECRET is not set, skipping`);
      return;
    }
    // The main site's host, so middleware treats the call as the app and not a hotel's domain.
    const origin = (env.HOTELONE_PUBLIC_URL || env.NEXT_PUBLIC_SITE_URL || 'https://hotelone.workers.dev').replace(/\/$/, '');
    for (const path of routesFor(controller.cron, env)) {
      const request = new Request(`${origin}${path}`, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
      const response: Response = await nextHandler.fetch(request, env, ctx);
      console.log(`cron ${controller.cron} ${path}: ${response.status}`);
      if (!response.ok) console.error(await response.text().catch(() => ''));
    }
  },
};
