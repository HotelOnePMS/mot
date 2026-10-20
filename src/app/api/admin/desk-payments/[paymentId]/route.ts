import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { cancelDeskPayment, refreshDeskPayment, refundCash, settleDeposit, simulateReaderTap } from '@/server/payments/desk';

type Params = { params: Promise<{ paymentId: string }> };

/** GET — a desk payment's state, refreshed from Stripe (polled while the guest pays). */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { paymentId } = await params;
  const actor = await requireStaff('payments.collect');
  return json(await refreshDeskPayment(actor, paymentId));
});

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('simulate'), decline: z.boolean().optional() }),
  z.object({ action: z.literal('settle'), keep: z.number().min(0).max(1_000_000), note: z.string().max(200).optional() }),
  z.object({ action: z.literal('refund_cash'), amount: z.number().positive().max(1_000_000).optional(), note: z.string().max(200).optional() }),
]);

/**
 * POST — cancel a card payment that hasn't gone through, simulate a tap on a
 * test reader, settle a security deposit (keep some, return the rest), or
 * hand back cash.
 */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { paymentId } = await params;
  const actor = await requireStaff();
  const body = await parseJson(request, bodySchema);
  const op = { actor, source: 'classic' as const };
  switch (body.action) {
    case 'cancel':
      return json(await cancelDeskPayment(op, paymentId));
    case 'simulate':
      return json(await simulateReaderTap(actor, paymentId, { decline: body.decline }));
    case 'settle':
      return json(await settleDeposit(op, paymentId, body));
    case 'refund_cash':
      return json(await refundCash(op, paymentId, body));
  }
});
