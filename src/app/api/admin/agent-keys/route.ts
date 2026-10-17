import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { assertNotDemoHotel, demoHotelLocked } from '@/server/demo';
import { forbidden } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { AGENT_KEY_SCOPES, AGENT_KEYS_DEMO_LOCKED as DEMO_LOCKED, createAgentKey, listAgentKeys } from '@/server/agent-api/keys';

export const dynamic = 'force-dynamic';

/**
 * GET ?propertyId — the hotel's API keys for outside AI assistants (never
 * the secrets), and whether this person can create or revoke them here.
 * Platform admins also see the all-hotel keys.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('agentkeys.manage');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { isDemo: true, isActive: true } });
  const locked = demoHotelLocked(actor, property.isDemo);
  const isAdmin = actor.role === 'ADMIN';
  return json({
    keys: await listAgentKeys(propertyId, { includeAllHotels: isAdmin }),
    canManage: !locked,
    locked: locked ? DEMO_LOCKED : null,
    canCreateAllHotels: isAdmin,
    /** False while the hotel is hidden from guests: assistants can't find or book it either. */
    listed: property.isActive,
  });
});

const createSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(1, 'Give the key a name, like the assistant or partner it’s for.').max(50),
  scopes: z.array(z.enum(AGENT_KEY_SCOPES)).max(AGENT_KEY_SCOPES.length).default(['book']),
  /** Platform admins only: a key that works for every hotel. */
  allHotels: z.boolean().optional(),
});

/** POST — create a key. The full key is in this response only; it's never shown again. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('agentkeys.manage');
  const body = await parseJson(request, createSchema);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  if (body.allHotels && actor.role !== 'ADMIN') throw forbidden('Only platform admins can create keys for every hotel.');
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { isDemo: true, name: true } });
  assertNotDemoHotel(actor, property.isDemo, DEMO_LOCKED);

  const { key, view } = await createAgentKey({ propertyId: body.allHotels ? null : propertyId, name: body.name, scopes: body.scopes, createdById: actor.userId });
  await recordAudit(
    { actor, source: 'classic' },
    propertyId,
    'AGENT_KEY_CREATE',
    `Created the API key “${view.name}” (${view.prefix}…) for ${body.allHotels ? 'every hotel' : property.name}${view.scopes.includes('book') ? ' — it can make confirmed pay-at-hotel bookings' : ''}`,
    { keyId: view.id, prefix: view.prefix, scopes: view.scopes, allHotels: view.allHotels },
  );
  return json({ key, record: view }, { status: 201 });
});
