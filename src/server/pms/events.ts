/**
 * Inbound events from PMS vendors: "a reservation was created", "room 14 is
 * clean". They land in the hotel's activity log, which staff see on the
 * Activity page and the agent reads when asked what happened.
 *
 * Signing: each connection has its own secret, DERIVED from the server
 * secret (nothing stored): HMAC-SHA256(key = "pms-events:<server secret>",
 * "pms-events|<connectionId>"). The vendor sends
 *   X-HotelOne-Timestamp: <unix seconds>
 *   X-HotelOne-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 * and we accept it within ±5 minutes. Rotating the server secret rotates
 * every events secret (set PMS_EVENTS_SECRET to decouple them).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { publicSiteUrl } from '../public-url';
import { sanitiseText } from './tools';

export const EVENT_SIGNATURE_HEADER = 'x-hotelone-signature';
export const EVENT_TIMESTAMP_HEADER = 'x-hotelone-timestamp';
export const EVENT_TOLERANCE_SECONDS = 300;
export const EVENT_MAX_BYTES = 64 * 1024;
/** Accepted events per connection per minute (across instances, counted in the activity log). */
export const EVENT_MAX_PER_MINUTE = 120;
export const PMS_EVENT_ACTION = 'PMS_EVENT';

function serverSecret(): string {
  const s = process.env.PMS_EVENTS_SECRET || process.env.AGENT_PLAN_SECRET || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET (or PMS_EVENTS_SECRET) must be set to sign PMS events.');
  return `pms-events:${s}`;
}

/** The connection's events secret (shown to managers on demand; the vendor signs with it). */
export function eventsSecret(connectionId: string): string {
  return `pmsevt_${createHmac('sha256', serverSecret()).update(`pms-events|${connectionId}`).digest('base64url')}`;
}

export function eventsPath(connectionId: string): string {
  return `/api/pms/events/${connectionId}`;
}

/** Absolute URL when this deployment knows its public address, else the path. */
export function eventsUrl(connectionId: string): string {
  return `${publicSiteUrl() ?? ''}${eventsPath(connectionId)}`;
}

/** `sha256=<hex>` over "<timestamp>.<raw body>" — what vendors compute. */
export function signEvent(secret: string, timestamp: string | number, rawBody: string | Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
}

export type VerifyResult = { ok: true } | { ok: false; status: number; code: string; message: string };

