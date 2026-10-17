import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { AgentEvent } from '@/lib/agent/blocks';
import { requireStaff } from '@/server/authz';
import { runAgent } from '@/server/agent/engine';
import { DomainError } from '@/server/errors';
import { handleRoute, parseJson } from '@/server/http';

/** PMS look-ups through an MCP server run inside this request (and may finish after it). */
export const maxDuration = 60;

const schema = z.object({
  propertyId: z.string().min(1),
  message: z.string().trim().min(1).max(600),
  context: z
    .object({
      lastBookingId: z.string().optional(),
      lastBookingCode: z.string().optional(),
      lastGuestName: z.string().optional(),
      lastRoomNumber: z.string().optional(),
    })
    .default({}),
  /** Earlier messages in this conversation, oldest first — what "save that as a shortcut" saves. */
  recent: z.array(z.string().trim().min(1).max(600)).max(12).default([]),
});

/**
 * POST /api/agent/command — run a natural-language command.
 * Streams NDJSON AgentEvents (status → blocks → context → done) so the
 * console can render cards as each tool finishes. Writes are never executed
 * here; they come back as a signed plan for POST /api/agent/confirm.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('agent.use');
  const body = await parseJson(request, schema);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      try {
        for await (const event of runAgent({ actor, propertyId: body.propertyId, message: body.message, memory: body.context, recent: body.recent })) {
          send(event);
        }
      } catch (e) {
        if (!(e instanceof DomainError)) console.error('Agent command failed:', e);
        send({ type: 'error', message: e instanceof DomainError ? e.message : 'Something went wrong. Please try again.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
});
