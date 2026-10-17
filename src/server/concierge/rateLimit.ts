/**
 * A rate limiter shared by every server instance, for public agent endpoints.
 *
 * It reuses the database mechanism the voice line already uses for its
 * ceilings (src/server/voice/sessions.ts): a hit is a row in voice_sessions
 * (channel 'RATE_LIMIT', scope 'GLOBAL', audience 'SYSTEM', no property),
 * keyed by a hash in `clientKey` and counted through the
 * (clientKey, startedAt) index. Insert first, then count including our own
 * row, so concurrent callers can't overshoot; a rejected hit removes its row,
 * so a caller hammering the limit doesn't grow the table. Old hits are swept
 * now and then. Anything counting voice sessions without a property should
 * filter on `channel` (or `scope`/`audience`) to skip these rows.
 */
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { DomainError } from '../errors';

/** voice_sessions.channel of rate-limit hits. */
export const RATE_LIMIT_CHANNEL = 'RATE_LIMIT';
const MAX_WINDOW_MS = 24 * 3600_000;

/** What a successful `consumeRateLimit` reports (for X-RateLimit-* style headers). */
export interface RateLimitResult {
  limit: number;
  /** Hits left in the current window. */
  remaining: number;
}

/**
 * Counts one hit for `key` (e.g. `mcp:ip:1.2.3.4`, `rest:key:<apiKeyId>`)
 * and throws DomainError(429, 'RATE_LIMITED', message, { retryAfterSeconds })
 * when that makes more than `max` hits within the last `windowMs` (capped at
 * 24 hours). The raw key is never stored, only its SHA-256.
 */
export async function consumeRateLimit(key: string, max: number, windowMs: number, message = 'Too many requests — please slow down and try again shortly.'): Promise<RateLimitResult> {
  const window = Math.min(Math.max(windowMs, 1000), MAX_WINDOW_MS);
  const clientKey = `rl:${createHash('sha256').update(key).digest('hex')}`;
  const now = new Date();
  const row = await prisma.voiceSession.create({
    // endedAt = when this hit stops counting, so short windows (a minute) don't keep rows for a day.
    data: { propertyId: null, audience: 'SYSTEM', scope: 'GLOBAL', channel: RATE_LIMIT_CHANNEL, clientKey, startedAt: now, endedAt: new Date(now.getTime() + window) },
    select: { id: true },
  });
  if (Math.random() < 0.02) sweep();
  const since = new Date(now.getTime() - window);
  const hits = await prisma.voiceSession.count({ where: { clientKey, startedAt: { gte: since } } });
  if (hits <= max) return { limit: max, remaining: max - hits };
  await prisma.voiceSession.delete({ where: { id: row.id } }).catch(() => undefined);
  const oldest = await prisma.voiceSession.findFirst({ where: { clientKey, startedAt: { gte: since } }, orderBy: { startedAt: 'asc' }, select: { startedAt: true } });
  const retryAfterSeconds = Math.max(1, Math.ceil(((oldest?.startedAt.getTime() ?? now.getTime()) + window - Date.now()) / 1000));
  throw new DomainError(429, 'RATE_LIMITED', message, { retryAfterSeconds });
}

/** Drops hits whose window has passed (endedAt is each hit's expiry; the (channel, startedAt) index bounds the scan). Best effort, never awaited. */
function sweep() {
  const now = new Date();
  prisma.voiceSession
    .deleteMany({ where: { channel: RATE_LIMIT_CHANNEL, startedAt: { lt: now }, OR: [{ endedAt: { lt: now } }, { startedAt: { lt: new Date(now.getTime() - MAX_WINDOW_MS) } }] } })
    .catch((e) => console.error('[concierge] rate-limit sweep failed', e));
}
