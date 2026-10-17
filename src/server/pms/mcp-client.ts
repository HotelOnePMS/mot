/**
 * A small, dependency-free MCP client for remote servers over Streamable
 * HTTP (MCP 2025-06-18; older servers answering 2025-03-26 / 2024-11-05
 * work too). Every message is a JSON-RPC 2.0 POST; the server answers with
 * `application/json` or a `text/event-stream` that carries the response.
 *
 *  • initialize → notifications/initialized → tools/list (paginated) → tools/call
 *  • keeps and resends `Mcp-Session-Id`; sends `MCP-Protocol-Version` after
 *    initialize; starts a new session once if the server forgets ours (404).
 *  • per-call timeout, an overall deadline, a response-size cap, no redirects,
 *    and the SSRF guard on every connection (url-guard.ts).
 *
 * Auth is a bearer token or one custom header. Tokens are only ever placed in
 * the outgoing request headers — never in errors, logs or views.
 */
import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from 'http';
import { request as httpsRequest } from 'https';
import { McpError } from './errors';
import { guardedLookup, parseMcpUrl } from './url-guard';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const KNOWN_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CLIENT_INFO = { name: 'hotelone-pms-bridge', title: 'HotelOne PMS bridge', version: '1.0.0' };

export type McpAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'header'; headerName: string; token: string };

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema & Record<string, unknown>>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  [k: string]: unknown;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: McpToolAnnotations;
}

export interface McpServerInfo {
  name: string;
  title?: string;
  version?: string;
  protocolVersion: string;
  instructions?: string;
  hasTools: boolean;
}

export interface McpCallResult {
  isError: boolean;
  /** Text parts of the result, joined. */
  text: string;
  /** structuredContent, else the text parsed as JSON when it is JSON, else null. */
  data: unknown;
}

export interface McpClientOptions {
  /** Per request (default 15 s). */
  timeoutMs?: number;
  /** Epoch ms after which nothing new is sent (overall budget). */
  deadline?: number;
  /** Response size cap in bytes (default 2 MB). */
  maxBytes?: number;
}

interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const RESERVED_HEADERS = new Set(['host', 'content-length', 'content-type', 'accept', 'connection', 'transfer-encoding', 'mcp-session-id', 'mcp-protocol-version', 'user-agent', 'cookie', 'te', 'upgrade', 'expect', 'proxy-authorization']);

/** Returns a problem with a custom auth header name, or null if it's usable. */
export function authHeaderIssue(name: string): string | null {
  if (!HEADER_NAME.test(name)) return 'Header names may only use letters, numbers and dashes.';
  if (RESERVED_HEADERS.has(name.toLowerCase())) return `“${name}” can’t carry the token — use Authorization or a custom header such as X-API-Key.`;
  return null;
}

const SAFE_TOKEN = /^[\x21-\x7e][\x20-\x7e]*$/;
export function authTokenIssue(token: string): string | null {
  if (!token || token.length > 4096) return 'The token must be between 1 and 4096 characters.';
  if (!SAFE_TOKEN.test(token)) return 'The token contains characters that can’t be sent in a header (line breaks or non-ASCII).';
  return null;
}

function authHeaders(auth: McpAuth): Record<string, string> {
  if (auth.type === 'bearer') return { authorization: /^bearer\s/i.test(auth.token) ? auth.token : `Bearer ${auth.token}` };
  if (auth.type === 'header') return { [auth.headerName.toLowerCase()]: auth.token };
  return {};
}

