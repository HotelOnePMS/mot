import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseQuery } from '@/server/http';
import { CONTRACT, CONTRACT_VERSION, disconnectMcp, getMcpStatus, PMS_MCP_MODEL } from '@/server/pms';
import { DEMO_LOCK_MESSAGE, pmsProperty } from '@/server/pms/guard';
import { vaultAvailable } from '@/server/vault';

/**
 * GET — the hotel's PMS connection as the MCP path sees it: mode, server
 * info, cached tools, contract coverage, events URL. Never any secret.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.use');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const property = await pmsProperty(actor, q.propertyId);
  const status = await getMcpStatus(property.id);
  return json(
    {
      ...status,
      vaultReady: vaultAvailable(),
      planner: { ready: !!process.env.OPENAI_API_KEY, model: PMS_MCP_MODEL },
      contract: { version: CONTRACT_VERSION, operations: CONTRACT.map((op) => ({ name: op.name, title: op.title, writes: op.writes })) },
      docs: '/developers/pms',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

/** DELETE ?propertyId — disconnect an MCP connection (desktop / cloud ones use /api/admin/bridge). */
export const DELETE = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const q = parseQuery(request, z.object({ propertyId: z.string().min(1) }));
  const property = await pmsProperty(actor, q.propertyId, { demoLock: DEMO_LOCK_MESSAGE });
  return json(await disconnectMcp({ actor, source: 'classic' }, property.id));
});
