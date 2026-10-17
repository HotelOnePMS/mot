'use client';

import * as React from 'react';
import type { OccupancyDay } from '@/lib/dto';
import { fmtDay, weekday } from '@/lib/format';
import { money } from '@/lib/status';
import { cn } from '@/lib/utils';

/** Bar colour by occupancy band. The legend below uses the same three bands. */
function toneFor(pct: number) {
  if (pct >= 85) return 'bg-success';
  if (pct >= 50) return 'bg-primary';
  return 'bg-primary/45';
}

const isWeekend = (date: string) => weekday(date) === 5 || weekday(date) === 6;

export function OccupancyLegend({ className }: { className?: string }) {
  const items: [string, string][] = [
    ['bg-success', '85% or more'],
    ['bg-primary', '50–84%'],
    ['bg-primary/45', 'Under 50%'],
  ];
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground', className)} aria-label="Chart key">
      {items.map(([swatch, label]) => (
        <li key={label} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-sm', swatch)} aria-hidden />
          {label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-3 rounded-sm border border-border-strong/40 bg-muted" aria-hidden />
        Fri &amp; Sat nights
      </li>
    </ul>
  );
}

/**
 * Nightly occupancy bars. Weekend nights sit on a neutral band; pointing at,
 * tapping or arrowing to a bar shows its numbers in the line above (announced
 * politely to screen readers). A visually hidden table carries the same data.
 * Pure CSS — fast and theme-aware.
 */
export function OccupancyChart({
  days,
  height = 160,
  className,
  legend = false,
  label = 'Nightly occupancy',
}: {
  days: OccupancyDay[];
  height?: number;
  className?: string;
  /** Show the colour key under the chart. */
  legend?: boolean;
  /** Accessible name of the chart. */
  label?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const plotRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const uid = React.useId();
  const hasDays = days.length > 0;

  React.useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDays]);

  if (!days.length) return null;
  const shown = active !== null ? days[active] : null;
  const avg = Math.round(days.reduce((s, d) => s + d.occupancyPct, 0) / days.length);
  const peak = days.reduce((best, d) => (d.occupancyPct > best.occupancyPct ? d : best), days[0]);

  // Thin the date labels so they never collide: roughly one per 44px.
  const slot = width ? width / days.length : 0;
  const every = slot ? Math.max(1, Math.ceil(44 / slot)) : Math.max(1, Math.ceil(days.length / 14));
  const gap = days.length > 45 ? 'gap-px' : 'gap-[3px]';

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = days.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = active === null ? 0 : Math.min(last, active + 1);
    else if (e.key === 'ArrowLeft') next = active === null ? last : Math.max(0, active - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape') {
      setActive(null);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <figure className={cn('w-full', className)}>
      <figcaption className="sr-only" id={`${uid}-summary`}>
        {label}: {days.length} nights from {fmtDay(days[0].date, 'weekday')} to {fmtDay(days[days.length - 1].date, 'weekday')}. Average {avg}% occupied; busiest{' '}
        {fmtDay(peak.date, 'weekday')} at {peak.occupancyPct}
        %.
      </figcaption>

      <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground" aria-live="polite">
        {shown ? (
          <>
            <span className="font-medium text-foreground">{fmtDay(shown.date, 'weekday')}</span>
            <span className="tabular">
              {shown.occupancyPct}% · {shown.roomsSold} of {shown.totalRooms} rooms
            </span>
            <span className="tabular">Avg rate {money(shown.adr, { cents: false })}</span>
          </>
        ) : (
          <span>
            Average <span className="font-medium text-foreground tabular">{avg}%</span>
            <span aria-hidden> · Hover or tap a night for details</span>
          </span>
        )}
      </div>

      <div className="relative" style={{ height }}>
        {/* Gridlines: solid baseline at 0%, dashed quarters, labelled 50% and 100%. */}
        {[0, 25, 50, 75, 100].map((g) => (
          <div key={g} aria-hidden className={cn('absolute inset-x-0 border-t', g === 0 ? 'border-border-strong/60' : 'border-dashed border-border')} style={{ bottom: `${g}%` }}>
            {(g === 50 || g === 100) && <span className="absolute -top-2 right-0 bg-card pl-1 text-2xs leading-4 text-muted-foreground tabular">{g}%</span>}
          </div>
        ))}
        <div
          ref={plotRef}
          role="group"
          tabIndex={0}
          aria-label={`${label}. Use the left and right arrow keys to read each night.`}
          aria-describedby={`${uid}-summary`}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
          className={cn(
            'absolute inset-y-0 left-0 right-10 flex items-end rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
            gap,
          )}
        >
          {days.map((d, i) => (
            <div
              key={d.date}
              aria-hidden
              onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
              onPointerDown={() => setActive(i)}
              className={cn('relative flex h-full flex-1 items-end rounded-t-md', isWeekend(d.date) && 'bg-muted')}
            >
              <span
                className={cn(
                  'w-full rounded-t-[5px] motion-safe:transition-[height] motion-safe:duration-500',
                  toneFor(d.occupancyPct),
                  active === i && 'ring-2 ring-ring ring-offset-1 ring-offset-card',
                )}
                style={{
                  height: `max(3px, ${Math.min(100, d.occupancyPct)}%)`,
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className={cn('mt-1.5 flex h-4 pr-10', gap)} aria-hidden>
        {days.map((d, i) => (
          <span key={d.date} className="relative flex-1 text-2xs leading-4 text-muted-foreground tabular">
            {i % every === 0 && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{fmtDay(d.date, 'numeric')}</span>}
          </span>
        ))}
      </div>

      {legend && <OccupancyLegend className="mt-4" />}

      {/* Tables ignore sr-only's 1px width, so the wrapper does the hiding. */}
      <div className="sr-only">
        <table>
          <caption>{label} by night</caption>
          <thead>
            <tr>
              <th scope="col">Night</th>
              <th scope="col">Occupancy</th>
              <th scope="col">Rooms sold</th>
              <th scope="col">Average rate</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <th scope="row">{fmtDay(d.date, 'weekday')}</th>
                <td>{d.occupancyPct}%</td>
                <td>
                  {d.roomsSold} of {d.totalRooms}
                </td>
                <td>{money(d.adr, { cents: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
