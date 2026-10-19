import { NextRequest, NextResponse } from 'next/server';
import { isStripeConfigured, webhookSecrets } from '@/lib/stripe';
import { constructEvent, processEvent } from '@/server/payments/webhook';

// Stripe signs the exact bytes it sends, so this must run on Node and read the raw body.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook for payments, refunds, disputes and connected-account updates.
 * Register this URL twice in Stripe: once for events on your account (secret:
 * STRIPE_WEBHOOK_SECRET) and once for events on connected accounts (secret:
 * STRIPE_CONNECT_WEBHOOK_SECRET). See PAYMENTS.md for the event list.
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  if (!webhookSecrets().length) {
    console.error('[stripe-webhook] No STRIPE_WEBHOOK_SECRET / STRIPE_CONNECT_WEBHOOK_SECRET is set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  let event;
  try {
    event = constructEvent(await request.text(), signature);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const outcome = await processEvent(event);
    // 409 on an event another request is still handling: Stripe retries it later.
    return NextResponse.json({ received: true, outcome }, { status: outcome === 'in_progress' ? 409 : 200 });
  } catch (err) {
    console.error(`[stripe-webhook] Failed handling ${event.type} (${event.id}):`, err);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }
}
