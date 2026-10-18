// fx/RedString: detective-board marks (S20) and the hand-drawn ring (S19).
//   <MarkerCircle>  a wobbly marker loop that draws on by progress (overshoots its start like a real hand)
//   <RedString>     a 2 px string with a slight sag between two pins, drawn on by progress, pins pop at each end
//   <Pin>           a push-pin head with a cast shadow
// Every component is a full-frame SVG in frame px (drop it straight into a scene).
import React from 'react';
import {Easing, interpolate} from 'remotion';
import {NIGHT} from '../theme.ts';
import {HEIGHT, WIDTH} from '../timeline.ts';
import {clamp01, perlin1} from './noise.ts';

type Pt = {x: number; y: number};

/** 0..1 → pop scale with overshoot (0 → 1.22 → 1). */
export const popScale = (t: number) => {
  const p = clamp01(t);
  if (p <= 0) return 0;
  return interpolate(p, [0, 0.55, 1], [0, 1.22, 1], {easing: Easing.out(Easing.quad)});
};

const Full: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible', ...style}}>
    {children}
  </svg>
);

/** Points of a hand-drawn loop around (cx, cy). */
export const markerLoop = (cx: number, cy: number, rx: number, ry: number, seed = 'mk', wobble = 0.035, overshoot = 0.42, tilt = -6): Pt[] => {
  const n = 120;
  const start = -2.2 + perlin1(`${seed}s`, 0.5) * 0.4; // start upper-left, like a right-handed stroke
  const total = Math.PI * 2 + overshoot;
  const tr = (tilt * Math.PI) / 180;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = start + u * total;
    // radius drifts outward a little through the stroke so the tail misses the start
    const k = 1 + perlin1(seed, u * 5.5) * wobble + (u - 0.5) * 0.06;
    const ex = Math.cos(a) * rx * k;
    const ey = Math.sin(a) * ry * k;
    pts.push({x: cx + ex * Math.cos(tr) - ey * Math.sin(tr), y: cy + ex * Math.sin(tr) + ey * Math.cos(tr)});
  }
  return pts;
};

const smoothPath = (pts: Pt[]) => {
  // Catmull-Rom → cubic Bézier
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = {x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6};
    const c2 = {x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6};
    d += `C${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
};

export type MarkerCircleProps = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** 0..1 draw-on. */
  progress: number;
  color?: string;
  /** Stroke width px (marker 7; S19's ivory ring 3). */
  width?: number;
  seed?: string;
  /** Wobble of the radius (0.035 = ±3.5 %). */
  wobble?: number;
  tilt?: number;
  opacity?: number;
};

export const MarkerCircle: React.FC<MarkerCircleProps> = ({cx, cy, rx, ry, progress, color = NIGHT.red, width = 7, seed = 'mk', wobble = 0.035, tilt = -6, opacity = 0.95}) => {
  const p = clamp01(progress);
  if (p <= 0) return null;
  // ease like a hand: quick through the middle, slowing at the end
  const e = Easing.bezier(0.3, 0.1, 0.3, 1)(p);
  const d = smoothPath(markerLoop(cx, cy, rx, ry, seed, wobble, 0.42, tilt));
  const dash = {pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - e};
  return (
    <Full>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={opacity}>
        <path d={d} stroke={color} strokeWidth={width} {...dash} />
        {/* marker texture: a lighter inner stroke where the felt tip runs dry */}
        {width >= 5 ? <path d={d} stroke={NIGHT.redSoft} strokeOpacity={0.35} strokeWidth={width * 0.28} transform="translate(0.8 -0.8)" {...dash} /> : null}
      </g>
    </Full>
  );
};

export type PinProps = {x: number; y: number; scale?: number; color?: string; r?: number};

/** Push-pin head (top-down) with a highlight and a cast shadow. */
export const Pin: React.FC<PinProps> = ({x, y, scale = 1, color = NIGHT.red, r = 11}) => {
  if (scale <= 0) return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={4} cy={6} rx={r * 1.05} ry={r * 0.9} fill={NIGHT.ink} opacity={0.5} />
      <circle r={r} fill={NIGHT.redDeep} />
      <circle r={r * 0.86} cy={-0.8} fill={color} />
      <circle r={r * 0.5} cx={-r * 0.12} cy={-r * 0.2} fill={NIGHT.redSoft} opacity={0.55} />
      <circle r={r * 0.2} cx={-r * 0.32} cy={-r * 0.38} fill="#ffffff" opacity={0.85} />
    </g>
  );
};

export type RedStringProps = {
  from: Pt;
  to: Pt;
  /** Sag at the middle, px (downward). */
  sag?: number;
  /** 0..1 draw-on from `from` to `to`. */
  progress: number;
  /** Pin pop progress 0..1 at each end. Defaults: the first pin pops as the string starts, the second as it lands. */
  pins?: [number, number];
  color?: string;
  width?: number;
};

export const stringPath = (a: Pt, b: Pt, sag: number) => {
  const c = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag * 2};
  return `M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`;
};

export const RedString: React.FC<RedStringProps> = ({from, to, sag = 26, progress, pins, color = NIGHT.red, width = 2}) => {
  const p = clamp01(progress);
  const e = Easing.inOut(Easing.cubic)(p);
  const [pa, pb] = pins ?? [clamp01(p / 0.18), clamp01((p - 0.86) / 0.14)];
  const d = stringPath(from, to, sag);
  const dash = {pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - e};
  return (
    <Full>
      {p > 0 ? (
        <g fill="none" strokeLinecap="round">
          {/* shadow on the board */}
          <path d={d} stroke={NIGHT.ink} strokeOpacity={0.55} strokeWidth={width + 1.5} transform="translate(3 5)" {...dash} />
          <path d={d} stroke={color} strokeWidth={width} {...dash} />
          {/* fibre highlight */}
          <path d={d} stroke={NIGHT.redSoft} strokeOpacity={0.5} strokeWidth={width * 0.4} transform="translate(0 -0.6)" {...dash} />
        </g>
      ) : null}
      <Pin x={from.x} y={from.y} scale={popScale(pa)} color={color} />
      <Pin x={to.x} y={to.y} scale={popScale(pb)} color={color} />
    </Full>
  );
};
