'use client';

import * as React from 'react';
import useSWR from 'swr';
import { CheckCircle2, Moon } from 'lucide-react';
import type { RoomOption } from '@/lib/agent/blocks';
import type { BookingSummary } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/primitives';

type Prefs = { highFloor: boolean; quiet: boolean };

/** Free rooms of the booking's type, best match first, with quick preferences. */
export function RoomPicker({
  booking,
  value,
  onChange,
  readyOnly,
}: {
  booking: BookingSummary;
  value: string | null;
  onChange: (id: string, option: RoomOption) => void;
  readyOnly: boolean;
}) {
  const [prefs, setPrefs] = React.useState<Prefs>({ highFloor: false, quiet: false });
  const q = new URLSearchParams();
  if (prefs.highFloor) q.set('highFloor', '1');
  if (prefs.quiet) q.set('tags', 'quiet');
  const { data, isLoading } = useSWR<RoomOption[]>(`/api/admin/bookings/${booking.id}/room?${q}`, fetcher);
  const options = (data ?? []).filter((o) => !readyOnly || o.ready || o.room.id === value);

  // Preselect the best match, or report the room already chosen (assigned in advance, say) so the caller knows
  // whether it's ready.
  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!value) {
      if (options[0]) onChange(options[0].room.id, options[0]);
      return;
    }
    if (reported.current === value) return;
    const current = options.find((o) => o.room.id === value);
    if (current) {
      reported.current = value;
      onChange(value, current);
    }
  }, [options, value, onChange]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Room preferences">
        <span className="text-xs text-muted-foreground">Prefer</span>
        {(
          [
            ['highFloor', 'High floor'],
            ['quiet', 'Quiet'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={prefs[k]}
            onClick={() => setPrefs((p) => ({ ...p, [k]: !p[k] }))}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
              prefs[k]
                ? 'border-primary/50 bg-primary-soft text-primary-soft-foreground'
                : 'border-border-strong/50 bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground'
            )}
          >
            {prefs[k] && <CheckCircle2 className="size-3.5" aria-hidden />}
            {label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="status">
          <span className="sr-only">Finding free rooms…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[66px] rounded-xl" />
          ))}
        </div>
      ) : options.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong/50 p-4 text-center text-sm text-muted-foreground">
          No {readyOnly ? 'ready ' : ''}
          {booking.roomType.name} room is free for these nights.
          {readyOnly ? ' Tick “Show rooms that still need cleaning” to see the rest.' : ''}
        </p>
      ) : (
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto p-0.5 pr-1 sm:grid-cols-3" role="radiogroup" aria-label="Room">
          {options.map((o, i) => {
            const checked = value === o.room.id;
            return (
              <button
                key={o.room.id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => onChange(o.room.id, o)}
                className={cn(
                  'relative min-h-[66px] rounded-xl border p-2.5 text-left transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                  checked ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-border-strong/40 hover:border-border-strong',
                  !o.ready && !checked && 'border-dashed'
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="font-semibold tabular">{o.room.number}</span>
                  {i === 0 && (
                    <Badge variant="highlight" size="sm">
                      Best match
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  {o.room.floor ? `Floor ${o.room.floor}` : 'No floor'} · {o.ready ? (o.room.status === 'INSPECTED' ? 'Inspected' : 'Clean') : 'Needs cleaning'}
                  {o.room.tags.includes('quiet') && (
                    <>
                      <Moon className="ml-auto size-3 shrink-0" aria-hidden />
                      <span className="sr-only">, quiet</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
