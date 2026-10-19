import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { assertPromotionAccess } from '@/server/channels/access';
import { serializePromotion, updatePromotion, type PromotionChanges } from '@/server/channels/promotions';
import { updatePromotionSchema } from '@/server/channels/schemas';
import { badRequest } from '@/server/errors';
import { handleRoute, json } from '@/server/http';

/** PATCH — edit, pause (active: false) or resume a promotion. Null fields stay unchanged. */
export const PATCH = handleRoute(async (request: NextRequest, { params }: { params: Promise<{ promotionId: string }> }) => {
  const { promotionId } = await params;
  const actor = await requireStaff('rates.write');
  await assertPromotionAccess(actor, promotionId);
  const body = await request.json().catch(() => {
    throw badRequest('Request body must be valid JSON.');
  });
  const { promotionId: _id, active, ...fields } = updatePromotionSchema.parse({ ...body, promotionId });
  const changes: PromotionChanges = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
  if (active !== null) changes.active = active;
  return json(serializePromotion(await updatePromotion(promotionId, changes)));
});
