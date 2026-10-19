/**
 * Error tracking on the server (Next.js instrumentation). Sentry starts only
 * when SENTRY_DSN is set; `onRequestError` reports errors thrown while
 * rendering pages and running route handlers that our own code didn't catch.
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    // Guests' and staff's personal details stay out of error reports.
    sendDefaultPii: false,
  });
}

export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (process.env.SENTRY_DSN) Sentry.captureRequestError(...args);
};
