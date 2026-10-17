import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { connectMcp } from '@/server/pms';
import { DEMO_LOCK_MESSAGE, limitOutbound, pmsProperty } from '@/server/pms/guard';
import { connectSchema } from '@/server/pms/schemas';

/** Testing a PMS MCP server can take up to ~30 s. */
export const maxDuration = 60;

/**
 * POST { propertyId, system, url, auth } — connect the hotel's PMS through
 * its vendor's MCP server. The server is tested first (initialize +
 * tools/list); nothing is saved if that fails. An empty token on a
 * reconnect to the same URL keeps the stored one.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const body = await parseJson(request, connectSchema);
  const property = await pmsProperty(actor, body.propertyId, { demoLock: DEMO_LOCK_MESSAGE });
  limitOutbound(actor);
  const status = await connectMcp({ actor, source: 'classic' }, property.id, { system: body.system, url: body.url, auth: body.auth });
  return json(status, { status: 201 });
});
