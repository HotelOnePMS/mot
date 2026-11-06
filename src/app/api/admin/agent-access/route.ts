import { NextRequest } from 'next/server';
import { z } from 'zod';
import { NOTICE_KINDS } from '@/lib/agent/access';
import { accessView, saveAccess } from '@/server/agent/policy';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET ?propertyId — what each role may do through the agent at this hotel, and which alerts it gets. Owners and platform admins. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('agent.policy');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  return json(await accessView(actor, await resolvePropertyId(actor, q.propertyId)));
});

const switches = z.record(z.string().max(40), z.boolean());
const kinds = z.array(z.enum(NOTICE_KINDS)).max(NOTICE_KINDS.length);
const schema = z.object({
  propertyId: z.string().min(1),
  capabilities: z.object({ MANAGER: switches, FRONT_DESK: switches, HOUSEKEEPER: switches }),
  alerts: z.object({ OWNER: kinds, MANAGER: kinds, FRONT_DESK: kinds, HOUSEKEEPER: kinds }),
});

/** PUT — save every switch; the server keeps only what differs from each role's defaults. */
export const PUT = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('agent.policy');
  return json(await saveAccess(actor, await parseJson(request, schema)));
});
