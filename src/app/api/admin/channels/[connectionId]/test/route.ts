import { NextRequest } from 'next/server';
import { connectionActor } from '@/server/channels/access';
import { serializeConnection, testConnection } from '@/server/channels/connections';
import { handleRoute, json } from '@/server/http';

/** POST — verify the credentials with the OTA. */
export const POST = handleRoute(async (_request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) => {
  const { connectionId } = await params;
  await connectionActor('channels.manage', connectionId);
  const result = await testConnection(connectionId);
  return json({ ...result, connection: serializeConnection(result.connection) });
});
