import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { transitionBooking } from '@/server/services/bookings';

type Params = { params: Promise<{ bookingId: string }> };

const schema = z.object({
  status: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW'])),
  notes: z.string().max(500).optional(),
});

/**
 * PUT — staff status change. Kept for API compatibility; delegates to the
 * same lifecycle rules as PATCH /api/admin/bookings/[bookingId].
 */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.view');
  const body = await parseJson(request, schema);
  const result = await transitionBooking({ actor, source: 'classic' }, bookingId, body.status, { note: body.notes });
  return json({ message: `Booking status updated to ${result.to}`, booking: result.booking });
});
