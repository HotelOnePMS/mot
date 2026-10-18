// Single-stroke handwriting for the sets: Rita's pen on the steno pad and the
// marker on her FRONT DESK tape. Each glyph is a few strokes through control
// points (Catmull-Rom), sampled into polylines so a progress value can draw
// them exactly like a pen: constant speed, stroke after stroke, in order.
// Deterministic: all wobble comes from random(seed) (remotion).
import {random} from 'remotion';

export type Pt = readonly [number, number];
/** A control point; a third value of 1 marks a hard corner (the curve turns sharply there). */
type Ctl = readonly [number, number] | readonly [number, number, 1];
type Glyph = {w: number; strokes: readonly (readonly Ctl[])[]};

// Unit box: x right, y down; y = 0 is cap height, y = 1 the baseline, x-height ≈ 0.45.
const G: Record<string, Glyph> = {
  '0': {w: 0.6, strokes: [[[0.34, 0.02], [0.1, 0.18], [0.05, 0.6], [0.24, 0.98], [0.46, 0.86], [0.54, 0.42], [0.42, 0.04], [0.26, 0.06]]]},
  '1': {w: 0.42, strokes: [[[0.06, 0.24], [0.3, 0.0, 1], [0.27, 1.0]]]},
  '2': {w: 0.58, strokes: [[[0.06, 0.24], [0.26, 0.02], [0.48, 0.1], [0.48, 0.36], [0.26, 0.66], [0.03, 0.98, 1], [0.55, 0.96]]]},
  '3': {w: 0.56, strokes: [[[0.06, 0.12], [0.3, 0.0], [0.5, 0.14], [0.42, 0.38], [0.2, 0.47, 1], [0.48, 0.6], [0.5, 0.85], [0.28, 1.0], [0.03, 0.9]]]},
  '9': {w: 0.56, strokes: [[[0.5, 0.24], [0.34, 0.44], [0.1, 0.38], [0.08, 0.1], [0.3, 0.0], [0.5, 0.12], [0.52, 0.36], [0.46, 0.7], [0.36, 1.0]]]},
  s: {w: 0.46, strokes: [[[0.42, 0.52], [0.22, 0.45], [0.06, 0.57], [0.2, 0.71], [0.38, 0.82], [0.3, 0.98], [0.03, 0.94]]]},
  r: {w: 0.4, strokes: [[[0.06, 0.46], [0.06, 1.0]], [[0.06, 0.68], [0.18, 0.5], [0.38, 0.46]]]},
  i: {w: 0.24, strokes: [[[0.1, 0.5], [0.09, 1.0]], [[0.1, 0.27], [0.12, 0.3]]]},
  m: {w: 0.66, strokes: [[[0.05, 0.47], [0.05, 1.0]], [[0.05, 0.66], [0.18, 0.47], [0.31, 0.56], [0.31, 1.0]], [[0.31, 0.66], [0.45, 0.47], [0.58, 0.56], [0.59, 1.0]]]},
  "'": {w: 0.18, strokes: [[[0.1, 0.0], [0.06, 0.24]]]},
  '’': {w: 0.18, strokes: [[[0.1, 0.0], [0.06, 0.24]]]},
  $: {w: 0.52, strokes: [[[0.46, 0.16], [0.26, 0.06], [0.06, 0.2], [0.18, 0.44], [0.42, 0.6], [0.4, 0.86], [0.2, 0.94], [0.0, 0.84]], [[0.25, -0.08], [0.22, 1.08]]]},
  '?': {w: 0.5, strokes: [[[0.05, 0.2], [0.2, 0.0], [0.45, 0.08], [0.45, 0.3], [0.25, 0.5], [0.24, 0.72]], [[0.24, 0.92], [0.26, 0.97]]]},
  '!': {w: 0.22, strokes: [[[0.12, 0.0], [0.09, 0.72]], [[0.09, 0.92], [0.1, 0.97]]]},
  '(': {w: 0.32, strokes: [[[0.3, -0.06], [0.1, 0.4], [0.12, 0.8], [0.3, 1.08]]]},
  ')': {w: 0.32, strokes: [[[0.04, -0.06], [0.24, 0.4], [0.22, 0.8], [0.02, 1.08]]]},
  F: {w: 0.52, strokes: [[[0.08, 0.02], [0.06, 1.0]], [[0.08, 0.03], [0.5, 0.0]], [[0.07, 0.48], [0.38, 0.46]]]},
  I: {w: 0.24, strokes: [[[0.12, 0.0], [0.1, 1.0]]]},
  R: {w: 0.56, strokes: [[[0.07, 1.0], [0.07, 0.0]], [[0.07, 0.02], [0.36, 0.03], [0.5, 0.18], [0.42, 0.42], [0.08, 0.48]], [[0.24, 0.48], [0.52, 1.0]]]},
  O: {w: 0.64, strokes: [[[0.34, 0.0], [0.08, 0.18], [0.05, 0.7], [0.3, 1.0], [0.56, 0.78], [0.58, 0.24], [0.38, 0.0], [0.24, 0.04]]]},
  N: {w: 0.6, strokes: [[[0.07, 1.0], [0.07, 0.0, 1], [0.52, 1.0, 1], [0.53, 0.0]]]},
  T: {w: 0.54, strokes: [[[0.0, 0.03], [0.52, 0.0]], [[0.26, 0.01], [0.25, 1.0]]]},
  D: {w: 0.58, strokes: [[[0.07, 0.0], [0.07, 1.0]], [[0.07, 0.02], [0.32, 0.06], [0.52, 0.36], [0.47, 0.76], [0.26, 0.97], [0.07, 1.0]]]},
  E: {w: 0.5, strokes: [[[0.46, 0.0], [0.07, 0.01, 1], [0.07, 0.99, 1], [0.47, 1.0]], [[0.07, 0.5], [0.38, 0.49]]]},
  S: {w: 0.52, strokes: [[[0.46, 0.12], [0.26, 0.0], [0.05, 0.16], [0.16, 0.42], [0.42, 0.58], [0.48, 0.82], [0.28, 1.0], [0.02, 0.88]]]},
  K: {w: 0.54, strokes: [[[0.07, 0.0], [0.07, 1.0]], [[0.48, 0.0], [0.08, 0.56]], [[0.22, 0.42], [0.52, 1.0]]]},
  ' ': {w: 0.3, strokes: []},
};

