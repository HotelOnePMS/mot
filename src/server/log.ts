/**
 * Server logging and error tracking. One line of JSON per event in
 * production (Vercel, Datadog and friends parse it), readable lines in
 * development. Errors also go to Sentry when SENTRY_DSN is set
 * (instrumentation.ts initialises it); without it nothing leaves the server.
 *
 * Never log secrets or whole request bodies: pass the ids that explain the event.
 */
import * as Sentry from '@sentry/nextjs';

type Level = 'info' | 'warn' | 'error';

const production = process.env.NODE_ENV === 'production';
export const errorTrackingEnabled = () => !!process.env.SENTRY_DSN;

function serialise(v: unknown): unknown {
  if (v instanceof Error) return { name: v.name, message: v.message, ...(production ? {} : { stack: v.stack }) };
  return v;
}

function write(level: Level, scope: string, message: string, details: unknown[]) {
  if (production) {
    const line = JSON.stringify({ level, scope, message, time: new Date().toISOString(), ...(details.length ? { details: details.map(serialise) } : {}) });
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  } else {
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(`[${scope}] ${message}`, ...details);
  }
}

export function logInfo(scope: string, message: string, ...details: unknown[]) {
  write('info', scope, message, details);
}

export function logWarn(scope: string, message: string, ...details: unknown[]) {
  write('warn', scope, message, details);
}

/** Log an error and report it to Sentry (the first Error among the details, else the message). */
export function logError(scope: string, message: string, ...details: unknown[]) {
  write('error', scope, message, details);
  if (!errorTrackingEnabled()) return;
  const err = details.find((d): d is Error => d instanceof Error);
  const extra = Object.fromEntries(details.filter((d) => !(d instanceof Error)).map((d, i) => [`detail${i}`, d]));
  Sentry.withScope((s) => {
    s.setTag('scope', scope);
    s.setExtras({ message, ...extra });
    if (err) Sentry.captureException(err);
    else Sentry.captureMessage(`[${scope}] ${message}`, 'error');
  });
}

/** Wrap background work (Next.js `after`) so a failure is logged and reported instead of vanishing. */
export function reportFailures<T>(scope: string, what: string, run: () => Promise<T>): () => Promise<T | undefined> {
  return () =>
    run().catch((e) => {
      logError(scope, `${what} failed`, e);
      return undefined;
    });
}
