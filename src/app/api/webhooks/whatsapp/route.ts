import { timingSafeEqual } from 'crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { inboundMessages, verifySignature, whatsAppConfig } from '@/server/whatsapp/cloud';
import { handleInbound } from '@/server/whatsapp/staff';
import { logError } from '@/server/log';

// Meta signs the exact bytes it sends, so this must run on Node and read the raw body.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** The agent answers after the 200 (Meta wants one within seconds); PMS look-ups can take a while. */
export const maxDuration = 60;

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * GET /api/webhooks/whatsapp — Meta's one-time check when the callback URL is
 * saved: echo hub.challenge when hub.verify_token is WHATSAPP_VERIFY_TOKEN.
 */
export async function GET(request: NextRequest) {
  const cfg = whatsAppConfig();
  if (!cfg) return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 404 });
  const q = request.nextUrl.searchParams;
  if (q.get('hub.mode') !== 'subscribe' || !sameSecret(q.get('hub.verify_token') ?? '', cfg.verifyToken)) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
  }
  return new Response(q.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

/**
 * POST /api/webhooks/whatsapp — messages to the staff number (WhatsApp
 * Business Cloud API, "messages" field). Signed with the app secret; the
 * agent runs after the response and replies through the Cloud API. See
 * WHATSAPP.md.
 */
export async function POST(request: NextRequest) {
  const cfg = whatsAppConfig();
  if (!cfg) return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 404 });
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get('x-hub-signature-256'), cfg.appSecret)) {
    logError('whatsapp-webhook', 'Signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const messages = inboundMessages(payload, cfg.phoneNumberId);
  if (messages.length) {
    after(async () => {
      for (const msg of messages) {
        await handleInbound(cfg, msg).catch((e) => logError('whatsapp-webhook', `Message ${msg.id} failed:`, e));
      }
    });
  }
  return NextResponse.json({ received: true });
}
