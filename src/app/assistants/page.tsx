import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { ArrowRight, BedDouble, Code2, Link2, Mic, MousePointerClick, ShieldCheck } from 'lucide-react';
import Navigation from '@/components/Navigation';
import { SiteFooter } from '@/components/guest/SiteFooter';
import { CopyButton } from '@/components/setup/CopyButton';
import { Button } from '@/components/ui/button';
import { PRODUCT_NAME, PRODUCT_URL } from '@/config/product';

export const metadata: Metadata = {
  title: 'Book with your AI assistant',
  description: `Add ${PRODUCT_NAME} to ChatGPT, Claude, Grok, Le Chat or any AI assistant, then ask it to find and book a hotel room. Live prices, and you confirm every booking.`,
  alternates: { canonical: '/assistants' },
};

/** The origin this page was reached on, so the link works on any deployment. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host');
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return PRODUCT_URL;
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https');
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

const ASSISTANTS: { name: string; steps: React.ReactNode[] }[] = [
  {
    name: 'Claude',
    steps: [
      <>
        Open <b>Settings → Connectors</b>.
      </>,
      <>
        Choose <b>Add custom connector</b>, name it {PRODUCT_NAME} and paste the link.
      </>,
      <>In a chat, switch {PRODUCT_NAME} on from the tools menu.</>,
    ],
  },
  {
    name: 'ChatGPT',
    steps: [
      <>
        Open <b>Settings → Apps &amp; Connectors → Advanced</b> and turn on <b>Developer mode</b>.
      </>,
      <>
        Choose <b>Create</b>, name it {PRODUCT_NAME}, paste the link and pick <b>No authentication</b>.
      </>,
      <>In a chat, add {PRODUCT_NAME} from the + menu.</>,
    ],
  },
  {
    name: 'Grok',
    steps: [
      <>
        Where Grok offers <b>connectors</b> or <b>MCP servers</b>, add a new one and paste the link.
      </>,
      <>Building with the xAI API? Add the link as a remote MCP tool — no key needed.</>,
      <>Then ask Grok to find or book a room.</>,
    ],
  },
  {
    name: 'Le Chat (Mistral)',
    steps: [
      <>
        Open <b>Intelligence → Connectors</b>.
      </>,
      <>
        Choose <b>Add connector → Custom MCP connector</b> and paste the link.
      </>,
      <>No sign-in needed. Turn it on in a chat.</>,
    ],
  },
  {
    name: 'Any other assistant',
    steps: [
      <>
        Look for <b>Add MCP server</b>, <b>custom connector</b> or <b>remote tool</b>.
      </>,
      <>
        Paste the link. If asked, choose <b>Streamable HTTP</b> and no sign-in.
      </>,
      <>Then just ask for a room.</>,
    ],
  },
];

const EXAMPLES = [
  'Find me a room in Santa Cruz next weekend for two and book it.',
  'Is parking free at The Saltwater Inn?',
  'Somewhere in Monterey for 3 nights from November 12, under $250 a night.',
  'Find my booking ABC123 — the last name is Smith.',
];

const HOW = [
  { icon: BedDouble, title: 'It finds rooms', text: 'Live availability and prices, straight from the hotel — not guesses.' },
  { icon: MousePointerClick, title: 'You confirm', text: 'You get a link to the hotel’s own checkout with your room and dates filled in. Check it and confirm in one tap.' },
  { icon: Mic, title: 'No screen? No problem', text: 'On a voice chat, your assistant can send your request to the hotel. The team confirms by email or phone.' },
];

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const textLink = `rounded-sm font-medium text-primary underline-offset-4 hover:underline ${focusRing}`;

export default async function AssistantsPage() {
  const base = await origin();
  const mcp = `${base}/api/mcp`;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(ellipse_at_50%_0%,hsl(var(--primary)/0.12),transparent_65%)]" aria-hidden />
      <Navigation variant="guest" />
      <main id="main" className="relative flex-1">
        {/* Hero: what it does, and the one link people need */}
        <section className="mx-auto max-w-3xl px-4 pb-12 pt-14 text-center sm:px-6 sm:pb-16 sm:pt-20">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-primary">For travellers</p>
          <h1 className="mt-4 text-balance font-display text-4xl font-medium leading-[1.1] tracking-tight sm:text-6xl">Book with your AI assistant</h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
            Ask ChatGPT, Claude, Grok or any AI assistant to find you a room at a {PRODUCT_NAME} hotel. It checks live prices and hands you a booking link with everything filled in — you just confirm.
          </p>

          <div className="mx-auto mt-10 max-w-xl rounded-2xl border bg-card p-4 text-left shadow-soft sm:p-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="size-4 text-primary" aria-hidden /> Your assistant link
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-sunken px-3 py-2.5 font-mono text-sm text-foreground">{mcp}</code>
              <CopyButton value={mcp} label="Copy link" copiedLabel="Link copied" variant="default" size="default" className="h-11 shrink-0 sm:h-10" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Free to use. No account or sign-in needed to search and get booking links.</p>
          </div>
        </section>

        {/* Setup per assistant */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20" aria-labelledby="setup-title">
          <h2 id="setup-title" className="text-center font-display text-3xl font-medium tracking-tight">
            Add it once
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">Paste the link into your assistant’s connector settings. It takes about a minute.</p>
          <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ASSISTANTS.map((a) => (
              <li key={a.name} className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
                <h3 className="font-semibold">{a.name}</h3>
                <ol className="mt-4 space-y-3">
                  {a.steps.map((s, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground" aria-hidden>
                        {i + 1}
                      </span>
                      <span>
                        <span className="sr-only">Step {i + 1}: </span>
                        {s}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
            <li className="flex flex-col justify-center rounded-2xl border border-dashed border-border-strong/50 p-5 text-sm leading-relaxed text-muted-foreground sm:p-6">
              <p className="font-medium text-foreground">Can’t find the setting?</p>
              <p className="mt-2">Menus move around. Search your assistant’s help for “custom connector” or “MCP”. Some plans don’t include connectors yet.</p>
            </li>
          </ul>
        </section>

        {/* Example prompts */}
        <section className="border-y bg-surface-sunken/60" aria-labelledby="ask-title">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 id="ask-title" className="text-center font-display text-3xl font-medium tracking-tight">
              Then just ask
            </h2>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2">
              {EXAMPLES.map((e) => (
                <li key={e} className="rounded-2xl border bg-card px-5 py-4 text-base leading-relaxed shadow-xs">
                  <span aria-hidden className="mr-1 font-display text-2xl leading-none text-primary">
                    “
                  </span>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How booking works */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="how-title">
          <h2 id="how-title" className="text-center font-display text-3xl font-medium tracking-tight">
            How booking works
          </h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
            {HOW.map((h, i) => (
              <li key={h.title} className="rounded-2xl border bg-card p-6 shadow-xs">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                  <h.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-5 font-semibold">
                  <span className="sr-only">{i + 1}. </span>
                  {h.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{h.text}</p>
              </li>
            ))}
          </ol>
          <p className="mx-auto mt-8 flex max-w-xl items-start justify-center gap-2 text-center text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>Nothing is booked without your OK. Free cancellation until 3 PM the day before you arrive.</span>
          </p>
        </section>

        {/* For developers */}
        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6 sm:pb-24" aria-labelledby="dev-title">
          <div className="rounded-3xl border bg-card p-6 shadow-soft sm:p-10">
            <div className="flex items-start gap-4">
              <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground sm:flex" aria-hidden>
                <Code2 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="dev-title" className="font-display text-2xl font-medium tracking-tight sm:text-3xl">
                  For developers
                </h2>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  Building your own agent — on Muse, Grok, OpenAI, Anthropic or anything else? Connect over MCP or plain REST.
                </p>
                <dl className="mt-6 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium">MCP server</dt>
                    <dd className="mt-1 leading-relaxed text-muted-foreground">
                      <code className="break-all rounded-sm bg-muted px-1 py-px font-mono text-[0.85em] text-foreground">{mcp}</code> — Streamable HTTP, stateless. One hotel only:{' '}
                      <code className="break-all rounded-sm bg-muted px-1 py-px font-mono text-[0.85em] text-foreground">/api/mcp/hotels/&#123;hotel id&#125;</code>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">REST API</dt>
                    <dd className="mt-1 leading-relaxed text-muted-foreground">
                      The same operations with an{' '}
                      <a href="/openapi.json" className={textLink}>
                        OpenAPI 3.1 description
                      </a>{' '}
                      — import it as a GPT Action or any tool-calling setup.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">For models</dt>
                    <dd className="mt-1 leading-relaxed text-muted-foreground">
                      <a href="/llms.txt" className={textLink}>
                        llms.txt
                      </a>
                      ,{' '}
                      <a href="/llms-full.txt" className={textLink}>
                        llms-full.txt
                      </a>{' '}
                      and an{' '}
                      <a href="/.well-known/agent-card.json" className={textLink}>
                        agent card
                      </a>
                      .
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Confirmed bookings</dt>
                    <dd className="mt-1 leading-relaxed text-muted-foreground">
                      Search, booking links and requests need no key. To book directly (paid at the hotel), ask the hotel for an API key and send it as{' '}
                      <code className="rounded-sm bg-muted px-1 py-px font-mono text-[0.85em] text-foreground">Authorization: Bearer</code>.
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center justify-between gap-4 rounded-2xl bg-primary-soft px-6 py-5 text-primary-soft-foreground sm:flex-row">
            <p className="text-sm font-medium">Run a hotel? Give guests your own assistant link — it’s in your console under AI assistants.</p>
            <Button asChild variant="default" className="h-11 shrink-0 sm:h-10">
              <Link href="/onboarding">
                Set up your hotel <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
