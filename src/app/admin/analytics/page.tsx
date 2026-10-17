'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { BedDouble, ChartLine, CircleDollarSign, Gauge, TrendingUp } from 'lucide-react';
import type { OccupancyDay } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { addDays, fmtDay, fmtRange, weekday } from '@/lib/format';
import { formatNumber, money } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton, StatTile } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { OccupancyChart } from '@/components/hotel/OccupancyChart';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { AskAgentButton } from '@/components/console/AskAgentButton';
import { PageShell, SectionHeader } from '@/components/console/PageShell';

type Range = 'last30' | 'next30' | 'next90';
const RANGES: Record<Range, { label: string; from: (t: string) => string; to: (t: string) => string }> = {
  last30: { label: 'Last 30 days', from: (t) => addDays(t, -30), to: (t) => t },
  next30: { label: 'Next 30 days', from: (t) => t, to: (t) => addDays(t, 30) },
  next90: { label: 'Next 90 days', from: (t) => t, to: (t) => addDays(t, 90) },
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const whole = (n: number) => money(n, { cents: false });

/** Compact tiles on phones: two per row, icon hidden so the number has room. */
const TILE = 'p-3.5 sm:p-4 [&>[aria-hidden]]:hidden sm:[&>[aria-hidden]]:flex';

function summarize(days: OccupancyDay[]) {
  const sold = days.reduce((s, d) => s + d.roomsSold, 0);
  const capacity = days.reduce((s, d) => s + d.totalRooms, 0);
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  return {
    sold,
    revenue,
    occupancy: capacity ? Math.round((sold / capacity) * 100) : 0,
    adr: sold ? revenue / sold : 0,
    revpar: capacity ? revenue / capacity : 0,
  };
}

export default function AnalyticsPage() {
  const { ctx } = useConsole();
  const today = ctx?.today;
  const [range, setRange] = React.useState<Range>('next30');
  const from = today ? RANGES[range].from(today) : undefined;
  const to = today ? RANGES[range].to(today) : undefined;
  const url = usePropertyUrl('/api/admin/occupancy', { from, to });
  const { data, isLoading } = useSWR<OccupancyDay[]>(today ? url : null, fetcher, { keepPreviousData: true });
  const days = data ?? [];
  const s = summarize(days);

  // Weekday pattern: average occupancy per day of week (Mon-first).
  const byWeekday = WEEKDAYS.map((label, i) => {
    const js = (i + 1) % 7; // weekday() is 0=Sun
    const list = days.filter((d) => weekday(d.date) === js);
    return { label, long: WEEKDAYS_LONG[i], pct: list.length ? Math.round(list.reduce((a, d) => a + d.occupancyPct, 0) / list.length) : 0, n: list.length };
  });
  const measured = byWeekday.filter((d) => d.n);
  const peak = [...measured].sort((a, b) => b.pct - a.pct)[0];
  const low = [...measured].sort((a, b) => a.pct - b.pct)[0];
  const best = [...days].filter((d) => d.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  return (
    <PageShell
      title="Analytics"
      description={from && to ? `${fmtRange(from, to)} · occupancy, rate and revenue from live reservations` : ' '}
      actions={
        <SegmentedControl
          layoutId="analytics-range"
          aria-label="Date range"
          value={range}
          onChange={setRange}
          options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: RANGES[r].label }))}
        />
      }
    >
      {isLoading && !data ? (
        <div className="space-y-6" role="status">
          <span className="sr-only">Loading analytics…</span>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[94px] rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-[360px] rounded-2xl" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        </div>
      ) : days.length === 0 || days[0].totalRooms === 0 ? (
        <Card>
          <EmptyState
            icon={ChartLine}
            title="No rooms to measure yet"
            description="Add room types with room counts and your occupancy, rates and revenue will appear here."
            action={
              <Button asChild>
                <Link href="/admin/room-types">Set up rooms</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile className={TILE} label="Occupancy" value={`${s.occupancy}%`} hint={`${formatNumber(s.sold)} room nights sold`} icon={BedDouble} />
            <StatTile className={TILE} label="Average daily rate" value={whole(s.adr)} hint="Revenue ÷ rooms sold" icon={CircleDollarSign} />
            <StatTile className={TILE} label="RevPAR" value={whole(s.revpar)} hint="Per available room" icon={Gauge} />
            <StatTile className={TILE} label="Room revenue" value={whole(s.revenue)} hint={range === 'last30' ? 'Earned' : 'On the books'} icon={TrendingUp} />
          </section>

          <Card className="p-5 sm:p-6">
            <SectionHeader title="Nightly occupancy" description="Share of rooms sold each night" />
            <OccupancyChart days={days} height={220} className="mt-4" legend label={`Nightly occupancy, ${RANGES[range].label.toLowerCase()}`} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="flex flex-col p-5 sm:p-6">
              <SectionHeader
                title="By day of week"
                description={peak && low && peak.pct !== low.pct ? `${peak.long}s are strongest (${peak.pct}%), ${low.long}s softest (${low.pct}%).` : 'Demand is even across the week.'}
              />
              <ul className="mt-5 space-y-3" aria-label="Average occupancy by day of week">
                {byWeekday.map((d) => {
                  const isPeak = peak && d.label === peak.label && peak.pct !== low?.pct;
                  return (
                    <li key={d.label} className="flex items-center gap-3 text-sm">
                      <span className={cn('w-9 shrink-0', isPeak ? 'font-semibold text-foreground' : 'text-muted-foreground')} aria-hidden>
                        {d.label}
                      </span>
                      <span className="sr-only">
                        {d.long}: {d.pct}%{isPeak ? ', strongest day' : ''}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div
                          className={cn('h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700', isPeak ? 'bg-primary' : 'bg-primary/60')}
                          style={{ width: `${d.pct}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-medium tabular" aria-hidden>
                        {d.pct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-auto pt-5 text-xs text-muted-foreground">
                Average occupancy for each weekday across the {formatNumber(days.length)} nights in this range.
              </p>
            </Card>

            <Card className="flex flex-col p-5 sm:p-6">
              <SectionHeader title="Top revenue nights" description="Where demand is strongest — candidates for higher rates." />
              {best.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-border-strong/40 px-4 py-8 text-center text-sm text-muted-foreground">
                  No revenue booked in this range yet.
                </p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <caption className="sr-only">Top {best.length} nights by room revenue</caption>
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-2 font-medium">
                        Night
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        Occupancy
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        <abbr title="Average daily rate" className="no-underline">
                          ADR
                        </abbr>
                      </th>
                      <th scope="col" className="py-2 pl-2 text-right font-medium">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {best.map((d) => (
                      <tr key={d.date}>
                        <th scope="row" className="py-2.5 pr-2 text-left font-normal">
                          {fmtDay(d.date, 'weekday')}
                        </th>
                        <td className="px-2 py-2.5 text-right text-muted-foreground tabular">{d.occupancyPct}%</td>
                        <td className="px-2 py-2.5 text-right text-muted-foreground tabular">{whole(d.adr)}</td>
                        <td className="py-2.5 pl-2 text-right font-medium tabular">{whole(d.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {range !== 'last30' && (
                <div className="mt-auto pt-4">
                  <AskAgentButton command="weekend forecast for the next 3 weekends">Get rate recommendations</AskAgentButton>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}
