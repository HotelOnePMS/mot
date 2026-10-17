'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { BedDouble, CalendarDays, CalendarX2, ExternalLink, Search, X } from 'lucide-react';
import type { BookingSummary } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { formatMoney } from '@/lib/format';
import { formatNumber } from '@/lib/status';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { ReservationList, ReservationListSkeleton, sortBookings, type Sort, type SortKey } from './_components/ReservationList';

type View = 'upcoming' | 'inhouse' | 'past' | 'cancelled' | 'all';

const VIEWS: Record<View, { label: string; status?: string; future?: boolean; sort: Sort }> = {
  upcoming: { label: 'Upcoming', status: 'PENDING,CONFIRMED', future: true, sort: { key: 'checkIn', dir: 'asc' } },
  inhouse: { label: 'In house', status: 'CHECKED_IN', sort: { key: 'checkIn', dir: 'asc' } },
  past: { label: 'Past', status: 'CHECKED_OUT', sort: { key: 'checkIn', dir: 'desc' } },
  cancelled: { label: 'Cancelled', status: 'CANCELLED,NO_SHOW', sort: { key: 'checkIn', dir: 'desc' } },
  all: { label: 'All', sort: { key: 'checkIn', dir: 'desc' } },
};

const PAGE = 50;
const API_LIMIT = 200;

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function BookingsPage() {
  const { ctx, propertyId } = useConsole();
  const today = ctx?.today ?? '';
  const [view, setView] = React.useState<View>('upcoming');
  const [text, setText] = React.useState('');
  const [roomType, setRoomType] = React.useState('all');
  const [sortOverride, setSortOverride] = React.useState<Sort | null>(null);
  const [limit, setLimit] = React.useState(PAGE);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const q = useDebounced(text.trim());
  const searching = q.length > 0;
  const cfg = VIEWS[view];
  const sort = sortOverride ?? (searching ? VIEWS.all.sort : cfg.sort);

  const url = usePropertyUrl('/api/admin/bookings', {
    q: q || undefined,
    // A search looks everywhere; the tabs only narrow an unfiltered list.
    status: searching ? undefined : cfg.status,
    from: !searching && cfg.future && today ? today : undefined,
    limit: API_LIMIT,
  });
  const { data, isLoading, error } = useSWR<BookingSummary[]>(url, fetcher, { keepPreviousData: true });
  const { data: roomTypes } = useSWR<{ id: string; name: string }[]>(usePropertyUrl('/api/admin/room-types'), fetcher);

  // Each new question starts at the top of the list.
  React.useEffect(() => setLimit(PAGE), [view, q, roomType, sortOverride]);

  const rows = React.useMemo(() => {
    const list = (data ?? []).filter((b) => roomType === 'all' || b.roomType.id === roomType);
    return sortBookings(list, sort);
  }, [data, roomType, sort]);
  const shown = rows.slice(0, limit);
  const booked = rows.reduce((s, b) => s + (b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 0 : b.totalPrice), 0);
  const typeName = roomTypes?.find((t) => t.id === roomType)?.name;

  function onSort(key: SortKey) {
    setSortOverride((cur) => {
      const base = cur ?? sort;
      if (base.key === key) return { key, dir: base.dir === 'asc' ? 'desc' : 'asc' };
      // Money and dates read best newest/biggest first; names A→Z.
      return { key, dir: key === 'total' ? 'desc' : 'asc' };
    });
  }

  const summary = !data
    ? 'Loading reservations…'
    : `${formatNumber(rows.length)}${data.length >= API_LIMIT ? '+' : ''} reservation${rows.length === 1 ? '' : 's'}${booked ? ` · ${formatMoney(booked, 'USD', { cents: false })} booked` : ''}`;

  const empty = searching
    ? {
        icon: Search,
        title: `No reservations match “${q}”`,
        description: 'Try a last name, the 8-character confirmation code, an email address or a phone number.',
        action: (
          <Button variant="outline" onClick={() => setText('')}>
            Clear search
          </Button>
        ),
      }
    : roomType !== 'all'
      ? {
          icon: BedDouble,
          title: `No ${typeName ?? 'matching'} reservations here`,
          description: `Nothing in “${cfg.label}” for this room type.`,
          action: (
            <Button variant="outline" onClick={() => setRoomType('all')}>
              Show all room types
            </Button>
          ),
        }
      : view === 'upcoming'
        ? {
            icon: CalendarDays,
            title: 'No upcoming reservations',
            description: 'New bookings from your booking page land here the moment a guest confirms.',
            action: propertyId ? (
              <Button asChild variant="outline">
                <Link href={`/properties/${propertyId}`} target="_blank" rel="noopener">
                  Open your booking page <ExternalLink aria-hidden />
                </Link>
              </Button>
            ) : undefined,
          }
        : view === 'inhouse'
          ? {
              icon: BedDouble,
              title: 'Nobody is staying right now',
              description: 'Guests show up here once they’re checked in at the front desk.',
              action: (
                <Button asChild variant="outline">
                  <Link href="/admin/front-desk">Go to the front desk</Link>
                </Button>
              ),
            }
          : view === 'cancelled'
            ? { icon: CalendarX2, title: 'No cancellations or no-shows', description: 'Cancelled stays and no-shows are listed here for your records.', action: undefined }
            : { icon: CalendarDays, title: view === 'past' ? 'No past stays yet' : 'No reservations yet', description: 'Checked-out stays are kept here, with their history and payments.', action: undefined };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <div className="space-y-5">
        <PageHeader
          title="Reservations"
          description={<span aria-live="polite">{summary}</span>}
        />

        {/* Filters */}
        <div role="search" aria-label="Filter reservations" className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SegmentedControl
            layoutId="bookings-view"
            aria-label="Which reservations"
            value={view}
            onChange={(v) => {
              setView(v);
              setSortOverride(null);
            }}
            options={(Object.keys(VIEWS) as View[]).map((v) => ({ value: v, label: VIEWS[v].label, disabled: searching }))}
            className="max-w-full self-start"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
            <div className="relative min-w-0 flex-1 lg:max-w-sm">
              <label htmlFor="res-search" className="sr-only">
                Search reservations
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                ref={searchRef}
                id="res-search"
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setText('')}
                placeholder="Guest, email, phone or code"
                className="pl-9 pr-10 [&::-webkit-search-cancel-button]:hidden"
                autoComplete="off"
              />
              {text && (
                <IconButton
                  label="Clear search"
                  size="icon-sm"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => {
                    setText('');
                    searchRef.current?.focus();
                  }}
                >
                  <X />
                </IconButton>
              )}
            </div>
            <Select value={roomType} onValueChange={setRoomType}>
              <SelectTrigger aria-label="Room type" className="w-full shrink-0 sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">All room types</SelectItem>
                {(roomTypes ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {searching && (
          <p className="-mt-2 text-sm text-muted-foreground" role="status">
            Searching every reservation for “{q}”. Clear the search to use the tabs again.
          </p>
        )}

        {/* overflow-clip (not hidden) keeps the sticky header pinned to the window. */}
        <Card className="overflow-clip p-0 shadow-xs" aria-busy={isLoading && !data}>
          {error && !data ? (
            <EmptyState icon={CalendarX2} title="Couldn’t load reservations" description={(error as Error).message || 'Check your connection and try again.'} />
          ) : isLoading && !data ? (
            <ReservationListSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
          ) : (
            <>
              <ReservationList rows={shown} today={today} sort={sort} onSort={onSort} />
              <div className="flex flex-col items-center gap-2 border-t bg-surface-sunken/50 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:justify-between">
                <p role="status">
                  Showing {formatNumber(shown.length)} of {formatNumber(rows.length)}
                  {data && data.length >= API_LIMIT && !searching ? ' — search to find older or later stays' : ''}
                </p>
                {shown.length < rows.length && (
                  <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                    Show {Math.min(PAGE, rows.length - shown.length)} more
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
