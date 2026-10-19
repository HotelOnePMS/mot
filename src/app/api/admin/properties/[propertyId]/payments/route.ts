import { NextRequest } from 'next/server';
import { z } from 'zod';
import { MAX_DEPOSIT_NIGHTS } from '@/lib/payments';
import { handleRoute, json, parseJson } from '@/server/http';
import { getPaymentSettings, setPaymentPolicy } from '@/server/payments/connect';

type Params = { params: Promise<{ propertyId: string }> };

/** GET — this hotel's payment settings and Stripe connection status (?refresh=1 re-reads it from Stripe). */
export const GET = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  return json(await getPaymentSettings(propertyId, { refresh }));
});

const policySchema = z.object({
  policy: z.enum(['PAY_AT_PROPERTY', 'DEPOSIT', 'FULL_PREPAYMENT']),
  depositNights: z.coerce.number().int().min(1).max(MAX_DEPOSIT_NIGHTS).default(1),
});

/** PUT — set how guests pay: at the property (default), a deposit of N nights, or the full amount. */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const body = await parseJson(request, policySchema);
  return json(await setPaymentPolicy(propertyId, body));
});
