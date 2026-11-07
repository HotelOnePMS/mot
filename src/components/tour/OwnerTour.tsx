'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BadgeDollarSign,
  BrushCleaning,
  CalendarCheck2,
  ChartLine,
  Check,
  CircleAlert,
  ConciergeBell,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Pause,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useVoiceDock } from '@/components/voice/VoiceDock';
import { useVoicePage } from '@/components/voice/page-context';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';
import { TOUR_HOTEL, TOUR_STOPS, tourStop, type TourStopId } from '@/config/tour';
import { SAMPLE } from './sample-data';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const ICONS: Record<TourStopId, LucideIcon> = {
  overview: LayoutDashboard,
  agent: Sparkles,
  'front-desk': ConciergeBell,
  bookings: CalendarCheck2,
  housekeeping: BrushCleaning,
  rates: BadgeDollarSign,
  channels: Globe,
  payments: CreditCard,
  disputes: ShieldAlert,
  reports: ChartLine,
  voice: AudioLines,
};

type Tone = 'success' | 'warning' | 'info' | 'danger' | 'neutral';

const ROOM_TONE: Record<string, Tone> = { Clean: 'success', Dirty: 'warning', 'In progress': 'info', 'Out of order': 'danger' };

/** How long each stop stays up when the tour plays on its own. */
const AUTOPLAY_MS = 9_000;

function Panel({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-xl border bg-card shadow-xs', className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <h3 className="text-sm font-medium">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-medium tabular-nums tracking-tight">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Initials({ name }: { name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-2xs font-semibold text-primary-soft-foreground" aria-hidden>
      {name
        .split(' ')
        .map((p) => p[0])
        .join('')}
    </span>
  );
}

