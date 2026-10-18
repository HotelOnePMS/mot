// fx/ParticleDive (S14 28.5–29.2): a macro dive into the speaker grille of
// Rita's phone; the grille holes break into ~600 teal particles that stream
// forward and resolve into the HotelOne console card.
//   progress 0..dive      : scale 1→6 into the grille (exponential), holes detach and streak radially (the "radial blur")
//   progress dive..1      : particles converge onto the card outline and its text rows (EASE_POP), then hand over to the card
// Deterministic (seeded random), one SVG, no filters. The scene draws the card itself.
import React, {useMemo} from 'react';
import {AbsoluteFill, Easing, interpolate, random} from 'remotion';
import {DARK, EASE_POP, NIGHT} from '../theme.ts';
import {HEIGHT, WIDTH} from '../timeline.ts';
import {clamp01} from './noise.ts';

type Rect = {x: number; y: number; w: number; h: number; r?: number};
type Row = {x: number; y: number; w: number};

export type ParticleDiveProps = {
  /** 0..1 over the whole effect (S14: 28.5 → 29.2 = 21 frames). */
  progress: number;
  /** Fraction of `progress` spent diving (board: 0.4 s of 0.7 s ⇒ 12/21). */
  dive?: number;
  /** Grille centre in frame px at scale 1. */
  center?: {x: number; y: number};
  /** Card the particles resolve into (S14: x 80–940, y 640–1100, radius 36). */
  target?: Rect;
  /** Text rows inside the card that particles also land on (default: the House rules field rows). */
  rows?: Row[];
  /** Number of holes/particles (≈600). */
  count?: number;
  seed?: string;
  /** 'all' (default), or draw only the grille plate (under the card) or only the particles (over it). */
  layer?: 'all' | 'grille' | 'particles';
  /** Background under the grille plate. */
  background?: string;
};

const DEFAULT_TARGET: Rect = {x: 80, y: 640, w: 860, h: 460, r: 36};
// S14's card: label at ~y 700, textarea rows at ~y 820 / 872 / 924 / 976 (52 px leading)
const DEFAULT_ROWS: Row[] = [
  {x: 130, y: 708, w: 280},
  {x: 150, y: 830, w: 560},
  {x: 150, y: 882, w: 700},
  {x: 150, y: 934, w: 380},
  {x: 150, y: 986, w: 500},
];

type P = {hx: number; hy: number; z: number; delay: number; tx: number; ty: number; bend: number; mix: number; size: number};

const GRILLE = {cols: 41, rows: 16, px: 14, py: 12.2, halfH: 98, halfW: 290};

/** Hole positions (relative to the grille centre) of a stadium-shaped hex grille. */
const holes = () => {
  const out: {x: number; y: number}[] = [];
  for (let j = 0; j < GRILLE.rows; j++) {
    const y = (j - (GRILLE.rows - 1) / 2) * GRILLE.py;
    for (let i = 0; i < GRILLE.cols + 1; i++) {
      const x = (i - GRILLE.cols / 2) * GRILLE.px + (j % 2 ? GRILLE.px / 2 : 0);
      // stadium clip
      const ex = Math.max(0, Math.abs(x) - (GRILLE.halfW - GRILLE.halfH));
      if (ex * ex + y * y > (GRILLE.halfH - 4) ** 2) continue;
      out.push({x, y});
    }
  }
  return out;
};

const perimeterPoint = (r: Rect, u: number) => {
  // walk a rectangle perimeter (radius ignored for placement, it's within a few px)
  const P = 2 * (r.w + r.h);
  let d = u * P;
  if (d < r.w) return {x: r.x + d, y: r.y};
  d -= r.w;
  if (d < r.h) return {x: r.x + r.w, y: r.y + d};
  d -= r.h;
  if (d < r.w) return {x: r.x + r.w - d, y: r.y + r.h};
  d -= r.w;
  return {x: r.x, y: r.y + r.h - d};
};

const lerpHex = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
};

