// The jump-cut ringing counter (S02, S07, S18-S19, S27): a mono label over a
// giant mono value. It never tweens: each step is a hard cut with a 2-frame
// pop (1.08 -> 1). Variants follow the film's colour code: ivory (the neutral
// count), teal (Gus's world: S02's 0:20 hold) and red (Rita's world: S18-S19),
// plus the frozen MISSED CALL state that ends S19.
import React from 'react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';
import {activeStep, COUNTER_POP_FRAMES, type Step} from '../marks.ts';
import {FONT, NIGHT} from '../theme.ts';

export type CounterVariant = 'ivory' | 'teal' | 'red';

/** label / value colours per variant (board: S02 label #8ed7eb over an ivory value; S02 0:20 all teal; S18-S19 all red). */
export const COUNTER_COLORS: Record<CounterVariant, {label: string; value: string; glow: string}> = {
  ivory: {label: NIGHT.tealSoft, value: NIGHT.ivory, glow: NIGHT.ivory},
  teal: {label: NIGHT.tealSoft, value: NIGHT.tealSoft, glow: NIGHT.teal},
  red: {label: NIGHT.red, value: NIGHT.red, glow: NIGHT.red},
};

export const MISSED_CALL = 'MISSED CALL';

/** Value line-height: the box is exactly the digit height (JetBrains Mono cap height 0.73 em). */
export const VALUE_LH = 0.73;

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** The 2-frame pop: frame 0 of a step at 1.08, frame 1 at 1.04, then 1. */
export const popScale = (since: number, frames = COUNTER_POP_FRAMES, from = 1.08): number =>
  since < 0 ? 1 : interpolate(since, [0, frames], [from, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

export type CounterProps = {
  /** e.g. "0:14", or "MISSED CALL" (switches to the missed state). */
  value: string;
  /** "RINGING". Omit for none. Hidden in the missed state. */
  label?: string;
  /** Frames since this value landed (0 and 1 are the pop). Omit for no pop. */
  since?: number;
  variant?: CounterVariant;
  /** Value font size in px (S02 200, S07 180, S27 140, S18-S19 inline 72). The value's box is 0.73 x size tall (the digits). */
  size?: number;
  /** Label font size in px (S02 30, S07/S27 26). Default size x 0.15, at least 24. */
  labelSize?: number;
  /** Overrides (S27: a #fa9e9e label over an ivory value). */
  labelColor?: string;
  valueColor?: string;
  /** 'stack': label on its own row above the value (S02, S07, S27). 'inline': "RINGING 0:18" on one line (S18-S19). */
  layout?: 'stack' | 'inline';
  /** Space between label and value in px (stack default size x 0.08; inline default size x 0.3). */
  gap?: number;
  /**
   * An ink pill behind the VALUE (S07: #07090d at 85%, radius 28, padding 0.21em/40 so a 180 px value makes the board's 208 px pill). true = those numbers.
   * In 'inline' layout the pill wraps label and value.
   */
  pill?: boolean | {color?: string; radius?: number; padX?: number; padY?: number};
  /** 0..1 white flash over the value (S18: one white flash on the counter at 0:20). */
  flash?: number;
  /** Frames since the MISSED CALL flip landed; drives the flip-in (3 frames). Default = since. */
  missedSince?: number;
  /** Soft neon glow on the value (default 1; 0 for none). */
  glow?: number;
  /** Text alignment of the block (default 'center'). */
  align?: 'center' | 'left' | 'right';
  style?: React.CSSProperties;
};

/** lucide phone-missed, drawn at the cap height of the MISSED CALL text. */
const PhoneMissed: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{display: 'block', flexShrink: 0}} aria-hidden>
    <path d="m16 2 6 6" />
    <path d="m22 2-6 6" />
    <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
  </svg>
);

/**
 * One counter state. Position it yourself (it is an inline-flex block, centred on its own box);
 * the pop scales about the value's centre so jump cuts never shift the layout.
 */
