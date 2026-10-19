/**
 * The shared public-demo logins. A plain module (not 'use client') so server
 * pages like /demo read the real value instead of a client reference.
 */

/** One-click demo logins: on in development, and in production with NEXT_PUBLIC_DEMO_MODE=true. */
export const DEMO_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEMO_MODE !== 'false');

export const DEMO_PASSWORD = 'demo1234';
