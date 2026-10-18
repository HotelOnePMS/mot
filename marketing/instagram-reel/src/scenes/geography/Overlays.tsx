// S05 overlays: the title over the sky with its brass threshold bar, and the
// hand-drawn "Rita" label + ivory arrow pointing at her sedan in the Starlite lot.
import React from 'react';
import {random} from 'remotion';
import {FONT, NIGHT} from '../../theme.ts';
import {HIGHWAY} from '../../set/Highway.tsx';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ─── Title ─────────────────────────────────────────────────────────────────

/** Board: centred on 540 with the bar at x 330–750. Shifted −26 px with the crane's pan so the title sits on the
 *  road's axis (vanishing point x 514). */
export const TITLE = {text: 'Across the Street', top: 300, size: 72, cx: 514, bar: {x0: 304, x1: 724, y: 392, h: 2}} as const;

/** "Across the Street" (Fraunces 600, 72 px, ivory) + the 2 px brass threshold bar under it.
 *  rise 0..1 = the title's entrance; bar 0..1 = the bar drawing left → right. */
export const GeoTitle: React.FC<{rise: number; bar: number}> = ({rise, bar}) => {
  const r = clamp01(rise);
  const b = clamp01(bar);
  const w = (TITLE.bar.x1 - TITLE.bar.x0) * b;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: TITLE.cx - 400,
          width: 800,
          top: TITLE.top - 14,
          textAlign: 'center',
          fontFamily: FONT.display,
          fontWeight: 600,
          fontSize: TITLE.size,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          color: NIGHT.ivory,
          opacity: clamp01(r * 1.6),
          transform: `translateY(${(1 - r) * 64}px)`,
          textShadow: `0 2px 0 ${NIGHT.ink}, 0 0 28px ${NIGHT.ink}`,
          whiteSpace: 'nowrap',
        }}
      >
        {TITLE.text}
      </div>
      {b > 0 ? (
        <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
          <rect x={TITLE.bar.x0} y={TITLE.bar.y - TITLE.bar.h / 2} width={w} height={TITLE.bar.h} fill={NIGHT.brass} />
          {/* bright travelling head while drawing */}
          {b < 1 ? <rect x={TITLE.bar.x0 + w - 18} y={TITLE.bar.y - TITLE.bar.h / 2} width={18} height={TITLE.bar.h} fill={NIGHT.brassLight} opacity={0.9} /> : null}
        </svg>
      ) : null}
    </>
  );
};

// ─── "Rita" label + arrow (drawn in set units, inside the crane's camera) ─────

const S = HIGHWAY.sedan;
/** Label anchor (text start, baseline) in set units: on the near lane, below-left of the sedan. */
export const LABEL = {x: 568, y: 1174, size: 30} as const;
// Arrow: from just right of the label, a loose hook up into the sedan's rear quarter.
const P0 = {x: 630, y: 1160};
const C1 = {x: 668, y: 1166};
const C2 = {x: 694, y: 1146};
const P3 = {x: S.x + S.w * 0.26, y: S.y + S.h + 3};

const N = 28;
const bez = (t: number) => {
  const u = 1 - t;
  return {
    x: u * u * u * P0.x + 3 * u * u * t * C1.x + 3 * u * t * t * C2.x + t * t * t * P3.x,
    y: u * u * u * P0.y + 3 * u * u * t * C1.y + 3 * u * t * t * C2.y + t * t * t * P3.y,
  };
};
// Wobbled points along the curve (deterministic: random(seed) phases), pinned at both ends.
const ARROW_PTS = (() => {
  const ph1 = random('geo-arrow-a') * Math.PI * 2;
  const ph2 = random('geo-arrow-b') * Math.PI * 2;
  const pts: {x: number; y: number}[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = bez(t);
    const q = bez(Math.min(1, t + 0.01));
    const p0 = bez(Math.max(0, t - 0.01));
    const dx = q.x - p0.x;
    const dy = q.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const env = Math.sin(Math.PI * t);
    const wob = env * (1.4 * Math.sin(t * 9 + ph1) + 0.8 * Math.sin(t * 23 + ph2));
    pts.push({x: p.x - (dy / len) * wob, y: p.y + (dx / len) * wob});
  }
  return pts;
})();
const TIP = ARROW_PTS[N];
const TIP_DIR = (() => {
  const a = ARROW_PTS[N - 3];
  const len = Math.hypot(TIP.x - a.x, TIP.y - a.y);
  return {x: (TIP.x - a.x) / len, y: (TIP.y - a.y) / len};
})();

const partial = (p: number) => {
  const k = clamp01(p) * N;
  const i = Math.floor(k);
  const out = ARROW_PTS.slice(0, i + 1);
  if (i < N) {
    const a = ARROW_PTS[i];
    const b = ARROW_PTS[i + 1];
    const fr = k - i;
    out.push({x: a.x + (b.x - a.x) * fr, y: a.y + (b.y - a.y) * fr});
  }
  return out;
};
const toD = (pts: {x: number; y: number}[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

/** Arrowhead barbs: two short hand strokes, each grows 0..1. */
const barb = (side: 1 | -1, k: number) => {
  // rotate the reversed direction by ±32° (slightly uneven, like a hand)
  const ang = (side * (side > 0 ? 32 : 28) * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const vx = -TIP_DIR.x;
  const vy = -TIP_DIR.y;
  const rx = vx * cos - vy * sin;
  const ry = vx * sin + vy * cos;
  const L = 15 * clamp01(k) * (side > 0 ? 1 : 0.88);
  return `M${TIP.x.toFixed(1)} ${TIP.y.toFixed(1)} L${(TIP.x + rx * L).toFixed(1)} ${(TIP.y + ry * L).toFixed(1)}`;
};

/** The label "Rita" and the ivory arrow to her sedan, in set units (put it inside the crane camera transform).
 *  label 0..1 = label entrance; draw 0..1 = arrow stroke; head 0..1 = arrowhead barbs. */
export const RitaCarLabel: React.FC<{label: number; draw: number; head: number}> = ({label, draw, head}) => {
  const l = clamp01(label);
  const d = clamp01(draw);
  const h = clamp01(head);
  const line = d > 0 ? toD(partial(d)) : '';
  const barbs = h > 0 ? `${barb(1, h)} ${barb(-1, Math.max(0, h * 1.25 - 0.25))}` : '';
  return (
    <g>
      {l > 0 ? (
        <text
          x={LABEL.x}
          y={LABEL.y + (1 - l) * 10}
          fontFamily={FONT.ui}
          fontWeight={600}
          fontSize={LABEL.size}
          fill={NIGHT.ivory}
          opacity={l}
          style={{paintOrder: 'stroke'}}
          stroke={NIGHT.ink}
          strokeOpacity={0.55}
          strokeWidth={6}
          strokeLinejoin="round"
        >
          Rita
        </text>
      ) : null}
      {line ? (
        <>
          <path d={`${line} ${barbs}`} fill="none" stroke={NIGHT.ink} strokeOpacity={0.5} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
          <path d={`${line} ${barbs}`} fill="none" stroke={NIGHT.ivory} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
    </g>
  );
};
