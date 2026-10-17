'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowDownToLine,
  BadgeCheck,
  BrushCleaning,
  CheckCircle2,
  DoorClosed,
  Hand,
  Play,
  RefreshCw,
  UserRound,
  Wand2,
} from 'lucide-react';
import type { HousekeepingTaskDTO, RoomSummary, TeamMember } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { fmtDay } from '@/lib/format';
import { formatNumber } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TaskStatusBadge } from '@/components/hotel/badges';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { AskAgentButton } from '@/components/console/AskAgentButton';
import { PageShell, SectionHeader } from '@/components/console/PageShell';

function useHousekeepingData() {
  const tasksUrl = usePropertyUrl('/api/admin/housekeeping', { includeDone: '1' });
  const tasks = useSWR<HousekeepingTaskDTO[]>(tasksUrl, fetcher, { refreshInterval: 30_000 });
  return tasks;
}

async function updateTask(id: string, body: object) {
  return api(`/api/admin/housekeeping/${id}`, { method: 'PATCH', json: body });
}

const rooms = (n: number) => `${formatNumber(n)} room${n === 1 ? '' : 's'}`;

/** Board actions: 44px tall on phones, compact on desktop. */
const TASK_BUTTON = 'h-11 flex-1 text-sm md:h-9 md:text-[13px]';

/* ------------------------------------------------------------------ */
/* Housekeeper: my rooms (phone-first)                                 */
/* ------------------------------------------------------------------ */

function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total ? done / total : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={`${done} of ${total} rooms done`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} className="fill-none stroke-muted" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          className="fill-none stroke-success motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular" aria-hidden>
        {done}/{total}
      </span>
    </div>
  );
}