/** Catmull-Rom through the points (corners split the run), sampled densely. */
const sample = (pts: readonly Pt[], corners: readonly boolean[], perSeg = 10): Pt[] => {
  const out: Pt[] = [];
  let start = 0;
  const runs: Array<[number, number]> = [];
  for (let i = 1; i < pts.length; i++) {
    if (corners[i] || i === pts.length - 1) {
      runs.push([start, i]);
      start = i;
    }
  }
  for (const [a, b] of runs) {
    const run = pts.slice(a, b + 1);
    for (let i = 0; i < run.length - 1; i++) {
      const p0 = run[Math.max(0, i - 1)];
      const p1 = run[i];
      const p2 = run[i + 1];
      const p3 = run[Math.min(run.length - 1, i + 2)];
      for (let k = i === 0 && out.length === 0 ? 0 : 1; k <= perSeg; k++) {
        const t = k / perSeg;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([x, y]);
      }
    }
  }
  if (!out.length && pts.length) out.push(pts[0], pts[0]);
  return out;
};

const lengthOf = (pl: readonly Pt[]) => {
  let L = 0;
  for (let i = 1; i < pl.length; i++) L += Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]);
  return L;
};

export type Stroke = {pts: Pt[]; len: number};
export type HandLayout = {strokes: Stroke[]; len: number; width: number};

export type HandOpts = {
  /** Cap height in units. */
  size: number;
  /** Baseline-left origin. */
  x?: number;
  y?: number;
  /** Forward slant (x shift per cap height). */
  slant?: number;
  /** Extra space between glyphs, in cap heights. */
  tracking?: number;
  /** Wobble amount, in cap heights (0 = clean). */
  jitter?: number;
  /** Rotation of the whole line in degrees, about its origin. */
  rotate?: number;
  seed?: string;
};

/** Lays a line of handwriting out as polylines (in drawing order). */
export const layoutHand = (text: string, o: HandOpts): HandLayout => {
  const {size, x = 0, y = 0, slant = 0.18, tracking = 0.06, jitter = 0.025, rotate = 0, seed = text} = o;
  const cos = Math.cos((rotate * Math.PI) / 180);
  const sin = Math.sin((rotate * Math.PI) / 180);
  const strokes: Stroke[] = [];
  let cx = 0;
  [...text].forEach((ch, gi) => {
    const g = G[ch] ?? G[' '];
    const r = (k: string) => random(`${seed}-${gi}-${k}`) * 2 - 1;
    const sc = 1 + r('s') * 0.05;
    const dy = r('y') * 0.035;
    const rot = r('r') * 0.06;
    g.strokes.forEach((st, si) => {
      const pts: Pt[] = [];
      const corners: boolean[] = [];
      st.forEach((c, pi) => {
        const jx = r(`x${si}${pi}`) * jitter;
        const jy = r(`j${si}${pi}`) * jitter;
        // glyph-local wobble rotation about its centre, then slant
        const gx = (c[0] - g.w / 2) * Math.cos(rot) - (c[1] - 0.5) * Math.sin(rot) + g.w / 2;
        const gy = (c[0] - g.w / 2) * Math.sin(rot) + (c[1] - 0.5) * Math.cos(rot) + 0.5;
        const ux = cx + gx * sc + jx + (1 - gy) * slant;
        const uy = (gy - 1) * sc + dy + jy; // baseline at 0
        const lx = ux * size;
        const ly = uy * size;
        pts.push([x + lx * cos - ly * sin, y + lx * sin + ly * cos]);
        corners.push(c.length === 3);
      });
      const pl = sample(pts, corners);
      strokes.push({pts: pl, len: lengthOf(pl)});
    });
    cx += g.w * sc + tracking;
  });
  return {strokes, len: strokes.reduce((a, s) => a + s.len, 0), width: cx * size};
};

