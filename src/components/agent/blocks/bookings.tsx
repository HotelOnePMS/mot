'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, BedDouble, CalendarRange, ChevronDown, CreditCard, Mail, Phone, StickyNote, Users } from 'lucide-react';
import type { AgentBlock, QuickAction } from '@/lib/agent/blocks';
import type { BookingSummary } from '@/lib/dto';
import { fmtDay, fmtRange, formatMoney, formatPhone, telHref, timeAgo } from '@/lib/format';
import { BOOKING_STATUS } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/primitives';
import { BookingRow } from '@/components/hotel/BookingRow';
import { BookingStatusBadge, PaymentBadge } from '@/components/hotel/badges';
import { useAgentUI } from '../AgentUI';
import { ActionButtons, BlockCard, BlockHeader, CountPill } from './core';

function rowActions(b: BookingSummary, variant: string, today: string): QuickAction[] {
  const arriving = (b.status === 'CONFIRMED' || b.status === 'PENDING') && b.checkIn <= today && b.checkOut > today;
  if (variant === 'arrivals' && arriving) return [{ label: 'Check in', command: `check in ${b.code}`, tone: 'primary' }];
  if ((variant === 'departures' || variant === 'inhouse') && b.status === 'CHECKED_IN') return [{ label: 'Check out', command: `check out ${b.code}` }];
  return [];
}

export function BookingsBlock({ block }: { block: Extract<AgentBlock, { type: 'bookings' }> }) {
  const { today, send, compact } = useAgentUI();
  const [expanded, setExpanded] = React.useState(false);
  const id = React.useId();
  const limit = compact ? 5 : 8;
  const items = expanded ? block.items : block.items.slice(0, limit);
  return (
    <BlockCard aria-labelledby={id}>
      <BlockHeader id={id} title={block.title} meta={<CountPill n={block.items.length} label={block.items.length === 1 ? 'reservation' : 'reservations'} />} className="py-2.5" />
      {block.items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{block.emptyText ?? 'Nothing here right now.'}</p>
      ) : (
        <div className="divide-y">
          {items.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              today={today}
              variant={block.variant === 'search' ? 'default' : block.variant}
              onClick={() => send(`show reservation ${b.code}`)}
              actions={<ActionButtons actions={rowActions(b, block.variant, today)} />}
              className={compact ? 'sm:flex-col sm:items-start' : undefined}
            />
          ))}
        </div>
      )}
      {block.items.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex min-h-10 w-full items-center justify-center gap-1.5 border-t text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {expanded ? 'Show fewer' : `Show all ${block.items.length}`}
          <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
        </button>
      )}
    </BlockCard>
  );
}