const short = (s: unknown, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function isResponse(m: unknown): m is RpcResponse {
  return !!m && typeof m === 'object' && 'id' in m && ('result' in m || 'error' in m);
}

function pick(msg: unknown, id: number): RpcResponse | null {
  const list = Array.isArray(msg) ? msg : [msg];
  for (const m of list) if (isResponse(m) && m.id === id) return m;
  return null;
}

export class McpClient {
  private readonly url: URL;
  private readonly auth: McpAuth;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly deadline: number | null;
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private server: McpServerInfo | null = null;

  constructor(url: string, auth: McpAuth, opts: McpClientOptions = {}) {
    this.url = parseMcpUrl(url);
    this.auth = auth;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
    this.deadline = opts.deadline ?? null;
  }

  get serverInfo(): McpServerInfo | null {
    return this.server;
  }

  /** Handshake. Called automatically by listTools / callTool. */
  async initialize(): Promise<McpServerInfo> {
    this.sessionId = null;
    this.protocolVersion = null;
    const res = await this.rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, { retryOnLostSession: false });
    const r = (res ?? {}) as { protocolVersion?: unknown; serverInfo?: { name?: unknown; title?: unknown; version?: unknown }; capabilities?: Record<string, unknown>; instructions?: unknown };
    if (typeof r.protocolVersion !== 'string') throw new McpError('PROTOCOL', 'That address answered, but not like an MCP server (no protocol version in its reply).');
    // Use what the server speaks; every version we know has the same tool calls.
    this.protocolVersion = r.protocolVersion;
    this.server = {
      name: short(r.serverInfo?.name || 'MCP server', 80),
      title: r.serverInfo?.title ? short(r.serverInfo.title, 120) : undefined,
      version: r.serverInfo?.version ? short(r.serverInfo.version, 40) : undefined,
      protocolVersion: r.protocolVersion,
      instructions: typeof r.instructions === 'string' ? r.instructions.slice(0, 2000) : undefined,
      hasTools: !!r.capabilities?.tools,
    };
    if (!KNOWN_VERSIONS.includes(r.protocolVersion)) console.warn(`[pms-mcp] server answered unknown protocol version ${short(r.protocolVersion, 40)}; continuing.`);
    await this.notify('notifications/initialized');
    return this.server;
  }

  /** Every tool the server offers (follows nextCursor; capped at 20 pages / 300 tools). */
  async listTools(): Promise<McpTool[]> {
    if (!this.server) await this.initialize();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = (await this.rpc('tools/list', cursor ? { cursor } : {})) as { tools?: unknown; nextCursor?: unknown } | null;
      if (!res || !Array.isArray(res.tools)) throw new McpError('PROTOCOL', 'The MCP server’s tool list was malformed.');
      for (const t of res.tools as Record<string, unknown>[]) {
        if (!t || typeof t.name !== 'string' || !t.name) continue;
        tools.push({
          name: t.name.slice(0, 128),
          title: typeof t.title === 'string' ? t.title : undefined,
          description: typeof t.description === 'string' ? t.description : undefined,
          inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? (t.inputSchema as JsonSchema) : { type: 'object', properties: {} },
          outputSchema: t.outputSchema && typeof t.outputSchema === 'object' ? (t.outputSchema as JsonSchema) : undefined,
          annotations: t.annotations && typeof t.annotations === 'object' ? (t.annotations as McpToolAnnotations) : undefined,
        });
        if (tools.length >= 300) return tools;
      }
      if (typeof res.nextCursor !== 'string' || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (!this.server) await this.initialize();
    const res = (await this.rpc('tools/call', { name, arguments: args })) as { content?: unknown; structuredContent?: unknown; isError?: unknown } | null;
    if (!res || typeof res !== 'object') throw new McpError('PROTOCOL', `The MCP server sent an empty result for ${name}.`);
    const parts = Array.isArray(res.content) ? (res.content as { type?: string; text?: string; resource?: { text?: string } }[]) : [];
    const text = parts
      .map((p) => (p?.type === 'text' && typeof p.text === 'string' ? p.text : p?.type === 'resource' && typeof p.resource?.text === 'string' ? p.resource.text : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, 200_000);
    let data: unknown = res.structuredContent ?? null;
    if (data === null && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { isError: res.isError === true, text, data };
  }

  /** Ends the session on the server (best effort). */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.send('DELETE', null, null, 3000);
    } catch {
      /* the server may not support explicit termination */
    }
    this.sessionId = null;
  }

  // ---------------------------------------------------------------------------

  private async rpc(method: string, params: unknown, opts: { retryOnLostSession?: boolean } = {}): Promise<unknown> {
    const id = this.nextId++;
    const body = { jsonrpc: '2.0', id, method, params };
    let res: { status: number; message: RpcResponse | null };
    try {
      res = await this.send('POST', body, id);
    } catch (e) {
      // The server forgot our session (restart / expiry): start over once.
      if (e instanceof McpError && e.detail?.httpStatus === 404 && this.sessionId && opts.retryOnLostSession !== false) {
        await this.initialize();
        return this.rpc(method, params, { retryOnLostSession: false });
      }
      throw e;
    }
    const msg = res.message;
    if (!msg) throw new McpError('PROTOCOL', `The MCP server didn’t answer ${method}.`);
    if (msg.error) {
      throw new McpError('RPC', `The PMS said: ${short(msg.error.message || 'error', 300)}`, { rpcCode: typeof msg.error.code === 'number' ? msg.error.code : undefined });
    }
    return msg.result ?? null;
  }

  private async notify(method: string): Promise<void> {
    await this.send('POST', { jsonrpc: '2.0', method }, null);
  }

  /**
   * One HTTP exchange. For requests (`expectId` set), resolves with the
   * JSON-RPC response carrying that id, from a JSON body or an SSE stream.
   */
  private send(method: 'POST' | 'DELETE', body: unknown, expectId: number | null, timeoutOverride?: number): Promise<{ status: number; message: RpcResponse | null }> {
    const remaining = this.deadline ? this.deadline - Date.now() : Infinity;
    const timeout = Math.min(timeoutOverride ?? this.timeoutMs, remaining);
    if (timeout <= 0) return Promise.reject(new McpError('TIMEOUT', 'Ran out of time talking to the PMS.'));
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const headers: OutgoingHttpHeaders = {
      accept: 'application/json, text/event-stream',
      'user-agent': `${CLIENT_INFO.name}/${CLIENT_INFO.version}`,
      ...authHeaders(this.auth),
    };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = payload.length;
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (this.protocolVersion) headers['mcp-protocol-version'] = this.protocolVersion;

    const isHttps = this.url.protocol === 'https:';
    const doRequest = isHttps ? httpsRequest : httpRequest;
    const host = this.url.hostname.replace(/^\[|\]$/g, '');

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err: Error | null, value?: { status: number; message: RpcResponse | null }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value!);
      };

      const req = doRequest(
        {
          protocol: this.url.protocol,
          hostname: host,
          port: this.url.port || (isHttps ? 443 : 80),
          path: `${this.url.pathname}${this.url.search}`,
          method,
          headers,
          lookup: guardedLookup as never,
          agent: false,
        },
        (res) => this.handleResponse(res, expectId, method, done, () => req.destroy()),
      );
      const timer = setTimeout(() => {
        done(new McpError('TIMEOUT', `The PMS didn’t answer within ${Math.round(timeout / 1000)} seconds.`));
        req.destroy();
      }, timeout);
      req.on('error', (e) => {
        if (e instanceof McpError) return done(e);
        const code = (e as NodeJS.ErrnoException).code;
        done(
          new McpError(
            'NETWORK',
            code === 'ENOTFOUND' || code === 'EAI_AGAIN'
              ? `Couldn’t find ${host} — check the MCP address.`
              : code === 'ECONNREFUSED'
                ? `${host} refused the connection — is the MCP server running?`
                : code && /CERT|SSL|TLS/i.test(code)
                  ? `${host}’s security certificate isn’t valid.`
                  : `Couldn’t reach ${host} (${code ?? 'network error'}).`,
          ),
        );
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  private handleResponse(
    res: IncomingMessage,
    expectId: number | null,
    method: string,
    done: (err: Error | null, value?: { status: number; message: RpcResponse | null }) => void,
    abort: () => void,
  ) {
    const status = res.statusCode ?? 0;
    const sid = res.headers['mcp-session-id'];
    if (typeof sid === 'string' && /^[\x21-\x7e]{1,256}$/.test(sid)) this.sessionId = sid;
    const type = String(res.headers['content-type'] ?? '').toLowerCase();

    let bytes = 0;
    const chunks: Buffer[] = [];
    const tooLarge = () => {
      done(new McpError('TOO_LARGE', 'The PMS sent a reply that is too large to handle.'));
      abort();
    };

    if (status === 401 || status === 403) {
      res.resume();
      return done(new McpError('AUTH', status === 401 ? 'The PMS refused the token (401). Check the token and try again.' : 'The PMS says this token isn’t allowed to do that (403).', { httpStatus: status }));
    }
    if (status >= 300 && status < 400) {
      res.resume();
      return done(new McpError('HTTP', `The MCP address redirects elsewhere (${status}). Paste the final MCP URL.`, { httpStatus: status }));
    }
    if (status === 404 && this.sessionId && method === 'POST') {
      res.resume();
      return done(new McpError('HTTP', 'The PMS forgot this session.', { httpStatus: 404 }));
    }
    if (status < 200 || status >= 300) {
      // Read a little of the body: many servers explain errors as JSON-RPC.
      res.on('data', (c: Buffer) => {
        if (bytes < 8192) chunks.push(c);
        bytes += c.length;
      });
      res.on('end', () => {
        let reason = '';
        try {
          const m = JSON.parse(Buffer.concat(chunks).toString('utf8').slice(0, 8192)) as { error?: { message?: string } | string; message?: string };
          reason = typeof m.error === 'string' ? m.error : m.error?.message || m.message || '';
        } catch {
          /* not JSON */
        }
        done(new McpError('HTTP', `The PMS MCP server answered ${status}${reason ? `: ${short(reason)}` : '.'}`, { httpStatus: status }));
      });
      res.on('error', () => done(new McpError('NETWORK', 'The connection to the PMS dropped.')));
      return;
    }

    // Notifications and DELETE: 202/204/200 with no body we care about.
    if (expectId === null) {
      res.resume();
      res.on('end', () => done(null, { status, message: null }));
      res.on('error', () => done(null, { status, message: null }));
      return;
    }

    if (type.includes('text/event-stream')) {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > this.maxBytes) return tooLarge();
        buffer += chunk;
        // Events end with a blank line (\n\n, \r\n\r\n or \r\r).
        let idx: number;
        while ((idx = buffer.search(/\r\n\r\n|\n\n|\r\r/)) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^(\r\n\r\n|\n\n|\r\r)/, '');
          const data = raw
            .split(/\r\n|\n|\r/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
            .join('\n');
          if (!data) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // keep-alives, comments, partial junk
          }
          const hit = pick(parsed, expectId);
          if (hit) {
            done(null, { status, message: hit });
            abort(); // we have our answer; don't hold the stream open
            return;
          }
        }
      });
      res.on('end', () => done(new McpError('PROTOCOL', 'The PMS closed the event stream without answering.')));
      res.on('error', () => done(new McpError('NETWORK', 'The connection to the PMS dropped.')));
      return;
    }

    res.on('data', (c: Buffer) => {
      bytes += c.length;
      if (bytes > this.maxBytes) return tooLarge();
      chunks.push(c);
    });
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return done(new McpError('PROTOCOL', type.includes('html') ? 'That address returned a web page, not an MCP server. Check the MCP URL.' : 'The PMS sent a reply that isn’t JSON-RPC.'));
      }
      const hit = pick(parsed, expectId);
      if (!hit) return done(new McpError('PROTOCOL', 'The PMS answered a different request.'));
      done(null, { status, message: hit });
    });
    res.on('error', () => done(new McpError('NETWORK', 'The connection to the PMS dropped.')));
  }
}
