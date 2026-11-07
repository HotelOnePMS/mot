/**
 * Booking domain service: creation (server-priced, overbooking-safe),
 * lifecycle transitions with side effects, room assignment, notes, search.
 */
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { BookingStatus, BookingSummary, ISODate } from '@/lib/dto';
import { CARD_NUMBER_REFUSED, containsCardNumber } from '@/lib/desk-payments';
import { BOOKING_STATUS, money } from '@/lib/status';
import { MAX_RESERVATION_LINES, MAX_RESERVATION_ROOMS, normalizeLines, splitParty, totalRooms, type BookingLine } from '@/lib/booking-lines';
import { paymentAmountDue, toCents, fromCents, type PaymentPolicy } from '@/lib/payments';
import { HOLD_MINUTES } from '../payments/config';
import { releaseExpiredHolds } from '../payments/expiry';
import { refreshPaymentStatus } from '../payments/record';
import { assertPropertyAccess, can, requirePermission, scopeByProperty, type Actor, type Permission } from '../authz';
import { addDaysISO, atNoonUTC, dayBounds, diffDays, eachNight, formatDay, hotelToday, isISODate, toISODate } from '../dates';
import { badRequest, conflict, DomainError, notFound } from '../errors';
import { scheduleInventorySync } from '../channels/sync';
import { recordAudit, type OpContext } from './audit';
import { localeOf, todayAt } from './hotels';
import { nightlyInventory, quoteStay } from './inventory';
import { attachDoNotRent } from './doNotRent';
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
            // The guest's code finds every room type of a multi-room reservation.
            { groupCode: { equals: text.toUpperCase().replace(/^#/, '') } },
            { id: text },
            { user: { firstName: { contains: text, mode: 'insensitive' } } },
            { user: { lastName: { contains: text, mode: 'insensitive' } } },
            { user: { email: { contains: text, mode: 'insensitive' } } },
            // Direct (API-key) bookings keep the guest's contact email on the booking; the guest record has a placeholder.
            { guestEmail: { contains: text, mode: 'insensitive' } },
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
  return attachDoNotRent(rows.map(toBookingSummary));
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
  /**
   * Online payment: the booking is held (PENDING, AWAITING_PAYMENT) until the
   * amount due now is paid. The amount is worked out from the server's quote.
   */
  onlinePayment?: { policy: PaymentPolicy; depositNights: number };
  /** The cancellation/refund policy the guest accepted, recorded with the booking. */
  policyAcceptance?: { version: string; hash: string; text: string; ip?: string | null; userAgent?: string | null };
  /** Who/what created it, for the status history. */
  createdVia?: string;
  /** WEB | FRONT_DESK | AGENT_API | VOICE (Booking.source). */
  source?: string;
  /** The staff member taking a reservation at the desk. */
  createdById?: string | null;
}

/** A reservation of one or more room types for the same stay and guest. */
export interface CreateReservationInput extends Omit<CreateBookingInput, 'roomTypeId' | 'rooms'> {
  lines: BookingLine[];
}

const MAX_NIGHTS = 30;

/** How long an identical booking counts as the same request (a double tap, or voice and page both booking). */
const DUPLICATE_WINDOW_MS = 60_000;

/** A booking row, flagged when it is the same guest's identical booking from moments ago (returned instead of a new one). */
export type CreatedBooking = BookingWithRelations & { duplicate?: true };

/** A single-room-type booking (one line of `createReservation`). */
export async function createBooking(input: CreateBookingInput): Promise<CreatedBooking> {
  const { roomTypeId, rooms, ...rest } = input;
  const [booking] = await createReservation({ ...rest, lines: [{ roomTypeId, rooms: rooms ?? 1 }] });
  return booking;
}

/**
 * The guest's reservation from moments ago with exactly these lines and party
 * split, lead first; null if there is none. A single line only matches a
 * single booking, several lines only a whole group with none of it cancelled
 * (`recent` holds every row of the guest's recent bookings for the stay).
 */
function sameReservation(recent: BookingWithRelations[], lines: BookingLine[], party: number[]): BookingWithRelations[] | null {
  const want = lines.map((l, i) => `${l.roomTypeId}:${l.rooms}:${party[i]}`).sort().join(',');
  const groups = new Map<string, BookingWithRelations[]>();
  for (const b of recent) {
    const key = b.groupCode ?? `single:${b.id}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  for (const rows of groups.values()) {
    if (rows.length !== lines.length || (lines.length > 1) !== !!rows[0].groupCode) continue;
    if (rows.some((b) => b.status === 'CANCELLED')) continue;
    if (rows.map((b) => `${b.roomTypeId}:${b.rooms}:${b.guests}`).sort().join(',') !== want) continue;
    return [...rows].sort((a, b) => Number(b.code === b.groupCode) - Number(a.code === a.groupCode));
  }
  return null;
}

/**
 * Books one or more room types for the same dates in one go: a booking row
 * per room type, all created in one serializable transaction (all or none),
 * each priced by the server and checked against live inventory. With several
 * lines, every row carries the first row's code as `groupCode`, and that is
 * the code the guest is given. The party is shared out across the lines
 * (`splitParty`). With online payment, every row is held (AWAITING_PAYMENT,
 * the same `expiresAt`) until the one card payment for the reservation
 * arrives; each row's `paymentDue` is its share of that payment. Returns the
 * rows in line order; the first is the lead.
 */
export async function createReservation(input: CreateReservationInput): Promise<CreatedBooking[]> {
  const lines = normalizeLines(input.lines);
  if (!isISODate(input.checkIn) || !isISODate(input.checkOut)) throw badRequest('Dates must be in YYYY-MM-DD format.');
  if (input.checkIn >= input.checkOut) throw badRequest('Check-out must be after check-in.');
  const nights = diffDays(input.checkIn, input.checkOut);
  if (eachNight(input.checkIn, input.checkOut).length !== nights) throw badRequest('Dates must be real calendar days.');
  if (nights > MAX_NIGHTS) throw badRequest(`Stays are limited to ${MAX_NIGHTS} nights online. Please contact the hotel for longer stays.`);
  if (!lines.length) throw badRequest('Choose a room.');
  if (lines.length > MAX_RESERVATION_LINES) throw badRequest(`One booking can include up to ${MAX_RESERVATION_LINES} room types.`);
  const rooms = totalRooms(lines);
  if (lines.some((l) => !Number.isInteger(l.rooms)) || rooms > MAX_RESERVATION_ROOMS) throw badRequest(`Rooms must be between 1 and ${MAX_RESERVATION_ROOMS}.`);
  if (!Number.isInteger(input.guests) || input.guests < 1) throw badRequest('At least one guest is required.');

  const found = await prisma.roomType.findMany({
    where: { id: { in: lines.map((l) => l.roomTypeId) } },
    select: { id: true, name: true, propertyId: true, capacity: true, isActive: true, property: { select: { isActive: true, setupPath: true, phone: true, timezone: true } } },
  });
  const types = lines.map((l) => found.find((t) => t.id === l.roomTypeId));
  for (const roomType of types) {
    if (!roomType || !roomType.isActive || !roomType.property.isActive) throw notFound('Room type');
    if (roomType.propertyId !== input.propertyId) throw badRequest('That room type does not belong to this property.');
    // Voice-only hotels take bookings in their own system; HotelOne only quotes them.
    if (roomType.property.setupPath === 'VOICE') throw badRequest(`This hotel takes bookings directly — please call ${roomType.property.phone}.`);
  }
  const roomTypes = types as NonNullable<(typeof types)[number]>[];
  if (input.checkIn < hotelToday(new Date(), localeOf(roomTypes[0].property).timezone)) throw badRequest('Check-in date cannot be in the past.');
  const party = splitParty(
    input.guests,
    lines.map((l, i) => ({ rooms: l.rooms, capacity: roomTypes[i].capacity }))
  );
  if (!party) {
    if (lines.length === 1) {
      throw badRequest(`${roomTypes[0].name} sleeps up to ${roomTypes[0].capacity} per room. Add another room or choose a larger room type.`);
    }
    throw badRequest(
      input.guests < lines.length
        ? 'Each room type in a booking needs at least one guest.'
        : `These rooms sleep up to ${lines.reduce((s, l, i) => s + l.rooms * roomTypes[i].capacity, 0)} guests. Add a room or choose larger rooms.`
    );
  }

  // Unpaid online bookings past their hold free their rooms before we count what is left.
  for (const line of lines) await releaseExpiredHolds({ roomTypeId: line.roomTypeId });

  // Serializable transaction: two guests racing for the last room cannot
  // both succeed. Retries on serialization failures and code collisions,
  // after a short random pause so racing requests don't collide again.
  const ATTEMPTS = 6;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.random() * 40 * attempt));
    try {
      const booked: CreatedBooking[] = await prisma.$transaction(
        async (tx) => {
          // The same guest booking the same stay moments ago (a double tap, or voice and page both booking) gets that booking back.
          // Every room type of those bookings is fetched, so a reservation only matches as a whole.
          const recent = await tx.booking.findMany({
            where: {
              userId: input.userId,
              propertyId: input.propertyId,
              checkIn: atNoonUTC(input.checkIn),
              checkOut: atNoonUTC(input.checkOut),
              paymentStatus: input.paymentStatus ?? 'UNPAID',
              createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
            },
            include: bookingInclude,
          });
          const same = sameReservation(recent, lines, party);
          if (same) return same.map((b) => ({ ...b, duplicate: true as const }));

          const leadCode = generateBookingCode();
          const holdUntil = new Date(Date.now() + HOLD_MINUTES * 60_000);
          const priced = [];
          for (const [i, line] of lines.entries()) {
            const roomType = roomTypes[i];
            const inventory = await nightlyInventory(tx, line.roomTypeId, input.checkIn, input.checkOut);
            if (inventory.minAvailable < line.rooms) {
              throw conflict(
                inventory.minAvailable === 0
                  ? `${roomType.name} is sold out for those dates.`
                  : `Only ${inventory.minAvailable} ${roomType.name} room${inventory.minAvailable === 1 ? '' : 's'} left for those dates.`,
                { available: inventory.minAvailable, roomTypeId: line.roomTypeId }
              );
            }
            const quote = await quoteStay(tx, { roomTypeId: line.roomTypeId, checkIn: input.checkIn, checkOut: input.checkOut, rooms: line.rooms, guests: party[i] });
            const due = input.onlinePayment
              ? paymentAmountDue({
                  policy: input.onlinePayment.policy,
                  depositNights: input.onlinePayment.depositNights,
                  nightlyCents: quote.nights.map((n) => toCents(n.price)),
                  rooms: line.rooms,
                  totalCents: toCents(quote.total),
                })
              : null;
            priced.push({ line, quote, dueCents: due?.dueNowCents ?? 0 });
          }
          // One card payment covers every room type, so the whole reservation is held until it is paid.
          const online = priced.some((x) => x.dueCents > 0);
          const created: BookingWithRelations[] = [];
          for (const [i, { line, quote, dueCents }] of priced.entries()) {
            created.push(
              await tx.booking.create({
                data: {
                  userId: input.userId,
                  propertyId: input.propertyId,
                  roomTypeId: line.roomTypeId,
                  checkIn: atNoonUTC(input.checkIn),
                  checkOut: atNoonUTC(input.checkOut),
                  guests: party[i],
                  rooms: line.rooms,
                  totalPrice: quote.total,
                  currency: quote.currency,
                  subtotalPrice: quote.subtotal,
                  charges: quote.charges.length ? (quote.charges as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
                  source: input.source ?? 'WEB',
                  createdById: input.createdById ?? null,
                  status: 'PENDING',
                  paymentStatus: online ? 'AWAITING_PAYMENT' : (input.paymentStatus ?? 'UNPAID'),
                  ...(online ? { paymentDue: fromCents(dueCents), expiresAt: holdUntil } : {}),
                  ...(input.policyAcceptance
                    ? {
                        policyAcceptance: {
                          create: {
                            version: input.policyAcceptance.version,
                            hash: input.policyAcceptance.hash,
                            text: input.policyAcceptance.text,
                            ip: input.policyAcceptance.ip ?? null,
                            userAgent: input.policyAcceptance.userAgent?.slice(0, 300) ?? null,
                          },
                        },
                      }
                    : {}),
                  code: i === 0 ? leadCode : generateBookingCode(),
                  groupCode: lines.length > 1 ? leadCode : null,
                  // Special requests are for the whole party: on every room type, so the desk sees them whichever room it handles.
                  notes: input.notes?.trim() || null,
                  statusHistory: {
                    create: {
                      status: 'PENDING',
                      notes: [
                        online ? 'Booked online — awaiting card payment' : (input.createdVia ?? 'Booking created'),
                        lines.length > 1 ? `part of reservation ${leadCode} (${lines.length} room types)` : null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    },
                  },
                },
                include: bookingInclude,
              })
            );
          }
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      // OTAs see fewer rooms on these nights (nothing changed if this was a repeat of a booking just made).
      if (!booked[0]?.duplicate) for (const b of booked) scheduleInventorySync(b.roomTypeId, b.checkIn, b.checkOut);
      return booked;
    } catch (e) {
      const retryable =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === 'P2034' || (e.code === 'P2002' && String(e.meta?.target ?? '').includes('code')));
      if (!retryable) throw e;
    }
  }
  throw new DomainError(503, 'BUSY', 'The hotel is busy right now — please try again.');
}

/** The other bookings in the same multi-room-type reservation (empty for a single booking). */
export async function reservationSiblings(b: { id: string; groupCode: string | null }): Promise<BookingWithRelations[]> {
  if (!b.groupCode) return [];
  return prisma.booking.findMany({ where: { groupCode: b.groupCode, id: { not: b.id } }, include: bookingInclude, orderBy: { createdAt: 'asc' } });
}

/** Confirms every pay-at-property line of a reservation (see `confirmPayAtProperty`). */
export async function confirmReservationPayAtProperty(bookingIds: string[]) {
  return Promise.all(bookingIds.map((id) => confirmPayAtProperty(id)));
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
  const recent = await prisma.booking.findMany({ where: { userId, createdAt: { gte: new Date(Date.now() - 3600_000) } }, select: { id: true, groupCode: true } });
  // A reservation of several room types is one confirmation.
  return new Set(recent.map((b) => b.groupCode ?? b.id)).size <= 5;
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
  /**
   * Extra writes that must commit or fail together with the transition (the guided check-in's ID,
   * registration card and deposit). Runs inside the same transaction, after the booking is updated.
   */
  inTransaction?: (tx: Prisma.TransactionClient, booking: BookingWithRelations) => Promise<void>;
  /** Check out with money still owed (managers: booking.checkoutWithBalance), saying why: billed to a company, paying later. */
  balanceOverride?: { reason: string };
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
  to: BookingStatus,
  opts: Pick<TransitionOptions, 'balanceOverride'> = {}
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const from = booking.status as BookingStatus;
  const rule = TRANSITIONS[from].find((t) => t.to === to);
  if (!rule) {
    return { ok: false, reason: `A ${BOOKING_STATUS[from].label.toLowerCase()} reservation can't be ${VERB[to]?.toLowerCase() ?? to.toLowerCase()}.` };
  }
  if (!can(actor, rule.perm)) return { ok: false, reason: 'Your role cannot perform this action.' };
  const today = await todayAt(booking.propertyId);
  const checkIn = toISODate(booking.checkIn);
  const checkOut = toISODate(booking.checkOut);
  if (to === 'CHECKED_IN') {
    if (today < checkIn) return { ok: false, reason: `This stay starts ${formatDay(checkIn, 'weekday')}. Check-in opens on the arrival day.` };
    if (today >= checkOut) return { ok: false, reason: `This stay ended ${formatDay(checkOut, 'weekday')}.` };
  }
  if (to === 'NO_SHOW' && today < checkIn) {
    return { ok: false, reason: `The guest isn't due until ${formatDay(checkIn, 'weekday')}.` };
  }
  // A guest checks out only once nothing is left to pay (online, at the desk, or recorded as paid another way), unless a
  // manager checks them out with it owing and says why.
  if (to === 'CHECKED_OUT') {
    const { checkOutDue, currency, reservationCode } = toBookingSummary(booking);
    if (checkOutDue > 0.004) {
      const owed = `${money(checkOutDue, { currency })}${reservationCode ? ` on reservation ${reservationCode}` : ''}`;
      const manager = can(actor, 'booking.checkoutWithBalance');
      if (!opts.balanceOverride) {
        return { ok: false, reason: `There’s a balance of ${owed} to collect before the guest can check out.${manager ? ' Or check them out with it owing, saying why, from the check-out screen.' : ' A manager can check them out with it owing.'}` };
      }
      if (!manager) return { ok: false, reason: `Only a manager can check a guest out with a balance (${owed} owing).` };
      const why = opts.balanceOverride.reason.replace(/\s+/g, ' ').trim();
      if (why.length < 3) return { ok: false, reason: 'Say why the guest checks out with the balance owing (for example “billed to Acme Corp”).' };
      if (containsCardNumber(why)) return { ok: false, reason: CARD_NUMBER_REFUSED };
    }
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
  const check = await checkTransition(ctx.actor, booking, to, { balanceOverride: opts.balanceOverride });
  if (!check.ok) throw badRequest(check.reason);
  // Checking out owing money (a manager said why): what was owed, kept with the reason. The guest's history doesn't say.
  const owing = to === 'CHECKED_OUT' && opts.balanceOverride ? toBookingSummary(booking).checkOutDue : 0;
  const owingReason = opts.balanceOverride?.reason.replace(/\s+/g, ' ').trim().slice(0, 200) ?? '';

  const today = await todayAt(booking.propertyId);
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
    // Only from the status we checked: a double tap or an agent plan running at the same moment can't apply it twice.
    const b = await tx.booking.update({ where: { id: booking.id, status: from }, data, include: bookingInclude }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw conflict('This reservation was just changed by someone else. Reload and try again.');
      throw e;
    });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        status: to,
        notes: [VERB[to] ?? to, `by ${ctx.actor.name}`, ctx.source === 'agent' ? 'via agent' : null, historyNote || null]
          .filter(Boolean)
          .join(' · '),
      },
    });
    if (opts.inTransaction) await opts.inTransaction(tx, b);
    if (owing > 0.004) {
      const record = { amount: owing, currency: booking.currency, reason: owingReason, approvedById: ctx.actor.userId, createdAt: new Date() };
      await tx.checkoutOverride.upsert({ where: { bookingId: booking.id }, create: { bookingId: booking.id, propertyId: booking.propertyId, ...record }, update: record });
    }
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

  // Cancellations, no-shows, reinstatements and early departures change what OTAs can sell.
  const occupying = (s: BookingStatus) => !['CANCELLED', 'NO_SHOW'].includes(s);
  if (occupying(from) !== occupying(to) || data.checkOut) {
    scheduleInventorySync(booking.roomTypeId, booking.checkIn, booking.checkOut);
  }

  if (to === 'CHECKED_OUT' && updated.room) effects.push(`Room ${updated.room.roomNumber} marked dirty and queued for housekeeping`);
  // A room type cancelled, a no-show or reinstated changes how a reservation's payments are shared: each line's status.
  if (booking.groupCode && occupying(from) !== occupying(to)) await refreshPaymentStatus(booking);

  const summary = toBookingSummary(updated);
  await recordAudit(ctx, booking.propertyId, `BOOKING_${to}`, `${VERB[to] ?? to} ${summary.guest.name} (${summary.code})`, {
    bookingId: booking.id,
    from,
    to,
    effects,
  });
  if (owing > 0.004) {
    await recordAudit(ctx, booking.propertyId, 'CHECKOUT_WITH_BALANCE', `Checked ${summary.guest.name} out with ${money(owing, { currency: booking.currency })} owing (${summary.code}): ${owingReason}`, { bookingId: booking.id });
  }
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
  const stamp = `[${await todayAt(booking.propertyId)} · ${ctx.actor.name}] ${clean}`;
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
  return attachDoNotRent(rows.map(toBookingSummary));
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
  return attachDoNotRent(rows.map(toBookingSummary));
}

export async function inHouse(propertyId: string): Promise<BookingSummary[]> {
  const rows = await prisma.booking.findMany({
    where: { propertyId, status: 'CHECKED_IN' },
    include: bookingInclude,
    orderBy: [{ checkOut: 'asc' }],
  });
  return attachDoNotRent(rows.map(toBookingSummary));
}
