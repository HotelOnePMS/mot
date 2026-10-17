import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  AudioLines,
  CalendarCheck2,
  Check,
  ChevronDown,
  Clock,
  FileDown,
  Globe,
  History,
  Hotel,
  KeyRound,
  Laptop,
  LayoutGrid,
  Lock,
  MessageCircle,
  MousePointerClick,
  Percent,
  PhoneCall,
  PhoneIncoming,
  RefreshCw,
  Rocket,
  ServerCog,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/primitives';
import { AgentDemo } from '@/components/marketing/AgentDemo';
import { TalkToConcierge } from '@/components/voice/VoiceDock';
import { SiteFooter } from '@/components/guest/SiteFooter';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL, PRODUCT_TAGLINE } from '@/config/product';

// The title comes from the root layout's default; description and social
// cards inherit from it too.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** One label per action across the page. */
const CTA = { primary: 'Set up your hotel', secondary: 'See a demo hotel' } as const;

const TRUST = [
  { icon: Percent, title: '0% commission', body: 'on bookings through your own site.' },
  { icon: Clock, title: 'Answers 24/7', body: 'calls and guest questions, day or night.' },
  { icon: ShieldCheck, title: 'You approve every change', body: 'the agent proposes, your team confirms.' },
  { icon: Rocket, title: 'Live in days', body: 'not months. Start with one piece if you like.' },
];

/** Systems hotels pick during onboarding; the bridge works them for you. */
const SYSTEMS = ['Cloudbeds', 'Mews', 'Oracle OPERA Cloud', 'Little Hotelier', 'RoomRaccoon', 'eZee Absolute'];

const PATHS: { id: string; icon: LucideIcon; title: string; who: string; body: string; cta: string; badge: string; extras?: { icon: LucideIcon; label: string }[] }[] = [
  {
    id: 'full',
    icon: Hotel,
    title: `Run on ${PRODUCT_NAME}`,
    who: 'For hotels that want one system.',
    body: 'Your booking site, front desk, housekeeping, rates, reports, the agent and voice — all in one place. Bring your rooms over in an afternoon.',
    cta: CTA.primary,
    badge: 'Most complete',
  },
  {
    id: 'bridge',
    icon: ServerCog,
    title: 'Keep your PMS',
    who: 'For hotels that aren’t ready to switch (or never will).',
    body: 'The agent and voice work your current reservation system for you, with your own logins. Move over whenever you like.',
    cta: 'Connect your system',
    badge: 'No migration',
    extras: [
      { icon: Laptop, label: 'Front-desk computer' },
      { icon: Lock, label: 'Secure cloud browser' },
    ],
  },
  {
    id: 'voice',
    icon: PhoneCall,
    title: 'Just voice',
    who: 'For hotels that want to stop missing calls first.',
    body: 'A voice front desk that answers with your real rooms and prices, plus an inbox for every message it takes. Nothing else to change.',
    cta: 'Start with voice',
    badge: 'Fastest',
  },
];

const FEATURES: { icon: LucideIcon; title: string; lead: string; points: string[]; ai?: boolean; early?: boolean }[] = [
  {
    icon: Globe,
    title: 'Your own booking site',
    lead: 'Booking platforms take 15–25% of every reservation. A site in your own name keeps it.',
    points: ['Your name and colours — guests never see ours.', 'Dates, room, details, booked: under two minutes on a phone.', 'Live availability and exact prices, with free changes until the day before.'],
  },
  {
    icon: PhoneCall,
    title: 'Voice front desk',
    lead: 'Missed calls are missed bookings. This clerk never sleeps and never puts anyone on hold.',
    points: ['Answers 24/7: quotes prices, checks availability, finds reservations.', 'Speaks naturally, handles interruptions and hands off to you when it should.', 'Uses the same live data and permissions as your team.'],
    ai: true,
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp',
    lead: 'Meet guests where they already are, at any hour.',
    points: ['Answers questions about rooms, parking and check-in instantly.', 'Sends booking links and pre-arrival messages.', 'Hands anything unusual to your team.'],
    ai: true,
    early: true,
  },
  {
    icon: RefreshCw,
    title: 'Channel sync',
    lead: 'Double bookings live in the gaps between systems. One calendar closes them.',
    points: ['Two-way prices and availability with Booking.com, Expedia and Airbnb.', 'No double bookings, no late-night rate entry.', 'Channel bookings land at the same front desk as direct ones.'],
    early: true,
  },
];

