import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { addGuestId, listGuestIds } from '@/server/services/guestIds';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — the reservation's guest ID photos (details only, never the images) and the hotel's rules for them. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('guestid.view');
  return json(await listGuestIds(actor, bookingId), { headers: { 'Cache-Control': 'private, no-store' } });
});

const bodySchema = z.object({
  image: z.string().min(1).max(3_500_000),
  type: z.enum(['DRIVERS_LICENSE', 'PASSPORT', 'NATIONAL_ID', 'OTHER']).default('DRIVERS_LICENSE'),
  side: z.enum(['FRONT', 'BACK']).default('FRONT'),
  nameOnId: z.string().max(120).nullish(),
  numberLast4: z.string().max(20).nullish(),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

/** POST { image: data URL, type, side, nameOnId?, numberLast4?, expiresOn? } — add a photo of the guest's ID (encrypted at rest). */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('guestid.capture');
  const body = await parseJson(request, bodySchema);
  return json(await addGuestId({ actor, source: 'classic' }, bookingId, body), { status: 201 });
});
