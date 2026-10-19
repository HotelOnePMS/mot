import { NextRequest } from 'next/server';
import { handleRoute, json } from '@/server/http';
import { startOnboarding } from '@/server/payments/connect';

type Params = { params: Promise<{ propertyId: string }> };

/** POST — start (or resume) Stripe Express onboarding; returns the Stripe-hosted link to send the owner to. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  return json(await startOnboarding(propertyId, request.nextUrl.origin));
});
