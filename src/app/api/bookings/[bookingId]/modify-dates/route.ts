import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireActor } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { changeOwnStayDates } from '@/server/services/guest';

type Params = { params: Promise<{ bookingId: string }> };

const schema = z.object({
  newCheckIn: z.string().optional(),
  newCheckOut: z.string().optional(),
});

/**
 * POST { newCheckIn?, newCheckOut? } — move your stay. Availability is
 * re-checked and the total is re-priced on the server.
 */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireActor();
  const body = await parseJson(request, schema);
  const result = await changeOwnStayDates(actor, bookingId, body);
  return json({ message: 'Your dates have been updated.', booking: result });
});
