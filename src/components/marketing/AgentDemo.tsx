'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDownToLine, BedDouble, Check, Pause, Play, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';

type Scene = { command: string; render: (phase: number) => React.ReactNode };

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Soft fill + its AA text colour; the label carries the meaning. */
const TONES = {
  warning: 'bg-warning-soft text-warning-soft-foreground',
  success: 'bg-success-soft text-success-soft-foreground',
  info: 'bg-info-soft text-info-soft-foreground',
} as const;

const Row = ({ name, meta, badge, tone }: { name: string; meta: string; badge: string; tone: keyof typeof TONES }) => (
  <div className="flex items-center gap-3 px-4 py-2.5">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-2xs font-semibold text-primary-soft-foreground">
      {name
        .split(' ')
        .map((p) => p[0])
        .join('')}
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{name}</p>
      <p className="truncate text-xs text-muted-foreground">{meta}</p>
    </div>
    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium', TONES[tone])}>{badge}</span>
  </div>
);

const SCENES: Scene[] = [
  {
    command: 'Who’s arriving today?',
    render: () => (
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ArrowDownToLine className="h-4 w-4 text-primary" /> 6 arrivals today
          </p>
          <span className="text-xs text-muted-foreground">2 need a room</span>
        </div>
        <div className="divide-y">
          <Row name="Jordan Smith" meta="Ocean King · 3 nights · anniversary" badge="No room" tone="warning" />
          <Row name="Grace Okafor" meta="Ocean King · Room 304" badge="Ready" tone="success" />
          <Row name="Lucas Silva" meta="Family Suite · flight delayed" badge="Late" tone="info" />
        </div>
      </div>
    ),
  },
  {
    command: 'Check in the Smiths — quiet room, high floor, note it’s their anniversary',
    render: (phase) => (
      <div className="overflow-hidden rounded-xl border border-agent/30 bg-card shadow-glow">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b bg-agent-soft px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm font-medium text-agent-soft-foreground">
            <ShieldCheck className="h-4 w-4" /> Review 2 changes
          </p>
          <span className="text-xs text-agent-soft-foreground">Nothing changes until you confirm</span>
        </div>
        <ul className="space-y-2 px-4 py-3 text-sm">
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <BedDouble className="h-4 w-4 shrink-0 text-muted-foreground" /> Check in Jordan Smith → <strong className="font-semibold">Room 304</strong>
            <span className="rounded-md bg-muted px-1.5 text-2xs text-muted-foreground">quiet · floor 3</span>
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> Add note: “Anniversary — chilled bubbles on arrival”
          </li>
        </ul>
        <div className="flex items-center justify-end gap-3 border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">Cancel</span>
          <motion.span
            animate={phase >= 2 ? { scale: [1, 0.94, 1] } : {}}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              phase >= 2 ? 'bg-success text-success-foreground' : 'bg-agent text-agent-foreground'
            )}
          >
            {phase >= 2 ? (
              <>
                <Check className="h-3.5 w-3.5" /> Done · keys for 304
              </>
            ) : (
              'Confirm 2 changes'
            )}
          </motion.span>
        </div>
      </div>
    ),
  },
  {
    command: 'Raise Ocean King 10% for the next two weekends',
    render: () => (
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="h-4 w-4 text-primary" /> Ocean King · 4 nights
          </p>
          <span className="text-xs text-muted-foreground">Weekends 89% booked</span>
        </div>
        <div className="grid grid-cols-4 gap-2 p-4">
          {(
            [
              ['Fri 16', 227, 250],
              ['Sat 17', 227, 250],
              ['Fri 23', 306, 337],
              ['Sat 24', 306, 337],
            ] as const
          ).map(([d, was, now]) => (
            <div key={d} className="rounded-lg bg-surface-sunken px-1 py-2 text-center">
              <p className="text-2xs text-muted-foreground">{d}</p>
              <p className="text-2xs text-muted-foreground line-through">{usd.format(was)}</p>
              <p className="tabular text-sm font-semibold text-primary">{usd.format(now)}</p>
            </div>
          ))}
        </div>
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          New prices go live after you confirm. Direct and channel rates stay in sync.
        </p>
      </div>
    ),
  },
];

const TYPE_MS = 28;
/** How long a finished scene stays on screen before the next one starts. */
const HOLD_MS = 3800;

