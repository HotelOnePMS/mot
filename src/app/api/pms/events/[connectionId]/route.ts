import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { EVENT_MAX_BYTES, EVENT_SIGNATURE_HEADER, EVENT_TIMESTAMP_HEADER, recordPmsEvent, verifyEventSignature } from '@/server/pms';
import { floodGuard } from '@/server/pms/events';
import { clientIp } from '@/server/http';

type Params = { params: Promise<{ connectionId: string }> };

const eventSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  type: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$|^ping$/, 'must look like "reservation.created"'),
  occurred_at: z.string().max(40).optional(),
  data: z.record(z.unknown()).optional(),
});

const reply = (status: number, body: Record<string, unknown>, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** Read at most `max` bytes of the body; null when it is larger. */
async function readCapped(request: NextRequest, max: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * POST — a PMS vendor tells HotelOne something changed (reservation created,
 * room status changed…). Signed per connection; see /developers/pms#events.
 * The event is written to the hotel's activity log, where staff and the
 * agent see it.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { connectionId } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(connectionId)) return reply(404, { error: 'Unknown connection.' });
  const ip = clientIp(request);
  if (!floodGuard(`pms-events:${connectionId}`, 240) || !floodGuard(`pms-events-ip:${ip}`, 600)) {
    return reply(429, { error: 'Too many events — slow down.' }, { 'Retry-After': '60' });
  }

  const raw = await readCapped(request, EVENT_MAX_BYTES);
  if (!raw) return reply(413, { error: `Events are limited to ${EVENT_MAX_BYTES / 1024} KB.` });

  // Signature first: needs no database, so junk is turned away cheaply.
  const verdict = verifyEventSignature({
    connectionId,
    rawBody: raw,
    timestamp: request.headers.get(EVENT_TIMESTAMP_HEADER),
    signature: request.headers.get(EVENT_SIGNATURE_HEADER),
  });
  if (!verdict.ok) return reply(verdict.status, { error: verdict.message, code: verdict.code });

  let parsed: z.infer<typeof eventSchema>;
  try {
    parsed = eventSchema.parse(JSON.parse(raw.toString('utf8')));
  } catch (e) {
    const msg = e instanceof z.ZodError ? `${e.issues[0]?.path.join('.') || 'body'}: ${e.issues[0]?.message}` : 'Body must be JSON.';
    return reply(400, { error: msg, code: 'VALIDATION' });
  }

  const connection = await prisma.pmsConnection.findUnique({ where: { id: connectionId }, select: { id: true, propertyId: true, system: true } });
  if (!connection) return reply(404, { error: 'This connection no longer exists. Reconnect the PMS in HotelOne.' });

  try {
    const result = await recordPmsEvent(connection, parsed);
    if (result.status === 'rate_limited') return reply(429, { error: 'Too many events this minute.', code: 'RATE_LIMITED' }, { 'Retry-After': '60' });
    return reply(200, { ok: true, type: parsed.type, ...(result.status === 'duplicate' ? { duplicate: true } : {}), ...(result.summary ? { logged: result.summary } : {}) });
  } catch (e) {
    console.error('[pms-events] could not record event:', e);
    return reply(500, { error: 'Could not record the event. Retry later.' });
  }
}
