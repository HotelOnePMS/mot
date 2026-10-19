import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleRoute, json, parseJson } from '@/server/http';
import { getRefundInfo, refundPayment } from '@/server/payments/refunds';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — what can be refunded on this reservation and what its cancellation policy suggests. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  return json(await getRefundInfo(bookingId));
});

const bodySchema = z.object({
  paymentId: z.string().min(1),
  /** Dollars; omit to refund what is left on the payment. */
  amount: z.number().positive().max(1_000_000).optional(),
  reason: z.string().max(200).optional(),
});

/** POST — refund part or all of a card payment back to the guest's card. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const body = await parseJson(request, bodySchema);
  return json(await refundPayment(bookingId, body));
});