/** A loose hand-drawn ellipse (a pen circling something), starting top-right and overshooting. */
export const handEllipse = (cx: number, cy: number, rx: number, ry: number, seed: string, turns = 1.12): HandLayout => {
  const n = 48;
  const pts: Pt[] = [];
  const a0 = -Math.PI * 0.32 + (random(`${seed}-a`) - 0.5) * 0.4;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 - t * turns * Math.PI * 2; // counter-clockwise like a right-handed pen
    const wob = 1 + Math.sin(t * 9 + random(`${seed}-p`) * 6) * 0.03 + t * 0.07;
    pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob - t * ry * 0.12]);
  }
  return {strokes: [{pts, len: lengthOf(pts)}], len: lengthOf(pts), width: rx * 2};
};

/** A slightly wavy hand-drawn line. */
export const handLine = (x1: number, y1: number, x2: number, y2: number, seed: string): HandLayout => {
  const n = 16;
  const pts: Pt[] = [];
  const amp = Math.hypot(x2 - x1, y2 - y1) * 0.012;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = Math.sin(t * Math.PI * 2 + random(seed) * 6) * amp;
    const nx = -(y2 - y1);
    const ny = x2 - x1;
    const nl = Math.hypot(nx, ny) || 1;
    pts.push([x1 + (x2 - x1) * t + (nx / nl) * w, y1 + (y2 - y1) * t + (ny / nl) * w + t * t * amp]);
  }
  return {strokes: [{pts, len: lengthOf(pts)}], len: lengthOf(pts), width: Math.abs(x2 - x1)};
};

/** A quick curved arrow (shaft, then the two head strokes). */
export const handArrow = (x1: number, y1: number, x2: number, y2: number, seed: string): HandLayout => {
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.28;
  const shaft = sample([[x1, y1], [mx, my], [x2, y2]], [false, false, false], 12);
  const ang = Math.atan2(y2 - shaft[shaft.length - 3][1], x2 - shaft[shaft.length - 3][0]);
  const hl = Math.hypot(x2 - x1, y2 - y1) * 0.28;
  const j = (random(seed) - 0.5) * 0.3;
  const h1: Pt[] = [[x2 - Math.cos(ang - 0.5 + j) * hl, y2 - Math.sin(ang - 0.5 + j) * hl], [x2, y2]];
  const h2: Pt[] = [[x2, y2], [x2 - Math.cos(ang + 0.5 + j) * hl, y2 - Math.sin(ang + 0.5 + j) * hl]];
  const strokes = [shaft, h1, h2].map((pts) => ({pts, len: lengthOf(pts)}));
  return {strokes, len: strokes.reduce((a, s) => a + s.len, 0), width: Math.abs(x2 - x1)};
};

/** Concatenates layouts so they draw one after another. */
export const joinHand = (...ls: HandLayout[]): HandLayout => {
  const strokes = ls.flatMap((l) => l.strokes);
  return {strokes, len: strokes.reduce((a, s) => a + s.len, 0), width: Math.max(0, ...ls.map((l) => l.width))};
};

const cut = (pts: readonly Pt[], L: number): Pt[] => {
  const out: Pt[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + d >= L) {
      const t = d ? (L - acc) / d : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      return out;
    }
    acc += d;
    out.push(pts[i]);
  }
  return out;
};

const toD = (pts: readonly Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('');

/** SVG path data for the part of a layout drawn by `progress` (0..1, by length). */
export const handPaths = (l: HandLayout, progress: number): string[] => {
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0) return [];
  let left = l.len * p;
  const out: string[] = [];
  for (const s of l.strokes) {
    if (left <= 0) break;
    if (left >= s.len) {
      out.push(toD(s.pts));
      left -= s.len;
    } else {
      out.push(toD(cut(s.pts, left)));
      left = 0;
    }
  }
  return out;
};

/** Where the pen tip is at `progress` (the end of the drawn ink). */
export const handTip = (l: HandLayout, progress: number): Pt => {
  const p = Math.max(0, Math.min(1, progress));
  let left = l.len * p;
  for (const s of l.strokes) {
    if (left <= s.len) {
      const c = cut(s.pts, left);
      return c[c.length - 1];
    }
    left -= s.len;
  }
  const last = l.strokes[l.strokes.length - 1];
  return last ? last.pts[last.pts.length - 1] : [0, 0];
};
