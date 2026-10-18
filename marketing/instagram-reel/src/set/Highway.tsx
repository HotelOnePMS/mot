// The highway between the two motels.
//
// variant 'crane' (S05): a high crane looking down the two-lane highway. The
// road recedes to a vanishing point and runs BETWEEN the lots: Rita's Motor
// Inn on the left (red), the Starlite Motor Court on the right (teal), their
// signs facing each other across the asphalt, Rita's sedan parked nose-in to
// Gus's office, and in Rita's own office window one tiny white rectangle
// pulsing at 1 Hz (her missed call).
//
// variant 'facade' (S27): Gus's view across the highway at Rita's Motor Inn,
// front-on: the red arrow sign top-left and her office plate glass with the
// S01 lobby inside (the shared Lobby set, red), her FRONT DESK phone glowing.
//
// Units are frame px at the shot's rest framing (crane end / S27), drawn
// oversize. The crane uses a real one-point projection (P below) so the
// geography holds up at phone size.
import React from 'react';
import {AbsoluteFill, random} from 'remotion';
import {NIGHT} from '../theme.ts';
import {LobbyArt, type LobbyProps} from './Lobby.tsx';
import {Glint, RitaSign, Sedan, StarliteSign, Stars, alpha, clamp01, mix, useUid} from './parts.tsx';

// ─── Projection (crane) ─────────────────────────────────────────────────────

const HZ = 560; // horizon y
const VPX = 540; // vanishing point x
const FOC = 990; // focal length, px
const CAM = 18.7; // camera height, m

type V = {x: number; y: number};
/** World (lateral m, height m, depth m) → frame px at the crane's rest framing. */
export const project = (lat: number, h: number, z: number): V => ({x: VPX + (lat * FOC) / z, y: HZ + ((CAM - h) * FOC) / z});
const pt = (v: V) => `${v.x.toFixed(1)} ${v.y.toFixed(1)}`;
const poly = (...vs: V[]) => `M${vs.map(pt).join(' L')} Z`;
/** A vertical rectangle on a plane of constant lateral (a facade), h0..h1 × z0..z1. */
const onFacade = (lat: number, h0: number, h1: number, z0: number, z1: number) => poly(project(lat, h0, z0), project(lat, h1, z0), project(lat, h1, z1), project(lat, h0, z1));
/** A rectangle on the ground (or at height h), lat0..lat1 × z0..z1. */
const onGround = (lat0: number, lat1: number, z0: number, z1: number, h = 0) => poly(project(lat0, h, z0), project(lat1, h, z0), project(lat1, h, z1), project(lat0, h, z1));

// World layout (m).
const ROAD = 4; // half width
const FACADE = 9.6; // lateral of each motel's road-side facade
const BACK = 19.6;
const NEAR = 31; // near end of each building
const FAR = 78;
const ROOF = 4.2;
const SIGN = {lat: 8.6, z: 27, top: 17.5, scale: 0.93};
const CAR = {lat0: 4.55, len: 4.85, z: 34};

/** Key positions in frame px at the crane's rest framing (for labels, arrows, rings). */
export const HIGHWAY = {
  vanishingPoint: {x: VPX, y: HZ},
  /** Rita's sedan in the Starlite lot (side view, nose-in to Gus's office). */
  sedan: (() => {
    const a = project(CAR.lat0, 0, CAR.z);
    const b = project(CAR.lat0 + CAR.len, 0, CAR.z);
    const h = (b.x - a.x) / 3;
    return {x: a.x, y: a.y - h, w: b.x - a.x, h, cx: (a.x + b.x) / 2, cy: a.y - h * 0.55};
  })(),
  /** Rita's office window (the one with the missed-call pulse). */
  ritaWindow: (() => {
    const a = project(-14.55, 2.55, NEAR);
    const b = project(-10.45, 0.85, NEAR);
    return {x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y};
  })(),
  /** The tiny white missed-call rectangle inside it. */
  missedGlow: (() => {
    const a = project(-11.65, 1.56, NEAR);
    const b = project(-11.25, 1.14, NEAR);
    return {x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2};
  })(),
  ritaSign: (() => {
    const c = project(-SIGN.lat, SIGN.top, SIGN.z);
    return {x: c.x - 130 * SIGN.scale, y: c.y, w: 260 * SIGN.scale, h: 320 * SIGN.scale};
  })(),
  starliteSign: (() => {
    const c = project(SIGN.lat, SIGN.top, SIGN.z);
    return {x: c.x - 130 * SIGN.scale, y: c.y, w: 260 * SIGN.scale, h: 320 * SIGN.scale};
  })(),
} as const;

