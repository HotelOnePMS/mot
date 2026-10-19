import { NextRequest } from 'next/server';
import { handleRoute } from '@/server/http';
import { getDispute } from '@/server/payments/disputes';

type Params = { params: Promise<{ disputeId: string }> };

/** GET — the evidence summary as a downloadable text file. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { disputeId } = await params;
  const { dispute, evidenceText } = await getDispute(disputeId);
  const name = `dispute-evidence-${dispute.booking?.code ?? dispute.stripeDisputeId}.txt`;
  return new Response(evidenceText ?? 'No evidence could be assembled for this dispute.', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });
});
