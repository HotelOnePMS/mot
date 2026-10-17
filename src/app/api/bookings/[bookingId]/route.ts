import { NextRequest } from 'next/server';
import { requireActor } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { getGuestBooking } from '@/server/services/guest';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — a guest's own booking with the policy flags the UI needs. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireActor();
  return json(await getGuestBooking(actor, bookingId), { headers: { 'Cache-Control': 'no-store' } });
});
