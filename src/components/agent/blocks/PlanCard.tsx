'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Ban, CheckCircle2, CircleAlert, Clock, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import type { AgentBlock } from '@/lib/agent/blocks';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, Kbd } from '@/components/ui/primitives';
import { useAgentUI } from '../AgentUI';

const RISK = {
  low: { label: 'Routine', variant: 'success', icon: ShieldCheck },
  medium: { label: 'Review', variant: 'warning', icon: CircleAlert },
  high: { label: 'High impact', variant: 'danger', icon: ShieldAlert },
} as const;

/** Re-renders on a timer so the "expires in" line stays honest. */
function useExpiry(expiresAt: string) {
  const at = Date.parse(expiresAt);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const left = at - Date.now();
    if (left <= 0) return setNow(Date.now());
    // Tick every 15s, and exactly at expiry.
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const end = window.setTimeout(() => setNow(Date.now()), Math.min(left + 50, 2 ** 31 - 1));
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [at]);
  const left = at - now;
  return { expired: !Number.isFinite(at) || left <= 0, minutesLeft: Math.max(1, Math.ceil(left / 60_000)), at };
}

function useIsMac() {
  const [mac, setMac] = React.useState(true);
  React.useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  return mac;
}

/**
 * The agent never acts on its own: every change arrives as this card. It
 * spells out what will change, any warnings, how risky it is and when the
 * offer runs out; the person confirms or cancels.
 */
export function PlanCard({ block }: { block: Extract<AgentBlock, { type: 'plan' }> }) {
  const { plan } = block;
  const { confirm, dismiss, plans, latestPlan } = useAgentUI();
  const state = plans[plan.token] ?? 'idle';
  const { expired, minutesLeft, at } = useExpiry(plan.expiresAt);
  const mac = useIsMac();
  const decided = state === 'done' || state === 'dismissed' || state === 'failed';
  const open = !decided && !expired;
  const isLatest = latestPlan === plan.token;
  const risk = RISK[plan.risk];
  const titleId = React.useId();
  const stepsId = React.useId();

  // ⌘/Ctrl + Enter confirms the newest open plan.
  React.useEffect(() => {
    if (!isLatest || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        confirm(plan.token);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLatest, open, confirm, plan.token]);

  const eyebrow =
    state === 'done'
      ? 'Done'
      : state === 'dismissed'
        ? 'Cancelled'
        : state === 'failed'
          ? 'Partly done'
          : expired
            ? 'Expired'
            : state === 'running'
              ? 'Working on it…'
              : 'Needs your OK';

  return (
    <motion.section
      layout="position"
      data-plan={plan.token}
      aria-labelledby={titleId}
      className={cn(
        'overflow-hidden rounded-2xl border bg-card',
        open ? 'ring-aurora shadow-lifted' : 'shadow-xs'
      )}
    >
      <div className="flex items-start gap-3 border-b px-4 py-3.5">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
            state === 'done'
              ? 'bg-success-soft text-success-soft-foreground'
              : open
                ? cn('bg-aurora text-agent-gradient-foreground shadow-glow', state === 'running' && 'motion-safe:animate-aurora')
                : 'bg-muted text-muted-foreground'
          )}
          aria-hidden
        >
          {state === 'done' ? <CheckCircle2 /> : state === 'dismissed' ? <Ban /> : expired && !decided ? <Clock /> : <Sparkles />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
          <h2 id={titleId} className="mt-0.5 text-[15px] font-semibold leading-snug">
            {plan.title}
          </h2>
        </div>
        <Badge variant={risk.variant} size="sm" icon={risk.icon} className="mt-0.5 shrink-0">
          {risk.label}
        </Badge>
      </div>

      <div className={cn('px-4 pb-1 pt-3', decided && 'opacity-75')}>
        <p id={stepsId} className="text-xs font-medium text-muted-foreground">
          {decided && state !== 'dismissed' ? 'What changed' : state === 'dismissed' ? 'What would have changed' : 'What will change'}
        </p>
        <ol aria-labelledby={stepsId} className="mt-1">
          {plan.steps.map((s, i) => (
            <li key={i} className="flex gap-3 py-2">
              <span
                className={cn(
                  'mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular',
                  state === 'done' ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted text-muted-foreground'
                )}
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.summary}</p>
                {s.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {plan.warnings.length > 0 && !decided && (
        <Callout tone="warning" icon={null} className="mx-4 mb-3 mt-1 block space-y-1.5 px-3 py-2.5">
          {plan.warnings.map((w, i) => (
            <p key={i} className="flex gap-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{w}</span>
            </p>
          ))}
        </Callout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t bg-surface-sunken/60 px-4 py-3">
        {decided ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            {state === 'dismissed' ? <Ban className="size-3.5" aria-hidden /> : <ShieldCheck className="size-3.5 text-success" aria-hidden />}
            {state === 'dismissed' ? 'Cancelled — nothing was changed.' : state === 'failed' ? 'Some steps didn’t go through — see below. Logged to the activity trail.' : 'Done and logged to the activity trail.'}
          </p>
        ) : expired ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden /> This plan expired so it can’t act on old data. Ask again for a fresh one.
          </p>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 shrink-0 text-success" aria-hidden /> Nothing changes until you confirm
              </p>
              <p className="flex items-center gap-1.5">
                <Clock className="size-3.5 shrink-0" aria-hidden />
                <span>
                  Expires in {minutesLeft} min
                  <span className="sr-only">, at {new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                </span>
                {isLatest && (
                  <span className="ml-1 hidden items-center gap-0.5 sm:inline-flex" aria-hidden>
                    · <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
                    <Kbd>↵</Kbd> to confirm
                  </span>
                )}
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => dismiss(plan.token)} disabled={state === 'running'}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant={plan.risk === 'high' ? 'destructive' : 'default'}
                loading={state === 'running'}
                loadingText="Working on it"
                onClick={() => confirm(plan.token)}
                autoFocus={isLatest}
              >
                {plan.confirmLabel}
              </Button>
            </div>
          </>
        )}
      </div>
    </motion.section>
  );
}
