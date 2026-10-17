'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { BookingStatus, BookingSummary, ISODate } from '@/lib/dto';
import { fmtDay, formatDateRange, formatMoney, formatNights, nightsBetween, relativeDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { BookingStatusBadge, PaymentBadge } from '@/components/hotel/badges';

export type SortKey = 'guest' | 'checkIn' | 'room' | 'status' | 'total';
export type Sort = { key: SortKey; dir: 'asc' | 'desc' };

const STATUS_ORDER: Record<BookingStatus, number> = {
  PENDING: 0,
  CONFIRMED: 1,
  CHECKED_IN: 2,
  CHECKED_OUT: 3,
  NO_SHOW: 4,
  CANCELLED: 5,
};

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function sortBookings(list: BookingSummary[], sort: Sort): BookingSummary[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const byArrival = (a: BookingSummary, b: BookingSummary) => a.checkIn.localeCompare(b.checkIn) || collator.compare(a.guest.name, b.guest.name);
  return [...list].sort((a, b) => {
    switch (sort.key) {
      case 'guest':
        return dir * collator.compare(a.guest.name, b.guest.name) || byArrival(a, b);
      case 'room': {
        // Unassigned rooms always sink to the bottom.
        if (!a.room !== !b.room) return a.room ? -1 : 1;
        return dir * (collator.compare(a.room?.number ?? '', b.room?.number ?? '') || collator.compare(a.roomType.name, b.roomType.name)) || byArrival(a, b);
      }
      case 'status':
        return dir * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || byArrival(a, b);
      case 'total':
        return dir * (a.totalPrice - b.totalPrice) || byArrival(a, b);
      case 'checkIn':
      default:
        return dir * byArrival(a, b);
    }
  });
}

/** The guest's name; it stretches over the whole row so the row is one link. */
const rowLink =
  "rounded-sm font-medium text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";

function flags(b: BookingSummary, today: ISODate) {
  return {
    late: !!today && (b.status === 'CONFIRMED' || b.status === 'PENDING') && b.checkIn < today,
    overdue: !!today && b.status === 'CHECKED_IN' && b.checkOut < today,
  };
}

/** "Today", "Tomorrow", "Yesterday", else the weekday ("Fri"). */
function whenLabel(b: BookingSummary, today: ISODate) {
  if (!today) return '';
  if (b.status === 'CHECKED_IN') {
    const day = relativeDay(b.checkOut, today);
    // Lowercase only the words ("leaves today"), never a date ("Wed, Oct 14").
    const when = /^(Today|Tomorrow|Yesterday)$/.test(day) ? day.toLowerCase() : day;
    return b.checkOut < today ? `Was due out ${when}` : `Leaves ${when}`;
  }
  const d = Math.abs(nightsBetween(b.checkIn, today) || nightsBetween(today, b.checkIn));
  return d <= 1 ? relativeDay(b.checkIn, today) : fmtDay(b.checkIn, 'weekday').split(',')[0];
}

function StatusCell({ b, today }: { b: BookingSummary; today: ISODate }) {
  const { late, overdue } = flags(b, today);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <BookingStatusBadge status={b.status} size="sm" />
      {late && (
        <Badge variant="warning" size="sm">
          Late
        </Badge>
      )}
      {overdue && (
        <Badge variant="danger" size="sm">
          Overdue
        </Badge>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('bg-surface-sunken/95 px-3 py-1.5 font-medium backdrop-blur first:pl-4 last:pr-4', align === 'right' && 'text-right', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'group/sort -mx-2 inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active ? 'text-foreground' : 'text-muted-foreground',
          align === 'right' && 'flex-row-reverse'
        )}
      >
        {label}
        <Icon className={cn('size-3.5 shrink-0', !active && 'opacity-40 group-hover/sort:opacity-80')} aria-hidden />
      </button>
    </th>
  );
}

/** Same row heights as the real list, so nothing jumps when data arrives. */
export function ReservationListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden>
      <div className="hidden h-11 border-b bg-surface-sunken/60 md:block" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 md:h-[65px]">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="hidden h-4 w-24 md:block" />
          <Skeleton className="hidden h-4 w-24 md:block" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="hidden h-4 w-14 md:block" />
        </div>
      ))}
    </div>
  );
}

/**
 * Reservations as a sortable table on desktop and stacked cards on phones.
 * Each row is one link to the reservation (open in a new tab works too).
 */