function MyRooms() {
  const { ctx, refresh } = useConsole();
  const { data, isLoading, mutate, isValidating } = useHousekeepingData();
  const [busy, setBusy] = React.useState<string | null>(null);
  const reduce = useReducedMotion();
  const me = ctx?.user.id;
  const mine = (data ?? []).filter((t) => t.assignee?.id === me);
  const open = mine.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  const done = mine.filter((t) => t.status === 'COMPLETED' || t.status === 'INSPECTED');
  const available = (data ?? []).filter((t) => !t.assignee && (t.status === 'PENDING' || t.status === 'IN_PROGRESS'));

  async function act(t: HousekeepingTaskDTO, status: HousekeepingTaskDTO['status'], msg: string) {
    setBusy(t.id);
    try {
      await updateTask(t.id, { status });
      toast.success(msg);
      await mutate();
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell size="narrow" className="max-w-xl">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{ctx ? fmtDay(ctx.today, 'long') : ' '}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">My rooms</h1>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {isLoading ? ' ' : open.length ? `${rooms(open.length)} to go — rooms for arriving guests first.` : 'All caught up. Nice work!'}
          </p>
        </div>
        <ProgressRing done={done.length} total={mine.length} />
      </div>

      {isLoading ? (
        <div className="space-y-3" role="status">
          <span className="sr-only">Loading your rooms…</span>
          <Skeleton className="h-[188px] rounded-2xl" />
          <Skeleton className="h-[188px] rounded-2xl" />
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <ul className="space-y-3" aria-label="Rooms to clean">
              <AnimatePresence initial={false}>
                {open.map((t) => (
                  <motion.li
                    key={t.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: 40 }}
                  >
                    <Card className={cn('p-4', t.status === 'IN_PROGRESS' && 'border-info/50 ring-2 ring-info/20')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-3xl font-semibold leading-none tabular">
                            <span className="sr-only">Room </span>
                            {t.room.number}
                          </h2>
                          <p className="mt-1.5 text-sm text-muted-foreground">
                            {t.room.roomTypeName}
                            {t.room.floor ? ` · Floor ${t.room.floor}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <TaskStatusBadge status={t.status} />
                          {t.priority >= 3 && (
                            <Badge variant="warning" icon={ArrowDownToLine}>
                              Guest arriving
                            </Badge>
                          )}
                          {t.room.occupancy === 'OCCUPIED' && (
                            <Badge variant="neutral" icon={DoorClosed}>
                              Guest staying — knock first
                            </Badge>
                          )}
                        </div>
                      </div>
                      {t.notes && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">{t.notes}</p>}
                      <div className="mt-4">
                        {t.status === 'PENDING' ? (
                          <Button
                            size="lg"
                            className="w-full"
                            variant="outline"
                            loading={busy === t.id}
                            loadingText="Starting…"
                            onClick={() => act(t, 'IN_PROGRESS', `Started room ${t.room.number}`)}
                          >
                            <Play aria-hidden /> Start cleaning
                          </Button>
                        ) : (
                          <Button
                            size="lg"
                            className="w-full"
                            loading={busy === t.id}
                            loadingText="Saving…"
                            onClick={() => act(t, 'COMPLETED', `Room ${t.room.number} is clean`)}
                          >
                            <CheckCircle2 aria-hidden /> Mark clean
                          </Button>
                        )}
                      </div>
                    </Card>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}

          {available.length > 0 && (
            <section aria-labelledby="hk-available">
              <SectionHeader id="hk-available" title="Available to pick up" description="Nobody has these yet — take one when you’re free." />
              <ul className="mt-3 space-y-2">
                {available.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
                    <div className="min-w-0">
                      <span className="text-lg font-semibold tabular">
                        <span className="sr-only">Room </span>
                        {t.room.number}
                      </span>
                      <span className="ml-2 text-sm text-muted-foreground">{t.room.roomTypeName}</span>
                    </div>
                    <Button
                      variant="soft"
                      className="h-11 shrink-0"
                      loading={busy === t.id}
                      aria-label={`Take room ${t.room.number}`}
                      onClick={() => act(t, 'IN_PROGRESS', `Room ${t.room.number} is yours`)}
                    >
                      <Hand aria-hidden /> Take it
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {done.length > 0 && (
            <section aria-labelledby="hk-done">
              <h2 id="hk-done" className="text-sm font-medium text-muted-foreground">
                Done today · {formatNumber(done.length)}
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {done.map((t) => (
                  <li key={t.id}>
                    <Badge variant="success" icon={CheckCircle2}>
                      <span className="sr-only">Room </span>
                      {t.room.number}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {mine.length === 0 && available.length === 0 && (
            <Card>
              <EmptyState
                icon={BrushCleaning}
                title="Nothing assigned yet"
                description="Your supervisor will assign rooms here. This list updates by itself every half minute."
                action={
                  <Button variant="outline" onClick={() => mutate()} loading={isValidating}>
                    <RefreshCw aria-hidden /> Check now
                  </Button>
                }
              />
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Supervisor board                                                    */
/* ------------------------------------------------------------------ */

function AssignSelect({
  value,
  team,
  onChange,
  label,
  placeholder = 'Unassigned',
  className,
}: {
  value?: string;
  team: TeamMember[];
  onChange: (id: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      {/* 44px on phones (thumb use), compact on desktop boards. */}
      <SelectTrigger aria-label={label} className={cn('h-11 md:h-9 md:text-xs', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {team.length === 0 && (
          <div className="px-2.5 py-2 text-sm text-muted-foreground">No housekeepers on this property yet</div>
        )}
        {team.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TaskCard({ task, team, onChange }: { task: HousekeepingTaskDTO; team: TeamMember[]; onChange: () => void }) {
  const { can } = useConsole();
  const reduce = useReducedMotion();
  const [busy, setBusy] = React.useState(false);
  async function run(body: object, msg: string) {
    setBusy(true);
    try {
      await updateTask(task.id, body);
      toast.success(msg);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const done = task.status === 'COMPLETED' || task.status === 'INSPECTED';
  const urgent = task.priority >= 3 && !done;
  return (
    <motion.li layout={!reduce} className={cn('rounded-xl border bg-card p-3 shadow-xs', urgent && 'border-warning/60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-none tabular">
            <span className="sr-only">Room </span>
            {task.room.number}
          </h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {task.room.roomTypeName}
            {task.room.floor ? ` · Floor ${task.room.floor}` : ''}
          </p>
        </div>
        {urgent && (
          <Badge variant="warning" size="sm" icon={ArrowDownToLine}>
            Arrival
          </Badge>
        )}
        {task.status === 'INSPECTED' && (
          <Badge variant="success" size="sm" icon={BadgeCheck}>
            Ready to sell
          </Badge>
        )}
      </div>
      {!done && can('housekeeping.assign') ? (
        <AssignSelect
          className="mt-3"
          value={task.assignee?.id ?? ''}
          team={team}
          label={`Assign a housekeeper to room ${task.room.number}`}
          onChange={(v) => run({ assignedTo: v }, `Room ${task.room.number} assigned`)}
        />
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <UserRound className="size-3.5" aria-hidden /> {task.assignee?.name ?? 'Unassigned'}
        </p>
      )}
      {task.status !== 'INSPECTED' && (
        <div className="mt-2 flex gap-2">
          {task.status === 'PENDING' && (
            <Button size="sm" variant="outline" className={TASK_BUTTON} loading={busy} onClick={() => run({ status: 'IN_PROGRESS' }, `Room ${task.room.number} started`)}>
              <Play aria-hidden /> Start
            </Button>
          )}
          {task.status === 'IN_PROGRESS' && (
            <Button size="sm" className={TASK_BUTTON} loading={busy} onClick={() => run({ status: 'COMPLETED' }, `Room ${task.room.number} is clean`)}>
              <CheckCircle2 aria-hidden /> Mark clean
            </Button>
          )}
          {task.status === 'COMPLETED' && (
            <Button size="sm" variant="soft" className={TASK_BUTTON} loading={busy} onClick={() => run({ status: 'INSPECTED' }, `Room ${task.room.number} inspected`)}>
              <BadgeCheck aria-hidden /> Inspect
            </Button>
          )}
        </div>
      )}
    </motion.li>
  );
}

function SupervisorBoard() {
  const { ctx, refresh, can, propertyId } = useConsole();
  const { data: tasks, isLoading, mutate, isValidating } = useHousekeepingData();
  const teamUrl = usePropertyUrl('/api/admin/team', { role: 'HOUSEKEEPER' });
  const boardUrl = usePropertyUrl('/api/admin/room-board');
  const { data: team } = useSWR<TeamMember[]>(teamUrl, fetcher);
  const { data: roomBoard, mutate: mutateRooms } = useSWR<RoomSummary[]>(boardUrl, fetcher, { refreshInterval: 30_000 });
  const [autoBusy, setAutoBusy] = React.useState(false);

  const onChange = () => {
    void mutate();
    void mutateRooms();
    refresh();
  };

  const unqueued = (roomBoard ?? []).filter((r) => r.status === 'DIRTY' && !r.task && !r.isOutOfOrder);
  const todo = (tasks ?? []).filter((t) => t.status === 'PENDING');
  const doing = (tasks ?? []).filter((t) => t.status === 'IN_PROGRESS');
  const done = (tasks ?? []).filter((t) => t.status === 'COMPLETED' || t.status === 'INSPECTED');
  const unassigned = todo.filter((t) => !t.assignee).length + unqueued.length;

  async function queueRoom(roomId: string, assignedTo: string) {
    try {
      await api('/api/admin/housekeeping', { method: 'POST', json: { roomId, assignedTo } });
      toast.success('Room added to the cleaning list');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function autoAssign() {
    setAutoBusy(true);
    try {
      const r = await api<{ assigned: number }>('/api/admin/housekeeping/auto-assign', { method: 'POST', json: { propertyId } });
      toast.success(r.assigned ? `Assigned ${rooms(r.assigned)}` : 'Everything already has someone on it');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAutoBusy(false);
    }
  }

  const columns = [
    { key: 'todo', title: 'To clean', items: todo, dot: 'bg-warning', empty: 'No rooms waiting to be cleaned.' },
    { key: 'doing', title: 'Cleaning now', items: doing, dot: 'bg-info', empty: 'Nobody is cleaning a room right now.' },
    { key: 'done', title: 'Done today', items: done, dot: 'bg-success', empty: 'Finished rooms collect here.' },
  ];
  const toTurn = todo.length + doing.length + unqueued.length;

  return (
    <PageShell
      eyebrow={ctx ? fmtDay(ctx.today, 'long') : ' '}
      title="Housekeeping"
      description={tasks ? `${rooms(toTurn)} to turn · ${formatNumber(done.length)} done today` : ' '}
      actions={
        <>
          <AskAgentButton command="show the housekeeping board">Ask the agent</AskAgentButton>
          <IconButton label="Refresh" variant="outline" size="icon-sm" onClick={onChange} aria-busy={isValidating || undefined}>
            <RefreshCw className={cn(isValidating && 'motion-safe:animate-spin')} />
          </IconButton>
          {can('housekeeping.assign') && (
            <Button size="sm" onClick={autoAssign} loading={autoBusy} loadingText="Assigning…" disabled={!unassigned}>
              <Wand2 aria-hidden /> Auto-assign{unassigned ? ` ${formatNumber(unassigned)}` : ''}
            </Button>
          )}
        </>
      }
    >
      {team && team.length > 0 && (
        <section aria-labelledby="hk-team">
          <h2 id="hk-team" className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Housekeepers on this property
          </h2>
          <ul className="flex flex-wrap gap-2">
            {team.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 rounded-xl border bg-card py-2 pl-2.5 pr-3.5 shadow-xs">
                <Avatar name={m.name} size="sm" />
                <div>
                  <p className="text-sm font-medium leading-tight">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{rooms(m.openTasks ?? 0)} open</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unqueued.length > 0 && (
        <Card className="p-4 sm:p-5">
          <SectionHeader
            title={`Dirty, not on the cleaning list · ${formatNumber(unqueued.length)}`}
            description={can('housekeeping.assign') ? 'Pick a housekeeper to add a room to their list, or use Auto-assign.' : 'A supervisor will add these to someone’s list.'}
          />
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {unqueued.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-xl border bg-surface-sunken p-2.5">
                <span className="w-12 shrink-0 text-lg font-semibold tabular">
                  <span className="sr-only">Room </span>
                  {r.number}
                </span>
                {can('housekeeping.assign') ? (
                  <AssignSelect
                    team={team ?? []}
                    placeholder="Assign…"
                    label={`Assign a housekeeper to room ${r.number}`}
                    onChange={(v) => queueRoom(r.id, v)}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{r.roomType.name}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3" role="status">
          <span className="sr-only">Loading the housekeeping board…</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-3">
          {columns.map((col) => (
            <section key={col.key} aria-labelledby={`hk-col-${col.key}`} className="rounded-2xl border bg-surface-sunken p-3">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className={cn('size-2 rounded-full', col.dot)} aria-hidden />
                <h2 id={`hk-col-${col.key}`} className="text-sm font-semibold">
                  {col.title}
                </h2>
                <span className="ml-auto text-xs font-medium text-muted-foreground tabular">
                  <span aria-hidden>{formatNumber(col.items.length)}</span>
                  <span className="sr-only">{rooms(col.items.length)}</span>
                </span>
              </div>
              {col.items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border-strong/40 px-3 py-8 text-center text-sm text-muted-foreground">{col.empty}</p>
              ) : (
                <ul className="space-y-2">
                  {col.items.map((t) => (
                    <TaskCard key={t.id} task={t} team={team ?? []} onChange={onChange} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}

export default function HousekeepingPage() {
  const { role } = useConsole();
  return role === 'HOUSEKEEPER' ? <MyRooms /> : <SupervisorBoard />;
}
