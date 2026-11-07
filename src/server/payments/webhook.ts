/**
 * Stripe webhook processing. Signature verification and idempotency live
 * here; the per-event work is in record.ts, disputes.ts and connect.ts.
 *
 * Events arrive from two Stripe endpoints (platform events and "Connect"
 * events from the hotels' accounts), each with its own signing secret.
 */
import type Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getStripe, webhookSecrets } from '@/lib/stripe';
import { syncAccountStatus } from './connect';
import { applyDeskIntent, applyDeskSession } from './desk';
import { recordDispute } from './disputes';
import { expireUnpaidBooking } from './expiry';
import { applyRefundState, recordPaymentFailed, recordPaymentSucceeded } from './record';

/** An event whose handler started this long ago without finishing is considered abandoned and may be retried. */
const STALE_MS = 5 * 60_000;

/** Verify the signature against every configured secret. Throws if none match. */
export function constructEvent(body: string, signature: string): Stripe.Event {
  const stripe = getStripe();
  let last: unknown = new Error('No webhook secret configured');
  for (const secret of webhookSecrets()) {
    try {
      return stripe.webhooks.constructEvent(body, signature, secret);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Payments taken at the front desk (card reader, typed-in or virtual card) carry the id of their Payment row. */
async function handleDesk(event: Stripe.Event, account: string | null): Promise<boolean> {
  if (event.type.startsWith('payment_intent.')) {
    const intent = event.data.object as Stripe.PaymentIntent;
    const id = intent.metadata?.deskPaymentId;
    if (!id) return false;
    // Re-read with the charge (card details, capture deadline, refunds); events can arrive out of order.
    const fresh = await getStripe().paymentIntents.retrieve(intent.id, { expand: ['latest_charge'] }, account ? { stripeAccount: account } : undefined);
    await applyDeskIntent(id, fresh, account);
    return true;
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    const id = session.metadata?.deskPaymentId;
    if (!id) return false;
    await applyDeskSession(id, session, account);
    return true;
  }
  return false;
}

async function handle(event: Stripe.Event): Promise<void> {
  const account = event.account ?? null;
  if (await handleDesk(event, account)) return;
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // Card payments are paid at once; anything else (async methods) arrives as payment_intent.succeeded later.
      if (session.payment_status === 'paid' && typeof session.payment_intent === 'string') {
        await recordPaymentSucceeded(session.payment_intent, { account, sessionId: session.id });
      }
      break;
    }
    case 'checkout.session.expired': {
      const bookingId = (event.data.object as Stripe.Checkout.Session).metadata?.bookingId;
      if (bookingId) await expireUnpaidBooking(bookingId);
      break;
    }
    case 'payment_intent.succeeded':
      await recordPaymentSucceeded((event.data.object as Stripe.PaymentIntent).id, { account });
      break;
    case 'payment_intent.payment_failed':
      await recordPaymentFailed(event.data.object as Stripe.PaymentIntent, account);
      break;
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (intent) await applyRefundState({ paymentIntentId: intent, amountRefundedCents: charge.amount_refunded });
      break;
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
      await recordDispute(event.data.object as Stripe.Dispute);
      break;
    case 'account.updated':
      await syncAccountStatus(event.data.object as Stripe.Account);
      break;
    case 'account.application.deauthorized':
      // The hotel disconnected HotelOne from its Stripe account: stop taking online payments for it.
      if (account) await prisma.property.updateMany({ where: { stripeAccountId: account }, data: { stripeAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false, stripeDetailsSubmitted: false, paymentPolicy: 'PAY_AT_PROPERTY' } });
      break;
    default:
      break;
  }
}

export type WebhookOutcome = 'processed' | 'duplicate' | 'in_progress';

/**
 * Handle an event exactly once. A redelivered event that already finished is
 * acknowledged and skipped; one still being handled (or abandoned less than
 * five minutes ago) asks Stripe to retry later. A failing handler releases the
 * event so Stripe's retry runs it again.
 */
export async function processEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type, account: event.account ?? null } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    const existing = await prisma.stripeEvent.findUnique({ where: { id: event.id } });
    if (existing?.processedAt) return 'duplicate';
    // Take over only if the earlier attempt looks abandoned; the guard makes exactly one retry win.
    const taken = await prisma.stripeEvent.updateMany({
      where: { id: event.id, processedAt: null, startedAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { startedAt: new Date() },
    });
    if (!taken.count) return 'in_progress';
  }
  try {
    await handle(event);
  } catch (e) {
    await prisma.stripeEvent.deleteMany({ where: { id: event.id, processedAt: null } });
    throw e;
  }
  await prisma.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  return 'processed';
}
