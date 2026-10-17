import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { BookingStatus } from '@/lib/dto';
import { can, requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { allowedTransitions, getBookingForStaff, transitionBooking } from '@/server/services/bookings';
import { listActivity } from '@/server/services/audit';
import { toBookingSummary } from '@/server/services/mappers';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — reservation detail with history and the actions available now. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.view');
  const booking = await getBookingForStaff(actor, bookingId);
  const [history, activity] = await Promise.all([
    prisma.bookingStatusHistory.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, notes: true, createdAt: true },
    }),
    can(actor, 'activity.view') ? listActivity(booking.propertyId, 50, { bookingId: booking.id }) : Promise.resolve([]),
  ]);
  return json({
    booking: toBookingSummary(booking),
    history: history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
    activity,
    actions: allowedTransitions(booking.status as BookingStatus),
  });
});

const patchSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW']),
  notes: z.string().max(500).optional(),
  roomId: z.string().optional(),
  allowDirtyRoom: z.boolean().optional(),
});

/** PATCH — move the reservation through its lifecycle (check in, check out, ...). */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.view');
  const body = await parseJson(request, patchSchema);
  const result = await transitionBooking({ actor, source: 'classic' }, bookingId, body.status, {
    note: body.notes,
    roomId: body.roomId,
    allowDirtyRoom: body.allowDirtyRoom,
  });
  return json({ ...result, message: `Reservation ${result.booking.code} updated.` });
});