export const ParticleDive: React.FC<ParticleDiveProps> = ({
  progress,
  dive = 12 / 21,
  center = {x: 505, y: 880},
  target = DEFAULT_TARGET,
  rows = DEFAULT_ROWS,
  count = 600,
  seed = 'dive',
  layer = 'all',
  background = NIGHT.ink,
}) => {
  const parts = useMemo<P[]>(() => {
    const hs = holes().slice(0, count);
    return hs.map((h, i) => {
      const r = (k: string) => random(`${seed}-${k}-${i}`);
      const kind = r('k');
      let t: {x: number; y: number};
      if (kind < 0.42) t = perimeterPoint(target, r('u'));
      else if (kind < 0.8) {
        const row = rows[Math.floor(r('row') * rows.length) % rows.length];
        t = {x: row.x + r('rx') * row.w, y: row.y + (r('ry') - 0.5) * 18};
      } else t = {x: target.x + 30 + r('fx') * (target.w - 60), y: target.y + 30 + r('fy') * (target.h - 60)};
      return {
        hx: h.x,
        hy: h.y,
        z: 0.4 + r('z') * 1.4,
        delay: Math.min(0.55, (Math.hypot(h.x, h.y * 2.4) / 300) * 0.35 + r('d') * 0.2),
        tx: t.x,
        ty: t.y,
        bend: (r('b') - 0.5) * 120,
        mix: r('m'),
        size: 0.8 + r('s') * 0.6,
      };
    });
  }, [count, seed, target, rows]);

  const p = clamp01(progress);
  const q = clamp01(p / dive); // dive phase
  const q2 = clamp01((p - dive) / (1 - dive)); // converge phase
  const zoomE = Easing.in(Easing.cubic)(q);
  const s = Math.pow(6, zoomE);
  const conv = Easing.bezier(...EASE_POP)(q2);

  // where a particle is at dive-phase t (0..1)
  const diveScale = (t: number) => Math.pow(6, Easing.in(Easing.cubic)(t));
  const divePos = (pt: P, t: number) => {
    const sc = diveScale(t);
    const det = clamp01((t - pt.delay) / (1 - pt.delay)); // detached amount
    const fly = 1 + det * det * pt.z * 2.2; // flies toward camera faster than the zoom
    const rx = pt.hx * sc * fly;
    const ry = pt.hy * sc * fly;
    // compress so the burst fills the frame instead of leaving it
    const d = Math.hypot(rx, ry) || 1;
    const R = 980;
    const k = (R * Math.tanh(d / R)) / d;
    return {x: center.x + rx * k, y: center.y + ry * k * (1 + 0.3 * det), det};
  };

  const plateOpacity = interpolate(q, [0.45, 0.85], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const showGrille = layer !== 'particles' && plateOpacity > 0;
  const showParticles = layer !== 'grille' && p < 1;

  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {layer !== 'particles' && background !== 'transparent' && q < 1 ? <AbsoluteFill style={{background}} /> : null}
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <defs>
          <linearGradient id="pd-plate" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={DARK.muted} />
            <stop offset="0.12" stopColor={DARK.surfaceRaised} />
            <stop offset="0.55" stopColor={DARK.surface} />
            <stop offset="1" stopColor={NIGHT.ink} />
          </linearGradient>
          <radialGradient id="pd-hole">
            <stop offset="0" stopColor={NIGHT.tealSoft} />
            <stop offset="0.55" stopColor={NIGHT.teal} />
            <stop offset="1" stopColor={NIGHT.tealDeep} />
          </radialGradient>
          <radialGradient id="pd-glow">
            <stop offset="0" stopColor={NIGHT.teal} stopOpacity="0.55" />
            <stop offset="0.6" stopColor={NIGHT.teal} stopOpacity="0.12" />
            <stop offset="1" stopColor={NIGHT.teal} stopOpacity="0" />
          </radialGradient>
        </defs>

        {showGrille ? (
          <g opacity={plateOpacity}>
            {/* zoom ghosts: a cheap radial blur on the plate */}
            {[0.86, 0.93, 1].map((g, gi) => (
              <g key={gi} opacity={gi === 2 ? 1 : 0.18 * zoomE} transform={`translate(${center.x} ${center.y}) scale(${s * (gi === 2 ? 1 : g)})`}>
                {/* the phone's bottom edge: brushed metal slab with a chamfer highlight */}
                <rect x={-760} y={-210} width={1520} height={420} rx={150} fill="url(#pd-plate)" />
                <rect x={-760} y={-210} width={1520} height={420} rx={150} fill="none" stroke={NIGHT.tealSoft} strokeOpacity={0.35} strokeWidth={2} />
                <path d="M-690 -196H690" stroke={NIGHT.ivory} strokeOpacity={0.18} strokeWidth={3} strokeLinecap="round" />
                {gi === 2 ? (
                  <>
                    {/* grille recess */}
                    <rect x={-GRILLE.halfW - 8} y={-GRILLE.halfH - 8} width={2 * GRILLE.halfW + 16} height={2 * GRILLE.halfH + 16} rx={GRILLE.halfH + 8} fill={DARK.surfaceSunken} />
                    <rect x={-GRILLE.halfW - 8} y={-GRILLE.halfH - 8} width={2 * GRILLE.halfW + 16} height={2 * GRILLE.halfH + 16} rx={GRILLE.halfH + 8} fill="none" stroke={DARK.borderStrong} strokeOpacity={0.5} strokeWidth={1.5} />
                    {/* light leaking from behind the mesh: the voice */}
                    <ellipse cx={0} cy={0} rx={GRILLE.halfW + 40} ry={GRILLE.halfH + 30} fill="url(#pd-glow)" />
                    {/* USB-C port and a mic hole, so it reads as a phone */}
                    <rect x={GRILLE.halfW + 70} y={-26} width={150} height={52} rx={26} fill={DARK.surfaceSunken} stroke={DARK.border} strokeWidth={2} />
                    <rect x={GRILLE.halfW + 92} y={-8} width={106} height={16} rx={8} fill={DARK.muted} />
                    <circle cx={-GRILLE.halfW - 110} cy={0} r={10} fill={DARK.surfaceSunken} stroke={DARK.border} strokeWidth={1.5} />
                  </>
                ) : null}
              </g>
            ))}
          </g>
        ) : null}

        {showParticles ? (
          <g strokeLinecap="round">
            {parts.map((pt, i) => {
              let x: number, y: number, x0: number, y0: number, w: number, col: string, op: number;
              if (q2 <= 0) {
                const a = divePos(pt, q);
                const b = divePos(pt, Math.max(0, q - 0.06)); // previous position → streak
                x = a.x;
                y = a.y;
                x0 = b.x;
                y0 = b.y;
                const holeR = 4.2 * s; // a hole at the current zoom
                w = interpolate(a.det, [0, 0.35, 1], [holeR * 2, Math.min(holeR * 2, 5 + pt.size * 3), 2.6 + pt.size * 2.6]);
                col = lerpHex(NIGHT.teal, NIGHT.tealSoft, clamp01(a.det * 0.7 + pt.mix * 0.3));
                op = layer === 'all' && a.det <= 0 ? plateOpacity * 0.95 : 0.95;
                if (a.det <= 0) {
                  x0 = x;
                  y0 = y;
                }
              } else {
                const a = divePos(pt, 1);
                const ex = a.x + (pt.tx - a.x) * conv;
                const ey = a.y + (pt.ty - a.y) * conv;
                // bow the path a little so the swarm swirls in
                const bow = Math.sin(Math.PI * conv) * pt.bend;
                const dx = pt.ty - a.y;
                const dy = -(pt.tx - a.x);
                const dl = Math.hypot(dx, dy) || 1;
                x = ex + (dx / dl) * bow;
                y = ey + (dy / dl) * bow;
                const prev = Easing.bezier(...EASE_POP)(Math.max(0, q2 - 0.025));
                x0 = a.x + (pt.tx - a.x) * prev + (dx / dl) * Math.sin(Math.PI * prev) * pt.bend;
                y0 = a.y + (pt.ty - a.y) * prev + (dy / dl) * Math.sin(Math.PI * prev) * pt.bend;
                w = interpolate(conv, [0, 1], [2.6 + pt.size * 2.6, 3 * pt.size]);
                col = lerpHex(NIGHT.teal, NIGHT.tealSoft, clamp01(0.3 + conv * 0.5 + pt.mix * 0.3));
                op = interpolate(q2, [0, 0.72, 1], [0.95, 0.9, 0], {extrapolateRight: 'clamp'});
              }
              return <line key={i} x1={x0} y1={y0} x2={x} y2={y} stroke={col} strokeWidth={w} strokeOpacity={op} />;
            })}
          </g>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};
