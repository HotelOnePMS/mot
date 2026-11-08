import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { requireStaff, type Actor } from '@/server/authz';
import { errorResponse, handleRoute, json } from '@/server/http';
import { AdvisorError, runAdvisorTurn, type AdvisorEvent, type ChatTurn } from '@/lib/business-agent/agent';
import { PortfolioData, resolvePortfolioScope, type PortfolioScope } from '@/lib/business-agent/portfolio-data';
import { buildPortfolioOverview, buildPortfolioSnapshot } from '@/lib/business-agent/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Agent turns with several tool rounds can take a few minutes on hosts that enforce this.
export const maxDuration = 300;

// Admins and owners only: the advisor reads revenue across the whole portfolio.
async function loadScope(): Promise<PortfolioScope> {
  return resolvePortfolioScope(await requireStaff('advisor.use'));
}

// GET portfolio overview for the advisor page header
export const GET = handleRoute(async () => {
  const data = await PortfolioData.load(await loadScope());
  return json(await buildPortfolioOverview(data));
});

const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(50000) }))
    .min(1)
    .max(61)
    .refine((messages) => messages.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant')), 'Messages must alternate, starting with the user')
    .refine((messages) => messages.at(-1)?.role === 'user', 'The last message must be from the user')
    .refine((messages) => messages.reduce((total, m) => total + m.content.length, 0) <= 300000, 'Conversation is too long'),
});

function describeError(error: unknown): string {
  if (error instanceof AdvisorError) return error.message;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return 'The AI advisor is not configured correctly. Ask an administrator to check the ANTHROPIC_API_KEY setting.';
  }
  if (error instanceof Anthropic.RateLimitError) return 'The AI advisor is busy right now. Please try again in a minute.';
  if (error instanceof Anthropic.InternalServerError) return 'The AI service had a temporary problem. Please try again.';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service. Please try again.';
  if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) {
    // Thrown by the client itself, e.g. when no API key is configured.
    return 'The AI advisor is not configured. Ask an administrator to set ANTHROPIC_API_KEY on the server.';
  }
  return 'Something went wrong while analysing your portfolio. Please try again.';
}

// POST one conversation turn; streams AdvisorEvents as server-sent events
export async function POST(request: NextRequest) {
  let scope: PortfolioScope;
  let history: ChatTurn[];
  let actor: Actor;
  try {
    actor = await requireStaff('advisor.use');
    scope = await resolvePortfolioScope(actor);

    const body = chatRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: body.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
    }
    history = body.data.messages;
  } catch (error) {
    return errorResponse(error);
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AdvisorEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        send({ type: 'status', text: 'Loading your portfolio data' });
        const data = await PortfolioData.load(scope);
        const snapshot = await buildPortfolioSnapshot(data);
        const client = new Anthropic();

        for await (const event of runAdvisorTurn({ client, data, snapshot, history, signal: request.signal, actor })) {
          send(event);
        }
      } catch (error) {
        if (!(error instanceof Anthropic.APIUserAbortError) && !request.signal.aborted) {
          if (!(error instanceof AdvisorError)) console.error('Advisor turn failed:', error);
          send({ type: 'error', message: describeError(error) });
        }
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
