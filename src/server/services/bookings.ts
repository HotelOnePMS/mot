/**
 * Booking domain service: creation (server-priced, overbooking-safe),
 * lifecycle transitions with side effects, room assignment, notes, search.
 */
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { BookingStatus, BookingSummary, ISODate } from '@/lib/dto';
import { BOOKING_STATUS } from '@/lib/status';
import { assertPropertyAccess, can, requirePermission, scopeByProperty, type Actor, type Permission } from '../authz';
import { addDaysISO, atNoonUTC, dayBounds, diffDays, formatDay, hotelToday, isISODate, toISODate } from '../dates';
import { badRequest, conflict, DomainError, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { nightlyInventory, quoteStay } from './inventory';
import { bookingInclude, floorNumber, toBookingSummary, type BookingWithRelations } from './mappers';

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateBookingCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

async function loadBooking(idOrCode: string): Promise<BookingWithRelations | null> {
  const key = idOrCode.trim().replace(/^#/, '');
  if (!key) return null;
  return prisma.booking.findFirst({
    where: { OR: [{ id: key }, { code: key.toUpperCase() }] },
    include: bookingInclude,
  });
}

/** Load a booking the actor may see (by id or confirmation code). */
export async function getBookingForStaff(actor: Actor, idOrCode: string): Promise<BookingWithRelations> {
  requirePermission(actor, 'booking.view');
  const booking = await loadBooking(idOrCode);
  if (!booking) throw notFound('Reservation');
  assertPropertyAccess(actor, booking.propertyId);
  return booking;
}

export interface BookingSearch {
  propertyId?: string;
  query?: string;
  status?: BookingStatus[];
  from?: ISODate;
  to?: ISODate;
  limit?: number;
}

export async function searchBookings(actor: Actor, q: BookingSearch): Promise<BookingSummary[]> {
  requirePermission(actor, 'booking.view');
  if (q.propertyId) assertPropertyAccess(actor, q.propertyId);
  const text = q.query?.trim();
  const where: Prisma.BookingWhereInput = {
    ...(q.propertyId ? { propertyId: q.propertyId } : scopeByProperty(actor)),
    ...(q.status?.length ? { status: { in: q.status } } : {}),
    ...(q.from || q.to
      ? {
          AND: [
            ...(q.to ? [{ checkIn: { lt: atNoonUTC(addDaysISO(q.to, 1)) } }] : []),
            ...(q.from ? [{ checkOut: { gt: atNoonUTC(q.from) } }] : []),
          ],
        }
      : {}),
    ...(text
      ? {
          OR: [
            { code: { equals: text.toUpperCase().replace(/^#/, '') } },
            { id: text },
            { user: { firstName: { contains: text, mode: 'insensitive' } } },
            { user: { lastName: { contains: text, mode: 'insensitive' } } },
            { user: { email: { contains: text, mode: 'insensitive' } } },
            { user: { phone: { contains: text } } },
            ...nameParts(text),
          ],
        }
      : {}),
  };
  const rows = await prisma.booking.findMany({
    where,
    include: bookingInclude,
    orderBy: [{ checkIn: 'desc' }],
    take: Math.min(q.limit ?? 50, 200),
  });
  return rows.map(toBookingSummary);
}

function nameParts(text: string): Prisma.BookingWhereInput[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];
  return [
    {
      user: {
        firstName: { contains: parts[0], mode: 'insensitive' },
        lastName: { contains: parts[parts.length - 1], mode: 'insensitive' },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateBookingInput {
  userId: string;
  propertyId: string;
  roomTypeId: string;
  checkIn: ISODate;
  checkOut: ISODate;
  guests: number;
  rooms?: number;
  notes?: string | null;
  paymentStatus?: string;
  /** Who/what created it, for the status history. */
  createdVia?: string;
}

const MAX_NIGHTS = 30;

export async function createBooking(input: CreateBookingInput): Promise<BookingWithRelations> {
  const rooms = input.rooms ?? 1;
  if (!isISODate(input.checkIn) || !isISODate(input.checkOut)) throw badRequest('Dates must be in YYYY-MM-DD format.');
  if (input.checkIn >= input.checkOut) throw badRequest('Check-out must be after check-in.');
  if (input.checkIn < hotelToday()) throw badRequest('Check-in date cannot be in the past.');
  const nights = diffDays(input.checkIn, input.checkOut);
  if (nights > MAX_NIGHTS) throw badRequest(`Stays are limited to ${MAX_NIGHTS} nights online. Please contact the hotel for longer stays.`);
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > 9) throw badRequest('Rooms must be between 1 and 9.');
  if (!Number.isInteger(input.guests) || input.guests < 1) throw badRequest('At least one guest is required.');

  const roomType = await prisma.roomType.findUnique({
    where: { id: input.roomTypeId },
    select: { id: true, name: true, propertyId: true, capacity: true, isActive: true, property: { select: { isActive: true, setupPath: true, phone: true } } },
  });
  if (!roomType || !roomType.isActive || !roomType.property.isActive) throw notFound('Room type');
  if (roomType.propertyId !== input.propertyId) throw badRequest('That room type does not belong to this property.');
  // Voice-only hotels take bookings in their own system; HotelOne only quotes them.
  if (roomType.property.setupPath === 'VOICE') throw badRequest(`This hotel takes bookings directly — please call ${roomType.property.phone}.`);
  if (input.guests > roomType.capacity * rooms) {
    throw badRequest(`${roomType.name} sleeps up to ${roomType.capacity} per room. Add another room or choose a larger room type.`);
  }

  // Serializable transaction: two guests racing for the last room cannot
  // both succeed. Retries on serialization failures and code collisions.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const inventory = await nightlyInventory(tx, input.roomTypeId, input.checkIn, input.checkOut);
          if (inventory.minAvailable < rooms) {
            throw conflict(
              inventory.minAvailable === 0
                ? `${roomType.name} is sold out for those dates.`
                : `Only ${inventory.minAvailable} ${roomType.name} room${inventory.minAvailable === 1 ? '' : 's'} left for those dates.`,
              { available: inventory.minAvailable }
            );
          }
          const quote = await quoteStay(tx, { roomTypeId: input.roomTypeId, checkIn: input.checkIn, checkOut: input.checkOut, rooms, guests: input.guests });
          return tx.booking.create({
            data: {
              userId: input.userId,
              propertyId: input.propertyId,
              roomTypeId: input.roomTypeId,
              checkIn: atNoonUTC(input.checkIn),
              checkOut: atNoonUTC(input.checkOut),
              guests: input.guests,
              rooms,
              totalPrice: quote.total,
              status: 'PENDING',
              paymentStatus: input.paymentStatus ?? 'UNPAID',
              code: generateBookingCode(),
              notes: input.notes?.trim() || null,
              statusHistory: { create: { status: 'PENDING', notes: input.createdVia ?? 'Booking created' } },
            },
            include: bookingInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (e) {
      const retryable =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === 'P2034' || (e.code === 'P2002' && String(e.meta?.target ?? '').includes('code')));
      if (retryable && attempt < 3) continue;
      throw e;
    }
  }
  throw new DomainError(503, 'BUSY', 'The hotel is busy right now — please try again.');
}

/** Pay-at-property bookings are confirmed instantly — the guest is told so. */
export async function confirmPayAtProperty(bookingId: string) {
  return prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CONFIRMED', statusHistory: { create: { status: 'CONFIRMED', notes: 'Instant confirmation (pay at property)' } } },
  });
}

/** Accounts aren't email-verified: a handful of confirmations per hour is plenty for a real guest. */
export async function confirmationEmailAllowed(userId: string): Promise<boolean> {
  const recentBookings = await prisma.booking.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  return recentBookings <= 5;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<BookingStatus, { to: BookingStatus; perm: Permission }[]> = {
  PENDING: [
    { to: 'CONFIRMED', perm: 'booking.confirm' },
    { to: 'CHECKED_IN', perm: 'booking.checkin' },
    { to: 'CANCELLED', perm: 'booking.cancel' },
    { to: 'NO_SHOW', perm: 'booking.noShow' },
  ],
  CONFIRMED: [
    { to: 'CHECKED_IN', perm: 'booking.checkin' },
    { to: 'CANCELLED', perm: 'booking.cancel' },
    { to: 'NO_SHOW', perm: 'booking.noShow' },
  ],
  CHECKED_IN: [{ to: 'CHECKED_OUT', perm: 'booking.checkout' }],
  CHECKED_OUT: [],
  CANCELLED: [{ to: 'CONFIRMED', perm: 'booking.reinstate' }],
  NO_SHOW: [{ to: 'CONFIRMED', perm: 'booking.reinstate' }],
};

export function allowedTransitions(status: BookingStatus): BookingStatus[] {
  return TRANSITIONS[status].map((t) => t.to);
}

const VERB: Partial<Record<BookingStatus, string>> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Marked no-show',
};

export interface TransitionOptions {
  note?: string;
  roomId?: string;
  /** Allow check-in to a room that is not yet clean (front desk override). */
  allowDirtyRoom?: boolean;
}

export interface TransitionResult {
  booking: BookingSummary;
  from: BookingStatus;
  to: BookingStatus;
  effects: string[];
}

/**
 * Validates whether a transition is allowed right now, without changing
 * anything. Used by the agent to build an honest confirmation card.
 */
export async function checkTransition(
  actor: Actor,
  booking: BookingWithRelations,
  to: BookingStatus
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const from = booking.status as BookingStatus;
  const rule = TRANSITIONS[from].find((t) => t.to === to);
  if (!rule) {
    return { ok: false, reason: `A ${BOOKING_STATUS[from].label.toLowerCase()} reservation can't be ${VERB[to]?.toLowerCase() ?? to.toLowerCase()}.` };
  }
  if (!can(actor, rule.perm)) return { ok: false, reason: 'Your role cannot perform this action.' };
  const today = hotelToday();
  const checkIn = toISODate(booking.checkIn);
  const checkOut = toISODate(booking.checkOut);
  if (to === 'CHECKED_IN') {
    if (today < checkIn) return { ok: false, reason: `This stay starts ${formatDay(checkIn, 'weekday')}. Check-in opens on the arrival day.` };
    if (today >= checkOut) return { ok: false, reason: `This stay ended ${formatDay(checkOut, 'weekday')}.` };
  }
  if (to === 'NO_SHOW' && today < checkIn) {
    return { ok: false, reason: `The guest isn't due until ${formatDay(checkIn, 'weekday')}.` };
  }
  return { ok: true };
}

export async function transitionBooking(
  ctx: OpContext,
  bookingIdOrCode: string,
  to: BookingStatus,
  opts: TransitionOptions = {}
): Promise<TransitionResult> {
  const booking = await getBookingForStaff(ctx.actor, bookingIdOrCode);
  const from = booking.status as BookingStatus;
  if (from === to) throw badRequest(`This reservation is already ${BOOKING_STATUS[to].label.toLowerCase()}.`);
  const rule = TRANSITIONS[from].find((t) => t.to === to);
  if (!rule) throw badRequest(`A ${BOOKING_STATUS[from].label.toLowerCase()} reservation can't move to ${BOOKING_STATUS[to].label.toLowerCase()}.`);
  requirePermission(ctx.actor, rule.perm);
  const check = await checkTransition(ctx.actor, booking, to);
  if (!check.ok) throw badRequest(check.reason);

  const today = hotelToday();
  const effects: string[] = [];
  const data: Prisma.BookingUpdateInput = { status: to };
  let historyNote = opts.note?.trim() || '';

  if (to === 'CHECKED_IN') {
    const roomId = opts.roomId ?? booking.roomId ?? (await suggestRooms(ctx.actor, booking.id, {}, { requireReady: !opts.allowDirtyRoom }))[0]?.room.id;
    if (!roomId) {
      throw conflict(`No ${booking.roomType.name} room is ready. Assign a room or ask housekeeping to prioritise one.`);
    }
    const room = await validateRoomForBooking(booking, roomId, { requireReady: !opts.allowDirtyRoom });
    data.room = { connect: { id: room.id } };
    effects.push(`Room ${room.roomNumber} assigned`);
  }

  if (to === 'CHECKED_OUT' && today < toISODate(booking.checkOut)) {
    // Early departure: release the unused nights back to inventory.
    const newOut = today > toISODate(booking.checkIn) ? today : addDaysISO(toISODate(booking.checkIn), 1);
    data.checkOut = atNoonUTC(newOut);
    effects.push(`Early departure — stay shortened to ${formatDay(newOut)}`);
    historyNote = [historyNote, `Early check-out (was due ${formatDay(toISODate(booking.checkOut))})`].filter(Boolean).join(' · ');
  }

  if ((to === 'CANCELLED' || to === 'NO_SHOW') && booking.roomId) {
    data.room = { disconnect: true };
    effects.push('Room assignment released');
  }

  if (to === 'CONFIRMED' && (from === 'CANCELLED' || from === 'NO_SHOW')) {
    const inv = await nightlyInventory(prisma, booking.roomTypeId, toISODate(booking.checkIn), toISODate(booking.checkOut), { excludeBookingId: booking.id });
    if (inv.minAvailable < booking.rooms) throw conflict('Not enough rooms are free to reinstate this reservation.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.update({ where: { id: booking.id }, data, include: bookingInclude });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        status: to,
        notes: [VERB[to] ?? to, `by ${ctx.actor.name}`, ctx.source === 'agent' ? 'via agent' : null, historyNote || null]
          .filter(Boolean)
          .join(' · '),
      },
    });
    if (to === 'CHECKED_OUT' && b.roomId) {
      await tx.room.update({ where: { id: b.roomId }, data: { status: 'DIRTY' } });
      const open = await tx.roomHousekeeping.findFirst({ where: { roomId: b.roomId, status: { in: ['PENDING', 'IN_PROGRESS'] } } });
      if (!open) {
        await tx.roomHousekeeping.create({
          data: { roomId: b.roomId, status: 'PENDING', priority: 2, notes: `Departure clean after ${b.code ?? 'stay'}` },
        });
      }
    }
    return b;
  });

  if (to === 'CHECKED_OUT' && updated.room) effects.push(`Room ${updated.room.roomNumber} marked dirty and queued for housekeeping`);

  const summary = toBookingSummary(updated);
  await recordAudit(ctx, booking.propertyId, `BOOKING_${to}`, `${VERB[to] ?? to} ${summary.guest.name} (${summary.code})`, {
    bookingId: booking.id,
    from,
    to,
    effects,
  });
  return { booking: summary, from, to, effects };
}

// ---------------------------------------------------------------------------
// Rooms for a booking
// ---------------------------------------------------------------------------

export interface RoomPreferences {
  highFloor?: boolean;
  lowFloor?: boolean;
  tags?: string[];
  roomNumber?: string;
}

export interface RoomSuggestion {
  room: { id: string; number: string; floor: string | null; status: string; tags: string[] };
  score: number;
  reasons: string[];
  ready: boolean;
}

async function roomIsFree(roomId: string, checkIn: ISODate, checkOut: ISODate, excludeBookingId: string): Promise<boolean> {
  const clash = await prisma.booking.findFirst({
    where: {
      roomId,
      id: { not: excludeBookingId },
      status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
      checkIn: { lt: atNoonUTC(checkOut) },
      checkOut: { gt: atNoonUTC(checkIn) },
    },
    select: { id: true },
  });
  return !clash;
}

async function validateRoomForBooking(booking: BookingWithRelations, roomId: string, opts: { requireReady: boolean }) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.propertyId !== booking.propertyId) throw notFound('Room');
  if (room.roomTypeId !== booking.roomTypeId) {
    throw badRequest(`Room ${room.roomNumber} is not a ${booking.roomType.name}.`);
  }
  if (room.isOutOfOrder) throw conflict(`Room ${room.roomNumber} is out of order${room.outOfOrderReason ? ` (${room.outOfOrderReason})` : ''}.`);
  if (!(await roomIsFree(room.id, toISODate(booking.checkIn), toISODate(booking.checkOut), booking.id))) {
    throw conflict(`Room ${room.roomNumber} is already assigned to another guest for those nights.`);
  }
  if (opts.requireReady && room.status === 'DIRTY') {
    throw conflict(`Room ${room.roomNumber} is still dirty. Pick a clean room or override.`, { roomId: room.id, dirty: true });
  }
  return room;
}

