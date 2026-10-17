import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseQuery } from '@/server/http';

/** GET — messages and callback requests guests left with the voice agent. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('requests.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional(), status: z.enum(['NEW', 'DONE', 'ALL']).default('ALL') }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const rows = await prisma.guestRequest.findMany({
    where: { propertyId, ...(q.status === 'ALL' ? {} : { status: q.status }) },
    orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })));
});