export type HighwayCamera = {scale: number; x: number; y: number; ox?: number; oy?: number};
export const HIGHWAY_REST: HighwayCamera = {scale: 1, x: 0, y: 0};

export type HighwayProps = {
  /** 'crane' = S05 geography; 'facade' = S27 Rita's Motor Inn seen from the Starlite. */
  variant?: 'crane' | 'facade';
  /** Camera: scale about (ox, oy) (default frame centre 540, 960), then move by (x, y). S05 crane: {scale 1.25→1, y 180→0}. */
  camera?: HighwayCamera;
  /** 0..1 neon level of Rita's sign (flicker dips). */
  ritaNeon?: number;
  /** 0..1 neon level of the Starlite sign. */
  starliteNeon?: number;
  /** 0..1 Rita's missed-call glow in her office window (use missedPulse(t) from marks.ts). */
  missedPulse?: number;
  /** 0..1 extra teal glint flash on the sedan's windshield (a faint one is always there). */
  carGlint?: number;
  /** 'facade' only: props passed to the lobby inside Rita's window (phone state, ringPulse, buzz, screen, clock…). */
  lobby?: Omit<LobbyProps, 'crop'>;
};

const camT = (c: HighwayCamera) => {
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return `translate(${ox + c.x} ${oy + c.y}) scale(${c.scale}) translate(${-ox} ${-oy})`;
};

// ─── Crane ──────────────────────────────────────────────────────────────────

