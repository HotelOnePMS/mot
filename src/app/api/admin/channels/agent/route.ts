import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/server/authz';
import { CHANNEL_AGENT_MODEL, channelAgentConfigured, sendToAgent } from '@/server/channel-agent/agent';
import { conversationView } from '@/server/channel-agent/view';
import { notFound } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';

// Agent turns can take a while (several model calls + OTA pushes)
export const maxDuration = 300;

/**
 * GET           — your recent channel-agent conversations
 * GET ?id=<id>  — one conversation as chat items
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('channels.view');
  const { id } = parseQuery(request, z.object({ id: z.string().optional() }));
  if (id) {
    const conversation = await prisma.channelAgentConversation.findFirst({ where: { id, userId: actor.userId } });
    if (!conversation) throw notFound('Conversation');
    return json(conversationView(conversation));
  }
  const conversations = await prisma.channelAgentConversation.findMany({
    where: { userId: actor.userId },
    select: { id: true, title: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });
  return json({ conversations, configured: channelAgentConfigured(), model: CHANNEL_AGENT_MODEL });
});

const body = z.object({
  conversationId: z.string().nullish(),
  message: z.string().max(4000, 'Message is too long').nullish(),
  /** Approve (true) / reject (false) pending changes by call id */
  decisions: z.record(z.boolean()).nullish(),
  autoApprove: z.boolean().optional(),
});

/** POST { conversationId?, message?, decisions?, autoApprove? } */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('channels.view');
  const input = await parseJson(request, body);
  const result = await sendToAgent({
    actor,
    conversationId: input.conversationId ?? null,
    message: input.message ?? null,
    decisions: input.decisions ?? null,
    autoApprove: input.autoApprove === true,
  });
  return json({ ...conversationView(result.conversation), status: result.status, error: result.error ?? null });
});
