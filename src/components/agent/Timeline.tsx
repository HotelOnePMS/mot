'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AudioLines, RotateCcw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/status';
import { Callout } from '@/components/ui/primitives';
import type { AgentTurn } from './useAgent';
import { BlockRenderer } from './BlockRenderer';

/**
 * The agent's avatar: the AI gradient with a soft sheen and a spark. It only
 * moves while the agent is working (and never for reduced-motion users).
 */
export function AgentOrb({ busy, className }: { busy?: boolean; className?: string }) {
  return (
    <span className={cn('relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full', className)} aria-hidden>
      <span
        className={cn(
          'bg-aurora absolute inset-0 rounded-full shadow-glow',
          busy && 'motion-safe:animate-aurora motion-safe:animate-pulse-ring'
        )}
      />
      <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,hsl(var(--agent-gradient-foreground)/0.38),transparent_60%)]" />
      <Sparkles className="relative size-[46%] text-agent-gradient-foreground" strokeWidth={2.25} />
    </span>
  );
}

function StatusTicker({ text }: { text: string }) {
  return (
    <div className="flex min-h-6 items-center gap-2.5 text-sm text-muted-foreground" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-agent motion-safe:animate-blink" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
          {text}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function elapsed(ms: number) {
  return ms < 1000 ? `${formatNumber(ms)} ms` : `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
}

/**
 * The conversation. A polite live log: new answers are read out as they
 * stream in, each turn says who is speaking, and failed commands can be
 * sent again.
 */
export function Timeline({
  turns,
  onRetry,
  compact,
}: {
  turns: AgentTurn[];
  onRetry: (text: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="space-y-7" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation with the agent">
      {turns.map((t, i) =>
        t.role === 'user' ? (
          <motion.div key={t.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end gap-1.5">
            <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-[15px] leading-relaxed text-background shadow-soft">
              <span className="sr-only">You said: </span>
              {t.text}
            </p>
            {t.via === 'voice' && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <AudioLines className="size-3.5" aria-hidden /> Said aloud
              </span>
            )}
            {t.retryable && (
              <button
                type="button"
                onClick={() => onRetry(t.text!)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary-soft hover:text-primary-soft-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <RotateCcw className="size-3.5" aria-hidden /> Send again
              </button>
            )}
          </motion.div>
        ) : (
          <div key={t.id} className="flex gap-3">
            <span className="sr-only">Agent:</span>
            <AgentOrb busy={t.pending} className="mt-0.5" />
            <div className="min-w-0 flex-1 space-y-3">
              {t.blocks.map((b, j) => (
                <motion.div
                  key={j}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: Math.min(j * 0.06, 0.3) }}
                >
                  <BlockRenderer block={b} />
                </motion.div>
              ))}
              {t.pending && t.status && <StatusTicker text={t.status} />}
              {t.error && (
                <Callout tone={t.error === 'Stopped.' ? 'neutral' : 'danger'} className="py-2.5">
                  {t.error === 'Stopped.' ? 'Stopped. Ask again whenever you’re ready.' : t.error}
                </Callout>
              )}
              {!t.pending && t.ms !== undefined && i === turns.length - 1 && !compact && (
                <p className="text-xs text-muted-foreground">Answered from live data in {elapsed(t.ms)}</p>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}

/**
 * Keeps a scroll container pinned to the bottom unless the person scrolls up.
 * Pass `enabled: false` (e.g. for an empty conversation) to leave the scroll
 * position alone, so a welcome screen opens at its top.
 */
export function useStickToBottom<T extends HTMLElement>(dep: unknown, { enabled = true }: { enabled?: boolean } = {}) {
  const ref = React.useRef<T>(null);
  const pinned = React.useRef(true);
  const first = React.useRef(true);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      const nearBottom = el.scrollHeight - top - el.clientHeight < 80;
      // Only a scroll *up* unpins; our own smooth scroll down (or content growing) never does.
      if (nearBottom) pinned.current = true;
      else if (top < last - 2) pinned.current = false;
      last = top;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      first.current = true;
      pinned.current = true;
      return;
    }
    if (!pinned.current) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Jump straight to the end of a restored conversation; glide for new answers.
    el.scrollTo({ top: el.scrollHeight, behavior: first.current || reduce ? 'auto' : 'smooth' });
    first.current = false;
  }, [dep, enabled]);
  return ref;
}
