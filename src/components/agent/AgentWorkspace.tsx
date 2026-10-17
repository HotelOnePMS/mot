'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BedDouble,
  Cable,
  CalendarRange,
  ChartLine,
  ConciergeBell,
  CornerDownRight,
  History,
  Info,
  Search,
  ShieldCheck,
  Siren,
  Sparkles,
  SprayCan,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import type { FrontDeskSummary } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { fmtDay, greeting, timeAgo } from '@/lib/format';
import { formatNumber, formatPercent } from '@/lib/status';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { Badge } from '@/components/ui/badge';
import { IconTile, Skeleton } from '@/components/ui/primitives';
import { AgentPanel } from './AgentPanel';
import { ShortcutStarters } from './ShortcutStarters';
import { AgentOrb } from './Timeline';
import type { AgentController } from './useAgent';

const STARTERS = [
  { icon: Sun, title: 'Brief me', hint: 'Today at a glance, with alerts', command: 'brief me' },
  { icon: ArrowDownToLine, title: 'Who’s arriving?', hint: 'Today’s arrivals and rooms', command: 'who’s arriving today?' },
  { icon: ConciergeBell, title: 'Check in a guest', hint: '“…the Smiths, quiet room, high floor”', command: 'check in the Smiths, quiet room on a high floor' },
  { icon: SprayCan, title: 'Rooms to clean', hint: 'Dirty rooms and who’s on them', command: 'which rooms need cleaning?' },
  { icon: CalendarRange, title: 'Availability', hint: 'Next weekend, 2 guests', command: 'availability next weekend for 2 guests' },
  { icon: ChartLine, title: 'Weekend outlook', hint: 'Occupancy and rate strategy', command: 'forecast the next 3 weekends' },
];

const BRIDGE_STARTERS = [
  { icon: ArrowDownToLine, title: 'Who’s arriving?', hint: 'Looked up in your PMS', command: 'who’s arriving today?' },
  { icon: ConciergeBell, title: 'Check in a guest', hint: '“…Jordan Smith into room 204”', command: 'check in Jordan Smith into room 204' },
  { icon: Search, title: 'Find a reservation', hint: 'By name or confirmation code', command: 'find the reservation for Grace Okafor' },
  { icon: SprayCan, title: 'Rooms to clean', hint: 'Housekeeping status from your PMS', command: 'which rooms are dirty?' },
];

