import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleRoute, json, parseJson } from '@/server/http';
import { getChecklist, setChecklistItem } from '@/server/payments/checklist';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — the check-in checklist for a flagged reservation (staff of that property only). */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  return json(await getChecklist(bookingId));
});

const bodySchema = z.object({ item: z.enum(['idMatched', 'cardShown', 'registrationSigned']), done: z.boolean() });

/** POST { item, done } — tick or untick one item; who and when are recorded. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const { item, done } = await parseJson(request, bodySchema);
  return json(await setChecklistItem(bookingId, item, done));
});
