import { NextRequest } from 'next/server';
import { runWatch } from '@/server/agent/watch';
import { handleRoute, json } from '@/server/http';
import { safeEqual } from '@/server/vault';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

/**
 * GET or POST /api/cron/agent-watch — the always-on agent's rounds: looks
 * over every hotel with staff linked on WhatsApp and messages them what needs
 * attention (src/server/agent/watch.ts). Call it every 15 minutes with
 * `Authorization: Bearer $CRON_SECRET`: the scheduled GitHub workflow
 * (.github/workflows/agent-watch.yml), a Vercel cron on a paid plan, or any
 * scheduler. Running it more often never sends anything twice.
 */
async function run(request: NextRequest) {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, { status: 401 });
  return json(await runWatch());
}

export const GET = handleRoute(run);
export const POST = handleRoute(run);