export const Counter: React.FC<CounterProps> = ({
  value,
  label,
  since,
  variant = 'ivory',
  size = 200,
  labelSize,
  labelColor,
  valueColor,
  layout = 'stack',
  gap,
  pill,
  flash = 0,
  missedSince,
  glow = 1,
  align = 'center',
  style,
}) => {
  const missed = value === MISSED_CALL;
  const c = COUNTER_COLORS[missed ? 'red' : variant];
  const vColor = missed ? NIGHT.red : valueColor ?? c.value;
  const lColor = labelColor ?? c.label;
  const lSize = labelSize ?? Math.max(24, Math.round(size * 0.15));
  const scale = since === undefined ? 1 : popScale(since);
  const fl = Math.max(0, Math.min(1, flash));
  const p = pill === true ? {} : pill || null;
  const pillStyle: React.CSSProperties | undefined = p
    ? {
        background: p.color ?? rgba(NIGHT.ink, 0.85),
        borderRadius: p.radius ?? 28,
        // S07: a 180 px value on a 208 px pill (y 856–1064) = digits plus ~38 px above and below.
        padding: `${p.padY ?? Math.round(size * 0.21)}px ${p.padX ?? 40}px`,
      }
    : undefined;
  const glowShadow = glow > 0 ? `0 0 ${Math.round(size * 0.16)}px ${rgba(c.glow, 0.28 * glow)}, 0 0 ${Math.round(size * 0.04)}px ${rgba(c.glow, 0.22 * glow)}` : undefined;
  const flashShadow = fl > 0 ? `0 0 ${Math.round(size * 0.3)}px ${rgba(NIGHT.ivory, 0.9 * fl)}` : undefined;
  const textShadow = [flashShadow, glowShadow].filter(Boolean).join(', ') || undefined;

  // MISSED CALL: a 3-frame flip down from the freeze (rotateX 90 -> 0), red, with the missed-call glyph.
  const ms = missedSince ?? since ?? 99;
  const flip = interpolate(ms, [0, 3], [88, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.22, 1, 0.36, 1)});
  const missedSize = layout === 'inline' ? size : Math.round(size * 0.42);

  const valueText = (
    <span
      style={{
        display: 'inline-block',
        fontFamily: FONT.mono,
        fontWeight: 500,
        fontSize: size,
        // JetBrains Mono digits are 0.73 em tall (cap height 730/1000): this line box hugs them exactly,
        // so the board's "value y 400–560"-style numbers place the digits themselves.
        lineHeight: VALUE_LH,
        letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
        color: fl > 0 ? mixHex(vColor, NIGHT.ivory, fl) : vColor,
        textShadow,
        transform: scale !== 1 ? `scale(${scale})` : undefined,
        transformOrigin: '50% 55%',
        whiteSpace: 'nowrap',
      }}
    >
      {value}
    </span>
  );

  const missedBlock = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(missedSize * 0.32),
        fontFamily: FONT.mono,
        fontWeight: 500,
        fontSize: missedSize,
        lineHeight: 1,
        letterSpacing: '0.06em',
        color: NIGHT.red,
        textShadow: glow > 0 ? `0 0 ${Math.round(missedSize * 0.35)}px ${rgba(NIGHT.red, 0.35 * glow)}` : undefined,
        transform: `perspective(${missedSize * 12}px) rotateX(${flip}deg)`,
        transformOrigin: '50% 0%',
        whiteSpace: 'nowrap',
      }}
    >
      <PhoneMissed size={Math.round(missedSize * 0.86)} color={NIGHT.red} />
      {MISSED_CALL}
    </span>
  );

  const labelEl = label && !missed ? (
    <span
      style={{
        display: 'block',
        fontFamily: FONT.mono,
        fontWeight: 500,
        fontSize: lSize,
        lineHeight: 1,
        letterSpacing: '0.16em',
        // optical: trailing tracking would push a centred label left
        marginRight: align === 'center' && layout === 'stack' ? '-0.16em' : undefined,
        color: lColor,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  ) : null;

  const justify = align === 'center' ? 'center' : align === 'left' ? 'flex-start' : 'flex-end';

  if (layout === 'inline') {
    return (
      <div style={{display: 'inline-flex', alignItems: 'baseline', justifyContent: justify, gap: gap ?? Math.round(size * 0.3), ...pillStyle, ...style}}>
        {missed ? (
          missedBlock
        ) : (
          <>
            {label ? (
              <span style={{fontFamily: FONT.mono, fontWeight: 500, fontSize: labelSize ?? size, lineHeight: 1, letterSpacing: '0.04em', color: lColor, whiteSpace: 'nowrap', textShadow: glowShadow}}>{label}</span>
            ) : null}
            {valueText}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{display: 'inline-flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : align === 'left' ? 'flex-start' : 'flex-end', gap: gap ?? Math.round(size * 0.08), ...style}}>
      {labelEl}
      {missed ? <span style={{display: 'inline-flex', ...pillStyle}}>{missedBlock}</span> : <span style={{display: 'inline-flex', ...pillStyle}}>{valueText}</span>}
    </div>
  );
};

/** opaque mix of two #rrggbb colours */
const mixHex = (a: string, b: string, t: number): string => {
  const p = (h: string) => {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const A = p(a);
  const B = p(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

export type SteppedCounterProps = Omit<CounterProps, 'value' | 'since' | 'missedSince'> & {
  /** Steps from marks.ts (S02_COUNTER, S07_COUNTER, TWIST_COUNTER, S27_COUNTER). */
  steps: readonly Step[];
  /** The scene whose <Sequence> this renders in (steps are absolute seconds). */
  sceneName: string;
  /** Override variant for a step (e.g. S02 turns teal from 0:20: `(s) => s.label === '0:20' ? 'teal' : 'ivory'`). */
  variantFor?: (step: Step, index: number) => CounterVariant;
  /** 0..1 white flash for a step given frames since it landed (S18 0:20). */
  flashFor?: (step: Step, since: number) => number;
};

/** A Counter driven by marks.ts steps and the scene's frame. Renders nothing before the first step. */
export const SteppedCounter: React.FC<SteppedCounterProps> = ({steps, sceneName, variantFor, flashFor, variant, flash, ...rest}) => {
  const frame = useCurrentFrame();
  const a = activeStep(steps, frame, sceneName);
  if (!a) return null;
  return (
    <Counter
      {...rest}
      value={a.step.label}
      since={a.since}
      missedSince={a.since}
      variant={variantFor ? variantFor(a.step, a.index) : variant}
      flash={flashFor ? flashFor(a.step, a.since) : flash}
    />
  );
};
