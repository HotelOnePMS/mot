'use client';

import * as React from 'react';
import useSWR from 'swr';
import { CheckCircle2, CircleAlert, Cable, Loader2, RotateCcw, XCircle, type LucideIcon } from 'lucide-react';
import type { AgentBlock } from '@/lib/agent/blocks';
import { api, fetcher } from '@/lib/fetcher';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BlockCard } from './core';

interface TaskView {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'NEEDS_HELP' | 'CANCELLED';
  summary: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** 'mcp' when it ran through the PMS's MCP server. */
  via?: string | null;
  pmsCalls?: number | null;
}

const STATUS: Record<TaskView['status'], { label: string; variant: 'info' | 'success' | 'warning' | 'neutral'; icon: LucideIcon }> = {
  QUEUED: { label: 'Waiting for the operator', variant: 'neutral', icon: Loader2 },
  RUNNING: { label: 'Working in your PMS', variant: 'info', icon: Loader2 },
  DONE: { label: 'Done', variant: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Couldn’t finish', variant: 'warning', icon: CircleAlert },
  NEEDS_HELP: { label: 'Needs you', variant: 'warning', icon: CircleAlert },
  CANCELLED: { label: 'Cancelled', variant: 'neutral', icon: XCircle },
};

/** Follows one bridge task live until the operator (or the PMS's MCP server) reports back. */
export function BridgeTaskBlock({ block }: { block: Extract<AgentBlock, { type: 'bridgeTask' }> }) {
  const { data, mutate } = useSWR<TaskView>(`/api/admin/bridge/tasks/${block.taskId}`, fetcher, {
    refreshInterval: (d) => (!d || d.status === 'QUEUED' || d.status === 'RUNNING' ? 2500 : 0),
  });
  const status = data?.status ?? 'QUEUED';
  const active = status === 'QUEUED' || status === 'RUNNING';
  const mcp = block.mode === 'MCP' || data?.via === 'mcp';
  const st = mcp && status === 'QUEUED' ? { ...STATUS.QUEUED, label: 'Sending to your PMS' } : STATUS[status];
  const [busy, setBusy] = React.useState<'cancel' | 'retry' | null>(null);
  const id = React.useId();
  const act = async (action: 'cancel' | 'retry') => {
    setBusy(action);
    try {
      await mutate(await api<TaskView>(`/api/admin/bridge/tasks/${block.taskId}`, { method: 'PATCH', json: { action } }), { revalidate: false });
    } finally {
      setBusy(null);
    }
  };
  return (
    <BlockCard aria-labelledby={id} className={cn(status === 'DONE' && 'border-success/30', (status === 'FAILED' || status === 'NEEDS_HELP') && 'border-warning/40')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface-sunken/50 px-4 py-2.5">
        <Cable className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 id={id} className="min-w-0 flex-1 text-sm font-semibold">
          {block.system} · {block.kind === 'LOOKUP' ? 'look-up' : 'change'}
        </h2>
        <span role="status">
          <Badge variant={st.variant} size="sm" icon={st.icon} className={cn(active && '[&_svg]:motion-safe:animate-spin')}>
            {st.label}
          </Badge>
        </span>
      </div>
      <div className="space-y-2 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          <span className="sr-only">Instruction: </span>“{block.instruction}”
        </p>
        {data?.summary && <p className="whitespace-pre-line text-sm">{data.summary}</p>}
        {data?.error && <p className="text-sm text-destructive">{data.error}</p>}
        {active && (
          <p className="text-xs text-muted-foreground">
            {mcp
              ? `Talking to ${block.system} through its MCP server — usually a few seconds.`
              : status === 'QUEUED'
                ? 'Your connector picks this up within a few seconds when it’s online.'
                : 'Reading the screen and working step by step — usually under a minute.'}
          </p>
        )}
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground">
            {data ? `Sent ${timeAgo(data.createdAt)}` : ''}
            {data && mcp ? ` · via MCP${data.pmsCalls ? ` · ${data.pmsCalls} PMS call${data.pmsCalls === 1 ? '' : 's'}` : ''}` : ''}
          </span>
          <div className="flex gap-2">
            {status === 'QUEUED' && (
              <Button type="button" size="sm" variant="ghost" loading={busy === 'cancel'} disabled={!!busy} onClick={() => act('cancel')}>
                Cancel
              </Button>
            )}
            {(status === 'FAILED' || status === 'NEEDS_HELP') && (
              <Button type="button" size="sm" variant="outline" loading={busy === 'retry'} disabled={!!busy} onClick={() => act('retry')}>
                <RotateCcw aria-hidden /> Try again
              </Button>
            )}
          </div>
        </div>
      </div>
    </BlockCard>
  );
}
