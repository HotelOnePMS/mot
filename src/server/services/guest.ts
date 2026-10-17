/**
 * Guest self-service: view, change dates and cancel your own reservation,
 * under the hotel's policy (free changes until 3 PM hotel time the day
 * before arrival). Staff use the booking service instead.
 */
import { prisma } from '@/lib/prisma';
import type { ISODate } from '@/lib/dto';
import { isStaffRole } from '@/lib/routes';
import type { Actor } from '../authz';
import { hasPropertyAccess } from '../authz';
import { HOTEL_TIMEZONE, addDaysISO, atNoonUTC, diffDays, formatDay, hotelToday, isISODate, toISODate } from '../dates';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { recordAudit } from './audit';
import { nightlyInventory, quoteStay } from './inventory';

const POLICY_HOUR = 15; // 3 PM hotel time, the day before arrival

function hotelHour(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: HOTEL_TIMEZONE, hour: 'numeric', hourCycle: 'h23' }).format(now)
  );
}

/** Free cancellation / check-in changes end at 3 PM hotel time the day before arrival. */
export function policyFor(checkIn: ISODate, now = new Date()) {
  const deadlineDay = addDaysISO(checkIn, -1);
  const today = hotelToday(now);
  const passed = today > deadlineDay || (today === deadlineDay && hotelHour(now) >= POLICY_HOUR);
  return { deadlineDay, deadlineLabel: `3:00 PM on ${formatDay(deadlineDay, 'weekday')}`, passed };
}

async function loadOwnBooking(actor: Actor, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      property: {
        select: { id: true, name: true, address: true, city: true, state: true, zipCode: true, phone: true, email: true, primaryColor: true, photos: { where: { isMain: true }, take: 1, select: { url: true } } },
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
  const policy = policyFor(checkIn);
  const upcoming = booking.status === 'CONFIRMED' || booking.status === 'PENDING';
  const today = hotelToday();
  const { stripeCheckoutSessionId: _s, stripePaymentIntentId: _p, ...rest } = booking;
  return {
    ...rest,
    code: booking.code ?? booking.id.slice(-8).toUpperCase(),
    checkIn,
    checkOut,
    nights: diffDays(checkIn, checkOut),
    totalPrice: Number(booking.totalPrice),
    statusHistory: booking.statusHistory.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
    policy,
    canCancel: upcoming && (isStaff || !policy.passed),
    canModifyCheckIn: upcoming && (isStaff || !policy.passed),
    canModifyCheckOut: (upcoming || booking.status === 'CHECKED_IN') && today < checkOut,
    canModify: (upcoming || booking.status === 'CHECKED_IN') && today < checkOut,
    cancellationDeadline: policy.deadlineLabel,
  };
}

export async function cancelOwnBooking(actor: Actor, bookingId: string, reason?: string) {
  const { booking, isStaff } = await loadOwnBooking(actor, bookingId);
  if (booking.status === 'CANCELLED') throw badRequest('This booking is already cancelled.');
  if (!['PENDING', 'CONFIRMED'].includes(booking.status)) throw badRequest('This stay has already started, so it can’t be cancelled online. Please contact the hotel.');
  const policy = policyFor(toISODate(booking.checkIn));
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
  const today = hotelToday();
  const inHouse = booking.status === 'CHECKED_IN';

  if (!['PENDING', 'CONFIRMED'].includes(booking.status) && !inHouse) throw badRequest('This booking can no longer be changed online.');
  if (newIn >= newOut) throw badRequest('Check-out must be after check-in.');
  if (diffDays(newIn, newOut) > 30) throw badRequest('Stays are limited to 30 nights online.');
  if (newIn !== oldIn) {
    if (inHouse) throw badRequest('Your stay has started, so only the check-out date can change.');
    if (newIn < today) throw badRequest('Check-in can’t be in the past.');
    if (!isStaff && policyFor(oldIn).passed) throw badRequest(`Check-in changes closed at ${policyFor(oldIn).deadlineLabel}. You can still change your check-out.`);
    if (!isStaff && policyFor(newIn).passed) throw badRequest('That new check-in is too soon to change online. Please call the hotel.');
  }
  if (newOut <= today) throw badRequest('Check-out must be after today.');

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
      ...(keepRoom ? {} : { roomId: null }),
      statusHistory: {
        create: { status: booking.status, notes: `Dates changed ${formatDay(oldIn)}–${formatDay(oldOut)} → ${formatDay(newIn)}–${formatDay(newOut)} (new total $${quote.total.toFixed(2)})` },
      },
    },
  });
  await recordAudit({ actor, source: 'classic' }, booking.propertyId, 'BOOKING_DATES', `${booking.code ?? 'Booking'} moved to ${formatDay(newIn)}–${formatDay(newOut)}`, {
    bookingId: booking.id,
  });
  return {
    ...updated,
    checkIn: newIn,
    checkOut: newOut,
    totalPrice: quote.total,
    previousTotal: Number(booking.totalPrice),
    priceDifference: Math.round((quote.total - Number(booking.totalPrice)) * 100) / 100,
  };
}
