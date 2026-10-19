/**
 * Reservations taken at the front desk: a walk-in or a phone call. Same
 * booking engine as the website (serializable transaction, live availability,
 * the hotel's prices, taxes and fees), confirmed at once, and optionally
 * checked straight in.
 *
 * The guest: an existing guest account with that email gets the booking in
 * its trips. Anyone else gets a record made for this booking alone (as
 * direct bookings by API key do), with their email kept on the booking.
 */
import { randomUUID } from 'crypto';
import type { BookingSummary, ISODate } from '@/lib/dto';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { INTEGRATION_GUEST_DOMAIN } from '../concierge/booking';
import { diffDays } from '../dates';
import { isEmailConfigured, sendBookingConfirmation } from '../email';
import { badRequest } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { assignRoom, confirmPayAtProperty, createBooking, getBookingForStaff, transitionBooking } from './bookings';
import { todayAt } from './hotels';
import { propertyAvailability, type RoomTypeAvailability } from './inventory';
import { toBookingSummary } from './mappers';

export interface DeskReservationInput {
  propertyId: string;
  roomTypeId: string;
  checkIn: ISODate;
  checkOut: ISODate;
  guests: number;
  rooms: number;
  guest: { firstName: string; lastName: string; email?: string | null; phone?: string | null };
  notes?: string | null;
  /** Paid in full at the desk now, or pay at the hotel later. */
  paid?: boolean;
  /** A specific room (optional; check-in picks the best ready one otherwise). */
  roomId?: string | null;
  /** Arriving now: check the guest in straight away (check-in must be today). */
  checkInNow?: boolean;
  sendConfirmation?: boolean;
}

/** Room types with live availability and the exact price for a stay. */
export async function reservationOptions(actor: Actor, propertyId: string, stay: { checkIn: ISODate; checkOut: ISODate; guests: number; rooms: number }): Promise<RoomTypeAvailability[]> {
  requirePermission(actor, 'booking.create');
  assertPropertyAccess(actor, propertyId);
  if (stay.checkOut <= stay.checkIn) throw badRequest('Check-out must be after check-in.');
  if (diffDays(stay.checkIn, stay.checkOut) > 30) throw badRequest('Reservations at the desk are limited to 30 nights. Split longer stays.');
  return propertyAvailability({ propertyId, ...stay });
}

async function guestFor(input: DeskReservationInput['guest']): Promise<{ userId: string; guestEmail: string | null; created: boolean }> {
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, role: 'CUSTOMER', isActive: true }, select: { id: true } });
    if (existing) return { userId: existing.id, guestEmail: null, created: false };
  }
  const record = await prisma.user.create({
    data: {
      email: `guest-${randomUUID()}@${INTEGRATION_GUEST_DOMAIN}`,
      password: '',
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: input.phone?.trim() || null,
      role: 'CUSTOMER',
      isActive: false,
    },
    select: { id: true },
  });
  return { userId: record.id, guestEmail: email, created: true };
}

export async function createDeskReservation(ctx: OpContext, input: DeskReservationInput): Promise<BookingSummary> {
  const { actor } = ctx;
  requirePermission(actor, 'booking.create');
  assertPropertyAccess(actor, input.propertyId);
  if (input.checkInNow) {
    requirePermission(actor, 'booking.checkin');
    if (input.checkIn !== (await todayAt(input.propertyId))) throw badRequest('Only guests arriving today can be checked in now.');
  }
  if (input.roomId) {
    const room = await prisma.room.findFirst({ where: { id: input.roomId, propertyId: input.propertyId, roomTypeId: input.roomTypeId }, select: { id: true } });
    if (!room) throw badRequest('That room isn’t a room of the chosen type at this hotel.');
  }

  const guest = await guestFor(input.guest);
  const booking = await createBooking({
    userId: guest.userId,
    propertyId: input.propertyId,
    roomTypeId: input.roomTypeId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    rooms: input.rooms,
    notes: input.notes,
    paymentStatus: input.paid ? 'PAID' : 'PAY_AT_PROPERTY',
    createdVia: `Taken at the front desk by ${actor.name}${input.paid ? ' — paid at the desk' : ' — pay at property'}`,
    source: 'FRONT_DESK',
    createdById: actor.userId,
  }).catch(async (e) => {
    // Sold out or refused: don't leave the guest record made for this booking behind.
    if (guest.created) await prisma.user.delete({ where: { id: guest.userId } }).catch(() => undefined);
    throw e;
  });
  if (guest.guestEmail) await prisma.booking.update({ where: { id: booking.id }, data: { guestEmail: guest.guestEmail } });
  await confirmPayAtProperty(booking.id);
  await recordAudit(ctx, input.propertyId, 'BOOKING_CREATED', `New reservation ${booking.code} for ${input.guest.firstName} ${input.guest.lastName}`.trim(), {
    bookingId: booking.id,
    source: 'FRONT_DESK',
    total: Number(booking.totalPrice),
    currency: booking.currency,
  });

  if (input.checkInNow) {
    await transitionBooking(ctx, booking.id, 'CHECKED_IN', { roomId: input.roomId ?? undefined, note: 'Walk-in' });
  } else if (input.roomId) {
    await assignRoom(ctx, booking.id, input.roomId);
  }

  const to = guest.guestEmail ?? (await prisma.user.findUnique({ where: { id: guest.userId }, select: { email: true } }))?.email ?? null;
  if (input.sendConfirmation !== false && to && !to.endsWith(`@${INTEGRATION_GUEST_DOMAIN}`) && isEmailConfigured()) {
    await sendBookingConfirmation({
      to,
      guestName: `${input.guest.firstName} ${input.guest.lastName}`.trim(),
      propertyName: booking.property.name,
      roomTypeName: booking.roomType.name,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: input.guests,
      rooms: input.rooms,
      totalPrice: Number(booking.totalPrice).toFixed(2),
      currency: booking.currency,
      bookingId: booking.code ?? booking.id,
      paymentStatus: input.paid ? 'PAID' : 'PAY_AT_PROPERTY',
    });
  }
  return toBookingSummary(await getBookingForStaff(actor, booking.id));
}
