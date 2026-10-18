// S05 · Geography · 0:09.0–0:11.0. A high crane down the highway: the road runs
// BETWEEN the two lots — Rita's Motor Inn (red) on the left, the Starlite Motor
// Court (teal) on the right — with Rita's sedan nose-in to Gus's office and her
// own office window pulsing with one tiny missed-call rectangle (1 Hz).
// Crane 1.25/+180 → rest over 9.0–10.1 (ease [0.22,1,0.36,1]), then a 1% drift.
// Title rises 9.05–9.40, brass bar draws 9.5–10.0, neon dips at 9.7 (Rita) and
// 10.4 (Starlite). The "Rita" label + arrow land on the sedan as the crane settles.
// Captions (R05) are drawn globally; nothing here touches y 1200–1300.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {Highway, type HighwayCamera} from '../set/Highway.tsx';
import {S05, missedPulse} from '../marks.ts';
import {f, scene} from '../timeline.ts';
import {EASE_POP} from '../theme.ts';
import {GeoTitle, RitaCarLabel} from './geography/Overlays.tsx';

const FROM = scene('Geography').from;
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const POP = Easing.bezier(...EASE_POP);

/** Label + arrow beats (absolute s): they land on the sedan once the crane has all but settled. */
export const GEO_LABEL = {label: 9.8, draw: [9.87, 10.2], head: [10.2, 10.27], glint: 10.23} as const;

/** One 3-frame flicker dip: dim, half-catch, dim, then back to full. */
const dip = (abs: number, at: number) => {
  const k = abs - f(at);
  if (k === 0) return 0.22;
  if (k === 1) return 0.7;
  if (k === 2) return 0.34;
  return 1;
};

/** Whole-shot pan: −22 px keeps the Starlite sign's right edge (x ≈ 950 on the board's layout) clear of the
 *  IG right rail (x > 930) through the 1% drift and puts the vanishing point at x 514, near the 505 text column. */
export const GEO_PAN_X = -26;

/** Crane camera at an absolute frame: 1.25/+180 → 1/0 over S05.crane, then a 1% push-drift to the cut. */
export const geoCamera = (abs: number): HighwayCamera => {
  const k = interpolate(abs, [f(S05.crane.start), f(S05.crane.end)], [0, 1], {...clamp, easing: POP});
  const drift = interpolate(abs, [f(S05.crane.end), f(scene('Geography').end)], [0, 0.01], {...clamp, easing: Easing.in(Easing.sin)});
  return {scale: (1.25 - 0.25 * k) * (1 + drift), x: GEO_PAN_X, y: 180 * (1 - k)};
};

const camT = (c: HighwayCamera) => `translate(${540 + c.x} ${960 + c.y}) scale(${c.scale}) translate(-540 -960)`;

export const Geography: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const abs = frame + FROM;
  const sec = abs / 30;
  const cam = geoCamera(abs);

  const rise = interpolate(abs, [f(S05.title.start), f(S05.title.end)], [0, 1], {...clamp, easing: POP});
  const bar = interpolate(abs, [f(S05.bar.start), f(S05.bar.end)], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});

  const label = interpolate(abs, [f(GEO_LABEL.label), f(GEO_LABEL.label) + 6], [0, 1], {...clamp, easing: POP});
  const draw = interpolate(abs, [f(GEO_LABEL.draw[0]), f(GEO_LABEL.draw[1])], [0, 1], {...clamp, easing: Easing.inOut(Easing.quad)});
  const head = interpolate(abs, [f(GEO_LABEL.head[0]), f(GEO_LABEL.head[1])], [0, 1], {...clamp, easing: Easing.out(Easing.quad)});
  // teal windshield glint as the arrow lands: up in 2 frames, down over 6
  const g = f(GEO_LABEL.glint);
  const carGlint = interpolate(abs, [g - 2, g, g + 6], [0, 1, 0], clamp);

  return (
    <AbsoluteFill>
      <Highway variant="crane" camera={cam} ritaNeon={dip(abs, S05.ritaDip.t)} starliteNeon={dip(abs, S05.starliteDip.t)} missedPulse={missedPulse(sec)} carGlint={carGlint} />
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <g transform={camT(cam)}>
          <RitaCarLabel label={label} draw={draw} head={head} />
        </g>
      </svg>
      <GeoTitle rise={rise} bar={bar} />
    </AbsoluteFill>
  );
};
