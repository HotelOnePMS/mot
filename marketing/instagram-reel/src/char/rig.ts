// Small geometry kit for the character rigs (char/Rita.tsx, char/Gus.tsx):
// smooth closed shapes from control points, tapered limbs, two-bone IK and
// pose blending. Pure functions, deterministic, no React.

export type P = readonly [number, number];
/** A control point; a third value of 1 makes it a hard corner. */
export type C = readonly [number, number] | readonly [number, number, 1];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const clamp01 = (x: number) => clamp(x, 0, 1);
export const lerpP = (a: P, b: P, t: number): P => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
export const scaleP = (a: P, k: number): P => [a[0] * k, a[1] * k];
export const len = (a: P) => Math.hypot(a[0], a[1]);
export const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a: P): P => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
export const perp = (a: P): P => [-a[1], a[0]];
const D2R = Math.PI / 180;
/** Rotate p about c by deg (SVG sense: positive = clockwise on screen). */
export const rot = (p: P, deg: number, c: P = [0, 0]): P => {
  const r = deg * D2R;
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(r) - y * Math.sin(r), c[1] + x * Math.sin(r) + y * Math.cos(r)];
};
export const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

/**
 * A smooth path through control points (Catmull-Rom → cubic Bézier). Points
 * flagged as corners break the curve there. `closed` joins the last to the first.
 */
export const shape = (pts: readonly C[], closed = true, tension = 1): string => {
  const n = pts.length;
  if (n < 2) return '';
  const at = (i: number): C => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  const isCorner = (i: number) => {
    const p = at(i);
    return p.length === 3;
  };
  let d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const k = tension / 6;
    // a corner end has a zero tangent on its side
    const t1: P = isCorner(i) || (!closed && i === 0) ? [0, 0] : [(p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k];
    const t2: P = isCorner(i + 1) || (!closed && i + 1 === n - 1) ? [0, 0] : [(p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k];
    d += ` C${n2(p1[0] + t1[0])} ${n2(p1[1] + t1[1])} ${n2(p2[0] - t2[0])} ${n2(p2[1] - t2[1])} ${n2(p2[0])} ${n2(p2[1])}`;
  }
  return closed ? `${d} Z` : d;
};

/** Map control points through a function (rotate/translate a shape before drawing). */
export const mapC = (pts: readonly C[], fn: (p: P) => P): C[] =>
  pts.map((p) => {
    const q = fn([p[0], p[1]]);
    return p.length === 3 ? ([q[0], q[1], 1] as const) : ([q[0], q[1]] as const);
  });

/** Blend two control-point lists of equal length (shape keys). */
export const blendC = (a: readonly C[], b: readonly C[], t: number): C[] =>
  a.map((p, i) => {
    const q = b[i] ?? p;
    const x = lerp(p[0], q[0], t);
    const y = lerp(p[1], q[1], t);
    return p.length === 3 ? ([x, y, 1] as const) : ([x, y] as const);
  });

/**
 * Two-bone IK: from root `a` reach toward `target` with bone lengths l1, l2.
 * `bend` = +1 / -1 picks which side the middle joint bends to. Returns [mid, end].
 */
export const ik = (a: P, target: P, l1: number, l2: number, bend: 1 | -1): [P, P] => {
  const d = sub(target, a);
  const L = clamp(len(d), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const dir = norm(d);
  const end = add(a, scaleP(dir, L));
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pp = perp(dir);
  const mid = add(add(a, scaleP(dir, x)), scaleP(pp, h * bend));
  return [mid, end];
};

/**
 * A tapered tube along a polyline (an arm in a sleeve): widths per point.
 * Returns the outline as control points for shape(): down one side, round the
 * end, back up the other. `capEnd` rounds the far end.
 */
export const tube = (pts: readonly P[], widths: readonly number[], capEnd = true, capStart = false): C[] => {
  const n = pts.length;
  const L: P[] = [];
  const R: P[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const dir = norm(sub(next, prev));
    const nrm = perp(dir);
    const w = widths[i] / 2;
    L.push(add(pts[i], scaleP(nrm, w)));
    R.push(add(pts[i], scaleP(nrm, -w)));
  }
  const out: C[] = [];
  if (capStart) {
    const d0 = norm(sub(pts[0], pts[1]));
    out.push(add(pts[0], scaleP(d0, widths[0] * 0.35)));
  }
  out.push(...L);
  if (capEnd) {
    const dn = norm(sub(pts[n - 1], pts[n - 2]));
    out.push(add(pts[n - 1], scaleP(dn, widths[n - 1] * 0.42)));
  }
  out.push(...[...R].reverse());
  return out;
};

/** Point along a quadratic arc from a to b bulging by `bulge` (perpendicular, px) at t. */
export const arc = (a: P, b: P, bulge: number, t: number): P => {
  const m = lerpP(a, b, 0.5);
  const c = add(m, scaleP(perp(norm(sub(b, a))), bulge));
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};

/** Angle of a vector in degrees (SVG sense). */
export const angle = (v: P) => Math.atan2(v[1], v[0]) / D2R;

/** `translate(x y) rotate(deg) scale(s)` for placing a local drawing at a point. */
export const place = (p: P, deg = 0, s = 1, sy?: number) => `translate(${n2(p[0])} ${n2(p[1])}) rotate(${n2(deg)}) scale(${n2(s)} ${n2(sy ?? s)})`;

/** Breathing offset (px) for time t (s) at `hz`, amplitude `amp`: a smooth sine. */
export const breath = (t: number, hz: number, amp: number) => Math.sin(t * hz * Math.PI * 2) * amp;
