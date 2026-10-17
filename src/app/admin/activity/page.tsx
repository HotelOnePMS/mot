'use client';

import * as React from 'react';
import useSWR from 'swr';
import {
  ArrowRightLeft,
  AudioLines,
  BedDouble,
  Brush,
  Building2,
  Cable,
  CalendarCheck2,
  CalendarRange,
  CalendarX2,
  DoorClosed,
  DoorOpen,
  History,
  MessageSquareText,
  MousePointerClick,
  PhoneCall,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  UserCog,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityEntry } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { formatPhonesIn, timeAgo } from '@/lib/format';
import { formatNumber } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, EmptyState, PageHeader, Skeleton, StatTile } from '@/components/ui/primitives';
import { SourceBadge } from '@/components/hotel/badges';
import { SegmentedControl } from '@/components/ui/segmented';
import { usePropertyUrl } from '@/components/console/ConsoleProvider';

type Filter = 'all' | 'agent' | 'classic';

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';
const PAGE = 60;

function iconFor(action: string): LucideIcon {
  if (action === 'COMMAND' || action === 'PLAN_EXECUTED') return Sparkles;
  if (action === 'MODE_SWITCH') return ArrowRightLeft;
  if (action.startsWith('BOOKING_NOTE')) return MessageSquareText;
  if (action === 'BOOKING_ASSIGN_ROOM') return DoorOpen;
  if (action === 'BOOKING_CANCELLED') return CalendarX2;
  if (action === 'BOOKING_DATES') return CalendarRange;
  if (action.startsWith('BOOKING')) return CalendarCheck2;
  if (action.startsWith('HOUSEKEEPING')) return Brush;
  if (action.startsWith('ROOM_TYPE')) return BedDouble;
  if (action === 'ROOM_OUT_OF_ORDER') return Wrench;
  if (action.startsWith('ROOM')) return DoorClosed;
  if (action.startsWith('RATE')) return Tag;
  if (action === 'VOICE_PHONE_LINE' || action.startsWith('PHONE')) return PhoneCall;
  if (action.startsWith('VOICE')) return AudioLines;
  if (action.startsWith('PROPERTY')) return Building2;
  if (action.startsWith('BRIDGE')) return Cable;
  if (action.startsWith('USER') || action.startsWith('STAFF')) return UserCog;
  if (action.startsWith('SETUP')) return Settings2;
  return History;
}