/** Checks timestamp freshness and the signature, in constant time. No database. */
export function verifyEventSignature(input: { connectionId: string; rawBody: Buffer; timestamp: string | null; signature: string | null; now?: number }): VerifyResult {
  const ts = input.timestamp?.trim() ?? '';
  if (!/^\d{9,11}$/.test(ts)) return { ok: false, status: 401, code: 'BAD_TIMESTAMP', message: `Missing or malformed ${EVENT_TIMESTAMP_HEADER} (Unix seconds).` };
  const age = Math.abs((input.now ?? Date.now()) / 1000 - Number(ts));
  if (age > EVENT_TOLERANCE_SECONDS) return { ok: false, status: 401, code: 'STALE', message: `Timestamp is more than ${EVENT_TOLERANCE_SECONDS / 60} minutes from our clock — check the sender’s clock and sign each delivery fresh.` };
  const expected = Buffer.from(signEvent(eventsSecret(input.connectionId), ts, input.rawBody));
  // Allow several signatures ("sha256=a, sha256=b") for secret rotation on the sender's side.
  const given = (input.signature ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const match = given.some((g) => {
    const b = Buffer.from(g.toLowerCase());
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
  return match ? { ok: true } : { ok: false, status: 401, code: 'BAD_SIGNATURE', message: `Invalid ${EVENT_SIGNATURE_HEADER}.` };
}

// ---------------------------------------------------------------------------
// Per-instance flood guard (before any work). Accepted events are also
// capped across instances via the activity log count.

const hits = new Map<string, { n: number; reset: number }>();
export function floodGuard(key: string, max = 240, windowMs = 60_000): boolean {
  const now = Date.now();
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  h.n++;
  return h.n <= max;
}

// ---------------------------------------------------------------------------

export interface PmsEvent {
  id?: string;
  type: string;
  occurred_at?: string;
  data?: Record<string, unknown>;
}

type Rec = Record<string, unknown>;
const str = (v: unknown, max = 80): string | undefined => (typeof v === 'string' || typeof v === 'number' ? sanitiseText(String(v), max) || undefined : undefined);
const firstStr = (o: Rec, keys: string[], max = 80) => {
  for (const k of keys) {
    const v = str(o[k], max);
    if (v) return v;
  }
  return undefined;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function day(v: string | undefined): { y: number; m: number; d: number } | null {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}
export function formatRange(from?: string, to?: string): string | undefined {
  const a = day(from);
  const b = day(to);
  if (!a) return undefined;
  if (!b) return `${a.d} ${MONTHS[a.m]}`;
  return a.m === b.m && a.y === b.y ? `${a.d}–${b.d} ${MONTHS[a.m]}` : `${a.d} ${MONTHS[a.m]}–${b.d} ${MONTHS[b.m]}`;
}

/** The fields we keep from an event (no full payload: guest data stays in the PMS). */
export function eventFacts(data: Rec = {}) {
  const guest = (data.guest && typeof data.guest === 'object' ? data.guest : {}) as Rec;
  const reservation = (data.reservation && typeof data.reservation === 'object' ? data.reservation : data) as Rec;
  const first = firstStr(guest, ['first_name', 'firstName']) ?? firstStr(reservation, ['first_name', 'firstName']);
  const last = firstStr(guest, ['last_name', 'lastName']) ?? firstStr(reservation, ['last_name', 'lastName']);
  const name =
    firstStr(reservation, ['guest_name', 'guestName', 'name']) ?? firstStr(guest, ['name', 'full_name', 'fullName']) ?? ([first, last].filter(Boolean).join(' ') || undefined);
  return {
    guest: name,
    code: firstStr(reservation, ['confirmation_code', 'confirmationCode', 'confirmation', 'code', 'booking_reference']),
    reservationId: firstStr(reservation, ['reservation_id', 'reservationId', 'id', 'booking_id']),
    room: firstStr(reservation, ['room_number', 'roomNumber', 'room']) ?? firstStr(data, ['room_number', 'roomNumber', 'room']),
    roomType: firstStr(reservation, ['room_type', 'roomType', 'room_type_name']) ?? firstStr(data, ['room_type', 'roomType']),
    arrival: firstStr(reservation, ['arrival', 'check_in', 'checkIn', 'arrival_date', 'start_date', 'from'], 30),
    departure: firstStr(reservation, ['departure', 'check_out', 'checkOut', 'departure_date', 'end_date', 'to'], 30),
    status: firstStr(data, ['status', 'new_status', 'newStatus'], 40),
    previousStatus: firstStr(data, ['previous_status', 'previousStatus', 'old_status'], 40),
    changes: Array.isArray(data.changes) ? (data.changes as unknown[]).map((c) => str(c, 40)).filter(Boolean).slice(0, 6) : data.changes && typeof data.changes === 'object' ? Object.keys(data.changes as Rec).map((k) => sanitiseText(k, 40)).slice(0, 6) : [],
    amount: firstStr(data, ['amount', 'rate', 'price'], 20),
  };
}

const humanStatus = (s: string) => s.replace(/[_-]+/g, ' ').toLowerCase();

/** "PMS: reservation created — Ana Moreno, 18–20 Oct, Deluxe King (RES-1001)". */
export function summariseEvent(type: string, data: Rec = {}): string {
  const f = eventFacts(data);
  const who = f.guest ?? (f.code ? `reservation ${f.code}` : 'a guest');
  const ref = f.code && f.guest ? ` (${f.code})` : '';
  const range = formatRange(f.arrival, f.departure);
  let s: string;
  switch (type) {
    case 'reservation.created':
      s = `PMS: reservation created — ${[who, range, f.roomType].filter(Boolean).join(', ')}${ref}`;
      break;
    case 'reservation.updated':
      s = `PMS: reservation updated — ${who}${ref}${f.changes.length ? `: ${f.changes.join(', ')} changed` : range ? `, now ${range}` : ''}`;
      break;
    case 'reservation.cancelled':
      s = `PMS: reservation cancelled — ${who}${ref}${range ? `, ${range}` : ''}`;
      break;
    case 'reservation.checked_in':
      s = `PMS: ${who}${ref} checked in${f.room ? ` to room ${f.room}` : ''}`;
      break;
    case 'reservation.checked_out':
      s = `PMS: ${who}${ref} checked out${f.room ? ` of room ${f.room}` : ''}`;
      break;
    case 'room.status_changed':
      s = `PMS: room ${f.room ?? '?'} is now ${f.status ? humanStatus(f.status) : 'updated'}${f.previousStatus ? ` (was ${humanStatus(f.previousStatus)})` : ''}`;
      break;
    case 'rates.updated':
      s = `PMS: rates updated${[f.roomType, range, f.amount].filter(Boolean).length ? ` — ${[f.roomType, range, f.amount].filter(Boolean).join(', ')}` : ''}`;
      break;
    case 'availability.changed':
      s = `PMS: availability changed${[f.roomType, range].filter(Boolean).length ? ` — ${[f.roomType, range].filter(Boolean).join(', ')}` : ''}`;
      break;
    default:
      s = `PMS: ${humanStatus(type.replace(/\./g, ' '))}${f.guest || f.code ? ` — ${who}${ref}` : f.room ? ` — room ${f.room}` : ''}`;
  }
  return s.slice(0, 300);
}

/**
 * Whose name the entry carries (the log needs a user): the person who last
 * set up this PMS connection, else an owner/manager of the hotel, else a
 * platform admin. The entry is marked source "system" ("Automatic").
 */
async function eventUserId(propertyId: string): Promise<string | null> {
  const setup = await prisma.agentAuditLog.findFirst({
    where: { propertyId, action: { in: ['PMS_MCP_CONNECT', 'BRIDGE_SETUP'] } },
    orderBy: { createdAt: 'desc' },
    select: { userId: true },
  });
  if (setup) return setup.userId;
  const staff = await prisma.userPropertyAssignment.findFirst({
    where: { propertyId, user: { isActive: true, role: { in: ['OWNER', 'MANAGER'] } } },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  if (staff) return staff.userId;
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return admin?.id ?? null;
}

export type RecordEventResult = { status: 'recorded' | 'duplicate' | 'ping' | 'rate_limited'; summary?: string };

/** Write the event to the activity log (deduplicated by `id` for 24 h, capped per minute). */
export async function recordPmsEvent(connection: { id: string; propertyId: string; system: string }, event: PmsEvent): Promise<RecordEventResult> {
  await prisma.pmsConnection.update({ where: { id: connection.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  if (event.type === 'ping') return { status: 'ping' };

  const since = new Date(Date.now() - 60_000);
  const recent = await prisma.agentAuditLog.count({ where: { propertyId: connection.propertyId, action: PMS_EVENT_ACTION, createdAt: { gte: since } } });
  if (recent >= EVENT_MAX_PER_MINUTE) return { status: 'rate_limited' };

  const eventId = event.id ? sanitiseText(event.id, 120).replace(/["\\]/g, '') : undefined;
  if (eventId) {
    const dup = await prisma.agentAuditLog.findFirst({
      where: { propertyId: connection.propertyId, action: PMS_EVENT_ACTION, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) }, detail: { contains: `"eventId":"${eventId}"` } },
      select: { id: true },
    });
    if (dup) return { status: 'duplicate' };
  }

  const summary = summariseEvent(event.type, event.data);
  const userId = await eventUserId(connection.propertyId);
  if (!userId) return { status: 'recorded', summary };
  const facts = eventFacts(event.data);
  await prisma.agentAuditLog.create({
    data: {
      propertyId: connection.propertyId,
      userId,
      action: PMS_EVENT_ACTION,
      detail: JSON.stringify({
        source: 'system',
        summary,
        pms: { type: event.type, system: connection.system, connectionId: connection.id, occurredAt: event.occurred_at ? sanitiseText(event.occurred_at, 40) : null },
        eventId: eventId ?? null,
        facts,
      }).slice(0, 4000),
    },
  });
  return { status: 'recorded', summary };
}
