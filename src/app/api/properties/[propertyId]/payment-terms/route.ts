import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notFound } from '@/server/errors';
import { handleRoute, json } from '@/server/http';
import { LISTED_PROPERTY } from '@/server/concierge/facts';
import { termsFor } from '@/server/payments/policy';

type Params = { params: Promise<{ propertyId: string }> };

/**
 * GET — public. How a guest pays at this hotel and the cancellation/refund
 * policy they accept when booking. Stripe account details stay server-side.
 */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const property = await prisma.property.findFirst({
    where: { id: propertyId, ...LISTED_PROPERTY },
    select: { paymentPolicy: true, depositNights: true, stripeChargesEnabled: true, stripeAccountId: true, currency: true },
  });
  if (!property) throw notFound('Property');
  const t = termsFor(property);
  return json(
    { policy: t.policy, depositNights: t.depositNights, onlinePayment: t.onlinePayment, policyVersion: t.version, policyText: t.text, policyHash: t.hash },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
