import { NextRequest } from 'next/server';
import { z } from 'zod';
import { connectionActor } from '@/server/channels/access';
import { getChannelCalendar } from '@/server/channels/rates';
import { handleRoute, json, parseQuery } from '@/server/http';

const query = z.object({ startDate: z.string(), endDate: z.string(), roomTypeId: z.string().optional() });

/** GET ?startDate&endDate(&roomTypeId) — day-by-day channel prices, availability and restrictions. */
export const GET = handleRoute(async (request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) => {
  const { connectionId } = await params;
  await connectionActor('channels.view', connectionId);
  const q = parseQuery(request, query);
  return json(await getChannelCalendar(connectionId, q.startDate, q.endDate, q.roomTypeId ?? null));
});
