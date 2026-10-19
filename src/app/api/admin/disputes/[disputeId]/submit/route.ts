import { NextRequest } from 'next/server';
import { handleRoute, json } from '@/server/http';
import { submitDisputeEvidence } from '@/server/payments/disputes';

type Params = { params: Promise<{ disputeId: string }> };

/** POST — send the evidence to Stripe. Only runs when someone clicks "Submit evidence". */
export const POST = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { disputeId } = await params;
  return json(await submitDisputeEvidence(disputeId));
});
