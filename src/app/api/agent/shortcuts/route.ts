import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { shortcutHints } from '@/server/agent/skills';
import { handleRoute, json, parseQuery } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * GET ?propertyId — the hotel's most used shortcuts, for the agent's starter
 * suggestions: name, how to say it, and the command a one-tap chip sends.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('agent.use');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json({ shortcuts: await shortcutHints(propertyId, 4) });
});
