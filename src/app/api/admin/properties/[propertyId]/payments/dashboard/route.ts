import { NextRequest } from 'next/server';
import { handleRoute, json } from '@/server/http';
import { dashboardLink } from '@/server/payments/connect';

type Params = { params: Promise<{ propertyId: string }> };

/** POST — a one-time link to the hotel's Stripe dashboard. */
export const POST = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  return json(await dashboardLink(propertyId));
});