/** One motel block in perspective. side -1 = left (Rita), +1 = right (Starlite). */
const Motel: React.FC<{side: -1 | 1; color: string; soft: string; neon: number; pulse?: number; uid: string; label: string}> = ({side, color, soft, neon, pulse = 0, uid, label}) => {
  const s = side;
  const lit = clamp01(neon);
  const stucco = mix(NIGHT.wallLow, color, 0.1 + 0.08 * lit);
  const stuccoFar = mix(NIGHT.ink, NIGHT.wallLow, 0.6);
  const doorZs = [38.5, 43.2, 47.9, 52.6, 57.3, 62, 66.7, 71.4];
  const posts = [36.4, 42.6, 48.8, 55, 61.2, 67.4, 73.6];
  const gid = `${uid}${s > 0 ? 'r' : 'l'}`;
  const a0 = project(s * FACADE, 0, NEAR);
  const a1 = project(s * FACADE, 0, FAR);
  const r0 = project(s * FACADE, ROOF, NEAR);
  const r1 = project(s * BACK, ROOF, FAR);
  const fq = (l0: number, l1: number, h0: number, h1: number, z = NEAR) => poly(project(s * l0, h0, z), project(s * l0, h1, z), project(s * l1, h1, z), project(s * l1, h0, z));
  const office = project(s * 12.3, 3.75, NEAR);
  const pxm = FOC / NEAR;
  return (
    <g>
      <defs>
        <linearGradient id={`${gid}f`} x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={stucco} />
          <stop offset="1" stopColor={stuccoFar} />
        </linearGradient>
        <linearGradient id={`${gid}roof`} x1={r0.x} y1={r0.y} x2={r1.x} y2={r1.y} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(mix(NIGHT.wall, NIGHT.wallLow, 0.5), color, 0.1 * lit)} />
          <stop offset="1" stopColor={mix(NIGHT.ink, NIGHT.wall, 0.5)} />
        </linearGradient>
        <linearGradient id={`${gid}n`} x1="0" y1={project(0, ROOF, NEAR).y} x2="0" y2={project(0, 0, NEAR).y} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(stucco, color, 0.2 * lit)} />
          <stop offset="1" stopColor={mix(stucco, NIGHT.ink, 0.45)} />
        </linearGradient>
        <linearGradient id={`${gid}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(color, soft, 0.35)} />
          <stop offset="0.7" stopColor={mix(NIGHT.ink, color, 0.75)} />
          <stop offset="1" stopColor={mix(NIGHT.ink, color, 0.4)} />
        </linearGradient>
      </defs>
      {/* lot + stalls */}
      <path d={onGround(s * (ROAD + 0.4), s * 27, 6, FAR + 10)} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.55)} />
      <path d={onGround(s * (ROAD + 0.4), s * (ROAD + 0.62), 6, FAR + 10)} fill={alpha(NIGHT.grey, 0.12)} />
      {/* roof (seen from the crane) */}
      <path d={onGround(s * FACADE, s * BACK, NEAR, FAR, ROOF)} fill={`url(#${gid}roof)`} />
      {Array.from({length: 7}, (_, i) => NEAR + 6 + i * 6.5).map((z) => (
        <path key={z} d={onGround(s * (FACADE + 0.3), s * (BACK - 0.3), z, z + 0.12, ROOF)} fill={alpha(NIGHT.ink, 0.35)} />
      ))}
      {[[13.5, 40], [15.5, 57]].map(([lat, z]) => (
        <g key={z}>
          <path d={onGround(s * lat, s * (lat + 2.2), z, z + 2.6, ROOF + 1)} fill={mix(NIGHT.wallLow, NIGHT.grey, 0.12)} />
          <path d={onFacade(s * lat, ROOF, ROOF + 1, z, z + 2.6)} fill={mix(NIGHT.ink, NIGHT.wall, 0.5)} />
          <path d={poly(project(s * lat, ROOF, z), project(s * lat, ROOF + 1, z), project(s * (lat + 2.2), ROOF + 1, z), project(s * (lat + 2.2), ROOF, z))} fill={mix(NIGHT.ink, NIGHT.wall, 0.75)} />
        </g>
      ))}
      <path d={onGround(s * FACADE, s * (FACADE + 0.25), NEAR, FAR, ROOF)} fill={alpha(soft, 0.1 + 0.22 * lit)} />
      <path d={onGround(s * FACADE, s * BACK, NEAR, NEAR + 0.3, ROOF)} fill={alpha(soft, 0.15 + 0.3 * lit)} />
      {/* facade along the road */}
      <path d={onFacade(s * FACADE, 0, ROOF, NEAR, FAR)} fill={`url(#${gid}f)`} />
      <path d={onFacade(s * FACADE, 2.9, ROOF, NEAR + 5.2, FAR)} fill={alpha(NIGHT.ink, 0.45)} />
      {doorZs.map((z, i) => {
        const warm = random(`room-${label}-${i}`) > 0.7;
        return (
          <g key={z}>
            <path d={onFacade(s * (FACADE - 0.01), 0, 2.1, z, z + 1)} fill={mix(NIGHT.ink, NIGHT.wall, 0.6)} />
            <path d={onFacade(s * (FACADE - 0.01), 0.9, 2.0, z + 1.6, z + 3.4)} fill={warm ? mix(NIGHT.ink, NIGHT.brass, 0.4) : mix(NIGHT.ink, color, 0.12)} />
            <path d={onFacade(s * (FACADE - 0.01), 2.32, 2.5, z + 1.1, z + 1.32)} fill={NIGHT.brassLight} opacity={0.85} />
          </g>
        );
      })}
      <path d={onFacade(s * (FACADE - 0.01), 0.8, 2.7, NEAR + 0.5, NEAR + 4.4)} fill={`url(#${gid}w)`} opacity={0.5 + 0.5 * lit} />
      {posts.map((z) => (
        <path key={z} d={onFacade(s * 8.6, 0, 3.0, z, z + 0.2)} fill={mix(NIGHT.ink, NIGHT.wall, 0.4)} />
      ))}
      <path d={onGround(s * 8.5, s * FACADE, NEAR + 5.2, FAR, 3.5)} fill={mix(NIGHT.ink, NIGHT.wall, 0.8)} />
      <path d={onFacade(s * 8.5, 3.0, 3.5, NEAR + 5.2, FAR)} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.7)} />
      <path d={onFacade(s * 8.5, 3.06, 3.14, NEAR + 5.2, FAR)} fill={color} opacity={0.25 + 0.4 * lit} />
      {/* near end: the office front, facing down the road */}
      <path d={fq(FACADE, BACK, 0, ROOF)} fill={`url(#${gid}n)`} />
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => (
        <path key={k} d={fq(FACADE + k * 1.05, FACADE + k * 1.05 + 0.03, 0, ROOF)} fill={alpha(NIGHT.ink, 0.12)} />
      ))}
      <path d={fq(10.3, 14.7, 0.75, 2.65)} fill={mix(NIGHT.ink, NIGHT.wall, 0.5)} />
      <path d={fq(10.45, 14.55, 0.85, 2.55)} fill={`url(#${gid}w)`} opacity={0.55 + 0.45 * lit} />
      <path d={fq(10.45, 14.55, 0.85, 1.12)} fill={alpha(NIGHT.ink, 0.7)} />
      <path d={fq(12.44, 12.56, 0.85, 2.55)} fill={mix(NIGHT.ink, NIGHT.wall, 0.5)} />
      {s < 0 && pulse > 0.001 ? (
        <>
          <path d={fq(11.0, 11.9, 1.0, 1.85)} fill={NIGHT.phoneBloom} opacity={0.3 * pulse} />
          <path d={fq(11.25, 11.65, 1.14, 1.56)} fill={NIGHT.phoneGlow} opacity={0.2 + 0.8 * pulse} />
        </>
      ) : null}
      <path d={fq(15.3, 16.4, 0, 2.35)} fill={mix(NIGHT.ink, color, 0.3 + 0.3 * lit)} />
      <path d={fq(15.3, 16.4, 1.1, 1.18)} fill={alpha(NIGHT.grey, 0.5)} />
      {/* neon strip along the office front */}
      <path d={fq(FACADE, BACK, 3.02, 3.14)} fill={color} opacity={0.4 + 0.6 * lit} />
      {/* OFFICE sign */}
      <path d={fq(10.9, 13.7, 3.45, 4.08)} fill={NIGHT.ink} />
      <text x={office.x} y={office.y + 0.12 * pxm} textAnchor="middle" fontFamily="'Inter Tight', sans-serif" fontWeight={800} fontSize={0.42 * pxm} letterSpacing={0.06 * pxm} fill={mix(mix(NIGHT.ink, color, 0.4), soft, lit)}>
        OFFICE
      </text>
      <path d={onFacade(s * FACADE, 0, ROOF, NEAR, NEAR + 0.01)} fill="none" stroke={alpha(soft, 0.45 * lit)} strokeWidth={1.6} />
    </g>
  );
};

