import { NextRequest } from 'next/server';
import { z } from 'zod';
import { badRequest, DomainError } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { createLiveSession } from '@/server/voice/live';
import { openVoiceSession } from '@/server/voice/sessions';
import { voiceProvider } from '@/server/voice/provider';

// No propertyId (or scope=global) on a guest session: the HotelOne concierge across every listed hotel.
const query = z.object({
  propertyId: z.string().min(1).max(64).optional(),
  audience: z.enum(['guest', 'staff']).default('guest'),
  scope: z.enum(['hotel', 'global']).optional(),
});

/**
 * POST /api/voice/session?propertyId&audience&scope — GPT-Live (a hotel's
 * front desk, or the all-hotels concierge without propertyId). The body is the
 * browser's WebRTC SDP offer; returns the SDP answer plus a signed token the
 * browser uses for this session's tool calls.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const q = parseQuery(request, query);
  if (voiceProvider() !== 'openai') throw new DomainError(503, 'VOICE_DISABLED', 'The GPT-Live voice line isn’t switched on.');
  const sdp = await request.text();
  if (!sdp.trim().startsWith('v=') || sdp.length > 64_000) throw badRequest('A WebRTC SDP offer is required.');
  const session = await openVoiceSession(request, { propertyId: q.propertyId, audience: q.audience, scope: q.scope === 'global' ? 'GLOBAL' : 'HOTEL' }, async (ctx) => {
    const live = await createLiveSession({ sdp, voice: ctx.voice, ...ctx.prompts, tools: ctx.tools });
    return { externalId: live.sessionId, result: live.sdp };
  });
  return json({ sdp: session.result, token: session.token });
});
