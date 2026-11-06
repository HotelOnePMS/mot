/**
 * WhatsApp Business Cloud API (Meta): configuration, webhook signatures,
 * reading inbound messages and sending replies. Used by the staff agent on
 * WhatsApp (staff.ts). Guests' WhatsApp runs through ElevenLabs instead
 * (voice/elevenlabs.ts), on a different number.
 *
 * Env: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET,
 * WHATSAPP_VERIFY_TOKEN; optional WHATSAPP_DISPLAY_NUMBER (shown in the
 * console) and WHATSAPP_GRAPH_VERSION. See WHATSAPP.md.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { logError } from '@/server/log';

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  /** The staff number as people dial it (E.164), for the console's instructions; null if not set. */
  displayNumber: string | null;
  graphVersion: string;
  /**
   * An approved message template for alerts sent more than 24 hours after
   * the person last wrote (WhatsApp allows free-form messages only inside
   * that window). Body with two variables: {{1}} hotel, {{2}} what happened.
   */
  alertTemplate: { name: string; language: string } | null;
}

/** The staff agent on WhatsApp is on only when all four required settings are present. */
export function whatsAppConfig(): WhatsAppConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!phoneNumberId || !accessToken || !appSecret || !verifyToken) return null;
  const display = process.env.WHATSAPP_DISPLAY_NUMBER?.replace(/[^\d+]/g, '') || null;
  return {
    phoneNumberId,
    accessToken,
    appSecret,
    verifyToken,
    displayNumber: display ? (display.startsWith('+') ? display : `+${display}`) : null,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION?.trim() || 'v23.0',
    alertTemplate: process.env.WHATSAPP_ALERT_TEMPLATE?.trim()
      ? { name: process.env.WHATSAPP_ALERT_TEMPLATE.trim(), language: process.env.WHATSAPP_ALERT_TEMPLATE_LANG?.trim() || 'en' }
      : null,
  };
}

/** Meta signs the exact body bytes: X-Hub-Signature-256 = "sha256=" + hex HMAC-SHA256 with the app secret. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? '');
  if (!m) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface InboundMessage {
  /** Meta's message id (wamid…), for de-duplication and read receipts. */
  id: string;
  /** Sender's WhatsApp ID: country code and number, digits only. */
  from: string;
  /** What they wrote or tapped; null for media, locations, reactions and the like. */
  text: string | null;
  /** Meta's message type: text, button (a template's quick reply), interactive, reaction, image… */
  type?: string;
  /** A reaction's emoji; empty when the person took their reaction back. */
  emoji?: string;
}

type WebhookMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { message_id?: string; emoji?: string };
};
type WebhookPayload = {
  object?: string;
  entry?: { changes?: { field?: string; value?: { metadata?: { phone_number_id?: string }; messages?: WebhookMessage[] } }[] }[];
};

/**
 * Messages sent to our number in a webhook delivery. Deliveries for other
 * numbers on the same Meta app, and status updates (sent, delivered, read),
 * are ignored.
 */
export function inboundMessages(payload: unknown, phoneNumberId: string): InboundMessage[] {
  const p = payload as WebhookPayload;
  if (p?.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return [];
  const out: InboundMessage[] = [];
  for (const entry of p.entry) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (change?.field !== 'messages' || value?.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const m of value.messages ?? []) {
        if (!m?.id || !m.from || !/^\d{6,15}$/.test(m.from)) continue;
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
        out.push({
          id: m.id,
          from: m.from,
          text: text?.trim() ? text.trim() : null,
          ...(m.type ? { type: m.type } : {}),
          ...(m.type === 'reaction' ? { emoji: m.reaction?.emoji ?? '' } : {}),
        });
      }
    }
  }
  return out;
}

/** WhatsApp's limit for one text message. */
export const MAX_TEXT = 4096;

/** Splits a long reply on paragraph, then line boundaries, so each part fits in one message. */
export function splitText(text: string, max = MAX_TEXT): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max / 2) cut = window.lastIndexOf('\n');
    if (cut < max / 2) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function graph(cfg: WhatsAppConfig, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`WhatsApp API ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/** Sends a text reply (split into several messages when it's long). */
export async function sendText(cfg: WhatsAppConfig, to: string, text: string): Promise<void> {
  for (const part of splitText(text)) {
    await graph(cfg, { recipient_type: 'individual', to, type: 'text', text: { body: part, preview_url: false } });
  }
}

/** Template variables can't hold line breaks, tabs or long runs of spaces. */
export function templateText(text: string, max = 900): string {
  const flat = text.replace(/\s*[\r\n\t]+\s*/g, ' · ').replace(/ {4,}/g, '   ').replace(/\*/g, '').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Sends an approved template (for messages outside the 24-hour window). */
export async function sendTemplate(cfg: WhatsAppConfig, to: string, template: { name: string; language: string }, params: string[]): Promise<void> {
  await graph(cfg, {
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: templateText(p) })) }],
    },
  });
}

/** Marks the message read and shows "typing…" while the agent works. Best effort. */
export async function markReadAndTyping(cfg: WhatsAppConfig, messageId: string): Promise<void> {
  try {
    await graph(cfg, { status: 'read', message_id: messageId, typing_indicator: { type: 'text' } });
  } catch (e) {
    logError('whatsapp', 'Read receipt failed:', e);
  }
}
