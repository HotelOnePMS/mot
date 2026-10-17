'use client';

import * as React from 'react';
import { AlertTriangle, Info, Siren, UserRound } from 'lucide-react';
import type { AgentBlock } from '@/lib/agent/blocks';
import { timeAgo } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, Callout } from '@/components/ui/primitives';
import { RoomGrid, RoomLegend } from '@/components/hotel/RoomGrid';
import { SourceBadge, TaskStatusBadge } from '@/components/hotel/badges';
import { useAgentUI } from '../AgentUI';
import { BlockCard, BlockHeader, CountPill } from './core';

export function RoomsBlock({ block }: { block: Extract<AgentBlock, { type: 'rooms' }> }) {
  const { send, compact } = useAgentUI();
  const id = React.useId();
  return (
    <BlockCard aria-labelledby={id} className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold">
          {block.title}
        </h2>
        {!compact && <RoomLegend />}
      </div>
      <RoomGrid
        rooms={block.rooms}
        highlight={block.highlight}
        dense={compact}
        onRoomClick={(r) => send(r.current ? `show reservation ${r.current.code}` : r.arriving ? `show reservation ${r.arriving.code}` : `rooms on floor ${r.floor ?? ''}`)}
      />
    </BlockCard>
  );
}

export function HousekeepingBlock({ block }: { block: Extract<AgentBlock, { type: 'housekeeping' }> }) {
  const { send, busy } = useAgentUI();
  const id = React.useId();
  const open = block.tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  const done = block.tasks.length - open.length;
  const byPerson = new Map<string, number>();
  for (const t of open) byPerson.set(t.assignee?.name ?? 'Unassigned', (byPerson.get(t.assignee?.name ?? 'Unassigned') ?? 0) + 1);
  const shown = block.tasks.slice(0, 10);
  return (
    <BlockCard aria-labelledby={id}>
      <BlockHeader
        id={id}
        title={block.title}
        description={`${open.length} open · ${done} done today`}
        meta={
          byPerson.size > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Open rooms per person">
              {[...byPerson.entries()].map(([name, n]) => (
                <li key={name}>
                  {name === 'Unassigned' ? (
                    <Badge variant="warning" size="sm" icon={UserRound}>
                      Unassigned · {n}
                    </Badge>
                  ) : (
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-surface pl-0.5 pr-2 text-xs">
                      <Avatar name={name} size="xs" />
                      {name.split(' ')[0]} · {n}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      />
      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No cleaning tasks right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken/60 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="w-16 px-4 py-2 font-semibold">
                  Room
                </th>
                <th scope="col" className="px-2 py-2 font-semibold">
                  Type
                </th>
                <th scope="col" className="hidden px-2 py-2 font-semibold sm:table-cell">
                  Assigned to
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className="px-4 py-2.5 text-left font-semibold tabular">
                    {t.room.number}
                  </th>
                  <td className="min-w-0 px-2 py-2.5 text-muted-foreground">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate">{t.room.roomTypeName}</span>
                      {t.priority >= 3 && (
                        <Badge variant="warning" size="sm">
                          Needed for arrival
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="hidden max-w-[10rem] truncate px-2 py-2.5 text-xs text-muted-foreground sm:table-cell">{t.assignee?.name ?? 'Unassigned'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <TaskStatusBadge status={t.status} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(block.tasks.length > shown.length || open.some((t) => !t.assignee)) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
          {block.tasks.length > shown.length ? (
            <p className="text-xs text-muted-foreground">
              Showing {shown.length} of {block.tasks.length}
            </p>
          ) : (
            <span />
          )}
          {open.some((t) => !t.assignee) && (
            <Button type="button" size="sm" variant="soft" disabled={busy} onClick={() => send('auto-assign housekeeping')}>
              Auto-assign unassigned rooms
            </Button>
          )}
        </div>
      )}
    </BlockCard>
  );
}

const ALERT = {
  danger: { icon: Siren, tone: 'danger', sr: 'Urgent' },
  warning: { icon: AlertTriangle, tone: 'warning', sr: 'Needs a look' },
  info: { icon: Info, tone: 'info', sr: 'Heads-up' },
} as const;

export function AlertsBlock({ block }: { block: Extract<AgentBlock, { type: 'alerts' }> }) {
  const { send, busy } = useAgentUI();
  if (block.items.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Needs attention">
      {block.items.map((a) => {
        const t = ALERT[a.tone];
        return (
          <li key={a.id}>
            <Callout
              tone={t.tone}
              icon={t.icon}
              title={
                <>
                  <span className="sr-only">{t.sr}: </span>
                  {a.title}
                </>
              }
              action={
                a.command && (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => send(a.command!)}>
                    Handle
                  </Button>
                )
              }
            >
              {a.detail && <span className="block text-xs opacity-90">{a.detail}</span>}
            </Callout>
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityBlock({ block }: { block: Extract<AgentBlock, { type: 'activity' }> }) {
  return (
    <BlockCard>
      {block.items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing has happened yet today. Changes made here or in the classic screens will show up.</p>
      ) : (
        <>
          <BlockHeader title="Activity" meta={<CountPill n={block.items.length} label="entries" />} className="py-2.5" />
          <ol className="divide-y">
            {block.items.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                <Avatar name={a.user.name} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{a.summary}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                    <span>{a.user.name}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={a.at}>{timeAgo(a.at)}</time>
                    <SourceBadge source={a.source} quiet className="ml-0.5" />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </BlockCard>
  );
}
