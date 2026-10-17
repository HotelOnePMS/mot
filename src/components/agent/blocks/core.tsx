'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, CircleCheck, CircleHelp, CircleX, Minus, X, CornerDownRight } from 'lucide-react';
import type { AgentBlock, QuickAction } from '@/lib/agent/blocks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/primitives';
import { useAgentUI } from '../AgentUI';

/* ------------------------------------------------------------------ */
/* Shared shells so every answer block reads as one family.            */
/* ------------------------------------------------------------------ */

/** The card every data block sits in: hairline border, card surface, light shadow. */
export function BlockCard({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs', className)} {...props}>
      {children}
    </section>
  );
}

/** A block's title row: the title (an h2 for screen-reader navigation) and optional meta on the right. */
export function BlockHeader({
  title,
  meta,
  description,
  className,
  id,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold leading-snug">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {meta}
    </div>
  );
}

/** A small count pill for block headers. */
export function CountPill({ n, label }: { n: number; label?: string }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular text-muted-foreground">
      {n}
      {label && <span className="sr-only"> {label}</span>}
    </span>
  );
}

/** Minimal, safe rich text: **bold**, line breaks and "•" bullets. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n');
  const inline = (s: string, key: number) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={`${key}-${i}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <React.Fragment key={`${key}-${i}`}>{part}</React.Fragment>
      )
    );
  return (
    <div className={cn('space-y-1.5 text-[15px] leading-relaxed text-foreground', className)}>
      {lines.map((line, i) =>
        line.trim().startsWith('•') ? (
          <div key={i} className="flex gap-2.5 pl-0.5">
            <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
            <span>{inline(line.trim().slice(1).trim(), i)}</span>
          </div>
        ) : line.trim() ? (
          <p key={i}>{inline(line, i)}</p>
        ) : null
      )}
    </div>
  );
}

export function ActionButtons({ actions, size = 'sm' }: { actions: QuickAction[]; size?: 'sm' | 'default' }) {
  const { send, prefill, busy } = useAgentUI();
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <Button
          key={a.label + a.command}
          type="button"
          size={size}
          variant={a.tone === 'primary' ? 'default' : a.tone === 'danger' ? 'ghost' : 'outline'}
          className={cn(a.tone === 'danger' && 'text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground')}
          disabled={busy && a.mode !== 'prefill'}
          onClick={() => (a.mode === 'prefill' ? prefill(a.command) : send(a.command))}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}

/** Follow-up questions the agent suggests; tapping one asks it. */
export function SuggestionsBlock({ block }: { block: Extract<AgentBlock, { type: 'suggestions' }> }) {
  const { send, busy } = useAgentUI();
  if (block.items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 pt-0.5" aria-label="Suggested follow-ups">
      {block.items.map((s) => (
        <li key={s} className="min-w-0 max-w-full">
          <button
            type="button"
            disabled={busy}
            onClick={() => send(s)}
            className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border bg-surface px-3.5 text-sm text-foreground shadow-xs transition-[border-color,background-color,color] hover:border-agent/40 hover:bg-agent-soft hover:text-agent-soft-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 sm:min-h-9"
          >
            <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{s}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function NavigateBlock({ block }: { block: Extract<AgentBlock, { type: 'navigate' }> }) {
  return (
    <div>
      <Link
        href={block.href}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {block.label}
        <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
      {block.description && <p className="text-xs text-muted-foreground">{block.description}</p>}
    </div>
  );
}

export function ErrorBlock({ block }: { block: Extract<AgentBlock, { type: 'error' }> }) {
  return <Callout tone="warning">{block.text}</Callout>;
}

/** The agent needs one more detail; each option answers for you. */
export function ClarifyBlock({ block }: { block: Extract<AgentBlock, { type: 'clarify' }> }) {
  const { send, busy } = useAgentUI();
  const id = React.useId();
  return (
    <BlockCard className="p-4" aria-labelledby={id}>
      <div className="flex items-start gap-2.5">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-agent-soft-foreground" aria-hidden />
        <h2 id={id} className="text-sm font-semibold leading-snug">
          {block.question}
        </h2>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {block.options.map((o) => (
          <li key={o.command}>
            <button
              type="button"
              disabled={busy}
              onClick={() => send(o.command)}
              className="flex h-full min-h-11 w-full flex-col justify-center rounded-xl border bg-surface px-3.5 py-2.5 text-left transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            >
              <span className="block text-sm font-medium">{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </BlockCard>
  );
}

/** What happened after a confirmed plan: each line marked done, failed or skipped. */
export function ResultBlock({ block }: { block: Extract<AgentBlock, { type: 'result' }> }) {
  return (
    <section
      role="status"
      className={cn(
        'rounded-2xl border p-4',
        block.ok ? 'border-success/25 bg-success-soft text-success-soft-foreground' : 'border-destructive/25 bg-destructive-soft text-destructive-soft-foreground'
      )}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {block.ok ? <CircleCheck className="size-5 shrink-0" aria-hidden /> : <CircleX className="size-5 shrink-0" aria-hidden />}
        {block.title}
      </h2>
      {block.lines.length > 0 && (
        <ul className="mt-2 space-y-1 pl-7 text-sm">
          {block.lines.map((l, i) => {
            const failed = l.startsWith('✗');
            const skipped = l.startsWith('○');
            const Icon = failed ? X : skipped ? Minus : Check;
            return (
              <li key={i} className={cn('flex gap-2', skipped && 'opacity-80')}>
                <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="sr-only">{failed ? 'Failed: ' : skipped ? 'Skipped: ' : 'Done: '}</span>
                  {l.replace(/^[✓✗○]\s*/, '')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Headline numbers. Values stay neutral (the engine's per-figure tones are
 * decorative, and colour on a number reads as a status it doesn't have).
 */
export function StatsBlock({ block }: { block: Extract<AgentBlock, { type: 'stats' }> }) {
  const { compact } = useAgentUI();
  return (
    <ul className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5')}>
      {block.items.map((s) => (
        <li key={s.label} className="min-w-0 rounded-xl border bg-card px-3.5 py-3 shadow-xs">
          <p className="truncate text-xs font-medium text-muted-foreground">{s.label}</p>
          <p className="mt-1 text-xl font-semibold leading-7 tracking-tight tabular">{s.value}</p>
          {s.hint && (
            <p className="truncate text-xs text-muted-foreground" title={s.hint}>
              {s.hint}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
