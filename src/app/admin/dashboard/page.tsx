'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useSearchParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  ConciergeBell,
  Info,
  Lightbulb,
  OctagonAlert,
  PartyPopper,
  RefreshCw,
  TrendingUp,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { BookingSummary, FrontDeskAlert, FrontDeskSummary, OccupancyDay, StaffProperty } from '@/lib/dto';
import { PRODUCT_NAME } from '@/config/product';
import { fetcher } from '@/lib/fetcher';
import { fmtDay, greeting, weekday } from '@/lib/format';
import { formatNumber, money } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton, StatTile } from '@/components/ui/primitives';
import { BookingRow } from '@/components/hotel/BookingRow';
import { OccupancyChart } from '@/components/hotel/OccupancyChart';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { AskAgentButton } from '@/components/console/AskAgentButton';
import { PageShell, SectionHeader } from '@/components/console/PageShell';

interface DashboardData {
  property: (Pick<StaffProperty, 'id' | 'name' | 'city' | 'state' | 'primaryColor' | 'interfaceMode' | 'isDemo'> & { tagline: string | null }) | null;
  today: FrontDeskSummary;
  forecast: OccupancyDay[];
  revenue: { monthToDate: number; monthBookings: number; next30Days: number; next30Bookings: number };
  recent: BookingSummary[];
  checklist: { id: string; label: string; done: boolean; href: string }[];
}

// Stored per viewer; the key predates the rename and must not change.
const DISMISS_KEY = 'stayos.checklist.dismissed';

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** Compact tiles on phones: two per row, icon hidden so the number has room. */
const TILE = 'p-3.5 sm:p-4 [&>[aria-hidden]]:hidden sm:[&>[aria-hidden]]:flex';

