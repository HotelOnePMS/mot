/**
 * Typed domain errors. Services throw these; route handlers translate them
 * into HTTP responses via `handleRoute`. Messages are safe to show to users.
 */
export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const unauthorized = (msg = 'Please sign in to continue.') => new DomainError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = "You don't have permission to do that.") => new DomainError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new DomainError(404, 'NOT_FOUND', `${what} not found.`);
export const badRequest = (msg: string, details?: Record<string, unknown>) =>
  new DomainError(400, 'BAD_REQUEST', msg, details);
export const conflict = (msg: string, details?: Record<string, unknown>) => new DomainError(409, 'CONFLICT', msg, details);
