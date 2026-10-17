import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff } from '@/server/authz';
import { notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';

type Params = { params: Promise<{ propertyId: string }> };

/**
 * PATCH { interfaceMode } — set the property's default console mode for
 * staff (CLASSIC dashboards vs AGENTIC command workspace). Each person can
 * still switch their own view; this sets where new sessions start.
 */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('mode.setDefault');
  assertPropertyAccess(actor, propertyId);
  const { interfaceMode } = await parseJson(request, z.object({ interfaceMode: z.enum(['CLASSIC', 'AGENTIC']) }));
  const before = await prisma.property.findUnique({ where: { id: propertyId }, select: { interfaceMode: true } });
  if (!before) throw notFound('Property');
  const property = await prisma.property.update({
    where: { id: propertyId },
    data: { interfaceMode },
    select: { id: true, name: true, interfaceMode: true },
  });
  if (before.interfaceMode !== interfaceMode) {
    await recordAudit({ actor, source: 'classic' }, propertyId, 'MODE_SWITCH', `Default interface set to ${interfaceMode === 'AGENTIC' ? 'Agentic' : 'Classic'}`, {
      from: before.interfaceMode,
      to: interfaceMode,
    });
  }
  return json({ property });
});
