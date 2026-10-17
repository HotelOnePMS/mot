import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { addBookingNote } from '@/server/services/bookings';

type Params = { params: Promise<{ bookingId: string }> };

/** POST { note } — append a timestamped, attributed note to the reservation. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.note');
  const { note } = await parseJson(request, z.object({ note: z.string().min(1).max(1000) }));
  return json(await addBookingNote({ actor, source: 'classic' }, bookingId, note));
});
