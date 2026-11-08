import { NextRequest } from 'next/server';
import { getDispute } from '@/server/payments/disputes';
import { evidenceResponse } from '@/server/payments/evidence-response';
import { handleRoute } from '@/server/http';

type Params = { params: Promise<{ disputeId: string }> };

/** GET: the evidence summary as a downloadable text file, or with ?format=html a page to print or save as a PDF. */
export const GET = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { disputeId } = await params;
  const { dispute, evidence } = await getDispute(disputeId);
  const format = request.nextUrl.searchParams.get('format') === 'html' ? 'html' : 'txt';
  return evidenceResponse(evidence, { code: dispute.booking?.code ?? dispute.stripeDisputeId, format });
});
