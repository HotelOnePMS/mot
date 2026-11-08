import { vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent } from '@/lib/agent/blocks';
import type { HarnessResult } from '@/server/agent/harness';

export type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };

/** A stand-in for the Anthropic client that replays a scripted conversation and records what it was sent. */
export function scriptedClient(rounds: Block[][]) {
  const sent: unknown[][] = [];
  const create = vi.fn(async (params: { messages: unknown[] }) => {
    const i = create.mock.calls.length - 1;
    const content = rounds[i] ?? [{ type: 'text', text: 'Done.' }];
    // The harness keeps appending to one array: copy what this round saw.
    sent.push([...params.messages]);
    return { content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create: Object.assign(create, { sent }) };
}

export async function drain(gen: AsyncGenerator<AgentEvent, HarnessResult>) {
  const events: AgentEvent[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done) return { events, result: r.value };
    events.push(r.value);
  }
}

/** The tool_result blocks the harness sent back on a given round. */
export function toolResults(create: ReturnType<typeof scriptedClient>['create'], round: number) {
  const messages = create.sent[round] as { role: string; content: unknown }[];
  return messages[messages.length - 1].content as { tool_use_id: string; content: string; is_error?: boolean }[];
}

/** The first message the model was sent: the context and the person's words. */
export const firstMessage = (create: ReturnType<typeof scriptedClient>['create']) => (create.sent[0][0] as { content: string }).content;
