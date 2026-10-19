/**
 * Error tracking in the browser: on when NEXT_PUBLIC_SENTRY_DSN is set, and
 * only then is Sentry downloaded. No session replay and no personal data.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import('@sentry/nextjs').then((Sentry) =>
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0),
      sendDefaultPii: false,
    })
  );
}
