'use client';

import * as React from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  Brush,
  CircleAlert,
  CircleCheck,
  Moon,
  Repeat,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { RoomSummary } from '@/lib/dto';
import { OCCUPANCY, ROOM_STATUS } from '@/lib/status';
import { cn } from '@/lib/utils';

/**
 * Housekeeping status → tile fill, its AA text colour and an icon, so the
 * status reads by colour, word and shape. Out of order wins over the rest.
 */
const STATUS: Record<string, { tile: string; text: string; dot: string; icon: LucideIcon }> = {
  CLEAN: { tile: 'border-success/30 bg-success-soft', text: 'text-success-soft-foreground', dot: 'bg-success', icon: CircleCheck },
  INSPECTED: { tile: 'border-info/30 bg-info-soft', text: 'text-info-soft-foreground', dot: 'bg-info', icon: BadgeCheck },
  DIRTY: { tile: 'border-warning/45 bg-warning-soft', text: 'text-warning-soft-foreground', dot: 'bg-warning', icon: Brush },
  OUT_OF_ORDER: { tile: 'border-destructive/35 bg-destructive-soft', text: 'text-destructive-soft-foreground', dot: 'bg-destructive', icon: Wrench },
};

const OCCUPANCY_ICON: Partial<Record<RoomSummary['occupancy'], LucideIcon>> = {
  OCCUPIED: User,
  ARRIVING: ArrowDownToLine,
  DEPARTING: ArrowUpFromLine,
  TURNOVER: Repeat,
};

function statusKey(room: RoomSummary) {
  return room.isOutOfOrder ? 'OUT_OF_ORDER' : room.status;
}

/** One sentence that says everything the tile shows (its accessible name and tooltip). */
function describe(room: RoomSummary) {
  const guest = room.current?.guestName ?? room.arriving?.guestName;
  const occ = OCCUPANCY[room.occupancy]?.label ?? room.occupancy.toLowerCase();
  return [
    `Room ${room.number}, ${room.roomType.name}`,
    room.isOutOfOrder ? `out of order${room.outOfOrderReason ? ` (${room.outOfOrderReason})` : ''}` : (ROOM_STATUS[room.status]?.label ?? room.status).toLowerCase(),
    room.occupancy !== 'VACANT' ? `${occ.toLowerCase()}${guest ? `: ${guest}` : ''}` : 'vacant',
    room.task ? `cleaning ${room.task.status === 'IN_PROGRESS' ? 'in progress' : 'to do'}${room.task.assignee ? ` (${room.task.assignee.name})` : ''}` : null,
    room.tags.includes('quiet') ? 'quiet room' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

export function RoomTile({ room, highlight, onClick }: { room: RoomSummary; highlight?: boolean; onClick?: () => void }) {
  const guest = room.current?.guestName ?? room.arriving?.guestName;
  const s = STATUS[statusKey(room)] ?? STATUS.CLEAN;
  const StatusIcon = s.icon;
  const OccIcon = OCCUPANCY_ICON[room.occupancy];
  const label = describe(room);
  const statusLabel = room.isOutOfOrder ? 'Out of order' : (ROOM_STATUS[room.status]?.label ?? room.status);
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      {...(onClick ? { type: 'button' as const, onClick, 'aria-label': label } : { role: 'group', 'aria-label': label })}
      data-room-tile={room.number}
      title={label}
      className={cn(
        'relative flex min-h-[92px] flex-col rounded-xl border p-2.5 text-left',
        s.tile,
        onClick &&
          'transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:hover:translate-y-0',
        // The agent points at rooms it is talking about (AI context only).
        highlight && 'ring-2 ring-agent ring-offset-2 ring-offset-background'
      )}
    >
      <span className="flex items-start justify-between gap-1" aria-hidden>
        <span className="text-[15px] font-semibold leading-none text-foreground tabular">{room.number}</span>
        <span className="flex items-center gap-1 text-foreground [&_svg]:size-3.5">
          {OccIcon && <OccIcon />}
          {room.task && !room.isOutOfOrder && <Brush className={cn(room.task.status === 'IN_PROGRESS' && 'motion-safe:animate-pulse')} />}
          {room.tags.includes('quiet') && <Moon className="text-muted-foreground" />}
        </span>
      </span>
      <span className="mt-1.5 block truncate text-2xs text-muted-foreground" aria-hidden>
        {room.roomType.name}
      </span>
      <span className="block truncate text-xs font-medium text-foreground" aria-hidden>
        {room.isOutOfOrder ? (room.outOfOrderReason ?? 'Maintenance') : (guest ?? 'Vacant')}
      </span>
      <span className={cn('mt-auto inline-flex items-center gap-1 pt-1 text-2xs font-semibold', s.text)} aria-hidden>
        <StatusIcon className="size-3 shrink-0" />
        {statusLabel}
      </span>
    </Comp>
  );
}

export function RoomLegend({ className }: { className?: string }) {
  const statuses: [string, string][] = [
    ['CLEAN', 'Clean'],
    ['INSPECTED', 'Inspected'],
    ['DIRTY', 'Dirty'],
    ['OUT_OF_ORDER', 'Out of order'],
  ];
  const marks: [LucideIcon, string][] = [
    [User, 'Occupied'],
    [ArrowDownToLine, 'Arriving'],
    [ArrowUpFromLine, 'Departing'],
    [Repeat, 'Turnover'],
    [Brush, 'Cleaning queued'],
    [Moon, 'Quiet room'],
  ];
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground', className)} aria-label="Room board key">
      {statuses.map(([k, l]) => {
        const Icon = STATUS[k].icon;
        return (
          <li key={k} className={cn('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-medium', STATUS[k].tile, STATUS[k].text)}>
            <Icon className="size-3" aria-hidden />
            {l}
          </li>
        );
      })}
      {marks.map(([Icon, l]) => (
        <li key={l} className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5 text-foreground" aria-hidden />
          {l}
        </li>
      ))}
    </ul>
  );
}

/** Rooms grouped by floor — a live floor plan of the property. */
export function RoomGrid({
  rooms,
  highlight = [],
  onRoomClick,
  dense,
  emptyText = 'No rooms match this filter.',
}: {
  rooms: RoomSummary[];
  highlight?: string[];
  onRoomClick?: (room: RoomSummary) => void;
  dense?: boolean;
  emptyText?: string;
}) {
  const floors = React.useMemo(() => {
    const map = new Map<string, RoomSummary[]>();
    for (const r of rooms) map.set(r.floor ?? '—', [...(map.get(r.floor ?? '—') ?? []), r]);
    return [...map.entries()].sort((a, b) => (parseInt(b[0]) || 0) - (parseInt(a[0]) || 0));
  }, [rooms]);
  if (!rooms.length) {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
        <CircleAlert className="size-4" aria-hidden /> {emptyText}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {floors.map(([floor, list]) => (
        <section key={floor} aria-label={floor === '—' ? 'Rooms without a floor' : `Floor ${floor}`} className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
          <div className="shrink-0 text-2xs font-semibold uppercase tracking-wider whitespace-nowrap text-muted-foreground sm:w-14 sm:pt-2.5 sm:text-right" aria-hidden>
            {floor === '—' ? '' : `Floor ${floor}`}
          </div>
          <div className={cn('grid flex-1 gap-2', dense ? 'grid-cols-[repeat(auto-fill,minmax(96px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(108px,1fr))]')}>
            {list.map((r) => (
              <RoomTile key={r.id} room={r} highlight={highlight.includes(r.number)} onClick={onRoomClick ? () => onRoomClick(r) : undefined} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
