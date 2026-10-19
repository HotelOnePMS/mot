import { NextRequest } from 'next/server';
import { handleRoute, json } from '@/server/http';
import { getDispute } from '@/server/payments/disputes';

type Params = { params: Promise<{ disputeId: string }> };

/** GET — one dispute with the evidence assembled from our records. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { disputeId } = await params;
  return json(await getDispute(disputeId));
});
