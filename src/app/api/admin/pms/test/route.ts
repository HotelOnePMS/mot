import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { badRequest } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { testMcp } from '@/server/pms';
import { DEMO_LOCK_MESSAGE, limitOutbound, pmsProperty } from '@/server/pms/guard';
import { testSchema } from '@/server/pms/schemas';

/** Testing a PMS MCP server can take up to ~30 s. */
export const maxDuration = 60;

/**
 * POST { propertyId, url?, auth? } — initialize + tools/list. With url/auth
 * it tests an address before saving (the Connect form); without, it tests
 * the saved connection and updates its status.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const body = await parseJson(request, testSchema);
  if (!!body.url !== !!body.auth) throw badRequest('Send both url and auth to test a new address, or neither to test the saved connection.');
  const property = await pmsProperty(actor, body.propertyId, body.url ? { demoLock: DEMO_LOCK_MESSAGE } : {});
  limitOutbound(actor);
  const ctx = { actor, source: 'classic' as const };
  return json(await testMcp(ctx, property.id, body.url && body.auth ? { url: body.url, auth: body.auth } : undefined));
});
