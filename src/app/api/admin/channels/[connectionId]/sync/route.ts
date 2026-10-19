import { NextRequest } from 'next/server';
import { z } from 'zod';
import { connectionActor } from '@/server/channels/access';
import { pullReservations } from '@/server/channels/reservations';
import { pushAri } from '@/server/channels/sync';
import { handleRoute, json } from '@/server/http';

const body = z.object({ type: z.enum(['ari', 'reservations', 'all']).default('all') });

/** POST { type: 'ari' | 'reservations' | 'all' } — resend prices/availability and/or fetch new OTA reservations. */
export const POST = handleRoute(async (request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) => {
  const { connectionId } = await params;
  await connectionActor('channels.view', connectionId);
  const { type } = body.parse(await request.json().catch(() => ({})));
  const ari = type === 'reservations' ? null : await pushAri(connectionId);
  const reservations = type === 'ari' ? null : await pullReservations(connectionId);
  return json({ ari, reservations });
});
