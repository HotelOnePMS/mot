import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { getCheckInRecord } from '@/server/services/checkin';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — what the guided check-in recorded: the ID summary (type, country, last 4) and the signed registration card. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.view');
  return json(await getCheckInRecord(actor, bookingId));
});
