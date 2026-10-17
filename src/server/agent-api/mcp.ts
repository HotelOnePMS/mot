/**
 * HotelOne's MCP server: Model Context Protocol over Streamable HTTP,
 * stateless — every POST carries JSON-RPC 2.0 and gets a JSON answer (no
 * SSE, no Mcp-Session-Id). Implements initialize (version negotiation),
 * notifications, ping, tools/list and tools/call, plus JSON-RPC batches.
 *
 * Two servers share this code: all hotels (POST /api/mcp) and one hotel's
 * own (POST /api/mcp/hotels/{propertyId}), which has no cross-hotel search
 * and needs no hotel id.
 */
import { ZodError } from 'zod';
import { PRODUCT_NAME } from '@/config/product';
import { conciergeError, findListedHotel } from '../concierge';
import { formatDay, hotelToday } from '../dates';
import { DomainError } from '../errors';
import { prisma } from '@/lib/prisma';
import { skillCatalogText } from '../skills';
import { clientIp, consumeAgentLimit, corsHeaders, errorHeaders, originAllowed } from './http';
import { agentKeyFromRequest, keyCanBook, type AgentKeyContext } from './keys';
import { callTool, isToolName, listTools, type ScopedHotel, type ToolContext } from './tools';
import type { RateLimitResult } from '../concierge';

/** Protocol revisions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const MCP_LATEST_VERSION = MCP_PROTOCOL_VERSIONS[0];
/** Server version reported in serverInfo. */
export const MCP_SERVER_VERSION = '1.0.0';
export const MCP_METHODS = 'POST, GET, DELETE, OPTIONS';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 20;

/** JSON-RPC error codes: the standard ones and this server's (-32000…-32099). */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  RATE_LIMITED: -32029,
} as const;

type Id = string | number;
interface RpcRequest {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}
type RpcResponse = { jsonrpc: '2.0'; id: Id | null; result: unknown } | { jsonrpc: '2.0'; id: Id | null; error: { code: number; message: string; data?: unknown } };

const rpcError = (id: Id | null, code: number, message: string, data?: unknown): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const rpcResult = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });

/** A DomainError thrown outside a tool as an HTTP status + JSON-RPC error. */
function domainToRpc(e: DomainError): { status: number; code: number } {
  if (e.status === 401) return { status: 401, code: RPC.UNAUTHORIZED };
  if (e.status === 403) return { status: 403, code: RPC.FORBIDDEN };
  if (e.status === 404) return { status: 404, code: RPC.NOT_FOUND };
  if (e.status === 429) return { status: 429, code: RPC.RATE_LIMITED };
  return { status: e.status, code: RPC.INVALID_REQUEST };
}

// ---------------------------------------------------------------------------
// Instructions for the model
// ---------------------------------------------------------------------------

