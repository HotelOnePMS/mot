/**
 * Client fetch helpers: JSON in/out, readable errors from our API's
 * `{ error }` shape, and an offline-aware message.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(
      typeof navigator !== 'undefined' && !navigator.onLine ? 'You’re offline. Reconnect and try again.' : 'Couldn’t reach the server. Try again.',
      0,
      'NETWORK'
    );
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const body = (data ?? {}) as { error?: string; message?: string; code?: string; details?: unknown };
    throw new ApiError(body.error || body.message || `Request failed (${res.status})`, res.status, body.code, body.details);
  }
  return data as T;
}

export const fetcher = <T,>(url: string) => api<T>(url);