function Checklist({ items, welcome, propertyId }: { items: DashboardData['checklist']; welcome: boolean; propertyId: string }) {
  const [dismissed, setDismissed] = React.useState(true);
  const reduce = useReducedMotion();
  React.useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(`${DISMISS_KEY}.${propertyId}`) === '1');
    } catch {
      setDismissed(false);
    }
  }, [propertyId]);
  const done = items.filter((i) => i.done).length;
  if ((dismissed && !welcome) || done === items.length) return null;
  const pct = Math.round((done / items.length) * 100);
  const next = items.find((i) => !i.done);
  const hide = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(`${DISMISS_KEY}.${propertyId}`, '1');
    } catch {
      /* preference won't persist */
    }
  };
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="relative overflow-hidden p-0" role="region" aria-labelledby="setup-title">
        <div className="grid gap-6 p-5 pr-14 sm:p-6 sm:pr-16 lg:grid-cols-[1fr_1.4fr]">
          <div>
            {welcome ? (
              <p className="flex items-center gap-2 text-sm font-medium text-primary-soft-foreground">
                <PartyPopper className="size-4" aria-hidden /> Your hotel is live
              </p>
            ) : (
              <p className="text-sm font-medium text-muted-foreground">Getting set up</p>
            )}
            <h2 id="setup-title" className="mt-1 text-balance text-xl font-semibold tracking-tight">
              {welcome ? `Welcome to ${PRODUCT_NAME} — let’s finish the basics.` : `${done} of ${items.length} steps done`}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Each step takes a minute or two. You can also just tell the agent what you need — it works with whatever you’ve set up so far.
            </p>
            <div
              className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={items.length}
              aria-valuenow={done}
              aria-valuetext={`${done} of ${items.length} steps done`}
            >
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {next && (
                <Button asChild size="sm">
                  <Link href={next.href}>
                    {next.label} <ArrowRight aria-hidden />
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={hide}>
                Hide for now
              </Button>
            </div>
          </div>
          <ul className="grid content-start gap-1 sm:grid-cols-2" aria-label="Setup steps">
            {items.map((i) => (
              <li key={i.id}>
                <Link
                  href={i.href}
                  className={cn(
                    'flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    i.done && 'text-muted-foreground'
                  )}
                >
                  {i.done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <Circle className="size-4 shrink-0 text-border-strong" aria-hidden />
                  )}
                  <span className={cn(i.done && 'line-through decoration-muted-foreground/60')}>{i.label}</span>
                  <span className="sr-only">{i.done ? ' (done)' : ' (to do)'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <IconButton label="Hide the setup checklist" size="icon-sm" onClick={hide} className="absolute right-2.5 top-2.5 text-muted-foreground">
          <X />
        </IconButton>
      </Card>
    </motion.div>
  );
}

function ForecastCard({ days }: { days: OccupancyDay[] }) {
  const avg = days.length ? Math.round(days.reduce((s, d) => s + d.occupancyPct, 0) / days.length) : 0;
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  const weekendDays = days.filter((d) => [5, 6].includes(weekday(d.date)));
  const weekendAvg = weekendDays.length ? Math.round(weekendDays.reduce((s, d) => s + d.occupancyPct, 0) / weekendDays.length) : 0;
  const soft = days.filter((d) => d.occupancyPct < 40).length;
  const insight =
    weekendAvg >= 80
      ? `Weekends are pacing at ${weekendAvg}% — there may be room to raise rates.`
      : soft >= 5
        ? `${soft} of the next ${days.length} nights are under 40% — a midweek offer could help.`
        : `Averaging ${avg}% over the next ${days.length} nights.`;
  return (
    <Card className="flex min-w-0 flex-col p-5 sm:p-6">
      <SectionHeader
        id="forecast-title"
        title={`Next ${days.length} nights`}
        description={`${avg}% average occupancy · ${money(revenue, { cents: false })} on the books`}
        action={
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <Link href="/admin/rate-calendar">
              Rates <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      />
      <OccupancyChart days={days} height={170} className="mt-4" legend label={`Occupancy for the next ${days.length} nights`} />
      <div className="mt-5 flex flex-col gap-3 rounded-xl border bg-surface-sunken p-3 sm:flex-row sm:items-center">
        <span className="flex min-w-0 flex-1 items-start gap-2.5">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span className="text-sm leading-relaxed">{insight}</span>
        </span>
        <AskAgentButton command="weekend forecast for the next 3 weekends" className="shrink-0 self-start sm:self-auto">
          Ask for a plan
        </AskAgentButton>
      </div>
    </Card>
  );
}

const ALERT_TONE: Record<FrontDeskAlert['tone'], { box: string; icon: LucideIcon }> = {
  danger: { box: 'bg-destructive-soft text-destructive-soft-foreground', icon: OctagonAlert },
  warning: { box: 'bg-warning-soft text-warning-soft-foreground', icon: TriangleAlert },
  info: { box: 'bg-info-soft text-info-soft-foreground', icon: Info },
};

function AlertList({ alerts, max = 3 }: { alerts: FrontDeskAlert[]; max?: number }) {
  if (alerts.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2.5 text-sm font-medium text-success-soft-foreground">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden /> Nothing needs attention right now.
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Needs attention">
      {alerts.slice(0, max).map((a) => {
        const t = ALERT_TONE[a.tone] ?? ALERT_TONE.info;
        const Icon = t.icon;
        return (
          <li key={a.id} className={cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm', t.box)}>
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 font-medium leading-snug">{a.title}</span>
            {a.command && (
              <AskAgentButton
                command={a.command}
                label={`Fix with the agent: ${a.title}`}
                className="h-8 shrink-0 border-border bg-surface px-2.5 text-xs text-foreground"
              >
                Fix
              </AskAgentButton>
            )}
          </li>
        );
      })}
      {alerts.length > max && (
        <li>
          <Link href="/admin/front-desk" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {alerts.length - max} more on the front desk
          </Link>
        </li>
      )}
    </ul>
  );
}

function ProgressRow({ icon: Icon, label, done, total, unit }: { icon: LucideIcon; label: string; done: number; total: number; unit: string }) {
  const pct = total ? done / total : 1;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Icon className="size-4" aria-hidden /> {label}
        </span>
        <span className="font-medium tabular">
          {formatNumber(done)}
          <span className="text-muted-foreground"> / {formatNumber(total)}</span>
          <span className="sr-only"> {unit}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
    </div>
  );
}

function TodayPanel({ today }: { today: FrontDeskSummary }) {
  const s = today.stats;
  // Arrivals/departures on the books today = done + still due (late arrivals and
  // overdue check-outs included), exactly as the front desk counts them.
  const sellable = Math.max(0, s.totalRooms - s.outOfOrder);
  return (
    <Card className="flex min-w-0 flex-col p-5 sm:p-6">
      <SectionHeader
        title="Today at the desk"
        action={
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <Link href="/admin/front-desk">
              Front desk <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      />
      <div className="mt-4 space-y-4">
        <ProgressRow icon={ArrowDownToLine} label="Checked in" done={s.arrivalsDone} total={s.arrivalsDone + s.arrivalsDue} unit="arrivals checked in" />
        <ProgressRow icon={ArrowUpFromLine} label="Checked out" done={s.departuresDone} total={s.departuresDone + s.departuresDue} unit="departures checked out" />
        <ProgressRow icon={BedDouble} label="Rooms ready" done={s.clean + s.inspected} total={sellable} unit="rooms clean or inspected" />
      </div>
      <div className="mt-5 flex-1">
        <h3 className="sr-only">Needs attention</h3>
        <AlertList alerts={today.alerts} />
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status">
      <span className="sr-only">Loading the overview…</span>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[94px] rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-[372px] rounded-2xl" />
        <Skeleton className="h-[372px] rounded-2xl" />
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

function Dashboard() {
  const { ctx, property } = useConsole();
  const params = useSearchParams();
  const welcome = params.get('welcome') === '1';
  const url = usePropertyUrl('/api/admin/dashboard');
  const { data, error, isLoading, mutate, isValidating } = useSWR<DashboardData>(url, fetcher, { refreshInterval: 60_000 });
  const firstName = ctx?.user.name.split(' ')[0];
  const s = data?.today.stats;

  return (
    <PageShell
      eyebrow={ctx ? fmtDay(ctx.today, 'long') : ' '}
      title={firstName ? `${greeting()}, ${firstName}` : 'Overview'}
      description={property ? `Here’s how ${property.name} is doing today.` : undefined}
      actions={
        <AskAgentButton size="default" command="give me the morning brief">
          Morning brief
        </AskAgentButton>
      }
    >
      {error ? (
        <Card>
          <EmptyState
            icon={TriangleAlert}
            title="We couldn’t load the overview"
            description="Check your connection and try again. Your reservations are safe."
            action={
              <Button variant="outline" onClick={() => mutate()} loading={isValidating}>
                <RefreshCw aria-hidden /> Try again
              </Button>
            }
          />
        </Card>
      ) : isLoading || !data || !s ? (
        <DashboardSkeleton />
      ) : (
        <>
          {property && <Checklist items={data.checklist} welcome={welcome} propertyId={property.id} />}

          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              className={TILE}
              label="Occupancy tonight"
              value={`${s.occupancyPct}%`}
              hint={`${formatNumber(s.occupiedTonight)} of ${plural(s.totalRooms, 'room')}`}
              icon={BedDouble}
            />
            <StatTile
              className={TILE}
              label="In house"
              value={formatNumber(s.inHouse)}
              hint={s.arrivalsDue ? `${formatNumber(s.arrivalsDue)} still to arrive` : 'All arrivals in'}
              icon={ConciergeBell}
            />
            <StatTile
              className={TILE}
              label="Booked this month"
              value={money(data.revenue.monthToDate, { cents: false })}
              hint={plural(data.revenue.monthBookings, 'reservation')}
              icon={CircleDollarSign}
            />
            <StatTile
              className={TILE}
              label="Next 30 days"
              value={money(data.revenue.next30Days, { cents: false })}
              hint={`${plural(data.revenue.next30Bookings, 'stay')} booked`}
              icon={TrendingUp}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <ForecastCard days={data.forecast} />
            <TodayPanel today={data.today} />
          </div>

          <Card className="overflow-hidden p-0">
            <SectionHeader
              className="px-5 pb-3 pt-5 sm:px-6"
              title="Latest reservations"
              description="Newest first, across every channel"
              action={
                <Button asChild variant="ghost" size="sm" className="-mr-2">
                  <Link href="/admin/bookings">
                    <span className="hidden sm:inline">All reservations</span>
                    <span className="sm:hidden">View all</span> <ArrowRight aria-hidden />
                  </Link>
                </Button>
              }
            />
            {data.recent.length === 0 ? (
              <EmptyState
                className="border-t py-10"
                icon={CalendarDays}
                title="No reservations yet"
                description="Share your booking page — new reservations show up here the moment they’re made."
                action={
                  property ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/properties/${property.id}`} target="_blank" rel="noopener">
                        Open booking page
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="divide-y border-t">
                {data.recent.map((b) => (
                  <BookingRow key={b.id} booking={b} today={data.today.date} href={`/admin/bookings/${b.id}`} />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}

export default function DashboardPage() {
  // useSearchParams needs a Suspense boundary so the shell can prerender.
  return (
    <React.Suspense>
      <Dashboard />
    </React.Suspense>
  );
}