/** A table that scrolls sideways inside its panel on phones, never the page. */
function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2.5 align-middle">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Screen({ stop, go }: { stop: TourStopId; go: (id: TourStopId) => void }) {
  switch (stop) {
    case 'overview':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {SAMPLE.kpis.map((k) => (
              <Stat key={k.label} {...k} />
            ))}
          </div>
          <Panel title="Needs you today">
            <ul className="divide-y">
              {SAMPLE.attention.map((a) => (
                <li key={a.text}>
                  <button type="button" onClick={() => go(a.stop)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                    <CircleAlert className={cn('size-4 shrink-0', a.tone === 'danger' ? 'text-destructive' : a.tone === 'warning' ? 'text-warning' : 'text-info')} aria-hidden />
                    <span className="min-w-0 flex-1">{a.text}</span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      );
    case 'agent':
      return (
        <div className="space-y-4">
          <div className="ml-auto max-w-md rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">{SAMPLE.agentPlan.request}</div>
          <Panel className="border-agent/30 shadow-glow">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-agent-soft px-4 py-2.5">
              <p className="flex items-center gap-2 text-sm font-medium text-agent-soft-foreground">
                <Sparkles className="size-4" aria-hidden /> Plan: check in Jordan Smith
              </p>
              <Badge variant="agent" size="sm">
                Waiting for you
              </Badge>
            </div>
            <ol className="space-y-2 px-4 py-3 text-sm">
              {SAMPLE.agentPlan.steps.map((s, i) => (
                <li key={s} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
              <Button size="sm" type="button" tabIndex={-1} aria-disabled>
                <Check aria-hidden /> Confirm
              </Button>
              <Button size="sm" variant="outline" type="button" tabIndex={-1} aria-disabled>
                Change
              </Button>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden /> Runs once, logged under your name
              </p>
            </div>
          </Panel>
        </div>
      );
    case 'front-desk':
      return (
        <Panel title="Arrivals today" action={<span className="text-xs text-muted-foreground">9 arriving · 7 leaving</span>}>
          <ul className="divide-y">
            {SAMPLE.arrivals.map((a) => (
              <li key={a.guest} className="flex items-center gap-3 px-4 py-2.5">
                <Initials name={a.guest} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.guest}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.room} · {a.nights} {a.nights === 1 ? 'night' : 'nights'}
                    {a.note && ` · ${a.note}`}
                  </p>
                </div>
                <Badge variant={a.tone as Tone} size="sm">
                  {a.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      );
    case 'bookings':
      return (
        <Panel title="Reservations" action={<span className="text-xs text-muted-foreground">Next 7 days</span>}>
          <Table
            head={['Code', 'Guest', 'Dates', 'Source', 'Total', 'Balance', 'Status']}
            rows={SAMPLE.bookings.map((b) => [
              <span key="c" className="font-mono text-xs">
                {b.code}
              </span>,
              b.guest,
              b.dates,
              <Badge key="s" variant={b.source === 'Direct' || b.source.startsWith('Phone') || b.source === 'Walk-in' ? 'success' : 'neutral'} size="sm">
                {b.source}
              </Badge>,
              <span key="t" className="tabular-nums">
                {usd.format(b.total)}
              </span>,
              <span key="b" className="tabular-nums">
                {b.balance ? usd.format(b.balance) : 'Paid'}
              </span>,
              b.status,
            ])}
          />
        </Panel>
      );
    case 'housekeeping':
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SAMPLE.rooms.map((r) => (
            <div key={r.room} className="rounded-xl border bg-card p-3 shadow-xs">
              <p className="font-display text-xl font-medium tabular-nums">{r.room}</p>
              <p className="text-xs text-muted-foreground">{r.type}</p>
              <Badge variant={ROOM_TONE[r.status] ?? 'neutral'} size="sm" className="mt-2">
                {r.status}
              </Badge>
            </div>
          ))}
        </div>
      );
    case 'rates':
      return (
        <Panel title="Rate calendar" action={<span className="text-xs text-muted-foreground">Price · rooms left</span>}>
          <Table
            head={['Room type', ...SAMPLE.rateDays]}
            rows={SAMPLE.rates.map((r) => [
              <span key="n" className="font-medium">
                {r.type}
              </span>,
              ...r.prices.map((p, i) => (
                <span key={i} className="block tabular-nums">
                  {usd.format(p)}
                  <span className={cn('block text-2xs', r.left[i] === 0 ? 'text-destructive' : 'text-muted-foreground')}>{r.left[i] === 0 ? 'Sold out' : `${r.left[i]} left`}</span>
                </span>
              )),
            ])}
          />
        </Panel>
      );
    case 'channels':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          {SAMPLE.channels.map((c) => (
            <div key={c.name} className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{c.name}</p>
                <Badge variant="success" size="sm" dot>
                  {c.status}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Prices and availability synced {c.synced}</p>
              <p className="mt-1 text-sm">
                <span className="font-medium tabular-nums">{c.bookings}</span> bookings this month
              </p>
            </div>
          ))}
        </div>
      );
    case 'payments':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Taken this month" value={usd.format(48920)} />
            <Stat label="Refunds" value="3" note={usd.format(447)} />
            <Stat label="Next payout" value={usd.format(6210)} note="Nov 9 to Stripe" />
          </div>
          <Panel title="Recent payments">
            <ul className="divide-y">
              {SAMPLE.payments.map((p) => (
                <li key={p.what} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.what}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.kind} · {p.when}
                    </span>
                  </span>
                  <span className={cn('tabular-nums', p.amount < 0 && 'text-destructive')}>{p.amount < 0 ? `−${usd.format(-p.amount)}` : usd.format(p.amount)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      );
    case 'disputes': {
      const d = SAMPLE.dispute;
      return (
        <Panel className="border-destructive/30">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-destructive-soft px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium text-destructive-soft-foreground">
                <ShieldAlert className="size-4" aria-hidden /> {d.guest} disputed {usd.format(d.amount)}
              </p>
              <p className="mt-0.5 text-xs text-destructive-soft-foreground/80">{d.booking}</p>
            </div>
            <Badge variant="danger" size="sm">
              {d.due}
            </Badge>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm text-muted-foreground">{d.reason}</p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence from your records</p>
            <ul className="mt-2 space-y-2">
              {d.evidence.map((e) => (
                <li key={e.label} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
                    <Check className="size-3" aria-hidden />
                  </span>
                  <span>
                    <span className="font-medium">{e.label}</span>
                    <span className="block text-xs text-muted-foreground">{e.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
            <Button size="sm" type="button" tabIndex={-1} aria-disabled>
              Submit evidence
            </Button>
            <p className="text-xs text-muted-foreground">Nothing is sent to the bank until you press submit.</p>
          </div>
        </Panel>
      );
    }
    case 'reports': {
      const r = SAMPLE.report;
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {r.stats.map((s) => (
              <Stat key={s.label} {...s} />
            ))}
          </div>
          <Panel title="Occupancy and direct share" action={<span className="text-xs text-muted-foreground">Last 6 months</span>}>
            <div className="flex h-44 items-end gap-3 px-4 pb-3 pt-4" role="img" aria-label={`Occupancy by month: ${r.months.map((m, i) => `${m} ${r.occupancy[i]}%`).join(', ')}. Direct share rose from ${r.direct[0]}% to ${r.direct.at(-1)}%.`}>
              {r.months.map((m, i) => (
                <div key={m} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                  <div className="relative w-full max-w-10 overflow-hidden rounded-t-md bg-primary/25" style={{ height: `${r.occupancy[i]}%` }}>
                    <div className="absolute inset-x-0 bottom-0 bg-primary" style={{ height: `${(r.direct[i] / r.occupancy[i]) * 100}%` }} />
                  </div>
                  <span className="text-2xs text-muted-foreground">{m}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-primary/25" aria-hidden /> Occupancy
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-primary" aria-hidden /> Booked direct
              </span>
            </div>
          </Panel>
        </div>
      );
    }
    case 'voice':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {SAMPLE.callStats.map((s) => (
              <Stat key={s.label} {...s} />
            ))}
          </div>
          <Panel title="Recent calls">
            <ul className="divide-y">
              {SAMPLE.calls.map((c) => (
                <li key={c.caller} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-agent-soft text-agent-soft-foreground" aria-hidden>
                    <AudioLines className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.what}</span>
                    <span className="block text-xs text-muted-foreground">{c.caller}</span>
                  </span>
                  <Badge variant={c.tone as Tone} size="sm">
                    {c.outcome}
                  </Badge>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      );
  }
}

/**
 * The owner demo: a sample hotel's console, one stop at a time. The voice
 * concierge drives it (show_demo_stop → showTourStop) and explains each stop;
 * without voice, Play walks through the same stops with their captions.
 */
export function OwnerTour() {
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const dock = useVoiceDock();
  const initial = (tourStop(params.get('stop'))?.id ?? 'overview') as TourStopId;
  const [current, setCurrent] = React.useState<TourStopId>(initial);
  const [playing, setPlaying] = React.useState(false);
  const mainRef = React.useRef<HTMLDivElement>(null);
  const index = TOUR_STOPS.findIndex((s) => s.id === current);
  const stop = TOUR_STOPS[index];

  const go = React.useCallback((id: TourStopId) => {
    setCurrent(id);
    // Keep the address bar on this stop (a reload or a shared link opens it), without a navigation.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('stop', id);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // Not essential.
    }
    // On a phone the screen is below the stop list: bring it into view.
    const el = mainRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Phones: the stop list scrolls sideways; keep the current stop in it visible.
  const navRef = React.useRef<HTMLUListElement>(null);
  React.useEffect(() => {
    const list = navRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, [current, reduce]);

  // Play: advance on a timer, stopping at the end.
  React.useEffect(() => {
    if (!playing) return;
    const next = TOUR_STOPS[index + 1];
    if (!next) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => go(next.id), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [playing, index, go]);

  useVoicePage({
    kind: 'tour',
    summary: `the owner demo (${TOUR_HOTEL}, a sample hotel’s console, sample data only), showing “${stop.title}” (stop ${index + 1} of ${TOUR_STOPS.length})`,
    actions: {
      showTourStop: (id) => {
        const s = tourStop(id);
        if (!s) return { ok: false, error: 'Unknown stop.' };
        setPlaying(false);
        go(s.id as TourStopId);
        return { ok: true, message: `“${s.title}” is on screen.` };
      },
    },
  });

  const prev = TOUR_STOPS[index - 1];
  const next = TOUR_STOPS[index + 1];

  return (
    <div className="bg-surface-sunken">
      <div className="border-b bg-highlight-soft text-highlight-soft-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm sm:px-6">
          <FlaskConical className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-medium">Owner demo.</span> {TOUR_HOTEL} is a sample hotel: every guest, booking and payment here is test data.
          </p>
          <Link href="/" className="font-medium underline underline-offset-4">
            Exit demo
          </Link>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_1fr] lg:py-8">
        <nav aria-label="Demo screens" className="min-w-0">
          <p className="hidden px-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground lg:block">{TOUR_HOTEL}</p>
          <ul ref={navRef} className="relative -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:mt-2 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {TOUR_STOPS.map((s) => {
              const Icon = ICONS[s.id];
              const active = s.id === current;
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      go(s.id);
                    }}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'flex min-h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active ? 'bg-primary-soft font-medium text-primary-soft-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden /> {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div ref={mainRef} className="min-w-0 scroll-mt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {stop.label} · step {index + 1} of {TOUR_STOPS.length}
              </p>
              <h1 className="mt-1 font-display text-2xl font-medium tracking-tight sm:text-3xl">{stop.title}</h1>
            </div>
            <Badge variant="highlight" size="sm" icon={FlaskConical}>
              Sample data
            </Badge>
          </div>

          <div aria-live="polite" className="mt-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={current}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.22 }}
              >
                <Screen stop={current} go={(id) => { setPlaying(false); go(id); }} />
                <p className="mt-4 rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed shadow-xs">{stop.caption}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={!prev} onClick={() => prev && (setPlaying(false), go(prev.id))}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            <Button type="button" variant="outline" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />} {playing ? 'Pause' : 'Play tour'}
            </Button>
            {next ? (
              <Button type="button" onClick={() => (setPlaying(false), go(next.id))}>
                Next: {next.label} <ArrowRight aria-hidden />
              </Button>
            ) : (
              <Button asChild>
                <Link href="/onboarding">
                  Try it with your hotel <ArrowRight aria-hidden />
                </Link>
              </Button>
            )}
            {dock?.available && (
              <Button type="button" variant="agent" className="sm:ml-auto" onClick={dock.start} onPointerEnter={dock.prepare} onFocus={dock.prepare}>
                <AudioLines aria-hidden /> Talk me through it
              </Button>
            )}
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            This is a guided preview of the {PRODUCT_NAME} console with made-up data. Buttons here don’t change anything.
          </p>
        </div>
      </div>
    </div>
  );
}
