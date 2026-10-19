import { NextRequest } from 'next/server';
import { z } from 'zod';
import { connectionActor } from '@/server/channels/access';
import { activateConnection, serializeConnection, setConnectionPaused } from '@/server/channels/connections';
import { handleRoute, json, parseJson } from '@/server/http';

/** POST { action: 'activate' | 'pause' } */
export const POST = handleRoute(async (request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) => {
  const { connectionId } = await params;
  await connectionActor('channels.manage', connectionId);
  const { action } = await parseJson(request, z.object({ action: z.enum(['activate', 'pause']) }));
  if (action === 'activate') {
    const result = await activateConnection(connectionId);
    return json({ ...result, connection: serializeConnection(result.connection) });
  }
  return json({ connection: serializeConnection(await setConnectionPaused(connectionId, true)) });
});
