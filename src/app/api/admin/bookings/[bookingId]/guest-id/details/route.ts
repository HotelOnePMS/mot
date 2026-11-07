import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { revealGuestIdDetails } from '@/server/services/checkin';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — the sealed ID details (full number, date of birth, address). Every view is logged; never cached. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('guestId.view');
  return json(await revealGuestIdDetails({ actor, source: 'classic' }, bookingId), { headers: { 'Cache-Control': 'private, no-store' } });
});