const AGENT_POINTS = [
  { icon: MousePointerClick, title: 'Ask it, see it', body: 'Ask in plain words and the answer arrives as the right screen — a list you can act on, a room map, a price grid — not a wall of text.' },
  { icon: ShieldCheck, title: 'Nothing changes without you', body: 'Every change is a plan you review first. Plans expire, run once and land in the activity log under your name.' },
  { icon: LayoutGrid, title: 'Classic screens, one click away', body: 'Prefer dashboards? Switch to Classic any time — same data, same actions. Each person picks their own default.' },
];

const CHANNELS = [
  { icon: PhoneIncoming, label: 'Your phone line' },
  { icon: MessageCircle, label: 'WhatsApp' },
  { icon: AudioLines, label: 'Voice on your website' },
];

const STEPS = [
  { title: 'Tell us about your hotel', body: 'Name, rooms and prices — or connect your current system and skip the typing.' },
  { title: 'Make it yours', body: 'Pick your brand colour, add photos and preview your booking site before anyone else sees it.' },
  { title: 'Go live', body: 'Share your booking link, switch on the voice front desk and run the desk in plain words.' },
];

const TIERS: { name: string; price: number | null; blurb: string; features: string[]; cta: string; href: string; popular?: boolean }[] = [
  {
    name: 'Voice',
    price: 29,
    blurb: 'Stop missing calls, whatever system you use.',
    features: ['Voice front desk', '100 voice minutes a month', 'Works alongside any system', 'Call summaries and messages'],
    cta: 'Start with voice',
    href: '/onboarding?path=voice',
  },
  {
    name: 'Professional',
    price: 149,
    blurb: 'Everything one hotel needs to sell direct.',
    features: ['Everything in Voice, with 500 minutes', 'Booking site and agent console', 'Front desk, housekeeping and rates', 'Keep-your-PMS bridge included', 'Priority onboarding call'],
    cta: CTA.primary,
    href: '/onboarding',
    popular: true,
  },
  {
    name: 'Portfolio',
    price: null,
    blurb: 'For groups running several properties.',
    features: ['Multiple properties', 'Voice minutes sized to you', 'All channels and API access', 'A dedicated account manager'],
    cta: 'Talk to us',
    href: '/contact',
  },
];

const SECURITY = [
  { icon: Lock, title: 'Encrypted', body: 'in transit and at rest, kept separate for each hotel.' },
  { icon: KeyRound, title: 'Your logins stay sealed', body: 'with a key only your workspace uses.' },
  { icon: History, title: 'Every change logged', body: 'who asked, who confirmed and when.' },
  { icon: FileDown, title: 'Your data is yours', body: 'export everything, any time.' },
];

const FAQS = [
  { q: `Will my guests know I’m using ${PRODUCT_NAME}?`, a: 'No. Your booking site and messages carry only your branding. We stay out of sight.' },
  {
    q: 'Do I have to leave my current reservation system?',
    a: `No. Connect it instead: install the ${PRODUCT_NAME} connector on a front-desk computer, or let the agent use your system in our isolated cloud browser with logins you store encrypted. Most hotels move over later, once they’ve seen it work — and we move your data for you.`,
  },
  { q: 'Can the agent do something I didn’t ask for?', a: 'It can only propose. Every change is shown as a plan with exactly what will happen, and runs only when someone with the right role confirms it. Everything is in the activity log.' },
  { q: 'How does the voice agent handle complicated requests?', a: 'It answers from your live prices, rooms and policies, and knows when to hand off — anything unusual goes to your front desk with a summary.' },
  { q: 'Is my guest data safe?', a: 'Data is kept separate for each property and encrypted in transit and at rest. Stored system logins are encrypted with a key only your workspace uses. You can export everything, any time.' },
  { q: 'What does it cost to get started?', a: 'Nothing up front. Start free, no card needed, and only pay when you go live.' },
];

const FAQ_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

/** Same edges as the header and footer on every section. */
const container = 'mx-auto w-full max-w-7xl px-4 sm:px-6';

