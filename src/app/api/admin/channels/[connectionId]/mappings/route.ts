import { NextRequest } from 'next/server';
import { connectionActor } from '@/server/channels/access';
import { getMappingOptions, saveMappings } from '@/server/channels/connections';
import { mappingsSchema } from '@/server/channels/schemas';
import { handleRoute, json, parseJson } from '@/server/http';

type Params = { params: Promise<{ connectionId: string }> };

/** GET — OTA rooms, HotelOne room types and the saved or suggested mapping. */
export const GET = handleRoute(async (_request: NextRequest, { params }: Params) => {
  const { connectionId } = await params;
  await connectionActor('channels.manage', connectionId);
  return json(await getMappingOptions(connectionId));
});

/** PUT — replace the room mapping. */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { connectionId } = await params;
  await connectionActor('channels.manage', connectionId);
  const { mappings } = await parseJson(request, mappingsSchema);
  return json({ mappings: await saveMappings(connectionId, mappings) });
});
