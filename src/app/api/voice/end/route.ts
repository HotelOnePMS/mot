import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { handleRoute, json, parseJson } from '@/server/http';
import { verifyVoiceToken } from '@/server/voice/live';

/** POST /api/voice/end — record that a voice session finished (usage log). */
export const POST = handleRoute(async (request: NextRequest) => {
  const body = await parseJson(request, z.object({ token: z.string().min(20).max(4000), toolCalls: z.number().int().min(0).max(500).optional(), summary: z.string().max(500).optional() }));
  const t = verifyVoiceToken(body.token);
  await prisma.voiceSession.updateMany({
    where: { id: t.sid, endedAt: null },
    data: { endedAt: new Date(), ...(body.summary ? { summary: body.summary } : {}), ...(t.aud === 'STAFF' && body.toolCalls !== undefined ? { toolCalls: body.toolCalls } : {}) },
  });
  return json({ ok: true });
});
