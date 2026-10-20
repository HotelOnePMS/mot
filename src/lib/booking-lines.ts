/**
 * One reservation can hold several room types ("lines"): two King rooms and
 * a Twin for the same dates. Shared by the booking site, the checkout links
 * agents hand out, and the booking service.
 *
 * In URLs a reservation is `items=<roomTypeId>:<rooms>,<roomTypeId>:<rooms>`;
 * the older `roomTypeId=…&rooms=…` still means a single line.
 */

export interface BookingLine {
  roomTypeId: string;
  rooms: number;
}

/** Rooms in one reservation, across all its room types (the same cap as a single-type booking). */
export const MAX_RESERVATION_ROOMS = 9;
/** Room types in one reservation. */
export const MAX_RESERVATION_LINES = 4;

/** Merges repeated room types and drops empty lines, keeping first-seen order. */
export function normalizeLines(lines: BookingLine[]): BookingLine[] {
  const out = new Map<string, number>();
  for (const l of lines) {
    const id = l.roomTypeId.trim();
    const rooms = Math.floor(Number(l.rooms));
    if (!id || !Number.isFinite(rooms) || rooms < 1) continue;
    out.set(id, (out.get(id) ?? 0) + rooms);
  }
  return [...out].map(([roomTypeId, rooms]) => ({ roomTypeId, rooms }));
}

export const totalRooms = (lines: BookingLine[]) => lines.reduce((s, l) => s + l.rooms, 0);

/** "rt1:2,rt2:1" */
export function formatLinesParam(lines: BookingLine[]): string {
  return normalizeLines(lines)
    .map((l) => `${l.roomTypeId}:${l.rooms}`)
    .join(',');
}

/** Lines from a URL: `items`, else `roomTypeId` + `rooms`. Malformed parts are skipped. */
export function linesFromParams(params: { get(name: string): string | null }): BookingLine[] {
  const items = params.get('items');
  if (items) {
    return normalizeLines(
      items.split(',').map((part) => {
        const [roomTypeId = '', rooms = '1'] = part.split(':');
        return { roomTypeId, rooms: Number(rooms) || 1 };
      })
    );
  }
  const roomTypeId = params.get('roomTypeId');
  return roomTypeId ? normalizeLines([{ roomTypeId, rooms: Number(params.get('rooms')) || 1 }]) : [];
}

/**
 * Sets a reservation's lines on URL params: one line keeps the familiar
 * `roomTypeId` + `rooms`, several use `items` (and `rooms` = all rooms).
 */
export function setLineParams(q: URLSearchParams, lines: BookingLine[]): URLSearchParams {
  const clean = normalizeLines(lines);
  q.delete('items');
  q.delete('roomTypeId');
  if (clean.length === 1) {
    q.set('roomTypeId', clean[0].roomTypeId);
    q.set('rooms', String(clean[0].rooms));
  } else if (clean.length > 1) {
    q.set('items', formatLinesParam(clean));
    q.set('rooms', String(totalRooms(clean)));
  }
  return q;
}

/**
 * Shares the party out across the lines: each line gets at least one guest
 * and no more than it sleeps (capacity × rooms), filled in order. Returns
 * null when the party doesn't fit, or is smaller than the number of lines.
 */
export function splitParty(guests: number, lines: { rooms: number; capacity: number }[]): number[] | null {
  if (!lines.length || guests < lines.length) return null;
  const sleeps = lines.map((l) => l.capacity * l.rooms);
  if (sleeps.reduce((s, n) => s + n, 0) < guests) return null;
  const out = lines.map(() => 1);
  let left = guests - lines.length;
  for (let i = 0; i < lines.length && left > 0; i++) {
    const add = Math.min(left, sleeps[i] - out[i]);
    out[i] += add;
    left -= add;
  }
  return left === 0 ? out : null;
}