function SectionIntro({ id, eyebrow, title, body, align = 'center', className }: { id: string; eyebrow?: ReactNode; title: ReactNode; body?: ReactNode; align?: 'center' | 'left'; className?: string }) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow && <p className="text-2xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>}
      <h2 id={id} className={cn('text-balance font-display text-3xl leading-tight tracking-tight md:text-4xl', eyebrow && 'mt-3')}>
        {title}
      </h2>
      {body && <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">{body}</p>}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navigation variant="marketing" />

      <main id="main" className="flex-1">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_60%_at_85%_10%,hsl(var(--primary)/0.10),transparent_70%),radial-gradient(40%_45%_at_10%_0%,hsl(var(--highlight)/0.10),transparent_70%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(hsl(var(--border-strong)/0.18)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
          />
          <div className={cn(container, 'grid items-center gap-12 pb-16 pt-10 md:pb-24 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16')}>
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
                <Hotel className="h-3.5 w-3.5 text-primary" /> For independent hotels, inns and motels
              </p>
              <h1 id="hero-title" className="mt-6 text-balance font-display text-4xl leading-[1.08] tracking-tight sm:text-5xl xl:text-6xl">
                {PRODUCT_TAGLINE}
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
                A booking site under your own name, a front desk you run by simply saying what you need, and a voice agent that picks up every call — with your real rooms and prices behind every answer.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/onboarding">
                    {CTA.primary} <ArrowRight />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/properties">{CTA.secondary}</Link>
                </Button>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {['Free to start', 'No card needed', 'Keep your current system'].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-primary" /> {t}
                  </li>
                ))}
              </ul>
              {/* Travellers: talk to the HotelOne concierge (the site's voice dock) — say a place and dates. */}
              <TalkToConcierge className="mt-8 max-w-xl" />
            </div>

            <div className="relative min-w-0 lg:ml-4">
              <AgentDemo />
              {/* Decorative proof points around the demo (desktop only). */}
              <div aria-hidden className="pointer-events-none absolute -bottom-6 -left-6 hidden rounded-2xl border bg-surface-raised p-3.5 pr-5 shadow-lifted sm:block xl:-left-10">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground">
                    <CalendarCheck2 className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">New direct booking</p>
                    <p className="whitespace-nowrap text-xs text-muted-foreground">
                      3 nights · {usd.format(681)} · 0% commission
                    </p>
                  </div>
                </div>
              </div>
              <div aria-hidden className="pointer-events-none absolute -right-3 -top-6 hidden items-center gap-2.5 rounded-full border bg-surface-raised py-1.5 pl-1.5 pr-4 shadow-lifted sm:flex">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-agent-soft text-agent-soft-foreground">
                  <PhoneIncoming className="h-3.5 w-3.5" />
                </span>
                <span className="text-xs font-medium">Call answered at 11:42 pm</span>
              </div>
            </div>
          </div>
        </section>

        {/* Trust strip: product facts, no invented customers or numbers. */}
        <section aria-label={`Why hotels choose ${PRODUCT_NAME}`} className="border-y bg-surface">
          <div className={cn(container, 'py-10')}>
            <ul className="grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4 lg:gap-x-8">
              {TRUST.map((t) => (
                <li key={t.title} className="flex flex-col items-start gap-3 sm:flex-row sm:gap-3.5">
                  <IconTile icon={t.icon} tone="brand" size="lg" className="size-10" />
                  <p className="text-sm leading-snug">
                    <span className="block font-semibold text-foreground">{t.title}</span>
                    <span className="text-muted-foreground">{t.body}</span>
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 border-t pt-6 md:flex-row md:items-center md:gap-6">
              <p className="shrink-0 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Keeps working with your system</p>
              <ul className="flex flex-wrap gap-x-6 gap-y-2">
                {SYSTEMS.map((s) => (
                  <li key={s} className="font-display text-base text-foreground/70">
                    {s}
                  </li>
                ))}
                <li className="text-sm text-muted-foreground">and more</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Three paths */}
        <section aria-labelledby="paths-title" className="py-14 md:py-24">
          <div className={container}>
            <SectionIntro
              id="paths-title"
              eyebrow="Three ways to start"
              title="Start where you are"
              body="Switch everything, keep what you have, or begin with one piece. Every path grows into the next without starting over."
            />
            <ul className="mt-12 grid gap-5 md:grid-cols-3">
              {PATHS.map((p) => (
                <li
                  key={p.id}
                  className="group relative flex flex-col rounded-2xl border bg-card p-5 shadow-xs transition-[box-shadow,transform,border-color] sm:p-6 duration-200 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background hover:-translate-y-0.5 hover:border-border-strong/50 hover:shadow-lifted motion-reduce:hover:translate-y-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <IconTile icon={p.icon} tone="brand" size="lg" />
                    <Badge variant="neutral" size="sm">
                      {p.badge}
                    </Badge>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{p.title}</h3>
                  <p className="mt-1 text-sm font-medium text-foreground/80">{p.who}</p>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                  {p.extras && (
                    <ul className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      {p.extras.map((x) => (
                        <li key={x.label} className="flex items-center gap-1.5 rounded-lg bg-surface-sunken px-2.5 py-2">
                          <x.icon className="h-3.5 w-3.5 shrink-0" /> {x.label}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    href={`/onboarding?path=${p.id}`}
                    className="mt-4 inline-flex min-h-10 items-center gap-1.5 self-start text-sm font-semibold text-primary after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none"
                  >
                    {p.cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-center text-sm text-muted-foreground">Change paths any time — your rooms, prices and guests come with you.</p>
          </div>
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-title" className="scroll-mt-20 border-y bg-surface-sunken py-14 md:py-24">
          <div className={container}>
            <SectionIntro
              id="features-title"
              eyebrow="Features"
              title="Everything a modern hotel needs. Nothing with someone else’s logo on it."
            />
            <ul className="mt-12 grid gap-5 md:grid-cols-2">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex flex-col rounded-2xl border bg-card p-5 shadow-xs sm:p-7">
                  <div className="flex items-center gap-3.5">
                    <IconTile icon={f.icon} tone="brand" size="lg" />
                    <h3 className="min-w-0 flex-1 text-lg font-semibold tracking-tight sm:text-xl">{f.title}</h3>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {f.ai && (
                        <Badge variant="agent" size="sm" icon={Sparkles}>
                          AI
                        </Badge>
                      )}
                      {f.early && (
                        <Badge variant="info" size="sm">
                          Early access
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">{f.lead}</p>
                  <ul className="mt-4 space-y-2.5 border-t pt-4 sm:mt-5 sm:pt-5">
                    {f.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2.5 text-sm leading-relaxed">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {pt}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* The AI front desk: the only place on the page that uses the agent colours. */}
        <section id="agent" aria-labelledby="agent-title" className="scroll-mt-20 py-14 md:py-24">
          <div className={cn(container, 'grid items-center gap-12 lg:grid-cols-2 lg:gap-16')}>
            <div>
              <Badge variant="agent" icon={Sparkles}>
                The AI front desk
              </Badge>
              <h2 id="agent-title" className="mt-4 text-balance font-display text-3xl leading-tight tracking-tight md:text-4xl">
                Run the desk in plain language. Watch the screen build itself.
              </h2>
              <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
                “Who’s arriving late?” becomes a list you can act on. “Move the Okafors to an ocean view” becomes a plan you confirm. The agent works on live data — it never guesses a room, a price or a guest.
              </p>
              <ul className="mt-8 space-y-6">
                {AGENT_POINTS.map((p) => (
                  <li key={p.title} className="flex gap-4">
                    <IconTile icon={p.icon} tone="agent" size="lg" className="size-10" />
                    <div>
                      <h3 className="font-semibold">{p.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative overflow-hidden rounded-3xl bg-aurora p-6 text-agent-gradient-foreground shadow-float sm:p-8">
              <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-agent-gradient-foreground/10 blur-2xl" />
              <p className="relative flex items-center gap-2 text-sm font-medium text-agent-gradient-foreground/85">
                <AudioLines className="h-4 w-4" /> Voice and messaging
              </p>
              <h3 className="relative mt-3 text-balance font-display text-2xl leading-snug sm:text-3xl">A voice that picks up every call.</h3>
              <p className="relative mt-3 text-pretty text-sm leading-relaxed text-agent-gradient-foreground/85 sm:text-base">
                Your phone line, WhatsApp and a “Talk to us” button on your site — answered by an agent that knows your live rooms and prices, and hands off to your team when it should.
              </p>
              <ul className="relative mt-5 flex flex-wrap gap-2">
                {CHANNELS.map((c) => (
                  <li key={c.label} className="inline-flex items-center gap-1.5 rounded-full bg-agent-gradient-foreground/15 px-3 py-1.5 text-xs font-medium">
                    <c.icon className="h-3.5 w-3.5" /> {c.label}
                  </li>
                ))}
              </ul>
              <figure className="relative mt-6 space-y-2.5 rounded-2xl bg-overlay/25 p-4">
                <figcaption className="text-2xs font-semibold uppercase tracking-wider text-agent-gradient-foreground/80">An example call</figcaption>
                <p className="mr-8 rounded-2xl rounded-tl-md bg-surface px-3.5 py-2.5 text-sm text-foreground">
                  <span className="sr-only">Guest: </span>Hi — do you have a room for two this Friday?
                </p>
                <p className="ml-8 rounded-2xl rounded-tr-md bg-agent-gradient-foreground/15 px-3.5 py-2.5 text-sm">
                  <span className="sr-only">Agent: </span>We do. An Ocean King is {usd.format(227)} for Friday night. Shall I text you a link to book it?
                </p>
              </figure>
              <Link
                href="/onboarding?path=voice"
                className="relative mt-6 inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-gradient-foreground"
              >
                Start with just voice <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-y bg-surface py-14 md:py-24">
          <div className={container}>
            <SectionIntro id="how-title" eyebrow="How it works" title="From sign-up to your first direct booking in three steps." />
            <ol className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
              <span aria-hidden className="absolute left-[12%] right-[12%] top-6 hidden h-px bg-border md:block" />
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative flex gap-4 md:flex-col md:items-center md:text-center">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-highlight/40 bg-highlight-soft font-display text-xl text-highlight-soft-foreground ring-8 ring-surface">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold md:mt-4">{s.title}</h3>
                    <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-12 flex flex-col items-center gap-3">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/onboarding">
                  {CTA.primary} <ArrowRight />
                </Link>
              </Button>
              <p className="text-sm text-muted-foreground">Step one takes about a minute.</p>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-14 md:py-24">
          <div className={container}>
            <SectionIntro
              id="pricing-title"
              eyebrow="Pricing"
              title="Simple pricing. Zero commission on direct bookings."
              body="Launch pricing. No setup fees. Cancel any time."
            />
            <ul className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-3 md:items-start">
              {TIERS.map((t) => (
                <li
                  key={t.name}
                  className={cn(
                    'relative flex flex-col rounded-2xl border bg-card p-6 shadow-xs sm:p-7',
                    t.popular && 'order-first border-primary shadow-lifted ring-1 ring-primary md:order-none md:-mt-3 md:pb-10'
                  )}
                >
                  {t.popular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-highlight px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-highlight-foreground shadow-xs">
                      Most popular
                    </span>
                  )}
                  <h3 className="font-semibold">{t.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t.blurb}</p>
                  <p className="mt-5 flex items-baseline gap-1">
                    {t.price === null ? (
                      <span className="font-display text-4xl tracking-tight">Custom</span>
                    ) : (
                      <>
                        <span className="tabular font-display text-4xl tracking-tight">{usd.format(t.price)}</span>
                        <span className="text-sm text-muted-foreground">/ month</span>
                      </>
                    )}
                  </p>
                  <ul className="mt-6 flex-1 space-y-2.5 border-t pt-6">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="mt-8 w-full" size="lg" variant={t.popular ? 'default' : 'outline'}>
                    <Link href={t.href}>{t.cta}</Link>
                  </Button>
                </li>
              ))}
            </ul>

            <div className="mx-auto mt-14 max-w-5xl rounded-2xl border bg-surface p-6 sm:p-8">
              <h3 className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-5 w-5 text-primary" /> Your data stays yours
              </h3>
              <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {SECURITY.map((s) => (
                  <li key={s.title} className="flex items-start gap-3 text-sm leading-snug">
                    <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <p>
                      <span className="block font-medium">{s.title}</span>
                      <span className="text-muted-foreground">{s.body}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t bg-surface-sunken py-14 md:py-24">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
            <SectionIntro id="faq-title" eyebrow="FAQ" title="Questions, answered." />
            <div className="mt-10 space-y-3">
              {FAQS.map((f) => (
                <details key={f.q} className="group rounded-2xl border bg-card shadow-xs transition-shadow open:shadow-soft">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Still wondering about something?{' '}
              <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`} className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Email {PRODUCT_SUPPORT_EMAIL}
              </a>
            </p>
          </div>
        </section>

        {/* Final call to action */}
        <section aria-labelledby="cta-title" className="relative isolate overflow-hidden bg-inverse py-16 text-inverse-foreground md:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45%_75%_at_18%_30%,hsl(var(--primary)/0.32),transparent_70%),radial-gradient(40%_70%_at_88%_80%,hsl(var(--highlight)/0.16),transparent_70%)]"
          />
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 id="cta-title" className="text-balance font-display text-3xl leading-tight tracking-tight sm:text-4xl md:text-5xl">
              Your next guest is searching right now. Be the booking they find.
            </h2>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-inverse-foreground text-inverse hover:bg-inverse-foreground/90 focus-visible:ring-inverse-foreground focus-visible:ring-offset-inverse"
              >
                <Link href="/onboarding">
                  {CTA.primary} <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-inverse-foreground/30 bg-transparent text-inverse-foreground shadow-none hover:border-inverse-foreground/60 hover:bg-inverse-foreground/10 hover:text-inverse-foreground focus-visible:ring-inverse-foreground focus-visible:ring-offset-inverse"
              >
                <Link href="/properties">{CTA.secondary}</Link>
              </Button>
            </div>
            <p className="mt-6 text-sm text-inverse-foreground/75">Free to start · live in days · your brand front and centre</p>
          </div>
        </section>
      </main>

      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD).replace(/</g, '\\u003c') }} />
    </div>
  );
}
