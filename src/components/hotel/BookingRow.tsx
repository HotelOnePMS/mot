import * as React from 'react';
import Link from 'next/link';
import { BedDouble, MessageSquareText, Users } from 'lucide-react';
import type { BookingSummary, ISODate } from '@/lib/dto';
import { formatDateRange, formatMoney, formatNights, relativeDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/primitives';
import { BookingStatusBadge, PaymentBadge } from './badges';

/** The guest's name; when the row opens something, it stretches over the whole row. */
const stretched =
  "rounded-sm text-left font-medium after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";

/**
 * One reservation, scannable in a glance: who, what, when, which room,
 * status — with an actions slot. Shared by the classic front desk and the
 * agent's booking lists so both modes look identical.
 *
 * Pass `href` (preferred: a real link that opens in a new tab too) or
 * `onClick`; either makes the whole row keyboard-reachable through the
 * guest's name. Buttons in `actions` stay clickable on top.
 */
export function BookingRow({
  booking: b,
  today,
  variant = 'default',
  actions,
  onClick,
  href,
  className,
}: {
  booking: BookingSummary;
  today: ISODate;
  variant?: 'default' | 'arrivals' | 'departures' | 'inhouse';
  actions?: React.ReactNode;
  onClick?: () => void;
  /** Link target for the whole row, e.g. the reservation detail page. */
  href?: string;
  className?: string;
}) {
  const late = variant === 'arrivals' && b.checkIn < today && b.status !== 'CHECKED_IN';
  const overdue = variant === 'departures' && b.checkOut < today && b.status === 'CHECKED_IN';
  const lastNote = b.notes?.split('\n').slice(-1)[0]?.replace(/^\[[^\]]+\]\s*/, '');
  const interactive = Boolean(href || onClick);
  // A future stay without a room is normal; flag it only once the guest is due.
  const needsRoom = !b.room && b.checkIn <= today && (b.status === 'CONFIRMED' || b.status === 'PENDING');

  const name = href ? (
    <Link href={href} className={cn(stretched, 'truncate')}>
      {b.guest.name}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className={cn(stretched, 'truncate')}>
      {b.guest.name}
    </button>
  ) : (
    <span className="truncate font-medium">{b.guest.name}</span>
  );

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-3 px-4 py-3.5 transition-colors sm:flex-row sm:items-center',
        interactive && 'hover:bg-accent/50',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={b.guest.name} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {name}
            <span className="font-mono text-2xs text-muted-foreground">{b.code}</span>
            {late && (
              <Badge variant="warning" size="sm">
                Late arrival
              </Badge>
            )}
            {overdue && (
              <Badge variant="danger" size="sm">
                Overdue
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{b.roomType.name}</span>
            <span className="tabular">
              {formatDateRange(b.checkIn, b.checkOut)} · {formatNights(b.nights)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" aria-hidden />
              <span className="sr-only">Guests:</span>
              {b.guests}
            </span>
            {variant === 'inhouse' && <span>Leaves {relativeDay(b.checkOut, today).toLowerCase()}</span>}
          </div>
          {lastNote && (
            <p className="mt-1 flex items-start gap-1 text-xs text-foreground/80">
              <MessageSquareText className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">Note:</span>
              <span className="line-clamp-1">{lastNote}</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-12 sm:pl-0">
        {(b.room || needsRoom) && (
          <span
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium tabular',
              b.room ? 'bg-surface' : 'border-dashed border-warning bg-warning-soft text-warning-soft-foreground'
            )}
            title={b.room ? `Room ${b.room.number}, floor ${b.room.floor ?? '—'}` : 'No room assigned'}
          >
            <BedDouble className="size-3.5" aria-hidden />
            {b.room ? (
              <>
                <span className="sr-only">Room</span> {b.room.number}
              </>
            ) : (
              'No room'
            )}
          </span>
        )}
        <BookingStatusBadge status={b.status} />
        {variant === 'departures' && b.paymentStatus !== 'PAID' && <PaymentBadge status={b.paymentStatus} />}
        <span className="hidden w-20 text-right text-sm font-medium tabular md:inline">{formatMoney(b.totalPrice, 'USD', { cents: false })}</span>
        {actions && (
          // Above the stretched link, so these stay clickable.
          <div className="relative z-10 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
