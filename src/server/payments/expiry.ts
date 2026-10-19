/**
 * Unpaid online bookings hold their rooms only for a short time (Booking.expiresAt),
 * then are released. Releases happen three ways, all through here:
 *  - Stripe says the Checkout session expired (webhook),
 *  - the next booking for that room type sweeps what is overdue,
 *  - an optional cron calls /api/cron/expire-bookings.
 */
import { prisma } from '@/lib/prisma';

const RELEASE_NOTE = 'Online payment not completed — rooms released';

/**
 * Cancel a still-unpaid held booking. Several room types booked together are
 * paid with one card payment, so the whole reservation is released together.
 * Returns true if anything was released.
 */
export async function expireUnpaidBooking(bookingId: string): Promise<boolean> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { groupCode: true } });
  const ids = booking?.groupCode ? (await prisma.booking.findMany({ where: { groupCode: booking.groupCode }, select: { id: true } })).map((b) => b.id) : [bookingId];
  let released = false;
  for (const id of ids) {
    const { count } = await prisma.booking.updateMany({
      where: { id, status: 'PENDING', paymentStatus: 'AWAITING_PAYMENT' },
      data: { status: 'CANCELLED', paymentStatus: 'EXPIRED' },
    });
    if (count) await prisma.bookingStatusHistory.create({ data: { bookingId: id, status: 'CANCELLED', notes: RELEASE_NOTE } });
    released ||= count > 0;
  }
  return released;
}

/** Release every held booking whose time is up (optionally only one room type's). Returns how many. */
export async function releaseExpiredHolds(scope: { roomTypeId?: string } = {}): Promise<number> {
  const overdue = await prisma.booking.findMany({
    where: {
      status: 'PENDING',
      paymentStatus: 'AWAITING_PAYMENT',
      expiresAt: { lt: new Date() },
      ...(scope.roomTypeId ? { roomTypeId: scope.roomTypeId } : {}),
    },
    select: { id: true },
    take: 200,
  });
  let released = 0;
  for (const { id } of overdue) if (await expireUnpaidBooking(id)) released++;
  return released;
}
