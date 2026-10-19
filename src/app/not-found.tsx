import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Home, Search } from 'lucide-react';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { Button } from '@/components/ui/button';
import { LOGO_GEOMETRY } from '@/components/brand/Logo';
import { PRODUCT_SUPPORT_EMAIL } from '@/config/product';
import { LABELS } from '@/config/copy';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

/** A room-number plaque reading 404, in the mark's style. Decorative. */
function RoomPlaque() {
  const g = LOGO_GEOMETRY;
  return (
    <div className="relative mx-auto flex w-56 flex-col items-center rounded-[2rem] bg-primary px-8 pb-7 pt-8 text-primary-foreground shadow-lifted" aria-hidden>
      <svg viewBox="5 4 22 20" className="h-12 w-12">
        <circle cx={g.bow.cx} cy={g.bow.cy} r={g.bow.r} className="fill-primary-foreground" />
        <path d={g.stem} className="fill-primary-foreground" />
      </svg>
      <span className="mt-4 font-display text-6xl font-medium leading-none tracking-tight tabular">404</span>
      <span className="mt-5 h-1 w-16 rounded-full bg-highlight" />
    </div>
  );
}

export default function NotFound() {
  return (
    <MarketingShell className="relative overflow-x-clip" mainClassName="flex items-center">
      {/* Positioned against the shell (main isn't), so the glow starts behind the header. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(ellipse_at_50%_0%,hsl(var(--primary)/0.10),transparent_65%)]"
        aria-hidden
      />
      <div className="relative mx-auto w-full max-w-xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <RoomPlaque />
        <p className="mt-10 text-2xs font-semibold uppercase tracking-[0.18em] text-primary">Error 404</p>
        <h1 className="mt-3 text-balance font-display text-4xl font-medium tracking-tight sm:text-5xl">We can’t find that room</h1>
        <p className="mx-auto mt-4 max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
          The link may be old, or the page may have moved. Let’s get you somewhere useful.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/">
              <Home aria-hidden /> Back to home
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/properties">
              <Search aria-hidden /> {LABELS.findStay}
            </Link>
          </Button>
        </div>
        <p className="mt-8 text-sm text-muted-foreground">
          Still stuck?{' '}
          <Link href="/contact" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
            {LABELS.contact} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>{' '}
          or email <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`} className="font-medium text-primary underline-offset-4 hover:underline">{PRODUCT_SUPPORT_EMAIL}</a>
        </p>
      </div>
    </MarketingShell>
  );
}
