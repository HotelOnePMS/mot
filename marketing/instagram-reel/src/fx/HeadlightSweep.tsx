// fx/HeadlightSweep: a passing truck's headlight bar sweeping across the frame
// (S07 13.0: right→left across both halves with a 200 px glare bloom #fff8e0;
// S11 22.0: a smaller reflection sliding across the dash). Pure gradients,
// screen-blended; drive it with `progress` 0..1 (see sweepProgress()).
import React from 'react';
import {AbsoluteFill, Easing, interpolate} from 'remotion';
import {HEIGHT, WIDTH} from '../timeline.ts';
import {clamp01} from './noise.ts';

/** Board: headlight glare #fff8e0. */
export const HEADLIGHT = '#fff8e0';

/** Progress of a sweep that starts at `from` and lasts `frames` (both in the caller's frame space). Eased in-out like a vehicle passing. */
export const sweepProgress = (frame: number, from: number, frames: number) =>
  interpolate(frame, [from, from + frames], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.45, 0.05, 0.55, 0.95)});

export type HeadlightSweepProps = {
  /** 0..1 travel across the frame. Nothing is drawn at 0 or 1. */
  progress: number;
  /** 'rtl' = right → left (S07). */
  direction?: 'rtl' | 'ltr';
  /** Bar tilt in degrees (a little perspective lean). */
  angle?: number;
  /** Width of the hot core, px. */
  width?: number;
  /** Glare bloom radius, px (board: 200). */
  bloom?: number;
  /** Peak strength 0..1. */
  intensity?: number;
  /** Vertical centre of the bloom, px. */
  y?: number;
  color?: string;
  /** Optional clip to a horizontal band [top, bottom] in px (e.g. the dash). */
  band?: [number, number];
};

export const HeadlightSweep: React.FC<HeadlightSweepProps> = ({
  progress,
  direction = 'rtl',
  angle = -8,
  width = 110,
  bloom = 200,
  intensity = 1,
  y = HEIGHT / 2,
  color = HEADLIGHT,
  band,
}) => {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return null;
  const span = WIDTH + 2 * (bloom + width);
  const t = direction === 'rtl' ? 1 - p : p;
  const x = -(bloom + width) + t * span;
  // brightest mid-frame; fades as it enters/leaves
  const env = Math.sin(Math.PI * p) ** 0.6 * intensity;
  const clip: React.CSSProperties = band ? {clipPath: `inset(${band[0]}px 0 ${HEIGHT - band[1]}px 0)`} : {};
  const tall = HEIGHT * 1.4;
  return (
    <AbsoluteFill style={{mixBlendMode: 'screen', pointerEvents: 'none', ...clip}}>
      {/* wide soft wash: the light spilling ahead of the bar */}
      <div
        style={{
          position: 'absolute',
          left: x - bloom * 2.2,
          top: (HEIGHT - tall) / 2,
          width: bloom * 4.4,
          height: tall,
          transform: `rotate(${angle}deg)`,
          opacity: 0.22 * env,
          background: `linear-gradient(90deg, rgba(0,0,0,0) 0%, ${color} 50%, rgba(0,0,0,0) 100%)`,
        }}
      />
      {/* the hot bar */}
      <div
        style={{
          position: 'absolute',
          left: x - width / 2,
          top: (HEIGHT - tall) / 2,
          width,
          height: tall,
          transform: `rotate(${angle}deg)`,
          opacity: 0.42 * env,
          background: `linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(255,248,224,0.35) 30%, ${color} 47%, #ffffff 50%, ${color} 53%, rgba(255,248,224,0.35) 70%, rgba(0,0,0,0) 100%)`,
        }}
      />
      {/* glare bloom (200 px) where the beam hits the lens */}
      <div
        style={{
          position: 'absolute',
          left: x - bloom,
          top: y - bloom,
          width: bloom * 2,
          height: bloom * 2,
          borderRadius: '50%',
          opacity: 0.85 * env,
          background: `radial-gradient(circle, #ffffff 0%, ${color} 14%, rgba(255,248,224,0.35) 38%, rgba(255,248,224,0.08) 62%, rgba(0,0,0,0) 72%)`,
        }}
      />
      {/* anamorphic streak through the bloom */}
      <div
        style={{
          position: 'absolute',
          left: x - bloom * 1.8,
          top: y - 2,
          width: bloom * 3.6,
          height: 4,
          opacity: 0.35 * env,
          background: `linear-gradient(90deg, rgba(0,0,0,0), ${color} 45%, #ffffff 50%, ${color} 55%, rgba(0,0,0,0))`,
        }}
      />
    </AbsoluteFill>
  );
};
