/**
 * The rooms a booking is for. One booking can mix room types ("1 King and
 * 2 Doubles"); each type becomes its own reservation, linked by a group code.
 * Shared by the booking pages, the API and the agents (no server imports).
 *
 * In URLs a single type keeps the original `roomTypeId` + `rooms` parameters
 * (so existing links still work); a mix is repeated `room=<roomTypeId>:<count>`.
 */

export interface RoomSelection {
  roomTypeId: string;
  rooms: number;
}

/** Most rooms in one booking, across all types (the same cap as a single-type booking). */
export const MAX_ROOMS_PER_BOOKING = 9;
/** Most different room types in one booking. */
export const MAX_ROOM_TYPES_PER_BOOKING = 5;

/** Merges repeats of a type and drops empty lines, keeping the guest's order. */
export function normalizeSelection(items: readonly RoomSelection[]): RoomSelection[] {
  const out: RoomSelection[] = [];
  for (const item of items) {
    const id = item.roomTypeId.trim();
    const rooms = Math.floor(Number(item.rooms) || 0);
    if (!id || rooms < 1) continue;
    const same = out.find((o) => o.roomTypeId === id);
    if (same) same.rooms += rooms;
    else out.push({ roomTypeId: id, rooms });
  }
  return out;
}

export const totalRooms = (items: readonly RoomSelection[]) => items.reduce((n, i) => n + i.rooms, 0);

/** Why a selection can't be booked, or null. */
export function selectionError(items: readonly RoomSelection[]): string | null {
  if (items.length === 0) return 'Choose at least one room.';
  if (items.length > MAX_ROOM_TYPES_PER_BOOKING) return `One booking can include up to ${MAX_ROOM_TYPES_PER_BOOKING} room types.`;
  if (totalRooms(items) > MAX_ROOMS_PER_BOOKING) return `One booking can include up to ${MAX_ROOMS_PER_BOOKING} rooms.`;
  return null;
}

/** Reads the rooms from a URL's search params (see the module note for the format). */
export function readSelection(params: Pick<URLSearchParams, 'get' | 'getAll'>): RoomSelection[] {
  const mixed = params.getAll('room');
  if (mixed.length) {
    return normalizeSelection(
      mixed.map((v) => {
        const [roomTypeId = '', rooms = '1'] = v.split(':');
        return { roomTypeId, rooms: Number(rooms) || 1 };
      })
    );
  }
  const roomTypeId = params.get('roomTypeId');
  return roomTypeId ? normalizeSelection([{ roomTypeId, rooms: Number(params.get('rooms')) || 1 }]) : [];
}

/** Writes the rooms into search params (see the module note for the format). */
export function writeSelection(q: URLSearchParams, items: readonly RoomSelection[]): URLSearchParams {
  const clean = normalizeSelection(items);
  q.delete('roomTypeId');
  q.delete('room');
  if (clean.length === 1) {
    q.set('roomTypeId', clean[0].roomTypeId);
    q.set('rooms', String(clean[0].rooms));
  } else {
    q.set('rooms', String(totalRooms(clean)));
    for (const i of clean) q.append('room', `${i.roomTypeId}:${i.rooms}`);
  }
  return q;
}

/**
 * Shares a party out across the rooms: every room type gets at least one
 * guest, then each fills up to what its rooms sleep, in order. Null when the
 * rooms can't sleep everyone or there are fewer guests than room types.
 */
export function allocateGuests(guests: number, lines: readonly { capacity: number; rooms: number }[]): number[] | null {
  if (guests < lines.length) return null;
  const out = lines.map(() => 1);
  let left = guests - lines.length;
  lines.forEach((l, i) => {
    const add = Math.min(left, Math.max(0, l.capacity * l.rooms - 1));
    out[i] += add;
    left -= add;
  });
  return left > 0 ? null : out;
}

/** "1 King, 2 Doubles"-style label: "King × 1, Double × 2" (names are the hotel's own). */
export function selectionLabel(lines: readonly { name: string; rooms: number }[]): string {
  return lines.map((l) => `${l.name} × ${l.rooms}`).join(', ');
}
