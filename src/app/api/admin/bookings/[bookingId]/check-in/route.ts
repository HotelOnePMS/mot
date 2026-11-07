import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { clientIp, handleRoute, json, parseJson } from '@/server/http';
import { completeGuidedCheckIn, getCheckInContext } from '@/server/services/checkin';
import { guidedCheckInSchema } from './schemas';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — what the guided check-in needs: the booking, whether it can check in now, deposits, prior records. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.checkin');
  return json(await getCheckInContext(actor, bookingId));
});

/** POST — check the guest in with their ID, deposit and signed registration card (or add them to a stay already checked in). */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.checkin');
  const { registration, ...body } = await parseJson(request, guidedCheckInSchema);
  const result = await completeGuidedCheckIn(
    { actor, source: 'classic' },
    bookingId,
    { ...body, registration: { textHash: registration.textHash, signature: registration.signature } },
    { ip: clientIp(request), userAgent: request.headers.get('user-agent') },
  );
  return json({ ...result, message: `${result.booking.guest.name} checked in.` });
});
