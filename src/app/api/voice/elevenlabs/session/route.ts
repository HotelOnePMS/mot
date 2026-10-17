import { NextRequest } from 'next/server';
import { z } from 'zod';
import { DomainError } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { voiceProvider } from '@/server/voice/provider';
import { startElevenLabsConversation } from '@/server/voice/elevenlabs';
import { openVoiceSession } from '@/server/voice/sessions';

// No propertyId (or scope=global) on a guest session: the HotelOne concierge across every listed hotel.
const query = z.object({
  propertyId: z.string().min(1).max(64).optional(),
  audience: z.enum(['guest', 'staff']).default('guest'),
  scope: z.enum(['hotel', 'global']).optional(),
});

/**
 * POST /api/voice/elevenlabs/session?propertyId&audience&scope — ElevenLabs
 * (a hotel's front desk, or the all-hotels concierge without propertyId). Returns
 * a single-use signed URL for the private agent, the hotel's prompt and
 * greeting (sent as overrides), the client tools to register, and the signed
 * token the browser uses for this session's tool calls.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const q = parseQuery(request, query);
  if (voiceProvider() !== 'elevenlabs') throw new DomainError(503, 'VOICE_DISABLED', 'The ElevenLabs voice line isn’t switched on.');
  const session = await openVoiceSession(request, { propertyId: q.propertyId, audience: q.audience, scope: q.scope === 'global' ? 'GLOBAL' : 'HOTEL' }, async (ctx) => {
    const { conversationId, ...result } = await startElevenLabsConversation({ audience: ctx.audience, prompts: ctx.prompts, firstMessage: ctx.firstMessage, tools: ctx.tools });
    return { externalId: conversationId, result };
  });
  return json({ ...session.result, token: session.token });
});
