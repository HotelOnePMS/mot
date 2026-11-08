import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, parseQuery } from '@/server/http';
import { reportedChargebackEvidence } from '@/server/payments/disputes';
import { evidenceResponse } from '@/server/payments/evidence-response';

type Params = { params: Promise<{ bookingId: string }> };

const schema = z.object({
  /** The cardholder's claim, as card networks name it (fraudulent, product_not_received, credit_not_processed…). */
  reason: z
    .string()
    .regex(/^[a-z_]{2,40}$/)
    .optional(),
  amount: z.coerce.number().positive().max(1_000_000).optional(),
  format: z.enum(['txt', 'html']).default('txt'),
});

/**
 * GET: the evidence for a chargeback that reached the hotel outside Stripe (a bank letter, the card terminal's
 * processor), built from the reservation's records: a text file to download, or (format=html) a page to print or save
 * as a PDF. Nothing is stored or sent.
 */
export const GET = handleRoute(async (request: NextRequest, { params }: Params) => {
  const actor = await requireStaff('disputes.view');
  const { bookingId } = await params;
  const p = parseQuery(request, schema);
  const { code, summary } = await reportedChargebackEvidence(actor, bookingId, { reason: p.reason, amount: p.amount });
  return evidenceResponse(summary, { code, format: p.format });
});
