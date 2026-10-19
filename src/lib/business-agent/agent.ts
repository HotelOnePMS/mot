import Anthropic from '@anthropic-ai/sdk';
import { ADVISOR_TOOLS, ToolInputError, executeAdvisorTool, toolLabel } from './tools';
import type { PortfolioData } from './portfolio-data';

/**
 * The AI business advisor: a Claude agent with the owner's whole portfolio as
 * context (the snapshot in its system prompt) and read-only tools to dig deeper.
 */

const MODEL = 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 10;
const MAX_UNPARSEABLE_TOOL_INPUT_RETRIES = 2;

const BETAS: Anthropic.Beta.AnthropicBeta[] = [
  // Re-run a classifier-declined request on Anthropic's recommended fallback model.
  'server-side-fallback-2026-07-01',
  // Return short progress notes between tool calls while keeping reasoning hidden.
  'thinking-display-updates-2026-08-18',
];

const SYSTEM_PROMPT = `You are the AI business advisor built into a hotel and motel management platform. The person you are talking with owns or runs the properties in the portfolio snapshot below, and you are their thinking partner for understanding and growing the business.

What you have:
- A portfolio snapshot (below) with every property in their portfolio, its room types and rates, recent and trailing-year performance, the forward booking position, monthly trends, room type performance and current operations. Treat it as your working knowledge of their business.
- Read-only tools to go deeper: any date range or breakdown, daily/weekly/monthly trends, booking pace against last year, demand patterns (day of week, lead time, length of stay, party size, repeat guests), the night-by-night rate calendar against occupancy, operations status, and individual bookings with guests anonymised.

How to help:
- Answer from the snapshot when it already covers the question. Call tools when you need another period, finer granularity, a different breakdown, or evidence for a hypothesis. Make independent tool calls in parallel.
- Ground every figure in the snapshot or a tool result, and say which period it covers. Do not invent numbers. When the data cannot answer something (costs, profit, staffing, marketing spend, distribution channels, competitor rates, reviews), say so plainly, then either reason from clearly labelled assumptions or say what data would settle it.
- Compare properties with each other and with their own history (previous period, same time last year). Call out small samples, such as a property with a handful of bookings, before drawing conclusions.
- When brainstorming or recommending, be specific and prioritised: what to do, at which property, room type and dates, the evidence behind it, a rough estimate of the upside with the arithmetic shown, the main risk, and how they would know it worked. Prefer a few strong ideas over a long generic list.
- If a goal is ambiguous and the answer would change your recommendation, ask one short clarifying question; otherwise state your assumption and proceed.
- You cannot change anything in the system. When you recommend a change, say where in the console to make it: Rates (nightly rates), Rooms (base rates, room counts), Properties, Reservations, Housekeeping, or Front desk.
- Before a round of tool calls, write one short sentence saying what you are checking.

Style: lead with the answer, then the supporting numbers. Use concise markdown with short paragraphs, bullet lists and small tables where they help comparison. Use USD. Refer to properties by name, not id.`;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type AdvisorEvent =
  // `round` marks the start of a model response; `discard` drops the text streamed since then.
  | { type: 'round' }
  | { type: 'discard' }
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'tool'; name: string; label: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Errors from the advisor that are safe to show to the user. */
export class AdvisorError extends Error {}

/**
 * Content to echo back after a server-side fallback: before the last `fallback`
 * block only text carries over; the declined model's thinking and tool calls must
 * be dropped (and its tool calls never run).
 */
function echoableContent(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.map((block) => block.type).lastIndexOf('fallback');
  if (boundary < 0) return content;
  return content.filter((block, index) => index >= boundary || block.type === 'text');
}

export async function* runAdvisorTurn({
  client,
  data,
  snapshot,
  history,
  signal,
}: {
  client: Anthropic;
  data: PortfolioData;
  snapshot: string;
  history: ChatTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<AdvisorEvent> {
  // Earlier turns come back as plain text: no thinking blocks are replayed, so the
  // snapshot can refresh every turn without invalidating anything.
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((turn) => ({ role: turn.role, content: turn.content }));
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT },
    { type: 'text', text: snapshot, cache_control: { type: 'ephemeral' } },
  ];

  let emittedText = false;
  let unparseableRetries = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    yield { type: 'round' };

    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: BETAS,
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'updates' },
        output_config: { effort: 'medium' },
        // Caches the growing conversation on each round; the snapshot has its own breakpoint.
        cache_control: { type: 'ephemeral' },
        system,
        tools: ADVISOR_TOOLS,
        // On the last allowed round, require a written answer from what has been gathered.
        tool_choice: round === MAX_TOOL_ROUNDS ? { type: 'none' } : { type: 'auto' },
        messages,
      },
      { signal },
    );

    let message: Anthropic.Beta.BetaMessage;
    try {
      const notes = new Map<number, string>();
      const separate = new Set<number>();
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'text' && emittedText) separate.add(event.index);
          if (block.type === 'tool_use') yield { type: 'tool', name: block.name, label: toolLabel(block.name) };
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta' && event.delta.text) {
            const prefix = separate.delete(event.index) ? '\n\n' : '';
            emittedText = true;
            yield { type: 'text', text: prefix + event.delta.text };
          } else if (event.delta.type === 'thinking_delta') {
            notes.set(event.index, (notes.get(event.index) ?? '') + event.delta.thinking);
          }
        } else if (event.type === 'content_block_stop') {
          const note = notes.get(event.index)?.trim();
          if (note) yield { type: 'status', text: note };
          notes.delete(event.index);
        }
      }
      message = await stream.finalMessage();
      unparseableRetries = 0;
    } catch (error) {
      // With eager input streaming, a tool input that is not valid JSON rejects the
      // stream. Only that is retried; API errors (including aborts) propagate.
      if (error instanceof Anthropic.APIError || signal?.aborted || unparseableRetries >= MAX_UNPARSEABLE_TOOL_INPUT_RETRIES) {
        throw error;
      }
      unparseableRetries++;
      round--;
      yield { type: 'discard' };
      continue;
    }

    if (message.stop_reason === 'refusal') {
      // A decline can land mid-response; its partial output is not a real answer.
      yield { type: 'discard' };
      throw new AdvisorError("I can't help with that request. Try asking about your properties' performance, pricing or operations.");
    }

    const content = echoableContent(message.content);
    const toolUses = content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use');

    if (message.stop_reason === 'max_tokens' && toolUses.length > 0) {
      throw new AdvisorError('The analysis ran too long to finish. Try a narrower question.');
    }
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content });
      continue;
    }
    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
      yield { type: 'done' };
      return;
    }

    messages.push({ role: 'assistant', content });

    // Tools share the portfolio's lazy booking cache, so run them one at a time.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      try {
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: await executeAdvisorTool(data, toolUse.name, toolUse.input) });
      } catch (error) {
        if (!(error instanceof ToolInputError)) {
          console.error(`Advisor tool ${toolUse.name} failed:`, error);
        }
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: error instanceof ToolInputError ? error.message : 'The tool failed unexpectedly. Try a different query or continue without it.',
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  // Unreachable in practice: the last round runs with tool_choice "none".
  yield { type: 'done' };
}
