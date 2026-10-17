'use client';

import * as React from 'react';
import Link from 'next/link';
import { Home, RotateCcw } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';

/** Friendly fallback when a page throws. Kept free of session/data hooks so it can't fail itself. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [retrying, setRetrying] = React.useState(false);

  React.useEffect(() => {
    console.error(error);
  }, [error]);

  React.useEffect(() => {
    document.title = `Something went wrong · ${PRODUCT_NAME}`;
  }, []);

  function retry() {
    setRetrying(true);
    React.startTransition(() => reset());
    // reset() re-renders in place; give the button its label back if it fails again.
    window.setTimeout(() => setRetrying(false), 1500);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center px-4 sm:px-6">
        <Link
          href="/"
          aria-label={`${PRODUCT_NAME} home`}
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Logo />
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-lg px-4 py-16 text-center sm:px-6">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-primary">Something went wrong</p>
          <h1 className="mt-3 text-balance font-display text-4xl font-medium tracking-tight">This page didn’t load properly</h1>
          <p className="mx-auto mt-4 max-w-md text-pretty leading-relaxed text-muted-foreground">
            It’s on our side, not yours. Trying again usually fixes it.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" onClick={retry} loading={retrying}>
              {!retrying && <RotateCcw aria-hidden />} Try again
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/">
                <Home aria-hidden /> Back to home
              </Link>
            </Button>
          </div>
          <p className="mt-8 text-sm text-muted-foreground">
            If it keeps happening, email{' '}
            <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {PRODUCT_SUPPORT_EMAIL}
            </a>
            {error.digest ? (
              <>
                {' '}
                and mention reference <span className="font-mono text-foreground">{error.digest}</span>.
              </>
            ) : (
              '.'
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
