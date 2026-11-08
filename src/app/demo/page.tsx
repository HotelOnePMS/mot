import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, Globe, LayoutDashboard, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/primitives';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { DemoLogins } from '@/components/auth/DemoLogins';
import { DEMO_ENABLED } from '@/config/demo';
import { LABELS, TERMS } from '@/config/copy';
import { PRODUCT_NAME } from '@/config/product';
import { prisma } from '@/lib/prisma';
import { LISTED_PROPERTY } from '@/server/concierge/facts';
import { TOUR_PATH } from '@/config/tour';

export const revalidate = 300;

export const metadata: Metadata = {
  title: LABELS.demo,
  description: `See ${PRODUCT_NAME} the way your guests and your team will: a demo hotel’s booking site, and the hotel console behind it.`,
  alternates: { canonical: '/demo' },
};

const GUEST_POINTS = ['Your name and colours. Guests never see ours.', 'Live availability and exact prices.', 'Dates, room, details, booked: under two minutes on a phone.'];

const CONSOLE_POINTS = [`Ask the ${TERMS.agent} in plain words; it shows the right screen.`, 'Arrivals, check-in, housekeeping and rates.', 'Each role sees only what it needs.'];

/** The first listed demo hotel's booking site; the directory when there is none (or no database). */
async function demoHotel(): Promise<{ href: string; name: string | null }> {
  try {
    const property = await prisma.property.findFirst({
      where: { isDemo: true, ...LISTED_PROPERTY },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (property) return { href: `/properties/${property.id}`, name: property.name };
  } catch {
    // Fall through to the directory.
  }
  return { href: '/properties', name: null };
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-2.5 border-t pt-6">
      {items.map((pt) => (
        <li key={pt} className="flex items-start gap-2.5 text-sm leading-relaxed">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> {pt}
        </li>
      ))}
    </ul>
  );
}

export default async function DemoPage() {
  const hotel = await demoHotel();

  return (
    <MarketingShell className="relative overflow-x-clip">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_at_50%_0%,hsl(var(--primary)/0.12),transparent_65%)]"
        aria-hidden
      />
      <div className="relative">
        <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-primary">See it working</p>
          <h1 className="mt-4 text-balance font-display text-4xl font-medium leading-[1.1] tracking-tight sm:text-6xl">{LABELS.demo}</h1>
          <div className="mx-auto mt-6 h-1 w-14 rounded-full bg-highlight" aria-hidden />
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">See {PRODUCT_NAME} the way your guests and your team will.</p>
        </section>

        <div className="mx-auto grid max-w-5xl gap-5 px-4 sm:px-6 md:grid-cols-2">
          <section aria-labelledby="demo-guest-title" className="flex flex-col rounded-3xl border bg-card p-6 shadow-soft sm:p-8">
            <IconTile icon={Globe} tone="brand" size="lg" />
            <h2 id="demo-guest-title" className="mt-5 font-display text-2xl font-medium tracking-tight">
              Your guests’ booking site
            </h2>
            <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">What a guest sees when they book with you: a site in your hotel’s name, with no commission on what they book.</p>
            <Points items={GUEST_POINTS} />
            <div className="mt-auto pt-8">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href={hotel.href}>
                  Open the demo hotel <ArrowRight aria-hidden />
                </Link>
              </Button>
              {hotel.name && <p className="mt-3 text-sm text-muted-foreground">Opens {hotel.name}, one of our demo hotels.</p>}
            </div>
          </section>

          <section aria-labelledby="demo-console-title" className="flex flex-col rounded-3xl border bg-card p-6 shadow-soft sm:p-8">
            <IconTile icon={LayoutDashboard} tone="brand" size="lg" />
            <h2 id="demo-console-title" className="mt-5 font-display text-2xl font-medium tracking-tight">
              Your hotel console
            </h2>
            <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">Where your team works, from the owner to housekeeping. Every change is confirmed by a person and logged.</p>
            {DEMO_ENABLED ? (
              <DemoLogins className="mt-6" />
            ) : (
              <>
                <Points items={CONSOLE_POINTS} />
                <div className="mt-auto pt-8">
                  <p className="font-medium">Want a walkthrough?</p>
                  <p className="mt-1 text-sm text-muted-foreground">Tell us about your hotel and we’ll show you around.</p>
                  <Button asChild size="lg" variant="outline" className="mt-4 w-full sm:w-auto">
                    <Link href="/contact">{LABELS.contact}</Link>
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="mx-auto mt-5 max-w-5xl px-4 sm:px-6">
          <Link
            href={TOUR_PATH}
            className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-3xl border bg-card p-5 shadow-soft transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
          >
            <IconTile icon={PlayCircle} tone="agent" size="lg" />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-xl font-medium tracking-tight">Take the guided owner tour</span>
              <span className="mt-1 block text-sm text-muted-foreground">A sample hotel’s console, screen by screen: front desk, reservations, rates, channels, payments, a card dispute and reports. Ask the voice guide to talk you through it.</span>
            </span>
            <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>

        <section aria-labelledby="demo-next-title" className="mx-auto max-w-3xl px-4 pb-16 pt-12 text-center sm:px-6 sm:pb-24">
          <h2 id="demo-next-title" className="font-display text-2xl font-medium tracking-tight">
            Ready to try it with your own rooms?
          </h2>
          <Button asChild size="lg" className="mt-6 w-full sm:w-auto">
            <Link href="/onboarding">
              {LABELS.hotelSignup} <ArrowRight aria-hidden />
            </Link>
          </Button>
        </section>
      </div>
    </MarketingShell>
  );
}
