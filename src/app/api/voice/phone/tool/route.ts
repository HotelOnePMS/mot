import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { DomainError } from '@/server/errors';
import { PHONE_WEBHOOK_HEADER, verifyPhoneWebhook } from '@/server/voice/elevenlabs';
import { guestToolOutput } from '@/server/voice/guestTools';
import { PHONE_TOOLS, verifyVoiceToken, voiceTokenScope } from '@/server/voice/live';

export const dynamic = 'force-dynamic';

const MAX_TOOL_CALLS = 80;
const TOOL_NAMES = new Set(PHONE_TOOLS.map((t) => t.name));

/** Tool problems go back as a normal result so the voice can say something useful (ElevenLabs hides HTTP errors from the model). */
const reply = (output: unknown) => NextResponse.json(output);

/**
 * POST /api/voice/phone/tool — a phone agent's webhook tool (phone calls and WhatsApp). ElevenLabs
 * sends the model's arguments plus `stayos_tool` and the call's
 * `stayos_session` token; the header secret proves the request is from our
 * agents, the token pins it to one hotel and one call. The field names are
 * configured in every phone tool at ElevenLabs: keep them as they are.
 */
export async function POST(request: NextRequest) {
  if (!verifyPhoneWebhook(request.headers.get(PHONE_WEBHOOK_HEADER))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NextResponse.json({ error: 'A JSON object is required.' }, { status: 400 });
  const { stayos_session: token, stayos_tool: name, ...args } = raw;
  if (typeof name !== 'string' || !TOOL_NAMES.has(name)) return reply({ error: 'Unknown tool.' });
  if (typeof token !== 'string' || token.length < 20) return reply({ error: 'This call isn’t connected to the hotel’s systems — offer to take a message, or ask them to call back.' });

  let t;
  try {
    t = verifyVoiceToken(token);
  } catch (e) {
    return reply({ error: e instanceof DomainError ? e.message : 'This call’s session is invalid.' });
  }
  if (t.aud !== 'GUEST' || (t.ch !== 'PHONE' && t.ch !== 'WHATSAPP') || voiceTokenScope(t) !== 'HOTEL' || !t.pid) return reply({ error: 'This session isn’t a phone call or WhatsApp chat.' });
  const propertyId = t.pid;

  // Count the call up front; a real conversation never needs this many lookups.
  const session = await prisma.voiceSession
    .update({ where: { id: t.sid }, data: { toolCalls: { increment: 1 } }, select: { toolCalls: true, callerNumber: true } })
    .catch(() => null);
  if (!session) return reply({ error: 'This call has ended.' });
  if (session.toolCalls > MAX_TOOL_CALLS) return reply({ error: 'This call has made a lot of lookups already — offer to take a message for the team instead.' });

  return reply(await guestToolOutput(propertyId, name, args, { kind: 'PHONE', callerNumber: session.callerNumber, via: t.ch }));
}
