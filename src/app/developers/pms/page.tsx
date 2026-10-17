import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Bot, FileJson, KeyRound, Phone, ShieldCheck, Webhook } from 'lucide-react';
import Navigation from '@/components/Navigation';
import { SiteFooter } from '@/components/guest/SiteFooter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL, PRODUCT_URL } from '@/config/product';
import { CONTRACT, CONTRACT_VERSION, EVENT_TYPES } from '@/server/pms/contract';
import { publicSiteUrl } from '@/server/public-url';

export const metadata: Metadata = {
  title: 'Connect your PMS',
  description: `PMS vendors: expose your system as an MCP server and every hotel on it can use ${PRODUCT_NAME}’s agents — console, voice front desk and phone line — with staff confirming every change.`,
  alternates: { canonical: '/developers/pms' },
};

const MCP_SPEC = 'https://modelcontextprotocol.io/specification/2025-06-18';

const BENEFITS = [
  { icon: Bot, title: 'Your PMS becomes agent-native', text: `Staff ask ${PRODUCT_NAME}’s console agent “who’s arriving?” or “check in Moreno into 14” and it reads and acts in your system through your MCP server.` },
  { icon: Phone, title: 'Voice and phone, too', text: `The same tools power ${PRODUCT_NAME}’s voice front desk and the hotel’s phone line, so answers come from your live data.` },
  { icon: ShieldCheck, title: 'People stay in charge', text: 'Look-ups use your read-only tools. Every change is shown to hotel staff as a plan and only runs after they confirm it.' },
];

const STEPS = [
  { title: 'Run a remote MCP server', text: 'Streamable HTTP (MCP 2025-06-18; 2025-03-26 also works), authenticated with a per-hotel token — a bearer token or a header such as X-API-Key.' },
  { title: 'The hotel connects it', text: `In ${PRODUCT_NAME} → Your PMS, the owner pastes your MCP URL and their token. We call initialize and tools/list before saving anything.` },
  { title: 'We discover your tools', text: 'Each tool is cached as a reusable skill and matched to the contract below. Names don’t have to be exact: common aliases and parameter names are recognised.' },
  { title: 'Staff just ask', text: 'Recognised operations run directly; anything else is planned by our AI with only the tools the task allows, at most 8 calls per task.' },
];

