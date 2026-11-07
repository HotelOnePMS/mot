import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { addAllowance } from '@/server/services/folio';

type Params = { params: Promise<{ bookingId: string }> };

const bodySchema = z.object({
  amount: z.number().positive().max(1_000_000),
  reason: z.string().trim().min(3).max(200),
});

/** POST — lower what the stay costs with an allowance (managers), with a reason. Returns the folio. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('folio.adjust');
  const body = await parseJson(request, bodySchema);
  return json(await addAllowance({ actor, source: 'classic' }, bookingId, body));
});
