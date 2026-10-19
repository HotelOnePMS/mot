/**
 * Stripe Connect (Express) for hotels. Each hotel connects its own Stripe
 * account; guests pay that account directly (direct charges), so the money
 * never passes through HotelOne. Every function here checks the signed-in
 * user's access to the property before touching it.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { getStripe, isStripeConfigured, platformFeePercent } from '@/lib/stripe';
import { MAX_DEPOSIT_NIGHTS, type PaymentPolicy } from '@/lib/payments';
import { assertPropertyAccess, requireStaff, type Actor } from '../authz';
import { assertNotDemoHotel } from '../demo';
import { badRequest, notFound } from '../errors';
import { publicSiteUrl } from '../public-url';
import { recordAudit } from '../services/audit';
import { highAmountThreshold } from './config';

export interface PaymentSettings {
  /** Stripe is configured on this deployment (STRIPE_SECRET_KEY). */
  stripeAvailable: boolean;
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  policy: PaymentPolicy;
  depositNights: number;
  maxDepositNights: number;
  /** Platform fee, percent of each online payment (0 = none). */
  platformFeePercent: number;
  highAmountThreshold: number;
}

const SETTINGS_SELECT = {
  id: true,
  name: true,
  email: true,
  isDemo: true,
  stripeAccountId: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  paymentPolicy: true,
  depositNights: true,
} as const;

async function loadProperty(actor: Actor, propertyId: string) {
  assertPropertyAccess(actor, propertyId);
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: SETTINGS_SELECT });
  if (!property) throw notFound('Property');
  return property;
}

function toSettings(p: Awaited<ReturnType<typeof loadProperty>>): PaymentSettings {
  return {
    stripeAvailable: isStripeConfigured(),
    connected: !!p.stripeAccountId,
    chargesEnabled: p.stripeChargesEnabled,
    payoutsEnabled: p.stripePayoutsEnabled,
    detailsSubmitted: p.stripeDetailsSubmitted,
    policy: p.paymentPolicy,
    depositNights: p.depositNights,
    maxDepositNights: MAX_DEPOSIT_NIGHTS,
    platformFeePercent: platformFeePercent(),
    highAmountThreshold: highAmountThreshold(),
  };
}

/** Copy the connected account's status onto the property (used by the webhook and after onboarding). */
export async function syncAccountStatus(account: Pick<Stripe.Account, 'id' | 'charges_enabled' | 'payouts_enabled' | 'details_submitted'>): Promise<boolean> {
  const { count } = await prisma.property.updateMany({
    where: { stripeAccountId: account.id },
    data: {
      stripeChargesEnabled: !!account.charges_enabled,
      stripePayoutsEnabled: !!account.payouts_enabled,
      stripeDetailsSubmitted: !!account.details_submitted,
    },
  });
  return count > 0;
}

/** GET — the hotel's payment settings. `refresh` re-reads the account from Stripe (after onboarding). */
export async function getPaymentSettings(propertyId: string, opts: { refresh?: boolean } = {}): Promise<PaymentSettings> {
  const actor = await requireStaff('payments.view');
  let property = await loadProperty(actor, propertyId);
  if (opts.refresh && property.stripeAccountId && isStripeConfigured()) {
    const account = await getStripe().accounts.retrieve(property.stripeAccountId);
    await syncAccountStatus(account);
    property = await loadProperty(actor, propertyId);
  }
  return toSettings(property);
}

/** POST — create the hotel's Express account (once) and return a Stripe-hosted onboarding link. */
export async function startOnboarding(propertyId: string, fallbackOrigin: string): Promise<{ url: string }> {
  const actor = await requireStaff('payments.manage');
  const property = await loadProperty(actor, propertyId);
  assertNotDemoHotel(actor, property.isDemo, 'Demo hotels can’t take real payments. Set up your own hotel to connect Stripe.');
  if (!isStripeConfigured()) throw badRequest('Online payments aren’t enabled on this deployment yet.');
  const stripe = getStripe();

  let accountId = property.stripeAccountId;
  if (!accountId) {
    const country = process.env.STRIPE_CONNECT_DEFAULT_COUNTRY?.trim();
    const account = await stripe.accounts.create(
      {
        type: 'express',
        ...(country ? { country } : {}),
        ...(property.email ? { email: property.email } : {}),
        business_profile: { name: property.name },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { propertyId: property.id },
      },
      // The same property always maps to the same account, even on a double click.
      { idempotencyKey: `connect-account-${property.id}` }
    );
    accountId = account.id;
    await prisma.property.updateMany({ where: { id: property.id, stripeAccountId: null }, data: { stripeAccountId: account.id } });
    await recordAudit({ actor, source: 'classic' }, property.id, 'PAYMENTS_CONNECT', `Started Stripe onboarding for ${property.name}`);
  }

  const base = publicSiteUrl() ?? fallbackOrigin;
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${base}/admin/settings?stripe=refresh`,
    return_url: `${base}/admin/settings?stripe=return`,
  });
  return { url: link.url };
}

/** POST — one-time link to the hotel's Stripe Express dashboard (payouts, disputes, statements). */
export async function dashboardLink(propertyId: string): Promise<{ url: string }> {
  const actor = await requireStaff('payments.manage');
  const property = await loadProperty(actor, propertyId);
  if (!property.stripeAccountId || !isStripeConfigured()) throw badRequest('Connect Stripe first.');
  const link = await getStripe().accounts.createLoginLink(property.stripeAccountId);
  return { url: link.url };
}

/** PUT — how guests pay at this hotel. Asking for payment needs a Stripe account that can take charges. */
export async function setPaymentPolicy(propertyId: string, input: { policy: PaymentPolicy; depositNights: number }): Promise<PaymentSettings> {
  const actor = await requireStaff('payments.manage');
  const property = await loadProperty(actor, propertyId);
  assertNotDemoHotel(actor, property.isDemo, 'Demo hotels can’t take real payments. Set up your own hotel to change this.');
  if (input.policy !== 'PAY_AT_PROPERTY') {
    if (!isStripeConfigured()) throw badRequest('Online payments aren’t enabled on this deployment yet.');
    if (!property.stripeAccountId || !property.stripeChargesEnabled) {
      throw badRequest('Finish connecting Stripe (and wait for it to be approved to take payments) before asking guests to pay online.');
    }
  }
  const updated = await prisma.property.update({
    where: { id: property.id },
    data: { paymentPolicy: input.policy, depositNights: input.depositNights },
    select: SETTINGS_SELECT,
  });
  await recordAudit({ actor, source: 'classic' }, property.id, 'PAYMENTS_POLICY', `Payment policy for ${property.name}: ${input.policy}${input.policy === 'DEPOSIT' ? ` (${input.depositNights} night${input.depositNights === 1 ? '' : 's'})` : ''}`, {
    from: property.paymentPolicy,
    to: input.policy,
  });
  return toSettings(updated);
}
