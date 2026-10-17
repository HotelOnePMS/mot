/**
 * Errors from talking to a PMS vendor's MCP server. Messages are written for
 * hotel staff and never contain tokens.
 */
import { DomainError } from '../errors';

export type McpErrorCode =
  | 'BLOCKED_URL' // refused by the URL guard (scheme, private network)
  | 'NETWORK' // DNS / connection failure
  | 'TIMEOUT'
  | 'AUTH' // 401 / 403 from the server
  | 'HTTP' // any other non-2xx
  | 'TOO_LARGE' // response over the size cap
  | 'PROTOCOL' // not JSON-RPC / not MCP
  | 'RPC'; // a JSON-RPC error object from the server

export class McpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly detail?: { httpStatus?: number; rpcCode?: number },
  ) {
    super(message);
    this.name = 'McpError';
  }
}

const STATUS: Record<McpErrorCode, number> = {
  BLOCKED_URL: 400,
  NETWORK: 502,
  TIMEOUT: 504,
  AUTH: 400,
  HTTP: 502,
  TOO_LARGE: 502,
  PROTOCOL: 502,
  RPC: 502,
};

/** For route handlers: an McpError becomes a DomainError with a staff-readable message. */
export function toDomainError(e: unknown): unknown {
  if (e instanceof McpError) return new DomainError(STATUS[e.code], `PMS_MCP_${e.code}`, e.message, e.detail ? { ...e.detail } : undefined);
  return e;
}
