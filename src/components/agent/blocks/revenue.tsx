'use client';

import * as React from 'react';
import { Activity, Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import type { AgentBlock } from '@/lib/agent/blocks';
import { fmtDay } from '@/lib/format';
import { formatNumber, formatPercent, money } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OccupancyChart } from '@/components/hotel/OccupancyChart';
import { useAgentUI } from '../AgentUI';
import { BlockCard, BlockHeader } from './core';

const whole = (n: number) => money(n, { cents: false });

/** Rooms left and prices for a date range, one row per room type. */
export function AvailabilityBlock({ block }: { block: Extract<AgentBlock, { type: 'availability' }> }) {
  const id = React.useId();
  return (
    <BlockCard aria-labelledby={id}>
      <BlockHeader
        id={id}
        title={
          <>
            {fmtDay(block.checkIn, 'weekday')} <span aria-hidden>→</span>
            <span className="sr-only"> to </span> {fmtDay(block.checkOut, 'weekday')}
          </>
        }
        meta={
          <span className="text-xs text-muted-foreground">
            {block.guests} guest{block.guests === 1 ? '' : 's'}
          </span>
        }
        className="py-2.5"
      />
      {block.items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No room types to show for these dates.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken/60 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Room type
                </th>
                <th scope="col" className="hidden w-36 px-2 py-2 font-semibold sm:table-cell">
                  Left
                </th>
                <th scope="col" className="w-28 px-4 py-2 text-right font-semibold">
                  Stay total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {block.items.map((r) => {
                const pct = r.total ? r.available / r.total : 0;
                const soldOut = r.available === 0;
                return (
                  <tr key={r.id} className={cn(soldOut && 'text-muted-foreground')}>
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <span className={cn('block font-medium', !soldOut && 'text-foreground')}>{r.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        Sleeps {r.capacity}
                        <span className="sm:hidden">
                          {' '}
                          · {r.available} of {r.total} left
                        </span>
                      </span>
                    </th>
                    <td className="hidden px-2 py-3 sm:table-cell">
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                        role="meter"
                        aria-label={`${r.name} rooms left`}
                        aria-valuemin={0}
                        aria-valuemax={r.total}
                        aria-valuenow={r.available}
                      >
                        <div
                          className={cn('h-full rounded-full', soldOut ? 'bg-destructive' : pct < 0.25 ? 'bg-warning' : 'bg-success')}
                          style={{ width: `${Math.max(pct * 100, soldOut ? 0 : 4)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs tabular text-muted-foreground">
                        {r.available} of {r.total} left
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {soldOut ? (
                        <Badge variant="danger" size="sm">
                          Sold out
                        </Badge>
                      ) : (
                        <>
                          <p className="font-semibold tabular text-foreground">{whole(r.totalPrice)}</p>
                          <p className="text-xs tabular text-muted-foreground">{whole(r.averageNightly)} / night</p>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </BlockCard>
  );
}

export function OccupancyBlock({ block }: { block: Extract<AgentBlock, { type: 'occupancy' }> }) {
  const id = React.useId();
  return (
    <BlockCard aria-labelledby={id} className="p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id={id} className="text-sm font-semibold">
          {block.title}
        </h2>
        <dl className="flex gap-5 text-right">
          {[
            { label: 'Avg occupancy', value: formatPercent(block.averagePct) },
            { label: 'Revenue', value: whole(block.revenue) },
            { label: 'Avg rate', value: whole(block.adr) },
          ].map((m) => (
            <div key={m.label}>
              <dt className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">{m.label}</dt>
              <dd className="text-lg font-semibold tabular">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <OccupancyChart days={block.days} height={130} />
    </BlockCard>
  );
}

/** Outlook per period: the badge names the demand, so colour is never the only signal. */
const OUTLOOK: Record<string, { label: string; variant: 'success' | 'info' | 'warning' | 'danger' | 'neutral'; icon: LucideIcon }> = {
  success: { label: 'Strong demand', variant: 'success', icon: TrendingUp },
  info: { label: 'On pace', variant: 'info', icon: Activity },
  warning: { label: 'Soft demand', variant: 'warning', icon: TrendingDown },
  danger: { label: 'At risk', variant: 'danger', icon: TrendingDown },
  neutral: { label: 'Watch', variant: 'neutral', icon: Minus },
};

export function ForecastBlock({ block }: { block: Extract<AgentBlock, { type: 'forecast' }> }) {
  const { send, busy } = useAgentUI();
  const id = React.useId();
  return (
    <section className="space-y-2.5" aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold">
        {block.title}
      </h2>
      <ul className="grid gap-2 md:grid-cols-3">
        {block.periods.map((p) => {
          const o = OUTLOOK[p.tone] ?? OUTLOOK.neutral;
          return (
            <li key={p.from} className="flex flex-col rounded-2xl border bg-card p-4 shadow-xs">
              <p className="text-xs font-medium text-muted-foreground">{p.label}</p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                <p className="text-3xl font-semibold leading-none tracking-tight tabular">{formatPercent(p.occupancyPct)}</p>
                <Badge variant={o.variant} size="sm" icon={o.icon} className="mb-0.5">
                  {o.label}
                </Badge>
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-label={`Occupancy ${p.label}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p.occupancyPct}
              >
                <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(0, p.occupancyPct))}%` }} />
              </div>
              <p className="mt-2 text-xs tabular text-muted-foreground">
                {formatNumber(p.roomsSold)} sold · {formatNumber(p.roomsAvailable)} left · avg rate {whole(p.adr)}
              </p>
              <p className="mt-3 flex-1 text-sm leading-relaxed">{p.recommendation}</p>
              {p.action && (
                <Button type="button" size="sm" variant="outline" className="mt-3 self-start" disabled={busy} onClick={() => send(p.action!.command)}>
                  {p.action.label}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
