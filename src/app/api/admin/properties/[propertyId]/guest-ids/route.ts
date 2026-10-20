import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { getGuestIdSettings, MAX_GUEST_ID_RETENTION_DAYS, setGuestIdSettings } from '@/server/services/guestIds';

type Params = { params: Promise<{ propertyId: string }> };

/** GET — whether check-in needs an ID photo, and how long photos are kept after the stay. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('guestid.view');
  return json(await getGuestIdSettings(actor, propertyId));
});

const bodySchema = z.object({
  requireGuestId: z.boolean(),
  guestIdRetentionDays: z.coerce.number().int().min(0).max(MAX_GUEST_ID_RETENTION_DAYS),
});

/** PUT { requireGuestId, guestIdRetentionDays } — owners and managers. Photos past the new retention are deleted straight away. */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('guestid.manage');
  const body = await parseJson(request, bodySchema);
  return json(await setGuestIdSettings({ actor, source: 'classic' }, propertyId, body));
});
