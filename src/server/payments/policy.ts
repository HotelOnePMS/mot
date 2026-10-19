/**
 * The terms a guest accepts at booking (cancellation and refund policy, and
 * how payment works), as recorded on the booking. The wording itself lives in
 * src/lib/payments.ts so the booking page shows exactly what is stored.
 */
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { isStripeConfigured } from '@/lib/stripe';
import { POLICY_VERSION, cancellationPolicyText, effectivePolicy, type PaymentPolicy } from '@/lib/payments';
import { notFound } from '../errors';

export interface PaymentTerms {
  /** What applies right now (falls back to PAY_AT_PROPERTY when online payment isn't available). */
  policy: PaymentPolicy;
  depositNights: number;
  onlinePayment: boolean;
  version: string;
  text: string;
  /** SHA-256 of version + text; the booking page sends it back so we know what the guest saw. */
  hash: string;
  stripeAccountId: string | null;
}

export function hashPolicy(version: string, text: string): string {
  return createHash('sha256').update(`${version}\n${text}`).digest('hex');
}

export function termsFor(property: { paymentPolicy: PaymentPolicy; depositNights: number; stripeChargesEnabled: boolean; stripeAccountId: string | null }): PaymentTerms {
  const policy = effectivePolicy({
    policy: property.paymentPolicy,
    stripeConfigured: isStripeConfigured(),
    chargesEnabled: property.stripeChargesEnabled && !!property.stripeAccountId,
  });
  const text = cancellationPolicyText({ policy, depositNights: property.depositNights });
  return {
    policy,
    depositNights: property.depositNights,
    onlinePayment: policy !== 'PAY_AT_PROPERTY',
    version: POLICY_VERSION,
    text,
    hash: hashPolicy(POLICY_VERSION, text),
    stripeAccountId: policy === 'PAY_AT_PROPERTY' ? null : property.stripeAccountId,
  };
}

export async function getPaymentTerms(propertyId: string): Promise<PaymentTerms> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { paymentPolicy: true, depositNights: true, stripeChargesEnabled: true, stripeAccountId: true },
  });
  if (!property) throw notFound('Property');
  return termsFor(property);
}