async function instructions(hotel: ScopedHotel | null, key: AgentKeyContext | null): Promise<string> {
  const today = hotelToday();
  const canBook = keyCanBook(key, hotel?.id ?? null);
  const lines = [
    hotel
      ? `This is ${hotel.name} in ${hotel.city}, ${hotel.state}, on ${PRODUCT_NAME}. Every tool here is about this hotel, so you never need a hotel id.`
      : `${PRODUCT_NAME} lists independent hotels, inns and motels and lets guests book them directly.`,
    `Today is ${formatDay(today, 'long')}, ${today.slice(0, 4)} (${today}) in hotel time. Dates are YYYY-MM-DD; prices are USD. Turn relative dates like "next weekend" into dates yourself and say which dates you used.`,
    '',
    'How to book:',
    hotel
      ? '1. check_availability for the dates and party, and suggest an available room type that fits the party (fits_party).'
      : '1. search_hotels with the place and, when known, checkIn, checkOut, guests and rooms. Then check_availability for the hotel the person picks, and suggest an available room type that fits the party (fits_party).',
    '2. get_booking_link with that room_type_id (add the guest’s name, email and phone if you have them). Give the person the link with the room, dates and total: they check it and confirm on the hotel’s checkout page. This is the default way to book.',
    '3. If the person can’t open a link (for example on a voice call), use request_booking: the hotel team confirms and sends a link. Read back the hotel, room, dates, guests and the quoted total first, and only call it after a clear yes.',
    ...(canBook ? ['4. create_booking makes a confirmed booking paid at the hotel on arrival (this API key allows it). Read everything back, including the guest’s name and email, and only call it after a clear yes. Give the guest the confirmation code.'] : []),
    '',
    `Questions about ${hotel ? 'the hotel' : 'a hotel'} (parking, pets, breakfast, Wi-Fi, policies): ask_hotel, or get_hotel for everything at once. Existing bookings: find_booking with the confirmation code and last name.`,
    'Quote prices and availability only from tool results, never from memory. Nothing is booked until the guest confirms at checkout or the hotel confirms a request.',
  ];
  if (hotel) {
    const topics = await skillCatalogText(hotel.id, 'GUEST', { kinds: ['ANSWER'], maxChars: 1200 }).catch(() => '');
    if (topics) lines.push('', `${hotel.name} has saved answers on:`, topics);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

interface Session {
  hotel: ScopedHotel | null;
  key: AgentKeyContext | null;
  ip: string;
  limits: RateLimitResult[];
}

function toolContext(s: Session): ToolContext {
  return {
    hotel: s.hotel,
    key: s.key,
    limit: async (category) => {
      s.limits.push(await consumeAgentLimit(category, { key: s.key, ip: s.ip }));
    },
  };
}

/** A tools/call outcome as an MCP CallToolResult. */
function toolResult(structured: Record<string, unknown>, isError = false) {
  const text = isError && typeof structured.error === 'string' ? structured.error : JSON.stringify(structured);
  return { content: [{ type: 'text', text }], structuredContent: structured, ...(isError ? { isError: true } : {}) };
}

async function dispatch(msg: RpcRequest, s: Session): Promise<RpcResponse | null> {
  const isNotification = msg.id === undefined;
  if (isNotification) return null; // notifications/initialized, notifications/cancelled, …: nothing to answer
  const id = msg.id as Id;
  const params = msg.params ?? {};
  switch (msg.method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_LATEST_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: PRODUCT_NAME, title: s.hotel ? `${s.hotel.name} — book on ${PRODUCT_NAME}` : `${PRODUCT_NAME} — find and book hotels`, version: MCP_SERVER_VERSION },
        instructions: await instructions(s.hotel, s.key),
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: await listTools({ hotel: s.hotel, key: s.key }) });
    case 'tools/call': {
      const name = params.name;
      const args = params.arguments ?? {};
      if (typeof name !== 'string' || !name) return rpcError(id, RPC.INVALID_PARAMS, 'tools/call needs params.name (the tool to call).');
      if (typeof args !== 'object' || args === null || Array.isArray(args)) return rpcError(id, RPC.INVALID_PARAMS, 'params.arguments must be an object.');
      if (!isToolName(name) || (name === 'search_hotels' && s.hotel)) return rpcError(id, RPC.INVALID_PARAMS, `Unknown tool: ${name}`);
      try {
        return rpcResult(id, toolResult(await callTool(name, args as Record<string, unknown>, toolContext(s))));
      } catch (e) {
        // Tool failures (bad dates, sold out, rate limits…) go back to the model as results it can explain.
        const err = conciergeError(e);
        return rpcResult(id, toolResult({ ...err }, true));
      }
    }
    default:
      return rpcError(id, RPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  }
}