/**
 * Looping illustration of the agent: a typed request becomes live UI.
 * - The first frame is already complete (no half-empty card on load).
 * - Pausable (WCAG 2.2.2), and it never auto-plays with reduced motion or
 *   while off screen. Screen readers get a text description instead of the
 *   animated transcript.
 */
export function AgentDemo({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const rootRef = React.useRef<HTMLElement>(null);
  const [scene, setScene] = React.useState(0);
  const [typed, setTyped] = React.useState(SCENES[0].command.length);
  const [phase, setPhase] = React.useState(2); // 0 typing, 1 answer shown, 2 confirmed
  const [paused, setPaused] = React.useState(false);
  const [inView, setInView] = React.useState(true);
  // Only scenes reached by autoplay are typed out; the first one, picked ones
  // and the one showing when play resumes appear complete.
  const animateNext = React.useRef(false);
  const s = SCENES[scene];
  const autoplay = !reduce && !paused && inView;

  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    const len = SCENES[scene].command.length;
    const animate = animateNext.current;
    animateNext.current = false;
    const advance = () => {
      animateNext.current = true;
      setScene((x) => (x + 1) % SCENES.length);
    };
    if (!autoplay || !animate) {
      setTyped(len);
      setPhase(2);
      if (!autoplay) return;
      const hold = setTimeout(advance, HOLD_MS);
      return () => clearTimeout(hold);
    }
    setTyped(0);
    setPhase(0);
    let i = 0;
    const typer = setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= len) clearInterval(typer);
    }, TYPE_MS);
    const t1 = setTimeout(() => setPhase(1), len * TYPE_MS + 450);
    const t2 = setTimeout(() => setPhase(2), len * TYPE_MS + 2300);
    const t3 = setTimeout(advance, len * TYPE_MS + 2300 + HOLD_MS);
    return () => {
      clearInterval(typer);
      [t1, t2, t3].forEach(clearTimeout);
    };
  }, [scene, autoplay]);

  const pick = (i: number) => {
    animateNext.current = false;
    setScene(i);
  };

  return (
    <figure ref={rootRef} className={cn('relative rounded-3xl border bg-surface/90 p-4 shadow-float backdrop-blur sm:p-5', className)}>
      <div className="mb-4 flex items-center gap-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong/40" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong/40" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong/40" />
        </span>
        <span className="ml-2 flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-muted-foreground" aria-hidden>
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-agent" /> {PRODUCT_NAME} agent
        </span>
        <span className="ml-auto flex items-center">
          {SCENES.map((sc, i) => (
            <button
              key={sc.command}
              type="button"
              onClick={() => pick(i)}
              aria-label={`Show example ${i + 1} of ${SCENES.length}`}
              aria-pressed={i === scene}
              className="group relative flex h-8 min-w-7 items-center justify-center rounded-md px-1 after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-all duration-300',
                  i === scene ? 'w-5 bg-agent' : 'w-2 bg-border-strong/40 group-hover:bg-border-strong'
                )}
              />
            </button>
          ))}
          {/* Nothing auto-plays with reduced motion, so there's nothing to pause (CSS, so SSR markup matches). */}
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Play the demo' : 'Pause the demo'}
            title={paused ? 'Play' : 'Pause'}
            className="relative ml-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:hidden"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        </span>
      </div>

      {/* The animated transcript is decorative; the caption below describes it. */}
      <div className="min-h-[18.5rem] space-y-3 sm:min-h-[17rem]" aria-hidden>
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            {s.command.slice(0, typed)}
            {typed < s.command.length && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-primary-foreground" />}
          </p>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {phase >= 1 && (
            <motion.div
              key={scene}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {s.render(phase)}
            </motion.div>
          )}
        </AnimatePresence>
        {phase === 0 && typed >= s.command.length && (
          <div className="flex gap-1 px-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-blink rounded-full bg-agent" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        )}
      </div>

      <figcaption className="sr-only">
        Example of the {PRODUCT_NAME} agent at work. Ask “Who’s arriving today?” and it lists today’s arrivals with the ones that still need a room.
        Ask it to check in the Smiths in a quiet, high-floor room and it prepares the changes for you to confirm. Ask it to raise weekend prices
        and it shows the new rates before anything goes live.
      </figcaption>
    </figure>
  );
}
