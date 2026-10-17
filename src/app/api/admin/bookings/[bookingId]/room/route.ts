import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { assignRoom, suggestRooms } from '@/server/services/bookings';

type Params = { params: Promise<{ bookingId: string }> };

const query = z.object({
  highFloor: z.enum(['1', 'true']).optional(),
  lowFloor: z.enum(['1', 'true']).optional(),
  tags: z.string().optional(),
  readyOnly: z.enum(['1', 'true']).optional(),
});

/** GET — ranked room suggestions for this stay. */
export const GET = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.assignRoom');
  const q = parseQuery(request, query);
  const suggestions = await suggestRooms(
    actor,
    bookingId,
    { highFloor: !!q.highFloor, lowFloor: !!q.lowFloor, tags: q.tags?.split(',').filter(Boolean) },
    { requireReady: !!q.readyOnly, limit: 30 }
  );
  return json(suggestions);
});

/** POST { roomId } — assign (or move to) a specific room. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.assignRoom');
  const { roomId } = await parseJson(request, z.object({ roomId: z.string().min(1) }));
  return json(await assignRoom({ actor, source: 'classic' }, bookingId, roomId));
});