function Code({ children, label }: { children: string; label: string }) {
  return (
    <figure className="mt-4">
      <figcaption className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</figcaption>
      <pre className="mt-2 max-w-full overflow-x-auto rounded-xl border bg-surface-sunken p-4 font-mono text-xs leading-relaxed text-foreground">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

function args(schema: (typeof CONTRACT)[number]['inputSchema']): string {
  const props = Object.keys(schema.properties ?? {});
  if (!props.length) return '—';
  const required = new Set(schema.required ?? []);
  return props.map((p) => (required.has(p) ? p : `${p}?`)).join(', ');
}

export default function PmsDevelopersPage() {
  const origin = publicSiteUrl() ?? PRODUCT_URL;
  const toolExample = JSON.stringify(
    {
      name: 'list_arrivals',
      title: 'List arrivals',
      description: CONTRACT[0].description,
      inputSchema: CONTRACT[0].inputSchema,
      annotations: { readOnlyHint: true },
    },
    null,
    2,
  );
  const curlExample = `SECRET='pmsevt_…'   # ${PRODUCT_NAME} → Your PMS → Events
URL='${origin}/api/pms/events/<connectionId>'
BODY='{"id":"evt_1001","type":"reservation.created","occurred_at":"2026-10-18T14:03:00Z","data":{"reservation_id":"R-1001","confirmation_code":"ABC123","guest_name":"Ana Moreno","arrival":"2026-10-20","departure":"2026-10-22","room_type":"Deluxe King"}}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST "$URL" \\
  -H 'Content-Type: application/json' \\
  -H "X-HotelOne-Timestamp: $TS" \\
  -H "X-HotelOne-Signature: sha256=$SIG" \\
  --data "$BODY"`;
  const jsExample = `import { createHmac } from 'node:crypto';

export async function sendHotelOneEvent(url, secret, event) {
  const body = JSON.stringify(event); // sign exactly the bytes you send
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = 'sha256=' + createHmac('sha256', secret).update(\`\${timestamp}.\${body}\`).digest('hex');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HotelOne-Timestamp': timestamp, 'X-HotelOne-Signature': signature },
    body,
  });
  if (!res.ok) throw new Error(\`HotelOne answered \${res.status}\`);
}

await sendHotelOneEvent(url, secret, {
  id: 'evt_1002',
  type: 'room.status_changed',
  occurred_at: new Date().toISOString(),
  data: { room_number: '14', status: 'clean', previous_status: 'dirty' },
});`;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_50%_0%,hsl(var(--primary)/0.10),transparent_65%)]" aria-hidden />
      <Navigation variant="marketing" />
      <main id="main" className="relative flex-1">
        <section className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-primary">For PMS partners</p>
          <h1 className="mt-4 text-balance font-display text-4xl font-medium leading-[1.1] tracking-tight sm:text-5xl">Connect your PMS to {PRODUCT_NAME}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
            Expose your PMS as an MCP server and every hotel that uses it can run {PRODUCT_NAME}’s agents on top of it — no screen-scraping, no migration.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <a href="#contract">
                See the tool contract <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="/developers/pms/contract.json">
                <FileJson className="h-4 w-4" aria-hidden /> contract.json
              </a>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-14 sm:px-6" aria-labelledby="benefits-title">
          <h2 id="benefits-title" className="sr-only">
            What you get
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {BENEFITS.map((b) => (
              <li key={b.title} className="rounded-2xl border bg-card p-6 shadow-xs">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                  <b.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-5 font-semibold">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-14 sm:px-6" aria-labelledby="how-title">
          <h2 id="how-title" className="font-display text-3xl font-medium tracking-tight">
            How it works
          </h2>
          <ol className="mt-6 space-y-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-inverse text-sm font-semibold text-inverse-foreground" aria-hidden>
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="contract" className="mx-auto max-w-5xl scroll-mt-24 px-4 pb-14 sm:px-6" aria-labelledby="contract-title">
          <div className="max-w-3xl">
            <h2 id="contract-title" className="font-display text-3xl font-medium tracking-tight">
              The recommended tool contract
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Expose these tools and {PRODUCT_NAME} works with your PMS the moment a hotel connects. Mark read tools with <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">annotations.readOnlyHint: true</code>, return JSON in{' '}
              <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">structuredContent</code> (or as JSON text), and report failures with{' '}
              <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">isError: true</code> and a message a front-desk clerk can read. Version {CONTRACT_VERSION}. <span className="whitespace-nowrap">? = optional</span>.
            </p>
          </div>
          <ul className="mt-6 divide-y rounded-2xl border bg-card">
            {CONTRACT.map((op) => (
              <li key={op.name} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-6 sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all font-mono text-sm font-semibold">{op.name}</code>
                    <Badge size="sm" variant={op.writes ? 'warning' : 'success'}>
                      {op.writes ? 'write' : 'read'}
                    </Badge>
                  </div>
                  <p className="mt-1 break-words font-mono text-xs text-muted-foreground">({args(op.inputSchema)})</p>
                </div>
                <div className="min-w-0 text-sm leading-relaxed">
                  <p>{op.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Also recognised: {op.aliases.slice(0, 4).join(', ')}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Lists return reservations as <code className="font-mono text-[0.8125rem]">{'{ reservation_id, confirmation_code, guest_name, arrival, departure, room_number?, room_type?, status }'}</code>. Write tools run only after staff confirm, so
            make them do exactly one thing. Your other tools still work through our planner — but we never call tools that delete, refund, export data or manage users.
          </p>
          <div className="max-w-3xl">
            <Code label="Example tool definition">{toolExample}</Code>
          </div>
        </section>

        <section id="events" className="mx-auto max-w-3xl scroll-mt-24 px-4 pb-14 sm:px-6" aria-labelledby="events-title">
          <div className="flex items-center gap-3">
            <Webhook className="h-6 w-6 text-primary" aria-hidden />
            <h2 id="events-title" className="font-display text-3xl font-medium tracking-tight">
              Events webhook
            </h2>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Tell {PRODUCT_NAME} when something changes and it shows up in the hotel’s activity log, where staff and the agent see it (“PMS: reservation created — Ana Moreno, 20–22 Oct”). The hotel’s owner copies the URL and secret from{' '}
            {PRODUCT_NAME} → Your PMS.
          </p>
          <dl className="mt-5 space-y-3 rounded-2xl border bg-card p-5 text-sm">
            <div>
              <dt className="font-semibold">Endpoint</dt>
              <dd className="mt-1 break-all font-mono text-xs text-muted-foreground">POST {origin}/api/pms/events/&lt;connectionId&gt;</dd>
            </div>
            <div>
              <dt className="font-semibold">Body (JSON, up to 64 KB)</dt>
              <dd className="mt-1 break-words font-mono text-xs text-muted-foreground">{'{ "id"?: "evt_…", "type": "reservation.created", "occurred_at": "ISO 8601", "data": { … } }'}</dd>
            </div>
            <div>
              <dt className="font-semibold">Types</dt>
              <dd className="mt-1 break-words font-mono text-xs text-muted-foreground">{EVENT_TYPES.join(' · ')}</dd>
            </div>
            <div>
              <dt className="font-semibold">Signature</dt>
              <dd className="mt-1 text-muted-foreground">
                <span className="break-all font-mono text-xs">X-HotelOne-Timestamp: &lt;unix seconds&gt;</span>
                <br />
                <span className="break-all font-mono text-xs">X-HotelOne-Signature: sha256=&lt;hex HMAC-SHA256(secret, timestamp + &quot;.&quot; + raw body)&gt;</span>
                <br />
                Deliveries more than 5 minutes off our clock are rejected; an <code className="font-mono text-xs">id</code> seen in the last 24 hours is accepted once.
              </dd>
            </div>
          </dl>
          <Code label="curl">{curlExample}</Code>
          <Code label="JavaScript (Node 18+)">{jsExample}</Code>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6" aria-labelledby="security-title">
          <div className="flex items-center gap-3">
            <KeyRound className="h-6 w-6 text-primary" aria-hidden />
            <h2 id="security-title" className="font-display text-3xl font-medium tracking-tight">
              Security
            </h2>
          </div>
          <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
            <li>Tokens are sealed with AES-256-GCM on our server. They are never shown again, never logged and never sent to an AI model.</li>
            <li>Look-ups may only call read-only tools. Write tools run only after a hotel staff member confirms the plan, and every change is written to the hotel’s activity log.</li>
            <li>At most 8 tool calls and 60 seconds per task, with per-hotel hourly limits. Tools that delete, refund, export data or manage users are never called, and hotels can switch off any of your tools.</li>
            <li>Your server must be public HTTPS; we don’t follow redirects and never connect to private network addresses.</li>
            <li>Events are signed per connection, time-limited and rate-limited.</li>
          </ul>
          <div className="mt-10 rounded-2xl border bg-surface-sunken p-6">
            <h2 className="font-semibold">Build it</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a className="font-medium text-primary underline-offset-4 hover:underline" href="/developers/pms/contract.json">
                  contract.json
                </a>{' '}
                <span className="text-muted-foreground">— the contract with full JSON Schemas</span>
              </li>
              <li>
                <a className="font-medium text-primary underline-offset-4 hover:underline" href={MCP_SPEC} target="_blank" rel="noreferrer">
                  Model Context Protocol specification
                </a>{' '}
                <span className="text-muted-foreground">— transports, tools and annotations</span>
              </li>
              <li>
                <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/contact">
                  Talk to us
                </Link>{' '}
                <span className="text-muted-foreground">
                  — or write to <a className="underline-offset-4 hover:underline" href={`mailto:${PRODUCT_SUPPORT_EMAIL}`}>{PRODUCT_SUPPORT_EMAIL}</a> for a test hotel
                </span>
              </li>
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
