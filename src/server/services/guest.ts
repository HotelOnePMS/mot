/**
 * Guest self-service: view, change dates and cancel your own reservation,
 * under the hotel's policy (free changes until 3 PM hotel time the day
 * before arrival). Staff use the booking service instead.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { roundMoney } from '@/lib/currency';
import type { ISODate } from '@/lib/dto';
import { isStaffRole } from '@/lib/routes';
import type { Actor } from '../authz';
import { hasPropertyAccess } from '../authz';
import { money } from '@/lib/status';
import { HOTEL_TIMEZONE, addDaysISO, atNoonUTC, diffDays, formatDay, hotelToday, hourIn, isISODate, toISODate } from '../dates';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { scheduleInventorySync } from '../channels/sync';
import { recordAudit } from './audit';
import { localeOf } from './hotels';
import { nightlyInventory, quoteStay } from './inventory';

const POLICY_HOUR = 15; // 3 PM hotel time, the day before arrival

/** Free cancellation / check-in changes end at 3 PM on the hotel's clock the day before arrival. */
export function policyFor(checkIn: ISODate, timezone: string = HOTEL_TIMEZONE, now = new Date()) {
  const deadlineDay = addDaysISO(checkIn, -1);
  const today = hotelToday(now, timezone);
  const passed = today > deadlineDay || (today === deadlineDay && hourIn(timezone, now) >= POLICY_HOUR);
  return { deadlineDay, deadlineLabel: `3:00 PM on ${formatDay(deadlineDay, 'weekday')}`, passed };
}

async function loadOwnBooking(actor: Actor, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      property: {
        select: { id: true, name: true, address: true, city: true, state: true, zipCode: true, phone: true, email: true, primaryColor: true, timezone: true, currency: true, photos: { where: { isMain: true }, take: 1, select: { url: true } } },
      },
      roomType: { select: { id: true, name: true, capacity: true, amenities: true, photos: { orderBy: { isMain: 'desc' }, take: 1, select: { url: true } } } },
      room: { select: { roomNumber: true } },
      statusHistory: { orderBy: { createdAt: 'asc' }, select: { status: true, notes: true, createdAt: true } },
    },
  });
  if (!booking) throw notFound('Booking');
  const isOwner = booking.userId === actor.userId;
  const isStaff = isStaffRole(actor.role) && hasPropertyAccess(actor, booking.propertyId);
  if (!isOwner && !isStaff) throw forbidden("This booking belongs to another account.");
  return { booking, isStaff };
}

export async function getGuestBooking(actor: Actor, bookingId: string) {
  const { booking, isStaff } = await loadOwnBooking(actor, bookingId);
  const checkIn = toISODate(booking.checkIn);
  const checkOut = toISODate(booking.checkOut);
  const { timezone } = localeOf(booking.property);
  const policy = policyFor(checkIn, timezone);
  const upcoming = booking.status === 'CONFIRMED' || booking.status === 'PENDING';
  const today = hotelToday(new Date(), timezone);
  const { stripeCheckoutSessionId: _s, stripePaymentIntentId: _p, ...rest } = booking;
  return {
    ...rest,
    reservation: await reservationFor(booking),
    code: booking.code ?? booking.id.slice(-8).toUpperCase(),
    checkIn,
    checkOut,
    nights: diffDays(checkIn, checkOut),
    totalPrice: Number(booking.totalPrice),
    subtotalPrice: booking.subtotalPrice === null ? Number(booking.totalPrice) : Number(booking.subtotalPrice),
    charges: Array.isArray(booking.charges) ? booking.charges : [],
    statusHistory: booking.statusHistory.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
    policy,
    canCancel: upcoming && (isStaff || !policy.passed),
    canModifyCheckIn: upcoming && (isStaff || !policy.passed),
    canModifyCheckOut: (upcoming || booking.status === 'CHECKED_IN') && today < checkOut,
    canModify: (upcoming || booking.status === 'CHECKED_IN') && today < checkOut,
    cancellationDeadline: policy.deadlineLabel,
  };
}

/**
 * A multi-room-type reservation as the guest sees it: the code they were
 * given and every room type in it (this one included), or null for a
 * single booking. Each room type is still its own booking: it can be
 * changed or cancelled on its own.
 */
async function reservationFor(b: { id: string; groupCode: string | null; userId: string }) {
  if (!b.groupCode) return null;
  const lines = await prisma.booking.findMany({
    where: { groupCode: b.groupCode, userId: b.userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true, status: true, rooms: true, guests: true, totalPrice: true, roomType: { select: { name: true } } },
  });
  const live = lines.filter((l) => l.status !== 'CANCELLED' && l.status !== 'NO_SHOW');
  return {
    code: b.groupCode,
    totalPrice: live.reduce((s, l) => s + Number(l.totalPrice), 0),
    rooms: live.reduce((s, l) => s + l.rooms, 0),
    guests: live.reduce((s, l) => s + l.guests, 0),
    lines: lines.map((l) => ({ id: l.id, code: l.code, status: l.status, rooms: l.rooms, guests: l.guests, totalPrice: Number(l.totalPrice), roomTypeName: l.roomType.name, current: l.id === b.id })),
  };
}

