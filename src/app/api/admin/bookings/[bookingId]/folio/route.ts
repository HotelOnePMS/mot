import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { getFolio } from '@/server/services/folio';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — the folio: room and tax lines, payments online and at the desk, refunds, security deposits, balance. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('folio.view');
  return json(await getFolio(actor, bookingId));
});
