// S15 opening: the S14 whip-pan (camera panning right, the picture sliding left) lands in the car.
// The motion blur resolves over S15.blurResolve.frames: the cabin arrives from the right, decelerating,
// rendered as an equal-weight average of copies along the motion (no full-frame CSS blur), with speed
// lines in the console's teal/ivory fading out.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, random} from 'remotion';
import {NIGHT} from '../../theme.ts';
import {clamp} from './common.ts';

/** Picture offset (frame px, +x = still to the right) at scene-local frame `fr` (fractional ok). */
export const whipOffset = (fr: number, frames: number, travel = 260) =>
  travel * (1 - interpolate(fr, [0, frames], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)}));

/** Offsets of the copies to average at frame `fr`: spread over the distance travelled during a half-frame shutter either side. */
export const whipSamples = (fr: number, frames: number): number[] => {
  const a = whipOffset(fr - 0.5, frames);
  const b = whipOffset(fr + 0.5, frames);
  const spread = Math.abs(a - b);
  if (spread < 1.5) return [whipOffset(fr, frames)];
  const n = Math.max(2, Math.min(10, Math.round(spread / 10) + 1));
  return Array.from({length: n}, (_, i) => b + ((a - b) * i) / (n - 1));
};

const STREAKS = Array.from({length: 22}, (_, i) => {
  const r = (k: string) => random(`rsh-whip-${k}-${i}`);
  return {y: 140 + r('y') * 1640, len: 240 + r('l') * 700, x: r('x') * 1300 - 200, w: 1 + r('w') * 3, a: 0.16 + r('a') * 0.42, teal: r('c') > 0.35};
});

/** Horizontal speed lines; `v` 0..1 speed, `travel` px slid so far. */
export const WhipStreaks: React.FC<{v: number; travel: number}> = ({v, travel}) => {
  if (v <= 0.02) return null;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920">
        <defs>
          <linearGradient id="rsh-st-t" x1="0" x2="1">
            <stop offset="0" stopColor={NIGHT.teal} stopOpacity={0} />
            <stop offset="0.35" stopColor={NIGHT.tealSoft} stopOpacity={1} />
            <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="rsh-st-i" x1="0" x2="1">
            <stop offset="0" stopColor={NIGHT.ivory} stopOpacity={0} />
            <stop offset="0.35" stopColor={NIGHT.ivory} stopOpacity={1} />
            <stop offset="1" stopColor={NIGHT.ivory} stopOpacity={0} />
          </linearGradient>
        </defs>
        {STREAKS.map((s, i) => {
          const len = s.len * (0.35 + v);
          const x = s.x - travel * (0.7 + 0.3 * (i % 3));
          return <rect key={i} x={x} y={s.y} width={len} height={s.w} rx={s.w / 2} fill={s.teal ? 'url(#rsh-st-t)' : 'url(#rsh-st-i)'} opacity={s.a * v} />;
        })}
      </svg>
    </AbsoluteFill>
  );
};