const timeOfDay = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** Today: "12m ago". Earlier days sit under their date heading, so just the time: "9:41 AM". */
function when(iso: string, day: string): string {
  return day === 'Today' ? timeAgo(iso) : timeOfDay.format(new Date(iso));
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** An entry plus how many identical ones came right after it (same person, action and words). */
type Row = ActivityEntry & { repeats: number };

export default function ActivityPage() {
  const url = usePropertyUrl('/api/admin/activity', { limit: 200 });
  const { data, isLoading, error } = useSWR<ActivityEntry[]>(url, fetcher, { refreshInterval: 30_000 });
  const [filter, setFilter] = React.useState<Filter>('all');
  const [q, setQ] = React.useState('');
  const [limit, setLimit] = React.useState(PAGE);
  React.useEffect(() => setLimit(PAGE), [filter, q]);

  const filtered = React.useMemo(
    () =>
      (data ?? []).filter((a) => {
        if (filter !== 'all' && a.source !== filter) return false;
        const t = q.trim().toLowerCase();
        if (!t) return true;
        const digits = t.replace(/[^\d+]/g, '');
        return (
          a.summary.toLowerCase().includes(t) ||
          a.user.name.toLowerCase().includes(t) ||
          // Phone numbers match however they're typed ("+1 831 555 0100" or "8315550100").
          (digits.length >= 4 && a.summary.replace(/[^\d+]/g, '').includes(digits))
        );
      }),
    [data, filter, q]
  );

  // Fold runs of identical events ("Marked room 104 clean" ×3) into one line.
  const rows = React.useMemo(() => {
    const out: Row[] = [];
    for (const a of filtered) {
      const last = out[out.length - 1];
      if (last && last.action === a.action && last.summary === a.summary && last.user.id === a.user.id && last.source === a.source && dayLabel(last.at) === dayLabel(a.at)) {
        last.repeats += 1;
      } else out.push({ ...a, repeats: 1 });
    }
    return out;
  }, [filtered]);
  const shown = rows.slice(0, limit);

  const groups: { day: string; items: Row[] }[] = [];
  for (const a of shown) {
    const day = dayLabel(a.at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(a);
    else groups.push({ day, items: [a] });
  }

  const agentActions = (data ?? []).filter((a) => a.source === 'agent' && a.action !== 'COMMAND').length;
  const todayCount = (data ?? []).filter((a) => dayLabel(a.at) === 'Today').length;
  const people = new Set((data ?? []).map((a) => a.user.id)).size;

  return (
    <div className={FRAME}>
      <div className="max-w-4xl space-y-6">
        <PageHeader title="Activity" description="Every change, by every person — and every action the agent took on someone’s behalf." />

        <section aria-label="Summary" className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <StatTile label="Today" value={data ? formatNumber(todayCount) : '—'} hint={data ? `${formatNumber(data.length)} recent in all` : ''} icon={History} />
            <StatTile label="Done through the agent" value={data ? formatNumber(agentActions) : '—'} hint="Each one confirmed" icon={Sparkles} tone="agent" />
            <StatTile label="People" value={data ? formatNumber(people) : '—'} hint="Made changes recently" icon={UserCog} className="col-span-2 sm:col-span-1" />
          </div>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            Agent changes always wait for a person to confirm, and are recorded under that person’s name.
          </p>
        </section>

        <div role="search" aria-label="Filter activity" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label htmlFor="activity-search" className="sr-only">
              Search activity
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="activity-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by guest, room or person" className="pl-9" autoComplete="off" />
          </div>
          <SegmentedControl
            layoutId="activity-filter"
            aria-label="Who made the change"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'agent', label: 'Agent', icon: <Sparkles className="size-3.5 text-agent" aria-hidden /> },
              { value: 'classic', label: 'Manual', icon: <MousePointerClick className="size-3.5" aria-hidden /> },
            ]}
            className="self-start"
          />
        </div>

        {/* overflow-clip (not hidden) keeps the sticky day headings pinned to the window. */}
        <Card className="overflow-clip p-0 shadow-xs">
          {error && !data ? (
            <EmptyState icon={History} title="Couldn’t load activity" description="Check your connection — the list refreshes on its own every 30 seconds." />
          ) : isLoading ? (
            <div aria-busy>
              <div className="h-8 border-b bg-surface-sunken/60" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex h-[66px] items-center gap-3 border-b px-4 last:border-b-0">
                  <Skeleton className="size-8 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={History}
              title={q || filter !== 'all' ? 'No matching activity' : 'Nothing has happened yet'}
              description={q || filter !== 'all' ? 'Try another name or room number, or show everything.' : 'Check-ins, room changes, rate updates and agent actions will appear here.'}
              action={
                q || filter !== 'all' ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQ('');
                      setFilter('all');
                    }}
                  >
                    Show all activity
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.day} aria-label={g.day}>
                  <h2 className="sticky top-14 z-10 border-b bg-surface-sunken/95 px-4 py-1.5 text-xs font-semibold backdrop-blur">{g.day}</h2>
                  <ul className="divide-y">
                    {g.items.map((a) => {
                      const Icon = iconFor(a.action);
                      const isCommand = a.action === 'COMMAND';
                      const agent = a.source === 'agent';
                      return (
                        <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                          <span
                            className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', agent ? 'bg-agent-soft text-agent-soft-foreground' : 'bg-muted text-muted-foreground')}
                            aria-hidden
                          >
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={cn('text-sm', isCommand && 'text-muted-foreground')}>
                              {isCommand && <span className="sr-only">Asked the agent: </span>}
                              {formatPhonesIn(a.summary)}
                              {a.repeats > 1 && (
                                <Badge variant="neutral" size="sm" className="ml-2 align-middle">
                                  {a.repeats} times
                                </Badge>
                              )}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <Avatar name={a.user.name} size="xs" />
                              {a.user.name}
                              {!isCommand && <SourceBadge source={a.source} quiet />}
                            </p>
                          </div>
                          <time className="shrink-0 text-xs text-muted-foreground tabular" dateTime={a.at} title={new Date(a.at).toLocaleString()}>
                            {when(a.at, g.day)}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              <div className="flex flex-col items-center gap-2 border-t bg-surface-sunken/50 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:justify-between">
                <p role="status">
                  Showing {formatNumber(shown.length)} of {formatNumber(rows.length)}
                </p>
                {shown.length < rows.length && (
                  <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                    Show more
                  </Button>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
