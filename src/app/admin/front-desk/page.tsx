'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BedDouble,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Info,
  MoreHorizontal,
  OctagonAlert,
  RefreshCw,
  Search,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { BookingSummary, FrontDeskAlert, FrontDeskSummary, RoomSummary } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { addDays, fmtDay, relativeDay } from '@/lib/format';
import { formatNumber } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, Skeleton, StatTile } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BookingRow } from '@/components/hotel/BookingRow';
import { RoomGrid, RoomLegend } from '@/components/hotel/RoomGrid';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { AskAgentButton } from '@/components/console/AskAgentButton';
import { PageShell } from '@/components/console/PageShell';
import { AssignRoomDialog, CheckInDialog, CheckOutDialog, ConfirmDialog, NoteDialog } from '@/components/frontdesk/dialogs';
import { RoomSheet } from '@/components/frontdesk/RoomSheet';
import { useBookingActions } from '@/components/frontdesk/useBookingActions';

type Tab = 'arrivals' | 'departures' | 'inhouse' | 'rooms';
type RoomFilter = 'all' | 'ready' | 'dirty' | 'occupied' | 'arriving' | 'ooo';
type DialogState = { kind: 'checkin' | 'checkout' | 'note' | 'assign' | 'noshow' | 'cancel'; booking: BookingSummary } | null;

const ALERT_TONE: Record<FrontDeskAlert['tone'], { chip: string; icon: LucideIcon }> = {
  danger: { chip: 'bg-destructive-soft text-destructive-soft-foreground', icon: OctagonAlert },
  warning: { chip: 'bg-warning-soft text-warning-soft-foreground', icon: TriangleAlert },
  info: { chip: 'bg-info-soft text-info-soft-foreground', icon: Info },
};

