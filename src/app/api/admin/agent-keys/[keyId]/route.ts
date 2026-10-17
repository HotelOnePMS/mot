import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff, resolvePropertyId } from '@/server/authz';
import { assertNotDemoHotel } from '@/server/demo';
import { forbidden, notFound } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { AGENT_KEYS_DEMO_LOCKED as DEMO_LOCKED, getAgentKey, revokeAgentKey } from '@/server/agent-api/keys';

export const dynamic = 'force-dynamic';

type Route = { params: Promise<{ keyId: string }> };

/**
 * DELETE [?propertyId] — revoke a key: it stops working at once (the record
 * stays). Hotel keys need access to their hotel; all-hotel keys need a
 * platform admin, and `propertyId` (the console's hotel) for the audit log.
 */
export const DELETE = handleRoute(async (request: NextRequest, { params }: Route) => {
  const actor = await requireStaff('agentkeys.manage');
  const { keyId } = await params;
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const key = await getAgentKey(keyId);
  if (!key) throw notFound('API key');
  let auditPropertyId: string;
  if (key.propertyId) {
    assertPropertyAccess(actor, key.propertyId);
    const property = await prisma.property.findUniqueOrThrow({ where: { id: key.propertyId }, select: { isDemo: true } });
    assertNotDemoHotel(actor, property.isDemo, DEMO_LOCKED);
    auditPropertyId = key.propertyId;
  } else {
    if (actor.role !== 'ADMIN') throw forbidden('Only platform admins can revoke keys for every hotel.');
    auditPropertyId = await resolvePropertyId(actor, q.propertyId);
  }
  const wasActive = !key.revokedAt;
  const record = await revokeAgentKey(key.id);
  if (wasActive) {
    await recordAudit({ actor, source: 'classic' }, auditPropertyId, 'AGENT_KEY_REVOKE', `Revoked the API key “${record.name}” (${record.prefix}…)${record.allHotels ? ' for every hotel' : ''}`, {
      keyId: record.id,
      prefix: record.prefix,
    });
  }
  return json({ record });
});