export function BookingCard({ block }: { block: Extract<AgentBlock, { type: 'booking' }> }) {
  const b = block.booking;
  const id = React.useId();
  const notes = b.notes?.split('\n').filter(Boolean) ?? [];
  return (
    <BlockCard aria-labelledby={id} className="shadow-soft">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <Avatar name={b.guest.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={id} className="text-base font-semibold leading-snug">
              {b.guest.name}
            </h2>
            <BookingStatusBadge status={b.status} size="sm" />
          </div>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            <span className="sr-only">Confirmation code </span>#{b.code}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <a
              href={`mailto:${b.guest.email}`}
              className="inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Mail className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{b.guest.email}</span>
            </a>
            {b.guest.phone && (
              <a
                href={telHref(b.guest.phone)}
                className="inline-flex min-h-6 items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Phone className="size-3.5 shrink-0" aria-hidden />
                {formatPhone(b.guest.phone)}
              </a>
            )}
          </div>
        </div>
        <div className="ml-auto text-right">
          <p className="text-lg font-semibold tabular">
            <span className="sr-only">Total </span>
            {formatMoney(b.totalPrice)}
          </p>
          <PaymentBadge status={b.paymentStatus} size="sm" />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px border-y bg-border text-sm sm:grid-cols-4">
        {[
          { icon: CalendarRange, label: 'Stay', value: fmtRange(b.checkIn, b.checkOut), hint: `${b.nights} night${b.nights === 1 ? '' : 's'}` },
          { icon: BedDouble, label: 'Room', value: b.room ? `Room ${b.room.number}` : 'Not assigned', hint: b.roomType.name, muted: !b.room },
          { icon: Users, label: 'Guests', value: `${b.guests} guest${b.guests === 1 ? '' : 's'}`, hint: `${b.rooms} room${b.rooms === 1 ? '' : 's'}` },
          { icon: CreditCard, label: 'Booked', value: fmtDay(b.createdAt.slice(0, 10)), hint: b.propertyName },
        ].map((c) => (
          <div key={c.label} className="min-w-0 bg-card px-4 py-3">
            <dt className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              <c.icon className="size-3.5" aria-hidden />
              {c.label}
            </dt>
            <dd className={cn('mt-1 font-medium', c.muted && 'text-muted-foreground')}>{c.value}</dd>
            <dd className="truncate text-xs text-muted-foreground">{c.hint}</dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 && (
        <div className="space-y-1.5 border-b bg-surface-sunken/60 px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            <StickyNote className="size-3.5" aria-hidden /> Notes
          </h3>
          {notes.slice(-3).map((n, i) => {
            // Staff notes are stamped "[YYYY-MM-DD · Name] text".
            const m = n.match(/^\[[^\]·]+·\s*([^\]]+)\]\s*(.*)$/);
            return (
              <p key={i} className="text-sm">
                {m ? m[2] : n}
                {m && <span className="ml-1.5 text-xs text-muted-foreground">— {m[1]}</span>}
              </p>
            );
          })}
        </div>
      )}
      {block.history && block.history.length > 0 && (
        <details className="group border-b">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 px-4 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
            History · {block.history.length} {block.history.length === 1 ? 'event' : 'events'}
          </summary>
          <ol className="space-y-1.5 px-4 pb-3">
            {block.history.map((h, i) => (
              <li key={i} className="flex gap-2 text-xs">
                <span className="w-20 shrink-0 text-muted-foreground">{timeAgo(h.createdAt)}</span>
                <span className="font-medium">{BOOKING_STATUS[h.status as keyof typeof BOOKING_STATUS]?.label ?? h.status}</span>
                <span className="truncate text-muted-foreground">{h.notes}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <ActionButtons actions={block.actions} />
        <Button asChild variant="ghost" size="sm" className="ml-auto text-muted-foreground">
          <Link href={`/admin/bookings/${b.id}`}>
            Open full reservation <ArrowUpRight aria-hidden />
          </Link>
        </Button>
      </div>
    </BlockCard>
  );
}

/** Rooms the agent suggests for a guest, best match first. */
export function RoomOptionsBlock({ block }: { block: Extract<AgentBlock, { type: 'roomOptions' }> }) {
  const { send, busy } = useAgentUI();
  const id = React.useId();
  return (
    <BlockCard aria-labelledby={id}>
      <BlockHeader id={id} title={block.title} description={`For ${block.guestName} · #${block.bookingCode}`} />
      {block.options.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No free rooms of this type for those nights. Try another room type or ask for availability.</p>
      ) : (
        <ul className="grid gap-2 p-3 sm:grid-cols-2">
          {block.options.map((o, i) => (
            <li key={o.room.id} className={cn('flex flex-col rounded-xl border p-3', i === 0 ? 'border-primary/40 bg-primary-soft/40' : 'bg-surface')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold leading-6 tabular">Room {o.room.number}</p>
                  <p className="text-xs text-muted-foreground">{o.room.floor ? `Floor ${o.room.floor}` : 'Floor not set'}</p>
                </div>
                {i === 0 && (
                  <Badge variant="primary" size="sm">
                    Best match
                  </Badge>
                )}
              </div>
              {o.reasons.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Why this room">
                  {o.reasons.map((r) => (
                    <li key={r}>
                      <Badge variant={r === 'Needs cleaning' ? 'warning' : 'neutral'} size="sm">
                        {r}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                size="sm"
                variant={i === 0 ? 'default' : 'outline'}
                className="mt-3"
                disabled={busy}
                onClick={() => send(`assign room ${o.room.number} to ${block.bookingCode}`)}
              >
                {i === 0 ? `Use room ${o.room.number}` : `Use ${o.room.number}`}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </BlockCard>
  );
}
