import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/server/authz';
import { assertConnectionAccess, assertRoomTypeAccess, scopeByProperty } from '@/server/channels/access';
import { createPromotion, serializePromotion } from '@/server/channels/promotions';
import { createPromotionSchema } from '@/server/channels/schemas';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';

const query = z.object({
  connectionId: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'FAILED']).optional(),
});

/** GET ?connectionId&status — promotions on the connections you can reach. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('channels.view');
  const q = parseQuery(request, query);
  if (q.connectionId) await assertConnectionAccess(actor, q.connectionId);
  const promotions = await prisma.channelPromotion.findMany({
    where: {
      connection: scopeByProperty(actor),
      ...(q.connectionId ? { connectionId: q.connectionId } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  return json(promotions.map(serializePromotion));
});

/** POST — create the promotion on one or more connections. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('rates.write');
  const { connectionIds, ...input } = await parseJson(request, createPromotionSchema);
  await assertConnectionAccess(actor, connectionIds);
  await assertRoomTypeAccess(actor, input.roomTypeIds);
  const promotions = [];
  for (const connectionId of connectionIds) {
    promotions.push(serializePromotion(await createPromotion(connectionId, input, actor.email)));
  }
  return json(promotions, { status: 201 });
});
