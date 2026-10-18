// S16: the phone tossed onto the passenger seat. Drawn in cabin rest px (inside Cabin's camera group).
// Flight HANG→LAND is two frames (the click at cue('AI04').cut, the thud 75 ms later), so it reads as a smear;
// then one 6 px bounce and a settle by S16.toss.end. It lands screen-up, the call-ended screen still lit.
import React from 'react';
import {interpolate} from 'remotion';
import {RitaPhoneArt} from '../../char/Rita.tsx';
import {NIGHT} from '../../theme.ts';
import type {P} from '../../char/rig.ts';
import {HANG, LAND, SETTLE, clamp} from './common.ts';

/** Phone size (the rig's PHONE). */
const W = 70;
const H = 146;
const R = 13;
/** Where it comes to rest on the passenger-seat cushion (rest px), lying flat, seen at a low angle. */
export const LANDING: P = [925, 1500];
const LAND_DEG = -74;
const LAND_SQUASH = 0.5;
/** Foreground: the seat is nearer the lens than Rita's hand. */
const LAND_SCALE = 1.14;

const bez = (a: P, c: P, b: P, u: number): P => [
  (1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * c[0] + u * u * b[0],
  (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * c[1] + u * u * b[1],
];

/** Her phone face-up: dark glass, the call-ended screen (avatar, name line, the red End disc fading). */
const PhoneFaceUp: React.FC<{lit: number; ended: number; id: string}> = ({lit, ended, id}) => (
  <g>
    <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={R} fill="#1a1f27" />
    <rect x={-W / 2 + 3.5} y={-H / 2 + 3.5} width={W - 7} height={H - 7} rx={R - 3} fill={NIGHT.ink} />
    <defs>
      <linearGradient id={`${id}scr`} x1="0" y1={-H / 2} x2="0" y2={H / 2} gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={NIGHT.tealDeep} />
        <stop offset="0.55" stopColor="#0f2530" />
        <stop offset="1" stopColor={NIGHT.wall} />
      </linearGradient>
    </defs>
    <g opacity={lit}>
      <rect x={-W / 2 + 4} y={-H / 2 + 4} width={W - 8} height={H - 8} rx={R - 4} fill={`url(#${id}scr)`} />
      {/* avatar + name + "Call ended" lines */}
      <circle cx={0} cy={-34} r={10} fill={NIGHT.tealSoft} opacity={0.55} />
      <rect x={-18} y={-17} width={36} height={4} rx={2} fill={NIGHT.ivory} opacity={0.75} />
      <rect x={-12} y={-9} width={24} height={3} rx={1.5} fill={NIGHT.tealSoft} opacity={0.6} />
      {/* the End disc, fading out as the call-ended screen settles */}
      <circle cx={0} cy={44} r={9} fill={NIGHT.red} opacity={0.9 * (1 - ended)} />
      {/* glass sheen */}
      <path d={`M${-W / 2 + 6} ${-H / 2 + 30} L${W / 2 - 8} ${-H / 2 + 6}`} stroke={NIGHT.ivory} strokeWidth={6} opacity={0.06} strokeLinecap="round" />
    </g>
    <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={R} fill="none" stroke={NIGHT.tealSoft} strokeWidth={1.6} opacity={0.35} />
  </g>
);

export type TossProps = {
  /** Scene-local frame. */
  frame: number;
  /** Phone centre and angle in her hand at the tap (rest px, from ritaAPoints). */
  from: P;
  fromDeg: number;
  id?: string;
};

/** The phone from the frame after the tap (it leaves her hand) to the end of the shot. Null before. */
export const TossedPhone: React.FC<TossProps> = ({frame, from, fromDeg, id = 'rshp'}) => {
  if (frame <= HANG) return null;
  const ctrl: P = [from[0] * 0.35 + LANDING[0] * 0.65, Math.min(from[1], LANDING[1]) - 190];

  // flight: one in-between frame (u ≈ 0.55), landed at LAND
  if (frame < LAND) {
    const u = interpolate(frame, [HANG, LAND], [0, 1], clamp);
    const deg = fromDeg + (LAND_DEG + 360 - fromDeg) * u;
    const sq = 1 + (LAND_SQUASH - 1) * u;
    const s = 1 + (LAND_SCALE - 1) * u;
    const a = bez(from, ctrl, LANDING, 0.04);
    const b = bez(from, ctrl, LANDING, u);
    const trail = Array.from({length: 13}, (_, i) => bez(from, ctrl, LANDING, 0.04 + ((u - 0.04) * i) / 12));
    const d = `M${trail.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L')}`;
    return (
      <g>
        <defs>
          <linearGradient id={`${id}tr`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0} />
            <stop offset="1" stopColor={NIGHT.phoneBloom} stopOpacity={0.75} />
          </linearGradient>
          <linearGradient id={`${id}sw`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={NIGHT.teal} stopOpacity={0} />
            <stop offset="0.6" stopColor={NIGHT.teal} stopOpacity={0.55} />
            <stop offset="1" stopColor={NIGHT.tealBright} stopOpacity={0.95} />
          </linearGradient>
        </defs>
        {/* the smear: a soft swept band along the arc plus a dense run of fading copies behind the phone */}
        <path d={d} fill="none" stroke={`url(#${id}tr)`} strokeWidth={96} strokeLinecap="round" opacity={0.18} />
        {/* three thin swoosh lines riding the arc (the classic smear), parallel to the path */}
        {[-22, 0, 22].map((o, j) => {
          const pts = Array.from({length: 11}, (_, i) => {
            const g = u * (0.2 + 0.07 * i);
            const p0 = bez(from, ctrl, LANDING, g);
            const p1 = bez(from, ctrl, LANDING, g + 0.01);
            const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
            return [p0[0] - ((p1[1] - p0[1]) / len) * o, p0[1] + ((p1[0] - p0[0]) / len) * o] as const;
          });
          return (
            <path
              key={`sw${j}`}
              d={`M${pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' L')}`}
              fill="none"
              stroke={`url(#${id}sw)`}
              strokeWidth={j === 1 ? 7 : 4}
              strokeLinecap="round"
              opacity={j === 1 ? 1 : 0.7}
            />
          );
        })}
        {Array.from({length: 9}, (_, i) => {
          const g = u * (0.45 + 0.055 * i);
          const p = bez(from, ctrl, LANDING, g);
          const gd = fromDeg + (LAND_DEG + 360 - fromDeg) * g;
          const gs = 1 + (LAND_SCALE - 1) * g;
          return (
            <g key={i} transform={`translate(${p[0]} ${p[1]}) rotate(${gd}) scale(${gs})`} opacity={0.1 + 0.035 * i}>
              <RitaPhoneArt />
            </g>
          );
        })}
        <g transform={`translate(${b[0]} ${b[1]}) scale(${s} ${s * (0.75 + 0.25 * sq)}) rotate(${deg})`}>
          <RitaPhoneArt />
        </g>
      </g>
    );
  }

  // landed: one 6 frame-px bounce, a small wobble, settled by SETTLE
  const k = frame - LAND;
  const bounce = k <= 4 ? Math.sin((Math.PI * k) / 4) : k <= 6 ? 0.18 * Math.sin((Math.PI * (k - 4)) / 2) : 0;
  const lift = (6 / 1.07) * bounce;
  const wob = interpolate(frame, [LAND, LAND + 2, LAND + 4, SETTLE], [6, -3, 1.5, 0], clamp);
  const impact = k === 0 ? 1 : 0; // a one-frame squash on contact
  const lit = interpolate(frame, [LAND, LAND + 3, SETTLE + 12, SETTLE + 30], [0.75, 1, 0.92, 0.8], clamp);
  const ended = interpolate(frame, [LAND, SETTLE + 18], [0, 1], clamp);
  const [x, y] = LANDING;
  return (
    <g>
      <defs>
        <radialGradient id={`${id}pool`} cx={x} cy={y + 4} r={150} gradientUnits="userSpaceOnUse" gradientTransform={`translate(${x} ${y + 4}) scale(1 0.42) translate(${-x} ${-(y + 4)})`}>
          <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0.3} />
          <stop offset="0.45" stopColor={NIGHT.teal} stopOpacity={0.1} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* the screen's light pooling on the cushion */}
      <ellipse cx={x} cy={y + 4} rx={150} ry={63} fill={`url(#${id}pool)`} opacity={lit} style={{mixBlendMode: 'screen'}} />
      {/* contact shadow: tight when it touches, soft when it is up */}
      <ellipse cx={x + 4} cy={y + 14} rx={70 - 10 * bounce} ry={13 - 3 * bounce} fill={NIGHT.ink} opacity={0.6 - 0.25 * bounce} />
      <g transform={`translate(${x} ${y - lift}) scale(${LAND_SCALE * (1 + 0.04 * impact)} ${LAND_SCALE * LAND_SQUASH * (1 - 0.1 * impact)}) rotate(${LAND_DEG + wob})`}>
        {/* the phone's thickness, seen as a dark edge under the slab */}
        <rect x={-W / 2 - 8} y={-H / 2 + 2.4} width={W} height={H} rx={R} fill="#05070a" />
        <PhoneFaceUp lit={lit} ended={ended} id={id} />
      </g>
    </g>
  );
};