/** Alerts wrap instead of scrolling off-screen; on phones the first two show, the rest on request. */
function AlertStrip({ alerts }: { alerts: FrontDeskAlert[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const PHONE_MAX = 2;
  const hidden = alerts.length - PHONE_MAX;
  return (
    <section aria-label="Needs attention">
      <ul className="flex flex-wrap gap-2" id="fd-alerts">
        {alerts.map((a, i) => {
          const t = ALERT_TONE[a.tone] ?? ALERT_TONE.info;
          const Icon = t.icon;
          return (
            <li
              key={a.id}
              title={a.detail}
              className={cn(
                'w-full items-center gap-2.5 rounded-xl py-1.5 pl-3 pr-1.5 text-sm sm:w-auto',
                t.chip,
                !expanded && i >= PHONE_MAX ? 'hidden sm:flex' : 'flex'
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 font-medium leading-snug">{a.title}</span>
              {a.command ? (
                <AskAgentButton
                  command={a.command}
                  label={`Fix with the agent: ${a.title}`}
                  className="h-8 shrink-0 border-border bg-surface px-2.5 text-xs text-foreground"
                >
                  Fix
                </AskAgentButton>
              ) : (
                <span className="w-1.5" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 -ml-2 sm:hidden"
          aria-expanded={expanded}
          aria-controls="fd-alerts"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown className={cn('motion-safe:transition-transform', expanded && 'rotate-180')} aria-hidden />
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </Button>
      )}
    </section>
  );
}

export default function FrontDeskPage() {
  const { ctx, can } = useConsole();
  const today = ctx?.today ?? '';
  const [day, setDay] = React.useState<string>('');
  const date = day || today;
  const [tab, setTab] = React.useState<Tab>('arrivals');
  const [query, setQuery] = React.useState('');
  const [roomFilter, setRoomFilter] = React.useState<RoomFilter>('all');
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [room, setRoom] = React.useState<RoomSummary | null>(null);
  const { transition, pending } = useBookingActions();

  const summaryUrl = usePropertyUrl('/api/admin/front-desk', { date: day || undefined });
  const boardUrl = usePropertyUrl('/api/admin/room-board');
  const { data, isLoading, mutate, isValidating } = useSWR<FrontDeskSummary>(summaryUrl, fetcher, { refreshInterval: 60_000 });
  const { data: rooms } = useSWR<RoomSummary[]>(tab === 'rooms' ? boardUrl : null, fetcher, { refreshInterval: 60_000 });

  const isToday = date === today;
  const filter = (list: BookingSummary[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((b) => [b.guest.name, b.guest.email, b.code, b.room?.number ?? '', b.roomType.name].some((v) => v.toLowerCase().includes(q)));
  };

  const filteredRooms = (rooms ?? []).filter((r) => {
    switch (roomFilter) {
      case 'ready':
        return !r.isOutOfOrder && (r.status === 'CLEAN' || r.status === 'INSPECTED') && r.occupancy !== 'OCCUPIED';
      case 'dirty':
        return r.status === 'DIRTY';
      case 'occupied':
        return r.occupancy === 'OCCUPIED' || r.occupancy === 'DEPARTING' || r.occupancy === 'TURNOVER';
      case 'arriving':
        return r.occupancy === 'ARRIVING' || r.occupancy === 'TURNOVER';
      case 'ooo':
        return r.isOutOfOrder;
      default:
        return true;
    }
  });

  const s = data?.stats;
  const overdue = (data?.departures ?? []).filter((b) => b.status === 'CHECKED_IN' && b.checkOut < date).length;
  const open = (kind: NonNullable<DialogState>['kind'], booking: BookingSummary) => setDialog({ kind, booking });

  // Plain render helpers (not components), so menus and rows keep their state across refreshes.
  const overflow = (b: BookingSummary) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`More actions for ${b.guest.name}`} size="icon-sm">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/admin/bookings/${b.id}`}>Open reservation</Link>
        </DropdownMenuItem>
        {b.status !== 'CHECKED_OUT' && can('booking.assignRoom') && (
          <DropdownMenuItem onSelect={() => open('assign', b)}>{b.room ? 'Change room' : 'Choose room'}</DropdownMenuItem>
        )}
        {can('booking.note') && <DropdownMenuItem onSelect={() => open('note', b)}>Add note</DropdownMenuItem>}
        {b.status === 'PENDING' && can('booking.confirm') && <DropdownMenuItem onSelect={() => transition(b, 'CONFIRMED')}>Confirm booking</DropdownMenuItem>}
        {(b.status === 'CONFIRMED' || b.status === 'PENDING') && (
          <>
            <DropdownMenuSeparator />
            {b.checkIn <= today && can('booking.noShow') && (
              <DropdownMenuItem destructive onSelect={() => open('noshow', b)}>
                Mark no-show
              </DropdownMenuItem>
            )}
            {can('booking.cancel') && (
              <DropdownMenuItem destructive onSelect={() => open('cancel', b)}>
                Cancel reservation
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const list = (items: BookingSummary[], variant: 'arrivals' | 'departures' | 'inhouse') => {
    const shown = filter(items);
    if (isLoading || !data) {
      return (
        <div className="divide-y" role="status">
          <span className="sr-only">Loading reservations…</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="hidden h-9 w-24 rounded-md sm:block" />
            </div>
          ))}
        </div>
      );
    }
    if (shown.length === 0) {
      const empty = {
        arrivals: { icon: ArrowDownToLine, title: `No arrivals ${isToday ? 'today' : 'on this day'}`, hint: 'New reservations for this day appear here automatically.' },
        departures: { icon: ArrowUpFromLine, title: `No departures ${isToday ? 'today' : 'on this day'}`, hint: 'Guests due to leave on this day appear here.' },
        inhouse: { icon: Users, title: 'Nobody is checked in right now', hint: 'Guests show up here as soon as you check them in.' },
      }[variant];
      return query ? (
        <EmptyState
          icon={Search}
          title={`No matches for “${query.trim()}”`}
          description="Try a guest name, booking code or room number."
          action={
            <Button variant="outline" size="sm" onClick={() => setQuery('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <EmptyState icon={empty.icon} title={empty.title} description={empty.hint} />
      );
    }
    return (
      <div className="divide-y">
        {shown.map((b) => {
          const canCheckIn = variant === 'arrivals' && (b.status === 'CONFIRMED' || b.status === 'PENDING') && isToday && can('booking.checkin');
          const canCheckOut = b.status === 'CHECKED_IN' && can('booking.checkout');
          return (
            <BookingRow
              key={b.id}
              booking={b}
              today={today}
              variant={variant}
              href={`/admin/bookings/${b.id}`}
              actions={
                <>
                  {canCheckIn && (
                    <Button size="sm" onClick={() => open('checkin', b)} aria-label={`Check in ${b.guest.name}`}>
                      Check in
                    </Button>
                  )}
                  {canCheckOut && variant !== 'arrivals' && (
                    <Button
                      size="sm"
                      variant={variant === 'departures' ? 'default' : 'outline'}
                      onClick={() => open('checkout', b)}
                      aria-label={`Check out ${b.guest.name}`}
                    >
                      Check out
                    </Button>
                  )}
                  {overflow(b)}
                </>
              }
            />
          );
        })}
      </div>
    );
  };

  const count = (n: number | undefined) => (n === undefined ? '' : ` · ${formatNumber(n)}`);

  return (
    <PageShell
      eyebrow={date ? `${relativeDay(date, today)} · ${fmtDay(date, 'long')}` : ' '}
      title="Front desk"
      actions={
        <>
          <div role="group" aria-label="Choose day" className="flex items-center rounded-lg border border-border-strong/50 bg-surface p-0.5 shadow-xs">
            <IconButton label="Previous day" size="icon-sm" onClick={() => setDay(addDays(date, -1))} disabled={!date}>
              <ChevronLeft />
            </IconButton>
            <Button
              variant="ghost"
              size="sm"
              className={cn('min-w-[84px] tabular', isToday && 'text-primary')}
              onClick={() => setDay('')}
              aria-label={isToday ? 'Showing today' : `Showing ${fmtDay(date, 'weekday')}. Back to today`}
            >
              {isToday ? 'Today' : fmtDay(date)}
            </Button>
            <IconButton label="Next day" size="icon-sm" onClick={() => setDay(addDays(date, 1))} disabled={!date}>
              <ChevronRight />
            </IconButton>
          </div>
          <IconButton label="Refresh" variant="outline" onClick={() => mutate()} aria-busy={isValidating || undefined}>
            <RefreshCw className={cn(isValidating && 'motion-safe:animate-spin')} />
          </IconButton>
        </>
      }
    >
      {/* Phones: one line instead of five tiles, so the first arrival is visible without scrolling. */}
      <p className="-mt-2 text-sm text-muted-foreground md:hidden" aria-live="polite">
        {s ? (
          <>
            Tonight <span className="font-medium text-foreground tabular">{s.occupancyPct}%</span> occupied ·{' '}
            <span className="font-medium text-foreground tabular">{formatNumber(s.clean + s.inspected)}</span> rooms ready
            {overdue > 0 && (
              <>
                {' · '}
                <span className="font-medium text-destructive-soft-foreground">{formatNumber(overdue)} overdue</span>
              </>
            )}
          </>
        ) : (
          <span className="inline-block h-5" />
        )}
      </p>

      <section aria-label="Today’s figures" className="hidden gap-3 md:grid md:grid-cols-5">
        <StatTile
          label="Arrivals"
          icon={ArrowDownToLine}
          value={s ? `${formatNumber(s.arrivalsDone)}/${formatNumber(s.arrivalsDone + s.arrivalsDue)}` : '—'}
          hint={s ? (s.unassignedArrivals ? `${formatNumber(s.unassignedArrivals)} need a room` : 'checked in') : ''}
          onClick={() => setTab('arrivals')}
          active={tab === 'arrivals'}
        />
        <StatTile
          label="Departures"
          icon={ArrowUpFromLine}
          tone={overdue ? 'danger' : 'neutral'}
          value={s ? `${formatNumber(s.departuresDone)}/${formatNumber(s.departuresDone + s.departuresDue)}` : '—'}
          hint={s ? (overdue ? `${formatNumber(overdue)} overdue` : 'checked out') : ''}
          onClick={() => setTab('departures')}
          active={tab === 'departures'}
        />
        <StatTile
          label="In house"
          icon={Users}
          value={s ? formatNumber(s.inHouse) : '—'}
          hint="guests staying"
          onClick={() => setTab('inhouse')}
          active={tab === 'inhouse'}
        />
        <StatTile label="Tonight" icon={BedDouble} tone="neutral" value={s ? `${s.occupancyPct}%` : '—'} hint={s ? `${formatNumber(s.availableTonight)} rooms to sell` : ''} />
        <StatTile
          label="Rooms ready"
          icon={CircleCheck}
          tone={s && s.dirty > 0 && s.clean + s.inspected === 0 ? 'warning' : 'neutral'}
          value={s ? formatNumber(s.clean + s.inspected) : '—'}
          hint={s ? `${formatNumber(s.dirty)} dirty · ${formatNumber(s.outOfOrder)} out of order` : ''}
          onClick={() => setTab('rooms')}
          active={tab === 'rooms'}
        />
      </section>

      {data && data.alerts.length > 0 && isToday && <AlertStrip alerts={data.alerts} />}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
          <SegmentedControl
            aria-label="Front desk view"
            layoutId="fd-tab"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'arrivals', label: `Arrivals${count(data?.arrivals.length)}` },
              { value: 'departures', label: `Departures${count(data?.departures.length)}` },
              { value: 'inhouse', label: `In house${count(data?.inHouse.length)}` },
              { value: 'rooms', label: 'Rooms' },
            ]}
          />
          {tab !== 'rooms' ? (
            <div className="relative lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search guest, code or room"
                aria-label="Search reservations by guest, booking code or room"
                className="pl-9"
              />
            </div>
          ) : (
            <SegmentedControl
              aria-label="Show rooms"
              layoutId="fd-room-filter"
              size="sm"
              value={roomFilter}
              onChange={setRoomFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'ready', label: 'Ready' },
                { value: 'dirty', label: 'Dirty' },
                { value: 'occupied', label: 'Occupied' },
                { value: 'arriving', label: 'Arriving' },
                { value: 'ooo', label: 'Out of order' },
              ]}
            />
          )}
        </div>
        {tab === 'arrivals' && list(data?.arrivals ?? [], 'arrivals')}
        {tab === 'departures' && list(data?.departures ?? [], 'departures')}
        {tab === 'inhouse' && list(data?.inHouse ?? [], 'inhouse')}
        {tab === 'rooms' && (
          <div className="space-y-4 p-4">
            <RoomLegend />
            {!rooms ? (
              <div className="space-y-4" role="status">
                <span className="sr-only">Loading rooms…</span>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2 sm:ml-[60px]">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <Skeleton key={j} className="h-[92px] rounded-xl" />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <RoomGrid rooms={filteredRooms} onRoomClick={setRoom} />
            )}
          </div>
        )}
      </Card>

      <CheckInDialog booking={dialog?.kind === 'checkin' ? dialog.booking : null} open={dialog?.kind === 'checkin'} onOpenChange={(o) => !o && setDialog(null)} />
      <CheckOutDialog
        booking={dialog?.kind === 'checkout' ? dialog.booking : null}
        open={dialog?.kind === 'checkout'}
        onOpenChange={(o) => !o && setDialog(null)}
        today={today}
      />
      <NoteDialog booking={dialog?.kind === 'note' ? dialog.booking : null} open={dialog?.kind === 'note'} onOpenChange={(o) => !o && setDialog(null)} />
      <AssignRoomDialog booking={dialog?.kind === 'assign' ? dialog.booking : null} open={dialog?.kind === 'assign'} onOpenChange={(o) => !o && setDialog(null)} />
      <ConfirmDialog
        open={dialog?.kind === 'noshow' || dialog?.kind === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === 'noshow' ? `Mark ${dialog.booking.guest.name} as a no-show?` : `Cancel ${dialog?.booking.guest.name}’s reservation?`}
        description="The room is released back to sale. A manager can reinstate it later."
        confirmLabel={dialog?.kind === 'noshow' ? 'Mark no-show' : 'Cancel reservation'}
        destructive
        loading={!!dialog && pending === `${dialog.booking.id}:${dialog.kind === 'noshow' ? 'NO_SHOW' : 'CANCELLED'}`}
        onConfirm={async () => {
          if (!dialog) return;
          const r = await transition(dialog.booking, dialog.kind === 'noshow' ? 'NO_SHOW' : 'CANCELLED');
          if (r) setDialog(null);
        }}
      />
      <RoomSheet room={room} onOpenChange={(o) => !o && setRoom(null)} />
    </PageShell>
  );
}