/** Checks one JSON-RPC message; returns the request or an error response. */
function validate(raw: unknown): { ok: RpcRequest } | { response: RpcResponse | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { response: rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC 2.0 object.') };
  const m = raw as Record<string, unknown>;
  const id = typeof m.id === 'string' || (typeof m.id === 'number' && Number.isFinite(m.id)) ? (m.id as Id) : null;
  // A JSON-RPC response from the client (we never send requests, so just accept it).
  if (m.method === undefined && ('result' in m || 'error' in m)) return { response: null };
  if (m.jsonrpc !== '2.0') return { response: rpcError(id, RPC.INVALID_REQUEST, 'Invalid Request: "jsonrpc" must be "2.0".') };
  if (typeof m.method !== 'string' || !m.method) return { response: rpcError(id, RPC.INVALID_REQUEST, 'Invalid Request: "method" must be a string.') };
  if ('id' in m && id === null) return { response: rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request: "id" must be a string or a number.') };
  if (m.params !== undefined && (typeof m.params !== 'object' || m.params === null || Array.isArray(m.params))) {
    return { response: id === null ? null : rpcError(id, RPC.INVALID_PARAMS, 'Invalid params: "params" must be an object.') };
  }
  return { ok: { jsonrpc: '2.0', id: id ?? undefined, method: m.method, params: m.params as Record<string, unknown> | undefined } };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function reply(request: Request, status: number, body: unknown, extra: Record<string, string> = {}, limits: RateLimitResult[] = []): Response {
  const headers: Record<string, string> = { ...corsHeaders(request, MCP_METHODS), 'Cache-Control': 'no-store', ...extra };
  const tightest = limits.reduce<RateLimitResult | null>((m, r) => (!m || r.remaining < m.remaining ? r : m), null);
  if (tightest) {
    headers['X-RateLimit-Limit'] = String(tightest.limit);
    headers['X-RateLimit-Remaining'] = String(Math.max(0, tightest.remaining));
  }
  if (body === null) return new Response(null, { status, headers });
  headers['Content-Type'] = 'application/json';
  return new Response(JSON.stringify(body), { status, headers });
}

/** The hotel a hotel-scoped server is for (listed hotels only; 404 otherwise). */
async function scopedHotel(propertyId: string): Promise<ScopedHotel> {
  await findListedHotel(propertyId);
  return prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { id: true, name: true, city: true, state: true } });
}

/**
 * Handles one POST to an MCP endpoint. `propertyId` makes it that hotel's
 * own server. HTTP statuses: 200 with JSON-RPC responses, 202 for
 * notifications only, 400 for unparseable or invalid JSON-RPC (and an
 * unsupported MCP-Protocol-Version), 401 for a bad API key, 403 for a
 * disallowed Origin, 404 for an unknown hotel, 413 for huge bodies, 429 when
 * the caller is over the rate limit.
 */
export async function handleMcpPost(request: Request, propertyId: string | null = null): Promise<Response> {
  const limits: RateLimitResult[] = [];
  try {
    if (!originAllowed(request)) return reply(request, 403, rpcError(null, RPC.FORBIDDEN, 'Requests from this website aren’t allowed.'));
    const version = request.headers.get('mcp-protocol-version');
    if (version && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
      return reply(request, 400, rpcError(null, RPC.INVALID_REQUEST, `Unsupported MCP-Protocol-Version "${version}". Supported: ${MCP_PROTOCOL_VERSIONS.join(', ')}.`));
    }

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return reply(request, 413, rpcError(null, RPC.INVALID_REQUEST, 'Request body is too large.'));
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return reply(request, 400, rpcError(null, RPC.PARSE_ERROR, 'Parse error: the body must be valid JSON.'));
    }
    const batch = Array.isArray(body);
    const messages = batch ? (body as unknown[]) : [body];
    if (messages.length === 0) return reply(request, 400, rpcError(null, RPC.INVALID_REQUEST, 'Invalid Request: empty batch.'));
    if (messages.length > MAX_BATCH) return reply(request, 400, rpcError(null, RPC.INVALID_REQUEST, `Invalid Request: at most ${MAX_BATCH} messages per batch.`));

    const key = await agentKeyFromRequest(request);
    const session: Session = { hotel: propertyId ? await scopedHotel(propertyId) : null, key, ip: clientIp(request), limits };
    // Every request (not notification) counts as a read, per API key or client IP.
    const requests = messages.filter((m) => m && typeof m === 'object' && (m as { id?: unknown }).id !== undefined && (m as { method?: unknown }).method !== undefined).length;
    for (let i = 0; i < Math.max(requests, 1); i++) limits.push(await consumeAgentLimit('read', session));

    const responses: RpcResponse[] = [];
    for (const raw of messages) {
      const v = validate(raw);
      if ('response' in v) {
        if (v.response) responses.push(v.response);
        continue;
      }
      const r = await dispatch(v.ok, session);
      if (r) responses.push(r);
    }
    if (responses.length === 0) return reply(request, 202, null, {}, limits);
    // An invalid single message is a 400 (as the MCP SDKs answer); everything else is 200.
    const single = !batch ? responses[0] : null;
    const status = single && 'error' in single && (single.error.code === RPC.INVALID_REQUEST || single.error.code === RPC.PARSE_ERROR) ? 400 : 200;
    return reply(request, status, batch ? responses : responses[0], {}, limits);
  } catch (e) {
    if (e instanceof DomainError) {
      const { status, code } = domainToRpc(e);
      return reply(request, status, rpcError(null, code, e.message, e.details), errorHeaders(e), limits);
    }
    if (e instanceof ZodError) return reply(request, 400, rpcError(null, RPC.INVALID_PARAMS, e.issues[0]?.message ?? 'Invalid params'));
    console.error('[mcp] failed', e);
    return reply(request, 500, rpcError(null, RPC.INTERNAL_ERROR, 'Internal error — please try again shortly.'), {}, limits);
  }
}

/** GET/DELETE: this server keeps no streams or sessions (Streamable HTTP lets it answer 405). */
export function mcpMethodNotAllowed(request: Request): Response {
  return reply(request, 405, rpcError(null, RPC.INVALID_REQUEST, 'Method not allowed: send JSON-RPC messages with POST. This server is stateless and has no event stream.'), { Allow: 'POST, OPTIONS' });
}
