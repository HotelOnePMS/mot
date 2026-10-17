import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { cancelOwnBooking } from '@/server/services/guest';

type Params = { params: Promise<{ bookingId: string }> };

/** PUT { reason? } — cancel your own booking within the free-cancellation window. */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireActor();
  const body = z.object({ reason: z.string().max(300).optional() }).catch({}).parse(await request.json().catch(() => ({})));
  const booking = await cancelOwnBooking(actor, bookingId, body.reason);
  return json({ message: 'Booking cancelled successfully', booking: { id: booking.id, status: booking.status } });
});
