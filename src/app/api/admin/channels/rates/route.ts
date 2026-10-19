import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { assertConnectionAccess, assertRateChangeAccess, assertRoomTypeAccess } from '@/server/channels/access';
import { applyMarkup, applyRateChange, applyRestrictions, previewMarkup, previewRateChange, previewRestrictions } from '@/server/channels/rates';
import { markupSchema, rateChangeSchema, restrictionSchema } from '@/server/channels/schemas';
import { badRequest } from '@/server/errors';
import { handleRoute, json } from '@/server/http';

const envelope = z.object({ kind: z.enum(['rates', 'restrictions', 'markup']), preview: z.boolean().default(false) }).passthrough();

/**
 * POST { kind: 'rates' | 'restrictions' | 'markup', preview?: boolean, ...change }
 * With preview: true nothing is written; the planned change comes back.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const raw = await request.json().catch(() => {
    throw badRequest('Request body must be valid JSON.');
  });
  const { kind, preview, ...body } = envelope.parse(raw);
  const actor = await requireStaff(preview ? 'channels.view' : 'rates.write');

  if (kind === 'rates') {
    const change = rateChangeSchema.parse(body);
    await assertRateChangeAccess(actor, change);
    return json(preview ? await previewRateChange(change) : await applyRateChange(change, actor.email));
  }
  if (kind === 'restrictions') {
    const change = restrictionSchema.parse(body);
    await assertConnectionAccess(actor, change.connectionIds);
    await assertRoomTypeAccess(actor, change.roomTypeIds);
    return json(preview ? await previewRestrictions(change) : await applyRestrictions(change, actor.email));
  }
  const change = markupSchema.parse(body);
  await assertConnectionAccess(actor, change.connectionId);
  if (change.roomTypeId) await assertRoomTypeAccess(actor, [change.roomTypeId]);
  return json(preview ? await previewMarkup(change) : await applyMarkup(change));
});