/** Low desert scrub along the lots (static silhouettes). */
const Scrub: React.FC = () => (
  <g fill={mix(NIGHT.ink, NIGHT.wall, 0.35)}>
    {Array.from({length: 26}, (_, i) => {
      const side = i % 2 ? 1 : -1;
      const lat = side * (23 + random(`sc-l${i}`) * 9);
      const z = 14 + random(`sc-z${i}`) * 80;
      const p = project(lat, 0, z);
      const r = (0.9 + random(`sc-r${i}`) * 0.9) * (FOC / z);
      return <ellipse key={i} cx={p.x} cy={p.y - r * 0.35} rx={r} ry={r * 0.5} />;
    })}
  </g>
);

/** Asphalt wear: darker wheel tracks per lane, a few patched squares and cracks near the camera. */
const RoadWear: React.FC = () => (
  <g>
    {[-3.0, -1.0, 1.0, 3.0].map((lat) => (
      <path key={lat} d={onGround(lat - 0.45, lat + 0.45, 8, 900)} fill={alpha(NIGHT.ink, 0.22)} />
    ))}
    {Array.from({length: 6}, (_, i) => {
      const z0 = 9 + random(`crack-z${i}`) * 20;
      const lat0 = -3.5 + random(`crack-l${i}`) * 7;
      const pts = Array.from({length: 5}, (_, k) => project(lat0 + (random(`crack-${i}-${k}`) - 0.5) * 0.8 + k * 0.25, 0, z0 + k * 0.9));
      return <path key={i} d={`M${pts.map(pt).join(' L')}`} fill="none" stroke={alpha(NIGHT.ink, 0.6)} strokeWidth={1.2} />;
    })}
  </g>
);

/** Road-edge reflectors catching each motel's neon. */
const Reflectors: React.FC<{rN: number; sN: number}> = ({rN, sN}) => (
  <g>
    {Array.from({length: 18}, (_, i) => 10 + i * 8).map((z) =>
      [-1, 1].map((sd) => {
        const p = project(sd * (ROAD - 0.05), 0, z);
        const near = Math.max(0, 1 - Math.abs(z - 30) / 45);
        const c = sd < 0 ? NIGHT.red : NIGHT.teal;
        const k = sd < 0 ? rN : sN;
        return <circle key={`${z}${sd}`} cx={p.x} cy={p.y} r={Math.max(0.8, (0.09 * FOC) / z)} fill={c} opacity={(0.15 + 0.75 * near) * (0.3 + 0.7 * k)} />;
      }),
    )}
  </g>
);

