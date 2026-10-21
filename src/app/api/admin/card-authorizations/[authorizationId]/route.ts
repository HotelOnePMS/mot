import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { cancelCardAuthorization, renewCardAuthorizationLink, reviewCardAuthorization } from '@/server/payments/cardAuthorization';

type Params = { params: Promise<{ authorizationId: string }> };

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('renew'), sendEmail: z.boolean().default(false) }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('reject'), note: z.string().trim().min(1).max(500) }),
]);

/**
 * POST { action } — renew: a new link (the old one stops working), optionally emailed · cancel: withdraw an
 * unsigned request · verify / reject: after checking the ID photo and the matches.
 */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { authorizationId } = await params;
  const actor = await requireStaff('booking.cardAuth');
  const body = await parseJson(request, bodySchema);
  const ctx = { actor, source: 'classic' as const };
  switch (body.action) {
    case 'renew':
      return json(await renewCardAuthorizationLink(ctx, authorizationId, { sendEmail: body.sendEmail }, new URL(request.url).origin));
    case 'cancel':
      return json({ authorization: await cancelCardAuthorization(ctx, authorizationId) });
    case 'verify':
      return json({ authorization: await reviewCardAuthorization(ctx, authorizationId, { decision: 'VERIFY' }) });
    case 'reject':
      return json({ authorization: await reviewCardAuthorization(ctx, authorizationId, { decision: 'REJECT', note: body.note }) });
  }
});
