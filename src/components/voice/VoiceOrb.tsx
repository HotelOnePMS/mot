'use client';

import { useReducedMotion } from 'framer-motion';
import { AlertTriangle, Loader2, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VoiceState } from './useLiveVoice';

/** What the voice line is doing right now, in words (the orb alone is only a picture). */
export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'speaking' | 'working' | 'muted' | 'ending' | 'error';

export function voicePhase({
  state,
  speaking,
  working,
  muted,
  error,
}: {
  state: VoiceState;
  speaking?: boolean;
  working?: boolean;
  muted?: boolean;
  error?: string | null;
}): VoicePhase {
  if (error || state === 'error') return 'error';
  if (state === 'connecting') return 'connecting';
  if (state === 'ending') return 'ending';
  if (state !== 'live') return 'idle';
  if (working) return 'working';
  if (speaking) return 'speaking';
  if (muted) return 'muted';
  return 'listening';
}

export const VOICE_PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'Ready to talk',
  connecting: 'Connecting…',
  listening: 'Listening',
  speaking: 'Speaking',
  working: 'Looking that up…',
  muted: 'Microphone off',
  ending: 'Ending the call…',
  error: 'Not connected',
};

const PHASE_DOT: Record<VoicePhase, string> = {
  idle: 'bg-muted-foreground/60',
  connecting: 'bg-info motion-safe:animate-pulse',
  listening: 'bg-success motion-safe:animate-pulse',
  speaking: 'bg-agent',
  working: 'bg-info motion-safe:animate-pulse',
  muted: 'bg-warning',
  ending: 'bg-muted-foreground/60',
  error: 'bg-destructive',
};

/**
 * A small pill that names the voice line's state ("Listening", "Speaking"…),
 * so the state never depends on the orb's animation alone. It is not a live
 * region — the caption area next to it announces what matters.
 */
export function VoiceStatus({ phase, tone = 'agent', className }: { phase: VoicePhase; tone?: 'agent' | 'brand'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-xs font-medium text-foreground',
        className
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-full', PHASE_DOT[phase], phase === 'speaking' && tone === 'brand' && 'bg-brand')} aria-hidden />
      {VOICE_PHASE_LABEL[phase]}
    </span>
  );
}

/**
 * The voice "presence": breathes with your microphone level, rings while
 * the agent speaks, spins while it is looking something up. Decorative —
 * pair it with <VoiceStatus> (or pass `label`) so the state is also in words.
 * Motion is dropped for people who ask for reduced motion.
 */
export function VoiceOrb({
  state,
  level,
  speaking,
  working,
  muted,
  size = 56,
  className,
  tone = 'agent',
  label,
}: {
  state: VoiceState;
  level: number;
  speaking: boolean;
  working: boolean;
  /** Shows a crossed-out mic while the microphone is off. */
  muted?: boolean;
  size?: number;
  className?: string;
  /** agent: the AI gradient (staff tools). brand: the hotel's own colour (guest pages). */
  tone?: 'agent' | 'brand';
  /** Accessible name; without it the orb is hidden from assistive tech. */
  label?: string;
}) {
  const reduce = useReducedMotion();
  const live = state === 'live';
  const busy = state === 'connecting' || working;
  const scale = live && !reduce ? 1 + Math.min(level, 1) * 0.3 : 1;
  const fill =
    tone === 'brand'
      ? 'bg-brand text-brand-foreground shadow-lifted'
      : cn('bg-aurora text-agent-gradient-foreground shadow-glow', (live || busy) && 'motion-safe:animate-aurora');
  const sheen =
    tone === 'brand'
      ? 'bg-[radial-gradient(circle_at_32%_26%,hsl(var(--brand-foreground)/0.28),transparent_62%)]'
      : 'bg-[radial-gradient(circle_at_32%_26%,hsl(var(--agent-gradient-foreground)/0.32),transparent_62%)]';
  const icon = { width: size * 0.38, height: size * 0.38 };
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {live && speaking && !reduce && (
        <span className={cn('absolute inset-0 rounded-full opacity-30 motion-safe:animate-ping', tone === 'brand' ? 'bg-brand' : 'bg-agent')} />
      )}
      <span
        className={cn('absolute inset-0 rounded-full transition-transform duration-100', fill, !live && !busy && 'opacity-95')}
        style={{ transform: `scale(${scale})` }}
      />
      <span className={cn('pointer-events-none absolute inset-0 rounded-full', sheen)} />
      <span className={cn('relative', tone === 'brand' ? 'text-brand-foreground' : 'text-agent-gradient-foreground')}>
        {busy ? (
          <Loader2 className="motion-safe:animate-spin" style={{ width: size * 0.4, height: size * 0.4 }} />
        ) : state === 'error' ? (
          <AlertTriangle style={icon} />
        ) : muted && live ? (
          <MicOff style={icon} />
        ) : (
          <Mic style={icon} />
        )}
      </span>
    </span>
  );
}