const Crane: React.FC<Required<Pick<HighwayProps, 'ritaNeon' | 'starliteNeon' | 'missedPulse' | 'carGlint'>> & {uid: string}> = ({ritaNeon, starliteNeon, missedPulse, carGlint, uid}) => {
  const rN = clamp01(ritaNeon);
  const sN = clamp01(starliteNeon);
  const dashes = (() => {
    const out: string[] = [];
    for (let z = 9; z < 700; z += 9) out.push(onGround(-0.09, 0.09, z, z + 3.2));
    return out;
  })();
  const poles = [90, 140, 200, 280, 380, 520];
  const poleTop = (lat: number, z: number) => project(lat, 9.2, z);
  const wire = (lat: number, dh: number) =>
    poles
      .map((z, i) => {
        const p = project(lat, 9.2 - dh, z);
        if (i === 0) return `M${pt(p)}`;
        const prev = project(lat, 9.2 - dh, poles[i - 1]);
        return `Q${((p.x + prev.x) / 2).toFixed(1)} ${((p.y + prev.y) / 2 + 6 * (FOC / z) * 0.06).toFixed(1)} ${pt(p)}`;
      })
      .join(' ');
  const rS = HIGHWAY.ritaSign;
  const sS = HIGHWAY.starliteSign;
  const ritaBase = project(-SIGN.lat, 0, SIGN.z);
  const starBase = project(SIGN.lat, 0, SIGN.z);
  const car = HIGHWAY.sedan;
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}sky`} x1="0" y1="-420" x2="0" y2={HZ} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} />
          <stop offset="0.7" stopColor={mix(NIGHT.ink, NIGHT.wall, 0.7)} />
          <stop offset="1" stopColor={mix(NIGHT.wall, NIGHT.wallLow, 0.8)} />
        </linearGradient>
        <linearGradient id={`${uid}gnd`} x1="0" y1={HZ} x2="0" y2="2100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.wall, NIGHT.wallLow, 0.4)} />
          <stop offset="0.25" stopColor={mix(NIGHT.ink, NIGHT.wall, 0.6)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={`${uid}road`} x1="0" y1={HZ} x2="0" y2="2100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.wall, NIGHT.grey, 0.06)} />
          <stop offset="0.3" stopColor={mix(NIGHT.ink, '#131720', 0.9)} />
          <stop offset="1" stopColor={mix(NIGHT.ink, '#131720', 0.5)} />
        </linearGradient>
        <radialGradient id={`${uid}hl`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset="0" stopColor={NIGHT.red} stopOpacity={0.5} />
          <stop offset="0.5" stopColor={NIGHT.red} stopOpacity={0.16} />
          <stop offset="1" stopColor={NIGHT.red} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${uid}hr`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset="0" stopColor={NIGHT.teal} stopOpacity={0.5} />
          <stop offset="0.5" stopColor={NIGHT.teal} stopOpacity={0.16} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${uid}glow`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset="0" stopColor={NIGHT.grey} stopOpacity={0.12} />
          <stop offset="1" stopColor={NIGHT.grey} stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* sky */}
      <rect x={-300} y={-420} width={1680} height={HZ + 420} fill={`url(#${uid}sky)`} />
      <Stars x={-300} y={-400} w={1680} h={820} n={90} seed="crane" size={1.5} opacity={0.75} />
      <ellipse cx={VPX} cy={HZ} rx={700} ry={90} fill={`url(#${uid}glow)`} />
      <ellipse cx={rS.x + rS.w / 2} cy={HZ - 10} rx={420} ry={160} fill={`url(#${uid}hl)`} opacity={0.35 * rN} />
      <ellipse cx={sS.x + sS.w / 2} cy={HZ - 10} rx={420} ry={160} fill={`url(#${uid}hr)`} opacity={0.35 * sN} />
      {/* far mesas */}
      <path d={`M-300 ${HZ} L-300 ${HZ - 26} L-120 ${HZ - 30} L-90 ${HZ - 52} L60 ${HZ - 54} L84 ${HZ - 30} L230 ${HZ - 26} L262 ${HZ - 12} L420 ${HZ - 10} L440 ${HZ} Z`} fill={mix(NIGHT.ink, NIGHT.wall, 0.8)} />
      <path d={`M640 ${HZ} L662 ${HZ - 14} L760 ${HZ - 16} L782 ${HZ - 40} L900 ${HZ - 42} L930 ${HZ - 22} L1100 ${HZ - 20} L1120 ${HZ - 34} L1380 ${HZ - 36} L1380 ${HZ} Z`} fill={mix(NIGHT.ink, NIGHT.wall, 0.8)} />
      {/* ground, road */}
      <rect x={-300} y={HZ} width={1680} height={2100 - HZ} fill={`url(#${uid}gnd)`} />
      <path d={onGround(-ROAD, ROAD, 8, 4000)} fill={`url(#${uid}road)`} />
      <path d={onGround(-ROAD + 0.15, -ROAD + 0.3, 8, 4000)} fill={alpha(NIGHT.grey, 0.18)} />
      <path d={onGround(ROAD - 0.3, ROAD - 0.15, 8, 4000)} fill={alpha(NIGHT.grey, 0.18)} />
      {dashes.map((d, i) => (
        <path key={i} d={d} fill="#2b303b" />
      ))}
      {/* neon pools on the ground and the road edges */}
      <ellipse cx={ritaBase.x + 40} cy={ritaBase.y - 120} rx={380} ry={150} fill={`url(#${uid}hl)`} opacity={0.9 * rN} />
      <ellipse cx={starBase.x - 40} cy={starBase.y - 120} rx={380} ry={150} fill={`url(#${uid}hr)`} opacity={0.9 * sN} />
      {/* far poles + wires */}
      {[6.2].map((lat) => (
        <g key={lat}>
          {poles.map((z) => {
            const top = poleTop(lat, z);
            const base = project(lat, 0, z);
            const w = Math.max(1, (0.3 * FOC) / z);
            const arm = (1.6 * FOC) / z;
            return (
              <g key={z} fill={NIGHT.ink}>
                <rect x={top.x - w / 2} y={top.y} width={w} height={base.y - top.y} />
                <rect x={top.x - arm} y={top.y + w} width={arm * 2} height={Math.max(1, w * 0.5)} />
              </g>
            );
          })}
          <path d={wire(lat, 0)} fill="none" stroke={alpha(NIGHT.ink, 0.95)} strokeWidth={1.3} />
          <path d={wire(lat + (lat > 0 ? 1.2 : -1.2), 0.1)} fill="none" stroke={alpha(NIGHT.ink, 0.95)} strokeWidth={1.1} />
        </g>
      ))}
      {/* distant taillights */}
      {[-2.2, -1.1].map((lat) => {
        const p = project(lat, 0.8, 640);
        return <circle key={lat} cx={p.x} cy={p.y} r={1.6} fill={NIGHT.red} opacity={0.8} />;
      })}
      {/* the motels */}
      <Scrub />
      <RoadWear />
      <Reflectors rN={rN} sN={sN} />
      <Motel side={-1} color={NIGHT.red} soft={NIGHT.redSoft} neon={rN} pulse={missedPulse} uid={uid} label="rita" />
      <Motel side={1} color={NIGHT.teal} soft={NIGHT.tealSoft} neon={sN} uid={uid} label="starlite" />
      {/* Rita's sedan, nose-in to Gus's office */}
      <g transform={`translate(${car.x} ${car.y - car.h * 0.0}) scale(${car.w / 300})`}>
        <Sedan rim={NIGHT.teal} rimAmount={0.55 + 0.4 * sN} />
      </g>
      <g transform={`translate(${car.x + car.w * 0.71} ${car.y + car.h * 0.27})`}>
        <Glint size={12 + 26 * clamp01(carGlint)} amount={0.55 + 0.45 * clamp01(carGlint)} color={mix(NIGHT.tealSoft, NIGHT.ivory, 0.6)} />
      </g>
      {/* the two signs, turned slightly to face each other across the road */}
      <g transform={`translate(${rS.x} ${rS.y}) matrix(${SIGN.scale * 0.95} ${-0.05 * SIGN.scale} 0 ${SIGN.scale} 0 0)`}>
        <RitaSign on={rN} pole={(ritaBase.y - rS.y) / SIGN.scale - 300} />
      </g>
      <g transform={`translate(${sS.x} ${sS.y}) matrix(${SIGN.scale * 0.95} ${0.05 * SIGN.scale} 0 ${SIGN.scale} ${0.05 * 260 * SIGN.scale} ${-0.05 * 260 * SIGN.scale * 0.95})`}>
        <StarliteSign on={sN} pole={(starBase.y - sS.y) / SIGN.scale - 300} />
      </g>
    </g>
  );
};

