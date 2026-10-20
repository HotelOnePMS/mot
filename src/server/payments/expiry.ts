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
  // One statement for the whole reservation, so a payment arriving at the same moment finds it all held or all released.
  const released = await prisma.booking.updateManyAndReturn({
    where: { ...(booking?.groupCode ? { groupCode: booking.groupCode } : { id: bookingId }), status: 'PENDING', paymentStatus: 'AWAITING_PAYMENT' },
    data: { status: 'CANCELLED', paymentStatus: 'EXPIRED' },
    select: { id: true },
  });
  if (!released.length) return false;
  await prisma.bookingStatusHistory.createMany({ data: released.map((b) => ({ bookingId: b.id, status: 'CANCELLED' as const, notes: RELEASE_NOTE })) });
  return true;
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
