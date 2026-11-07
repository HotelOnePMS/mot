import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { voidAllowance } from '@/server/services/folio';

type Params = { params: Promise<{ bookingId: string; allowanceId: string }> };

/** DELETE — remove an allowance (it stays on record). Returns the folio. */
export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId, allowanceId } = await params;
  const actor = await requireStaff('folio.adjust');
  return json(await voidAllowance({ actor, source: 'classic' }, bookingId, allowanceId));
});