function Hero({ send }: { send: (cmd: string) => void }) {
  const { ctx, property, can } = useConsole();
  const first = ctx?.user.name.split(' ')[0] ?? '';
  const bridged = property?.setupPath === 'BRIDGE';
  const starters = bridged ? BRIDGE_STARTERS : STARTERS;
  const voiceReady = !!ctx?.agent.voiceEnabled && can('voice.use');
  return (
    <div className="flex flex-col py-2 sm:min-h-[min(62vh,600px)] sm:justify-center sm:py-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
        <div className="flex items-center gap-3">
          <AgentOrb className="h-11 w-11 sm:h-12 sm:w-12" />
          <Badge variant="agent" size="sm" icon={Sparkles}>
            AI front desk
          </Badge>
        </div>
        <h1 className="mt-5 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
          {greeting()}
          {first ? `, ${first}` : ''}.
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
          {bridged ? (
            <>
              I’m the front-desk agent for <span className="font-medium text-foreground">{property?.name}</span>. I work in your own PMS for you — look-ups go
              straight through, and I <span className="font-medium text-foreground">ask before changing anything</span>.
            </>
          ) : (
            <>
              I’m the front-desk agent for <span className="font-medium text-foreground">{property?.name}</span>. Ask in plain words — I answer from live data, show
              you the right screen for it, and <span className="font-medium text-foreground">ask before changing anything</span>.
            </>
          )}
        </p>
      </motion.div>
      <h2 className="mt-7 text-2xs font-semibold uppercase tracking-wider text-muted-foreground sm:mt-9">Try asking</h2>
      <ul className="mt-2.5 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
        {starters.map((s, i) => (
          <motion.li
            key={s.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="min-w-0"
          >
            <button
              type="button"
              onClick={() => send(s.command)}
              className="group flex h-full min-h-14 w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-xs transition-[border-color,box-shadow,transform] duration-150 hover:border-agent/35 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:hover:-translate-y-0.5 sm:items-start sm:p-4"
            >
              <IconTile icon={s.icon} tone="agent" size="sm" className="sm:size-9 sm:rounded-xl sm:[&_svg]:size-[18px]" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-snug">{s.title}</span>
                <span className="mt-0.5 hidden text-xs leading-snug text-muted-foreground sm:block">{s.hint}</span>
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
      <ShortcutStarters send={send} />
      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-px size-4 shrink-0 text-success" aria-hidden />
        <span>
          Nothing changes until you confirm. Every action is permission-checked and written to the activity log.
          {voiceReady && ' Prefer to talk? Use Talk below.'}
        </span>
      </p>
    </div>
  );
}

/** A small uppercase heading for the side rail's sections. */
function RailHeading({ children, icon: Icon }: { children: React.ReactNode; icon?: LucideIcon }) {
  return (
    <h2 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </h2>
  );
}

const ALERT_TONE = {
  danger: { icon: Siren, tone: 'danger', sr: 'Urgent' },
  warning: { icon: AlertTriangle, tone: 'warning', sr: 'Needs a look' },
  info: { icon: Info, tone: 'info', sr: 'Heads-up' },
} as const;

function RecentCommands({ agent, limit }: { agent: AgentController; limit: number }) {
  if (agent.history.length === 0) return null;
  return (
    <section className="mt-6" aria-labelledby="agent-rail-recent">
      <RailHeading icon={History}>
        <span id="agent-rail-recent">Recent</span>
      </RailHeading>
      <ul className="mt-2 space-y-0.5">
        {agent.history
          .slice(-limit)
          .reverse()
          .map((h) => (
            <li key={h}>
              <button
                type="button"
                onClick={() => agent.send(h)}
                disabled={agent.busy}
                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{h}</span>
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}

function LiveRail({ agent }: { agent: AgentController }) {
  const url = usePropertyUrl('/api/admin/front-desk');
  const { data } = useSWR<FrontDeskSummary>(url, fetcher, { refreshInterval: 60_000 });
  const stats = data?.stats;
  return (
    <aside aria-label="Today at a glance" className="hidden w-[300px] shrink-0 overflow-y-auto border-l bg-surface/60 p-4 scrollbar-thin xl:block">
      <RailHeading>
        <span className="relative mr-0.5 flex size-2" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-success/50 motion-safe:animate-ping" />
          <span className="relative size-2 rounded-full bg-success" />
        </span>
        Live · {data ? fmtDay(data.date, 'weekday') : 'today'}
      </RailHeading>
      {!stats ? (
        <div className="mt-3 grid grid-cols-2 gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[66px] rounded-xl" />
          ))}
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {[
            { icon: ArrowDownToLine, label: 'To arrive', value: formatNumber(stats.arrivalsDue), cmd: 'who’s arriving today?' },
            { icon: ArrowUpFromLine, label: 'To depart', value: formatNumber(stats.departuresDue), cmd: 'who’s leaving today?' },
            { icon: BedDouble, label: 'Occupied tonight', value: formatPercent(stats.occupancyPct), cmd: 'occupancy this week' },
            { icon: SprayCan, label: 'To clean', value: formatNumber(stats.dirty), cmd: 'which rooms need cleaning?' },
          ].map((s) => (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => agent.send(s.cmd)}
                disabled={agent.busy}
                title={`Ask: “${s.cmd}”`}
                className="group flex w-full flex-col rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs transition-[border-color,box-shadow] hover:border-border-strong/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-lg font-semibold leading-6 tabular">{s.value}</span>
                  <s.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </span>
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.alerts.length > 0 && (
        <section className="mt-6" aria-labelledby="agent-rail-attention">
          <RailHeading>
            <span id="agent-rail-attention">Needs attention</span>
          </RailHeading>
          <ul className="mt-2 space-y-2">
            {data.alerts.map((a) => {
              const t = ALERT_TONE[a.tone];
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => a.command && agent.send(a.command)}
                    disabled={!a.command || agent.busy}
                    className="flex w-full items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs transition-[border-color,box-shadow,background-color] hover:border-border-strong/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default disabled:hover:shadow-xs"
                  >
                    <IconTile icon={t.icon} tone={t.tone} size="sm" className="size-7 rounded-md [&_svg]:size-3.5" />
                    <span className="min-w-0">
                      <span className="sr-only">{t.sr}: </span>
                      <span className="block text-sm font-medium leading-snug text-foreground">{a.title}</span>
                      {a.command && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <CornerDownRight className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">Ask: {a.command}</span>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <RecentCommands agent={agent} limit={6} />
    </aside>
  );
}

interface BridgeSnapshot {
  connection: { system: string; mode: 'DESKTOP' | 'CLOUD' | 'MCP'; status: string; online: boolean; hasCredentials: boolean; devicePaired: boolean } | null;
  tasks: { id: string; instruction: string; status: string; summary: string | null; createdAt: string }[];
}

const BRIDGE_TASK: Record<string, { label: string; variant: 'success' | 'warning' | 'info' | 'neutral' }> = {
  QUEUED: { label: 'Waiting', variant: 'neutral' },
  RUNNING: { label: 'Working', variant: 'info' },
  DONE: { label: 'Done', variant: 'success' },
  FAILED: { label: 'Couldn’t finish', variant: 'warning' },
  NEEDS_HELP: { label: 'Needs you', variant: 'warning' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral' },
};

/** For hotels on their own PMS: connection health and the operator's recent work. */
function BridgeRail({ agent }: { agent: AgentController }) {
  const url = usePropertyUrl('/api/admin/bridge');
  const { data } = useSWR<BridgeSnapshot>(url, fetcher, { refreshInterval: 8000 });
  const c = data?.connection;
  // MCP: ready once the PMS's server answered (status CONNECTED); ERROR means the last call to it failed.
  const ready = c && c.status !== 'PAUSED' && (c.mode === 'MCP' ? c.status === 'CONNECTED' || c.status === 'ERROR' : c.mode === 'CLOUD' ? c.hasCredentials : c.devicePaired);
  const health = !c || !ready ? 'setup' : (c.mode === 'DESKTOP' && !c.online) || (c.mode === 'MCP' && c.status === 'ERROR') ? 'offline' : 'online';
  return (
    <aside aria-label="Your PMS" className="hidden w-[300px] shrink-0 overflow-y-auto border-l bg-surface/60 p-4 scrollbar-thin xl:block">
      <RailHeading icon={Cable}>Your PMS</RailHeading>
      {!data ? (
        <Skeleton className="mt-3 h-[62px] rounded-xl" />
      ) : !c ? (
        <Link
          href="/admin/connect"
          className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-dashed border-border-strong/50 p-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Connect your PMS so I can work in it
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ) : (
        <Link
          href="/admin/connect"
          className="mt-3 flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{c.system}</span>
            <span className="block text-xs text-muted-foreground">{c.mode === 'MCP' ? 'MCP server' : c.mode === 'CLOUD' ? 'Cloud browser' : 'Desktop connector'}</span>
          </span>
          <Badge variant={health === 'online' ? 'success' : health === 'offline' ? 'warning' : 'neutral'} size="sm" dot>
            {health === 'online' ? 'Online' : health === 'offline' ? (c.mode === 'MCP' ? 'Not answering' : 'Offline') : 'Finish setup'}
          </Badge>
        </Link>
      )}
      {data && data.tasks.length > 0 && (
        <section className="mt-6" aria-labelledby="agent-rail-work">
          <RailHeading>
            <span id="agent-rail-work">Recent work</span>
          </RailHeading>
          <ul className="mt-2 space-y-2">
            {data.tasks.slice(0, 6).map((t) => {
              const st = BRIDGE_TASK[t.status] ?? { label: t.status.replace('_', ' ').toLowerCase(), variant: 'neutral' as const };
              return (
                <li key={t.id} className="rounded-xl border bg-card px-3 py-2.5 shadow-xs">
                  <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{t.instruction}</span>
                  <span className="mt-1.5 flex items-center justify-between gap-2">
                    <Badge variant={st.variant} size="sm">
                      {st.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{timeAgo(t.createdAt)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <RecentCommands agent={agent} limit={5} />
    </aside>
  );
}

/** The full Agentic workspace: conversation in the middle, live context on the right. */
export function AgentWorkspace() {
  const { property } = useConsole();
  const bridged = property?.setupPath === 'BRIDGE';
  return (
    <div className="h-[calc(100dvh-3.5rem)]">
      <AgentPanel
        title="Agent"
        empty={(send) => <Hero send={send} />}
        rail={(agent) => (bridged ? <BridgeRail agent={agent} /> : <LiveRail agent={agent} />)}
      />
    </div>
  );
}
