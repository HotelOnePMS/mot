'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { BadgeCheck, Brush, CircleCheck, Wrench } from 'lucide-react';
import type { RoomSummary, TeamMember } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { fmtDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OccupancyBadge, RoomStatusBadge, TaskStatusBadge } from '@/components/hotel/badges';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { AskAgentButton } from '@/components/console/AskAgentButton';

export function RoomSheet({ room, onOpenChange }: { room: RoomSummary | null; onOpenChange: (o: boolean) => void }) {
  const { can, refresh } = useConsole();
  const statusLabelId = React.useId();
  const teamUrl = usePropertyUrl('/api/admin/team', { role: 'HOUSEKEEPER' });
  const { data: team, error: teamError } = useSWR<TeamMember[]>(room && can('housekeeping.assign') ? teamUrl : null, fetcher);
  const teamPlaceholder = teamError
    ? 'Couldn’t load housekeepers'
    : !team
      ? 'Loading housekeepers…'
      : team.length
        ? 'Choose a housekeeper'
        : 'No housekeepers on this property yet';
  const [busy, setBusy] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  React.useEffect(() => setReason(''), [room?.id]);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      refresh();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: object) => api(`/api/admin/rooms/${room!.id}`, { method: 'PATCH', json: body });

  return (
    <Sheet open={!!room} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col p-0">
        {room && (
          <>
            <SheetHeader>
              <SheetTitle className="text-lg">Room {room.number}</SheetTitle>
              <SheetDescription>
                {room.roomType.name}
                {room.floor ? ` · Floor ${room.floor}` : ''}
                {room.tags.length > 0 && ` · ${room.tags.map((t) => t.replace(/[-_]/g, ' ')).join(', ')}`}
              </SheetDescription>
              <div className="flex flex-wrap gap-1.5 pt-2">
                <RoomStatusBadge status={room.status} />
                <OccupancyBadge occupancy={room.occupancy} />
                {room.task && <TaskStatusBadge status={room.task.status} />}
              </div>
            </SheetHeader>
            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {(room.current || room.arriving) && (
                <div className="space-y-2">
                  {room.current && (
                    <div className="rounded-xl border bg-surface-sunken p-3 text-sm">
                      <p className="text-xs text-muted-foreground">In house</p>
                      <p className="font-medium">{room.current.guestName}</p>
                      <p className="text-xs text-muted-foreground">Leaves {fmtDay(room.current.checkOut, 'weekday')} · #{room.current.code}</p>
                    </div>
                  )}
                  {room.arriving && (
                    <div className="rounded-xl border bg-surface-sunken p-3 text-sm">
                      <p className="text-xs text-muted-foreground">Arriving</p>
                      <p className="font-medium">{room.arriving.guestName}</p>
                      <p className="text-xs text-muted-foreground">#{room.arriving.code}</p>
                    </div>
                  )}
                </div>
              )}

              {!room.isOutOfOrder && can('room.status') && (
                <div>
                  <p id={statusLabelId} className="mb-2 text-sm font-medium">
                    Housekeeping status
                  </p>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby={statusLabelId}>
                    {(
                      [
                        ['DIRTY', 'Dirty', Brush],
                        ['CLEAN', 'Clean', CircleCheck],
                        ['INSPECTED', 'Inspected', BadgeCheck],
                      ] as const
                    ).map(([status, label, Icon]) => {
                      const current = room.status === status;
                      return (
                        <Button
                          key={status}
                          variant={current ? 'soft' : 'outline'}
                          aria-pressed={current}
                          loading={busy === status}
                          disabled={busy !== null && busy !== status}
                          className={cn('px-2', current && 'ring-1 ring-inset ring-primary/40')}
                          onClick={() => {
                            // The current status is shown as selected; choosing it again changes nothing.
                            if (current) return;
                            void act(status, () => patch({ status }), `Room ${room.number} marked ${label.toLowerCase()}`);
                          }}
                        >
                          <Icon aria-hidden /> {label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {can('housekeeping.assign') && !room.isOutOfOrder && (
                <Field label="Cleaning assigned to">
                  <Select
                    value={room.task?.assignee?.id ?? ''}
                    onValueChange={(v) =>
                      act('assign', () => api('/api/admin/housekeeping', { method: 'POST', json: { roomId: room.id, assignedTo: v } }), `Room ${room.number} assigned`)
                    }
                  >
                    <SelectTrigger disabled={busy === 'assign' || !team?.length}>
                      <SelectValue placeholder={teamPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {(team ?? []).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name} · {m.openTasks ?? 0} open
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {can('room.outOfOrder') && (
                <div className="rounded-xl border p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Wrench className="size-4 text-muted-foreground" aria-hidden /> {room.isOutOfOrder ? 'Out of order' : 'Maintenance'}
                  </p>
                  {room.isOutOfOrder ? (
                    <>
                      <p className="mt-1 text-sm text-muted-foreground">{room.outOfOrderReason ?? 'No reason given.'}</p>
                      <Button
                        className="mt-3"
                        variant="outline"
                        loading={busy === 'ooo'}
                        onClick={() => act('ooo', () => patch({ isOutOfOrder: false }), `Room ${room.number} is back in service`)}
                      >
                        Return to service
                      </Button>
                    </>
                  ) : (
                    <>
                      <Field
                        label="Reason"
                        optional
                        className="mt-3"
                        hint={room.occupancy === 'OCCUPIED' || room.occupancy === 'DEPARTING' ? 'Someone is staying here — move them to another room first.' : undefined}
                      >
                        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. AC not cooling — vendor booked" />
                      </Field>
                      <Button
                        className="mt-3"
                        variant="destructive"
                        disabled={room.occupancy === 'OCCUPIED' || room.occupancy === 'DEPARTING'}
                        loading={busy === 'ooo'}
                        onClick={() => act('ooo', () => patch({ isOutOfOrder: true, outOfOrderReason: reason || 'Maintenance' }), `Room ${room.number} taken out of order`)}
                      >
                        Take out of order
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
            {can('agent.use') && (
              <SheetFooter>
                <AskAgentButton size="default" className="w-full" command={room.floor ? `rooms on floor ${room.floor}` : 'show the room board'}>
                  {room.floor ? `Ask the agent about floor ${room.floor}` : 'Ask the agent about the rooms'}
                </AskAgentButton>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