/**
 * Rank rooms of the booking's type for this stay, honouring preferences
 * like "high floor" or "quiet". Only rooms free for every night are returned.
 */
export async function suggestRooms(
  actor: Actor,
  bookingIdOrCode: string,
  prefs: RoomPreferences = {},
  opts: { requireReady?: boolean; limit?: number } = {}
): Promise<RoomSuggestion[]> {
  const booking = await getBookingForStaff(actor, bookingIdOrCode);
  const checkIn = toISODate(booking.checkIn);
  const checkOut = toISODate(booking.checkOut);
  const rooms = await prisma.room.findMany({
    where: { propertyId: booking.propertyId, roomTypeId: booking.roomTypeId, isOutOfOrder: false },
  });
  const busy = await prisma.booking.findMany({
    where: {
      roomId: { in: rooms.map((r) => r.id) },
      id: { not: booking.id },
      status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
      checkIn: { lt: atNoonUTC(checkOut) },
      checkOut: { gt: atNoonUTC(checkIn) },
    },
    select: { roomId: true },
  });
  const busyIds = new Set(busy.map((b) => b.roomId));
  const free = rooms.filter((r) => !busyIds.has(r.id));
  const maxFloor = Math.max(0, ...free.map((r) => floorNumber(r.floor)));
  const minFloor = Math.min(...free.map((r) => floorNumber(r.floor)), Infinity);
  const wantedTags = (prefs.tags ?? []).map((t) => t.toLowerCase());

  const ranked = free.map((r) => {
    const reasons: string[] = [];
    let score = 0;
    const ready = r.status === 'CLEAN' || r.status === 'INSPECTED';
    if (r.status === 'INSPECTED') {
      score += 30;
      reasons.push('Inspected');
    } else if (r.status === 'CLEAN') {
      score += 25;
      reasons.push('Clean');
    } else {
      reasons.push('Needs cleaning');
    }
    const floor = floorNumber(r.floor);
    if (prefs.highFloor) {
      score += floor * 4;
      if (floor === maxFloor && maxFloor > 0) reasons.push(`Highest free floor (${r.floor})`);
    }
    if (prefs.lowFloor) {
      score -= floor * 4;
      if (floor === minFloor) reasons.push(`Lowest free floor (${r.floor ?? 'ground'})`);
    }
    const tags = r.tags.map((t) => t.toLowerCase());
    for (const t of wantedTags) {
      if (tags.includes(t)) {
        score += 20;
        reasons.push(`Tagged “${t}”`);
      }
    }
    if (booking.roomId === r.id) {
      score += 50;
      reasons.unshift('Already assigned');
    }
    if (prefs.roomNumber && r.roomNumber === prefs.roomNumber) {
      score += 100;
      reasons.unshift('Requested room');
    }
    return { room: { id: r.id, number: r.roomNumber, floor: r.floor, status: r.status, tags: r.tags }, score, reasons, ready };
  });

  return ranked
    .filter((s) => !opts.requireReady || s.ready)
    .sort((a, b) => b.score - a.score || a.room.number.localeCompare(b.room.number, undefined, { numeric: true }))
    .slice(0, opts.limit ?? 8);
}

