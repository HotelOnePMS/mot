'use client';

import * as React from 'react';
import './globals.css';
import { LogoMark } from '@/components/brand/Logo';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';

/**
 * Last-resort fallback when the root layout itself fails. It replaces the
 * whole document, so it renders its own <html>/<body> and plain controls.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>{`Something went wrong · ${PRODUCT_NAME}`}</title>
      </head>
      <body className="bg-background font-sans text-foreground antialiased">
        <main className="flex min-h-dvh items-center justify-center px-4 py-16">
          <div className="w-full max-w-md text-center">
            <LogoMark className="mx-auto h-12 w-12" />
            <h1 className="mt-6 text-3xl font-semibold tracking-tight">Something went wrong</h1>
            <p className="mt-3 leading-relaxed text-muted-foreground">{PRODUCT_NAME} couldn’t load this page. Please try again in a moment.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Try again
              </button>
              {/* A full page load, since the app shell itself failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-input bg-surface px-6 font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Back to home
              </a>
            </div>
            <p className="mt-8 text-sm text-muted-foreground">
              Need help? Email{' '}
              <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`} className="font-medium text-primary underline-offset-4 hover:underline">
                {PRODUCT_SUPPORT_EMAIL}
              </a>
              {error.digest ? ` (reference ${error.digest})` : ''}.
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
