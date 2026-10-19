/**
 * Helpers for the REST API (/api/agents/v1): the same tools as the MCP
 * server, called with query parameters or a JSON body.
 */
import { badRequest } from '../errors';
import { MAX_REST_BODY_BYTES, readBodyText, type AgentRequestContext } from './http';
import type { ToolContext } from './tools';

/** REST version prefix. */
export const REST_BASE = '/api/agents/v1';

/** Query parameters as tool arguments (empty values left out, so defaults apply). */
export function queryArgs(request: Request, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [k, v] of new URL(request.url).searchParams) if (v.trim() !== '') args[k] = v;
  return { ...args, ...extra };
}

/** A JSON object body (at most MAX_REST_BODY_BYTES) as tool arguments; DomainError 413 when larger, 400 when not a JSON object. */
export async function bodyArgs(request: Request): Promise<Record<string, unknown>> {
  const text = await readBodyText(request, MAX_REST_BODY_BYTES);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object.');
  return body as Record<string, unknown>;
}

/** The tool context for a REST call (all hotels; the key and limits from the route wrapper). */
export function restToolContext(ctx: AgentRequestContext): ToolContext {
  return { hotel: null, key: ctx.key, limit: ctx.limit };
}
