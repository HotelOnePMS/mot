import { NextRequest } from 'next/server';
import { connectionActor } from '@/server/channels/access';
import { simulateReservation } from '@/server/channels/reservations';
import { handleRoute, json } from '@/server/http';

/** POST — sandbox only: a made-up OTA booking run through the real import. */
export const POST = handleRoute(async (_request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) => {
  const { connectionId } = await params;
  await connectionActor('channels.manage', connectionId);
  return json({ results: await simulateReservation(connectionId) });
});
