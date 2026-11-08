/**
 * Language-model engine switch.
 *
 * The model-driven harness lives in harness.ts: one Claude tool loop over
 * the hotel's tools, used whenever an Anthropic key is configured (set
 * AGENT_LLM_ENABLED=false to force the deterministic engine). It keeps the
 * contract the deterministic engine follows:
 *   • call only catalog tools — never touch the DB;
 *   • build UI blocks from tool results, never from model-written numbers;
 *   • route every write through one signed plan → confirmPlan(), so
 *     nothing changes without the person confirming.
 * If the model call fails before anything is shown, the engine falls back to
 * the deterministic parser (nlu.ts).
 */
import { llmConfigured } from './harness';

export const LLM_AGENT_AVAILABLE = llmConfigured();
export { llmConfigured, runHarness } from './harness';