// ─── Facade (S27) ───────────────────────────────────────────────────────────

/** Native box of the facade art (frame px of the S27 rest framing). */
export const FACADE_BOX = {x0: -260, y0: -200, x1: 1340, y1: 2120} as const;
/** Where Rita's office plate window sits in the facade art. */
export const FACADE_WINDOW = {x: 290, y: 820, w: 580, h: 340} as const;

/**
 * Rita's Motor Inn seen front-on from across the highway: the red arrow sign
 * top-left, the canopy with its neon strip, her office plate glass with the
 * shared Lobby set inside, the glass door with her neon window sign, the road
 * in the foreground. An SVG <g> in FACADE_BOX units; CarInterior's rearview
 * mirror reuses it mirrored and small.
 */
export const RitasMotelFacade: React.FC<{neon?: number; lobby?: Omit<LobbyProps, 'crop'>; road?: boolean}> = ({neon = 1, lobby, road = true}) => {
  const uid = useUid('rf');
  const lit = clamp01(neon);
  const W = FACADE_WINDOW;
  const C = NIGHT.red;
  const stucco = mix(NIGHT.wallLow, C, 0.14 + 0.1 * lit);
  // map the lobby's counter/phone region into the window
  const ls = 0.66;
  const lobbyT = `translate(${W.x + W.w * 0.46} ${W.y + W.h * 0.46}) scale(${ls}) translate(-505 -895)`;
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}sky`} x1="0" y1={FACADE_BOX.y0} x2="0" y2="640" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} />
          <stop offset="1" stopColor={mix(NIGHT.wall, C, 0.12 * lit)} />
        </linearGradient>
        <linearGradient id={`${uid}wall`} x1="0" y1="640" x2="0" y2="1200" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(stucco, NIGHT.ink, 0.35)} />
          <stop offset="0.5" stopColor={stucco} />
          <stop offset="1" stopColor={mix(stucco, NIGHT.ink, 0.25)} />
        </linearGradient>
        <radialGradient id={`${uid}halo`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset="0" stopColor={C} stopOpacity={0.4} />
          <stop offset="0.5" stopColor={C} stopOpacity={0.12} />
          <stop offset="1" stopColor={C} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${uid}road`} x1="0" y1="1240" x2="0" y2={FACADE_BOX.y1} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, '#131720', 0.9)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={`${uid}streak`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={NIGHT.ivory} stopOpacity={0} />
          <stop offset="0.5" stopColor={NIGHT.ivory} stopOpacity={0.06} />
          <stop offset="1" stopColor={NIGHT.ivory} stopOpacity={0} />
        </linearGradient>
        <clipPath id={`${uid}win`}>
          <rect x={W.x} y={W.y} width={W.w} height={W.h} />
        </clipPath>
        <filter id={`${uid}b`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={4} />
        </filter>
      </defs>
      {/* sky + stars */}
      <rect x={FACADE_BOX.x0} y={FACADE_BOX.y0} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={900} fill={`url(#${uid}sky)`} />
      <Stars x={FACADE_BOX.x0} y={FACADE_BOX.y0} w={FACADE_BOX.x1 - FACADE_BOX.x0} h={760} n={60} seed="facade" size={1.4} opacity={0.6} />
      <ellipse cx={200} cy={560} rx={520} ry={380} fill={`url(#${uid}halo)`} opacity={0.7 * lit} />
      {/* building */}
      <rect x={FACADE_BOX.x0} y={720} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={480} fill={`url(#${uid}wall)`} />
      {/* roof edge + canopy fascia with the neon strip */}
      <rect x={FACADE_BOX.x0} y={676} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={48} fill={mix(NIGHT.ink, NIGHT.wall, 0.6)} />
      <rect x={FACADE_BOX.x0} y={676} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={3} fill={alpha(NIGHT.redSoft, 0.25 * lit)} />
      <rect x={FACADE_BOX.x0} y={716} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={6} fill={C} opacity={0.35 + 0.6 * lit} />
      <rect x={FACADE_BOX.x0} y={710} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={18} fill={C} opacity={0.18 * lit} filter={`url(#${uid}b)`} />
      <rect x={FACADE_BOX.x0} y={724} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={40} fill={alpha(NIGHT.ink, 0.35)} />
      {/* room doors to the right, beyond the office */}
      {[1050, 1230].map((x, i) => (
        <g key={x}>
          <rect x={x} y={900} width={80} height={280} fill={mix(NIGHT.ink, NIGHT.wall, 0.7)} />
          <rect x={x + 6} y={906} width={68} height={274} fill="none" stroke={alpha(NIGHT.redSoft, 0.12)} strokeWidth={2} />
          <circle cx={x + 66} cy={1050} r={4} fill={NIGHT.brass} opacity={0.6} />
          <text x={x + 40} y={950} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontWeight={700} fontSize={22} fill={alpha(NIGHT.brass, 0.6)}>
            {`${i + 1}`}
          </text>
          <circle cx={x + 40} cy={870} r={6} fill={NIGHT.brassLight} opacity={0.8} />
          <ellipse cx={x + 40} cy={900} rx={60} ry={40} fill={NIGHT.brassLight} opacity={0.06} />
        </g>
      ))}
      {[-210, -70, 70].map((x) => (
        <g key={x}>
          <rect x={x} y={900} width={80} height={280} fill={mix(NIGHT.ink, NIGHT.wall, 0.7)} />
          <circle cx={x + 40} cy={870} r={5} fill={NIGHT.brassLight} opacity={0.5} />
        </g>
      ))}
      {/* office plate window with the lobby inside */}
      <rect x={W.x - 18} y={W.y - 18} width={W.w + 36} height={W.h + 36} fill={mix(NIGHT.ink, NIGHT.wall, 0.4)} />
      <g clipPath={`url(#${uid}win)`}>
        <rect x={W.x} y={W.y} width={W.w} height={W.h} fill={NIGHT.ink} />
        <g transform={lobbyT}>
          <LobbyArt tint="red" windowView="none" {...lobby} />
        </g>
        <path d={`M${W.x + 60} ${W.y + W.h} L${W.x + 260} ${W.y} L${W.x + 330} ${W.y} L${W.x + 130} ${W.y + W.h} Z`} fill={`url(#${uid}streak)`} />
        <path d={`M${W.x + 380} ${W.y + W.h} L${W.x + 560} ${W.y} L${W.x + 590} ${W.y} L${W.x + 410} ${W.y + W.h} Z`} fill={`url(#${uid}streak)`} />
        <rect x={W.x} y={W.y} width={W.w} height={W.h} fill={C} opacity={0.06} />
      </g>
      <rect x={W.x - 18} y={W.y - 18} width={W.w + 36} height={4} fill={alpha(NIGHT.redSoft, 0.45 * lit)} />
      <rect x={W.x + 26} y={W.y} width={6} height={W.h} fill={mix(NIGHT.ink, NIGHT.wall, 0.4)} />
      {/* glass door with her neon window sign (read from outside: the right way round) */}
      <rect x={900} y={830} width={120} height={350} fill={mix(NIGHT.ink, NIGHT.wall, 0.45)} />
      <rect x={910} y={840} width={100} height={340} fill={mix(NIGHT.ink, C, 0.22)} />
      <ellipse cx={960} cy={920} rx={70} ry={60} fill={C} opacity={0.25 * lit} filter={`url(#${uid}b)`} />
      <g transform="translate(960 0)">
        <rect x={-44} y={880} width={88} height={74} rx={10} fill="none" stroke={C} strokeWidth={2.4} opacity={0.4 + 0.6 * lit} />
        <text x={0} y={916} textAnchor="middle" fontFamily="'Fraunces', serif" fontStyle="italic" fontWeight={700} fontSize={30} fill={mix(mix(NIGHT.ink, C, 0.4), NIGHT.redSoft, lit)} stroke={C} strokeWidth={0.8} paintOrder="stroke">
          Rita’s
        </text>
        <text x={0} y={940} textAnchor="middle" fontFamily="'Inter Tight', sans-serif" fontWeight={800} fontSize={12} letterSpacing={1.2} fill={mix(mix(NIGHT.ink, C, 0.4), NIGHT.redSoft, lit)}>
          MOTOR INN
        </text>
      </g>
      <rect x={916} y={1070} width={88} height={8} rx={4} fill={mix(NIGHT.ink, NIGHT.grey, 0.4)} />
      {/* walkway + curb */}
      <rect x={FACADE_BOX.x0} y={1180} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={30} fill={mix(NIGHT.wallLow, C, 0.08)} />
      <rect x={FACADE_BOX.x0} y={1180} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={3} fill={alpha(NIGHT.redSoft, 0.3 * lit)} />
      {/* canopy posts */}
      {[200, 1030].map((x) => (
        <g key={x}>
          <rect x={x} y={764} width={14} height={420} fill={mix(NIGHT.ink, NIGHT.wall, 0.5)} />
          <rect x={x} y={764} width={3} height={420} fill={alpha(NIGHT.redSoft, 0.4 * lit)} />
        </g>
      ))}
      {/* the arrow sign, top-left, on its pole */}
      <g transform="translate(40 330) scale(1.06)">
        <RitaSign on={neon} pole={540} />
      </g>
      {/* lot + road in front */}
      {road ? (
        <g>
          <rect x={FACADE_BOX.x0} y={1210} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={140} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.55)} />
          <ellipse cx={540} cy={1215} rx={700} ry={110} fill={`url(#${uid}halo)`} opacity={0.6 * lit} />
          <rect x={FACADE_BOX.x0} y={1350} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={FACADE_BOX.y1 - 1350} fill={`url(#${uid}road)`} />
          <rect x={FACADE_BOX.x0} y={1350} width={FACADE_BOX.x1 - FACADE_BOX.x0} height={4} fill={alpha(NIGHT.grey, 0.2)} />
          {Array.from({length: 9}, (_, i) => (
            <rect key={i} x={FACADE_BOX.x0 + 40 + i * 200} y={1600} width={110} height={10} fill="#2b303b" />
          ))}
        </g>
      ) : null}
    </g>
  );
};

// ─── Component ──────────────────────────────────────────────────────────────

/** The highway set as a full 1080×1920 layer. */
export const Highway: React.FC<HighwayProps & {style?: React.CSSProperties}> = ({variant = 'crane', camera = HIGHWAY_REST, ritaNeon = 1, starliteNeon = 1, missedPulse = 0.5, carGlint = 0, lobby, style}) => {
  const uid = useUid('hw');
  return (
    <AbsoluteFill style={{background: NIGHT.ink, ...style}}>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <g transform={camT(camera)}>
          {variant === 'crane' ? (
            <Crane ritaNeon={ritaNeon} starliteNeon={starliteNeon} missedPulse={missedPulse} carGlint={carGlint} uid={uid} />
          ) : (
            <RitasMotelFacade neon={ritaNeon} lobby={lobby} />
          )}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