export async function cancelOwnBooking(actor: Actor, bookingId: string, reason?: string) {
  const { booking, isStaff } = await loadOwnBooking(actor, bookingId);
  if (booking.status === 'CANCELLED') throw badRequest('This booking is already cancelled.');
  if (!['PENDING', 'CONFIRMED'].includes(booking.status)) throw badRequest('This stay has already started, so it can’t be cancelled online. Please contact the hotel.');
  const policy = policyFor(toISODate(booking.checkIn), localeOf(booking.property).timezone);
  if (policy.passed && !isStaff) {
    throw badRequest(`Free cancellation ended at ${policy.deadlineLabel}. Please contact the hotel.`);
  }
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: 'CANCELLED',
      roomId: null,
      statusHistory: { create: { status: 'CANCELLED', notes: reason?.trim() ? `Cancelled by guest: ${reason.trim().slice(0, 300)}` : 'Cancelled by guest' } },
    },
  });
  scheduleInventorySync(booking.roomTypeId, booking.checkIn, booking.checkOut);
  await recordAudit({ actor, source: 'classic' }, booking.propertyId, 'BOOKING_CANCELLED', `${booking.user.firstName} ${booking.user.lastName} cancelled ${booking.code ?? 'their booking'} online`, {
    bookingId: booking.id,
  });
  return updated;
}

export async function changeOwnStayDates(actor: Actor, bookingId: string, input: { newCheckIn?: string; newCheckOut?: string }) {
  const { booking, isStaff } = await loadOwnBooking(actor, bookingId);
  if (!input.newCheckIn && !input.newCheckOut) throw badRequest('Choose a new check-in or check-out date.');
  for (const d of [input.newCheckIn, input.newCheckOut]) if (d && !isISODate(d)) throw badRequest('Dates must be YYYY-MM-DD.');
  const oldIn = toISODate(booking.checkIn);
  const oldOut = toISODate(booking.checkOut);
  const newIn = input.newCheckIn ?? oldIn;
  const newOut = input.newCheckOut ?? oldOut;
  const { timezone } = localeOf(booking.property);
  const today = hotelToday(new Date(), timezone);
  const inHouse = booking.status === 'CHECKED_IN';

  if (!['PENDING', 'CONFIRMED'].includes(booking.status) && !inHouse) throw badRequest('This booking can no longer be changed online.');
  if (newIn >= newOut) throw badRequest('Check-out must be after check-in.');
  if (diffDays(newIn, newOut) > 30) throw badRequest('Stays are limited to 30 nights online.');
  if (newIn !== oldIn) {
    if (inHouse) throw badRequest('Your stay has started, so only the check-out date can change.');
    if (newIn < today) throw badRequest('Check-in can’t be in the past.');
    if (!isStaff && policyFor(oldIn, timezone).passed) throw badRequest(`Check-in changes closed at ${policyFor(oldIn, timezone).deadlineLabel}. You can still change your check-out.`);
    if (!isStaff && policyFor(newIn, timezone).passed) throw badRequest('That new check-in is too soon to change online. Please call the hotel.');
  }
  if (newOut <= today) throw badRequest('Check-out must be after today.');
  // The hotel lowered what this stay costs (an allowance, for unused nights say): a guest shortening it online would
  // take the same nights off twice, so the hotel does it (staff see the folio). Extensions go ahead.
  if (!isStaff && (newIn > oldIn || newOut < oldOut) && (await prisma.folioAllowance.count({ where: { bookingId: booking.id, voidedAt: null } }))) {
    throw badRequest('The hotel has adjusted the price of this stay, so it can’t be shortened online. Please contact the hotel.');
  }

  const inv = await nightlyInventory(prisma, booking.roomTypeId, newIn, newOut, { excludeBookingId: booking.id });
  if (inv.minAvailable < booking.rooms) {
    const full = Object.entries(inv.soldByNight)
      .filter(([, sold]) => inv.total - sold < booking.rooms)
      .map(([d]) => formatDay(d));
    throw conflict(`${booking.roomType.name} isn’t available on ${full.join(', ')}. Try different dates.`);
  }
  // Keep the assigned room only if it's still free for the new nights.
  let keepRoom = !!booking.roomId;
  if (booking.roomId) {
    const clash = await prisma.booking.findFirst({
      where: {
        roomId: booking.roomId,
        id: { not: booking.id },
        status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lt: atNoonUTC(newOut) },
        checkOut: { gt: atNoonUTC(newIn) },
      },
      select: { id: true },
    });
    keepRoom = !clash;
    if (!keepRoom && inHouse) throw conflict('Your room is booked after your current check-out. Please ask the front desk about extending.');
  }
  const quote = await quoteStay(prisma, { roomTypeId: booking.roomTypeId, checkIn: newIn, checkOut: newOut, rooms: booking.rooms, guests: booking.guests });
  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      checkIn: atNoonUTC(newIn),
      checkOut: atNoonUTC(newOut),
      totalPrice: quote.total,
      currency: quote.currency,
      subtotalPrice: quote.subtotal,
      charges: quote.charges.length ? (quote.charges as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      ...(keepRoom ? {} : { roomId: null }),
      statusHistory: {
        create: { status: booking.status, notes: `Dates changed ${formatDay(oldIn)}–${formatDay(oldOut)} → ${formatDay(newIn)}–${formatDay(newOut)} (new total ${money(quote.total, { currency: quote.currency })})` },
      },
    },
  });
  // Both the nights given up and the nights taken change on the OTAs.
  scheduleInventorySync(booking.roomTypeId, newIn < oldIn ? newIn : oldIn, newOut > oldOut ? newOut : oldOut);
  await recordAudit({ actor, source: 'classic' }, booking.propertyId, 'BOOKING_DATES', `${booking.code ?? 'Booking'} moved to ${formatDay(newIn)}–${formatDay(newOut)}`, {
    bookingId: booking.id,
  });
  return {
    ...updated,
    checkIn: newIn,
    checkOut: newOut,
    totalPrice: quote.total,
    previousTotal: Number(booking.totalPrice),
    priceDifference: roundMoney(quote.total - Number(booking.totalPrice), quote.currency),
  };
}
