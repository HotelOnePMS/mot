/**
 * Language-model plug-in point for the agent.
 *
 * The deterministic engine (nlu.ts + tools.ts) handles the front-desk
 * vocabulary today with no model and no API key. A model can be added here
 * later to cover open-ended phrasing. Whatever provider is chosen, it MUST:
 *   • call only the tools in TOOL_CATALOG (tools.ts) — never touch the DB;
 *   • build UI blocks from tool results, never from model-written numbers;
 *   • route every write through planWrite() → signPlan() → confirmPlan(),
 *     so nothing changes without the person confirming.
 *
 * Returning null falls back to the deterministic engine.
 */
import type { AgentEvent } from '@/lib/agent/blocks';
import type { ResolveCtx } from './resolve';

/** Set to a real provider check (plus AGENT_LLM_ENABLED=true) once one is wired below. */
export const LLM_AGENT_AVAILABLE = false;

export async function runWithLLM(_ctx: ResolveCtx): Promise<AgentEvent[] | null> {
  return null;
}