export function ReservationList({
  rows,
  today,
  sort,
  onSort,
  currency = 'USD',
}: {
  rows: BookingSummary[];
  today: ISODate;
  sort: Sort;
  onSort: (k: SortKey) => void;
  currency?: string;
}) {
  const href = (b: BookingSummary) => `/admin/bookings/${b.id}`;
  return (
    <>
      {/* Desktop and tablet: a real table with a sticky header. */}
      <table className="hidden w-full table-fixed border-separate border-spacing-0 text-sm md:table">
        <caption className="sr-only">Reservations. Select a column heading to sort.</caption>
        <thead className="sticky top-14 z-10 text-left shadow-[inset_0_-1px_0_hsl(var(--border))]">
          <tr>
            <SortHeader label="Guest" sortKey="guest" sort={sort} onSort={onSort} />
            <SortHeader label="Stay" sortKey="checkIn" sort={sort} onSort={onSort} className="w-40 xl:w-44" />
            <SortHeader label="Room" sortKey="room" sort={sort} onSort={onSort} className="w-36 xl:w-44" />
            <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSort} className="w-48" />
            <th scope="col" className="hidden w-40 bg-surface-sunken/95 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur xl:table-cell">
              Payment
            </th>
            <SortHeader label="Total" sortKey="total" sort={sort} onSort={onSort} align="right" className="w-28" />
          </tr>
        </thead>
        <tbody className="[&>tr+tr>td]:border-t">
          {rows.map((b) => (
            <tr key={b.id} className="group relative transition-colors hover:bg-accent/40 has-[a:focus-visible]:bg-accent/40">
              <td className="py-3 pl-4 pr-3 align-middle">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={b.guest.name} />
                  <div className="min-w-0">
                    <Link href={href(b)} className={cn(rowLink, 'block truncate')}>
                      {b.guest.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono tracking-wide">{b.code}</span>
                      <span aria-hidden> · </span>
                      <span>
                        {b.guests} guest{b.guests === 1 ? '' : 's'}
                        {b.rooms > 1 ? `, ${b.rooms} rooms` : ''}
                      </span>
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 align-middle">
                <p className="truncate font-medium tabular">{formatDateRange(b.checkIn, b.checkOut)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatNights(b.nights)} · {whenLabel(b, today)}
                </p>
              </td>
              <td className="px-3 py-3 align-middle">
                <p className="truncate">{b.roomType.name}</p>
                <p className={cn('truncate text-xs', b.room ? 'text-muted-foreground' : 'italic text-muted-foreground')}>
                  {b.room ? `Room ${b.room.number}` : 'No room yet'}
                </p>
              </td>
              <td className="px-3 py-3 align-middle">
                <StatusCell b={b} today={today} />
              </td>
              <td className="hidden px-3 py-3 align-middle xl:table-cell">
                <PaymentBadge status={b.paymentStatus} size="sm" />
              </td>
              <td className="py-3 pl-3 pr-4 text-right align-middle font-medium tabular">
                {b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? (
                  <span className="text-muted-foreground line-through decoration-muted-foreground/60">{formatMoney(b.totalPrice, currency, { cents: false })}</span>
                ) : (
                  formatMoney(b.totalPrice, currency, { cents: false })
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Phones: stacked cards with the same facts. */}
      <ul className="divide-y md:hidden">
        {rows.map((b) => (
          <li key={b.id} className="relative transition-colors hover:bg-accent/40 has-[a:focus-visible]:bg-accent/40">
            <div className="flex items-start gap-3 px-4 py-3.5">
              <Avatar name={b.guest.name} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Link href={href(b)} className={cn(rowLink, 'min-w-0 truncate text-base leading-6')}>
                    {b.guest.name}
                  </Link>
                  <span className={cn('shrink-0 font-semibold tabular', (b.status === 'CANCELLED' || b.status === 'NO_SHOW') && 'text-muted-foreground line-through')}>
                    {formatMoney(b.totalPrice, currency, { cents: false })}
                  </span>
                </div>
                <p className="mt-0.5 text-sm tabular text-foreground/90">
                  {formatDateRange(b.checkIn, b.checkOut)} · {formatNights(b.nights)}
                  {today && <span className="text-muted-foreground"> · {whenLabel(b, today)}</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {b.roomType.name} · {b.room ? `Room ${b.room.number}` : 'No room yet'} · <span className="font-mono">{b.code}</span>
                </p>
                <div className="mt-2">
                  <StatusCell b={b} today={today} />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
