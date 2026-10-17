import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, MessageSquareText, ShieldCheck } from 'lucide-react';
import Navigation from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { SiteFooter } from '@/components/guest/SiteFooter';
import { LogoMark } from '@/components/brand/Logo';
import { PRODUCT_NAME } from '@/config/product';

export const metadata: Metadata = {
  title: 'About',
  description: `${PRODUCT_NAME} gives independent hotels a booking site under their own name, a front desk run by saying what you need, and a phone agent that never misses a call.`,
  alternates: { canonical: '/about' },
};

const PRINCIPLES = [
  { icon: Building2, title: 'Your brand, your guests', text: 'Guests book with you, not with us. Your name, your colours, your data — exportable any time.' },
  { icon: MessageSquareText, title: 'Say it, see it', text: 'Software should understand “check in the Smiths” and show you the right screen — not make you hunt for it.' },
  { icon: ShieldCheck, title: 'People stay in charge', text: 'The agent proposes, a person confirms. Every action is permission-checked and written to the activity log.' },
];

const PATHS = [
  { title: 'Run everything here', text: 'Booking site, front desk, rates and the phone agent.' },
  { title: 'Keep your current system', text: 'The agent works alongside the software you already use.' },
  { title: 'Just the phone agent', text: 'Answer every call and WhatsApp message, day and night.' },
];

export default function AboutPage() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_at_50%_0%,hsl(var(--primary)/0.12),transparent_65%)]"
        aria-hidden
      />
      <Navigation variant="marketing" />
      <main id="main" className="relative flex-1">
        <section>
          <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
            <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-primary">About {PRODUCT_NAME}</p>
            <h1 className="mt-4 text-balance font-display text-4xl font-medium leading-[1.1] tracking-tight sm:text-6xl">Built for the people who keep the lights on</h1>
            <div className="mx-auto mt-6 h-1 w-14 rounded-full bg-highlight" aria-hidden />
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Independent hotel owners do everything — front desk, housekeeping, night audit — and still lose 15–25% of every booking to online travel agencies, plus every guest who calls after hours and gets no answer.
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg leading-relaxed text-foreground">
              {PRODUCT_NAME} gives them a booking site under their own name, a front desk they can run by just saying what they need, and a voice that never misses a call.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6 sm:pb-24" aria-labelledby="principles-title">
          <h2 id="principles-title" className="text-center font-display text-3xl font-medium tracking-tight">
            What we believe
          </h2>
          <ul className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
            {PRINCIPLES.map((p) => (
              <li key={p.title} className="rounded-2xl border bg-card p-6 shadow-xs">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                  <p.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-5 font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.text}</p>
              </li>
            ))}
          </ul>

          <div className="relative mt-16 overflow-hidden rounded-3xl bg-inverse px-6 py-10 text-inverse-foreground sm:px-10 sm:py-12">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,hsl(var(--primary)/0.5),transparent_55%)]"
              aria-hidden
            />
            <LogoMark className="pointer-events-none absolute -bottom-20 -right-14 hidden h-72 w-72 drop-shadow-2xl xl:block" />
            <div className="relative max-w-2xl">
              <h2 className="font-display text-3xl font-medium tracking-tight">Start where you are</h2>
              <p className="mt-3 text-inverse-foreground/75">There’s no big switch-over. Pick the setup that fits your hotel today and change it later.</p>
              <ul className="mt-8 grid gap-4 sm:grid-cols-3">
                {PATHS.map((p) => (
                  <li key={p.title} className="border-l-2 border-highlight/70 pl-4">
                    <p className="font-medium">{p.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-inverse-foreground/70">{p.text}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="bg-inverse-foreground text-inverse hover:bg-inverse-foreground/90 focus-visible:ring-inverse-foreground focus-visible:ring-offset-inverse">
                  <Link href="/onboarding">
                    Set up your hotel <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-inverse-foreground/30 bg-transparent text-inverse-foreground hover:bg-inverse-foreground/10 focus-visible:ring-inverse-foreground focus-visible:ring-offset-inverse"
                >
                  <Link href="/contact">Talk to us</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