export async function assignRoom(ctx: OpContext, bookingIdOrCode: string, roomId: string): Promise<BookingSummary> {
  requirePermission(ctx.actor, 'booking.assignRoom');
  const booking = await getBookingForStaff(ctx.actor, bookingIdOrCode);
  if (!['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
    throw badRequest('Rooms can only be assigned to upcoming or in-house reservations.');
  }
  const room = await validateRoomForBooking(booking, roomId, { requireReady: false });
  const updated = await prisma.booking.update({ where: { id: booking.id }, data: { roomId: room.id }, include: bookingInclude });
  const summary = toBookingSummary(updated);
  const moved = booking.room && booking.room.id !== room.id ? ` (moved from ${booking.room.roomNumber})` : '';
  await recordAudit(ctx, booking.propertyId, 'BOOKING_ASSIGN_ROOM', `Assigned room ${room.roomNumber} to ${summary.guest.name}${moved}`, {
    bookingId: booking.id,
    roomId: room.id,
  });
  return summary;
}

export async function addBookingNote(ctx: OpContext, bookingIdOrCode: string, note: string): Promise<BookingSummary> {
  requirePermission(ctx.actor, 'booking.note');
  const clean = note.trim();
  if (!clean) throw badRequest('Note is empty.');
  if (clean.length > 1000) throw badRequest('Notes are limited to 1000 characters.');
  const booking = await getBookingForStaff(ctx.actor, bookingIdOrCode);
  const stamp = `[${hotelToday()} · ${ctx.actor.name}] ${clean}`;
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { notes: booking.notes ? `${booking.notes}\n${stamp}` : stamp },
    include: bookingInclude,
  });
  const summary = toBookingSummary(updated);
  await recordAudit(ctx, booking.propertyId, 'BOOKING_NOTE', `Added a note to ${summary.guest.name} (${summary.code}): “${clean.slice(0, 80)}”`, {
    bookingId: booking.id,
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Day lists
// ---------------------------------------------------------------------------

export async function arrivalsOn(propertyId: string, day: ISODate): Promise<BookingSummary[]> {
  const rows = await prisma.booking.findMany({
    where: {
      propertyId,
      OR: [
        { checkIn: dayBounds(day), status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] } },
        // Late arrivals: due earlier, still not checked in, stay not over.
        { checkIn: { lt: dayBounds(day).gte }, checkOut: { gt: atNoonUTC(day) }, status: { in: ['PENDING', 'CONFIRMED'] } },
      ],
    },
    include: bookingInclude,
    orderBy: [{ checkIn: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toBookingSummary);
}

export async function departuresOn(propertyId: string, day: ISODate): Promise<BookingSummary[]> {
  const rows = await prisma.booking.findMany({
    where: {
      propertyId,
      OR: [
        { checkOut: dayBounds(day), status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } },
        // Overdue departures still in house.
        { checkOut: { lt: dayBounds(day).gte }, status: 'CHECKED_IN' },
      ],
    },
    include: bookingInclude,
    orderBy: [{ checkOut: 'asc' }],
  });
  return rows.map(toBookingSummary);
}

export async function inHouse(propertyId: string): Promise<BookingSummary[]> {
  const rows = await prisma.booking.findMany({
    where: { propertyId, status: 'CHECKED_IN' },
    include: bookingInclude,
    orderBy: [{ checkOut: 'asc' }],
  });
  return rows.map(toBookingSummary);
}
