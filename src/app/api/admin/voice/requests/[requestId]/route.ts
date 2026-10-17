import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff } from '@/server/authz';
import { notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';

type Params = { params: Promise<{ requestId: string }> };

/** PATCH { status } — mark a guest request handled (or reopen it). */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { requestId } = await params;
  const actor = await requireStaff('requests.view');
  const { status } = await parseJson(request, z.object({ status: z.enum(['NEW', 'DONE']) }));
  const row = await prisma.guestRequest.findUnique({ where: { id: requestId } });
  if (!row) throw notFound('Request');
  assertPropertyAccess(actor, row.propertyId);
  const updated = await prisma.guestRequest.update({ where: { id: requestId }, data: { status, handledById: status === 'DONE' ? actor.userId : null } });
  if (status === 'DONE') await recordAudit({ actor, source: 'classic' }, row.propertyId, 'GUEST_REQUEST', `Handled ${row.name}’s request`);
  return json(updated);
});
