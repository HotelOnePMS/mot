// Gus (60s, owner of the Starlite Motor Court): broad, unhurried, salt-and-
// pepper hair thinning on top, grey stubble, a Lagoon cardigan with the sleeves
// shoved up over a chambray shirt, reading glasses on a cord. Teal is his world.
//
//   GusDesk        the S22 desk rig, seen over his right shoulder: his phone up
//                  in his right hand (screen toward him and us, so the camera can
//                  push into it), a mug in his left hand. Drawn in S22 frame px
//                  (Gus at x 120–620, y 700–1400; phone at x 520–760, y 820–1300).
//                  Layers: 'back' (Gus, his palm and the phone body; draw the
//                  HotelOne screen over GUS_PHONE.screen after it) and 'front'
//                  (the thumb and fingertips that overlap the phone's edges).
//   GusSilhouette  S23 (dawn): a dark backlit silhouette at his office window,
//                  raising the mug toward Rita's car. Also 'night' + binoculars
//                  for anything S27 needs from his side of the road.
// Every moving part is a number so scenes can interpolate() it.
import React from 'react';
import {AbsoluteFill, random} from 'remotion';
import {LIGHT, NIGHT} from '../theme.ts';
import {alpha, mix, useUid} from '../set/parts.tsx';
import type {Crop} from '../set/Lobby.tsx';
import {add, angle, arc, breath, clamp01, ik, lerp, lerpP, place, rot, shape, smoothstep, sub, type C, type P} from './rig.ts';

// ─── Palette ────────────────────────────────────────────────────────────────

const SKIN = mix(mix(NIGHT.tape, NIGHT.redSoft, 0.3), LIGHT.highlightSoftForeground, 0.14);

type Pal = ReturnType<typeof palette>;
const palette = (dawn: number) => {
  const d = clamp01(dawn);
  const n = 1 - d;
  const m = (night: string, day: string) => mix(night, day, d);
  return {
    d,
    n,
    skin: m(mix(NIGHT.ink, SKIN, 0.3), mix(SKIN, LIGHT.highlightSoftForeground, 0.1)),
    skinDeep: m(mix(NIGHT.ink, SKIN, 0.16), mix(SKIN, LIGHT.highlightSoftForeground, 0.42)),
    skinLine: m(mix(NIGHT.ink, SKIN, 0.06), mix(SKIN, NIGHT.redDeep, 0.6)),
    hair: m(mix(NIGHT.ink, NIGHT.grey, 0.4), mix(NIGHT.grey, NIGHT.ink, 0.18)),
    hairDeep: m(mix(NIGHT.ink, NIGHT.grey, 0.18), mix(NIGHT.grey, NIGHT.ink, 0.55)),
    hairHi: m(mix(NIGHT.grey, NIGHT.tealSoft, 0.4), NIGHT.ivory),
    knit: m(mix(NIGHT.ink, LIGHT.primary, 0.42), mix(LIGHT.primary, NIGHT.ink, 0.22)),
    knitDeep: m(mix(NIGHT.ink, LIGHT.primary, 0.2), mix(LIGHT.primary, NIGHT.ink, 0.55)),
    knitHi: m(mix(LIGHT.primary, NIGHT.tealSoft, 0.3), mix(LIGHT.primary, LIGHT.primarySoft, 0.45)),
    shirt: m(mix(NIGHT.ink, LIGHT.primarySoft, 0.38), mix(LIGHT.primarySoft, LIGHT.primarySoftForeground, 0.18)),
    shirtDeep: m(mix(NIGHT.ink, LIGHT.primarySoft, 0.2), mix(LIGHT.primarySoft, LIGHT.primarySoftForeground, 0.45)),
    frame: m(mix(NIGHT.ink, LIGHT.highlightSoftForeground, 0.5), LIGHT.highlightSoftForeground),
    cord: m(mix(NIGHT.ink, NIGHT.brass, 0.5), mix(NIGHT.brass, LIGHT.highlightSoftForeground, 0.4)),
    mug: m(mix(NIGHT.ink, NIGHT.ivory, 0.45), NIGHT.ivory),
    mugDeep: m(mix(NIGHT.ink, NIGHT.ivory, 0.22), mix(NIGHT.ivory, NIGHT.grey, 0.55)),
    mugBand: m(mix(NIGHT.ink, LIGHT.primary, 0.7), LIGHT.primary),
    phone: mix(NIGHT.ink, NIGHT.wallLow, 0.7),
    /** light from the window ahead of him */
    rim: m(NIGHT.tealSoft, LIGHT.highlightSoft),
    rimHot: m(NIGHT.phoneGlowTeal, NIGHT.ivory),
    rimAmt: 0.9,
    /** the room behind us: a soft fill on his back */
    shade: alpha(mix(NIGHT.ink, LIGHT.highlightSoftForeground, d), lerp(0.5, 0.2, d)),
  };
};

// ─── Geometry (head-local: origin at the neck pivot; he faces away, turned right) ──

const SKULL: C[] = [
  [-6, -258],
  [52, -246],
  [96, -214],
  [120, -178],
  [130, -148],
  [134, -126],
  [141, -110], // nose tip peeking past the cheek
  [134, -99],
  [128, -90],
  [124, -72],
  [116, -56],
  [100, -36],
  [72, -22],
  [30, -14],
  [-30, -18],
  [-74, -48],
  [-102, -104],
  [-110, -170],
  [-90, -226],
  [-52, -252],
];
const HAIR: C[] = [
  [-104, -196],
  [-72, -228],
  [-24, -240],
  [28, -236],
  [74, -218],
  [104, -190],
  [116, -164],
  [112, -134],
  [111, -104], // sideburn
  [98, -100],
  [86, -88],
  [64, -72],
  [44, -46],
  [0, -32],
  [-48, -36],
  [-84, -62],
  [-106, -118],
];
const EAR: C[] = [[60, -150], [76, -162], [92, -152], [97, -126], [91, -100], [79, -88], [66, -94], [60, -120]];
const NECK: C[] = [[-60, -44], [58, -48], [66, 8], [62, 44], [-62, 44], [-66, 8]];

// Body-local (origin at the neck pivot, untilted).
const TORSO: C[] = [
  [-70, 8],
  [-140, 28],
  [-196, 64],
  [-228, 136],
  [-238, 260],
  [-242, 560, 1],
  [300, 560, 1],
  [292, 260],
  [278, 150],
  [242, 78],
  [160, 28],
  [70, 4],
];

/** S22 rest placement and the phone's rect (frame px). Draw the HotelOne screen inside `screen`. */
export const GUS_DESK = {
  neck: [330, 950] as P,
  phone: {x: 520, y: 820, w: 240, h: 480, r: 34},
  screen: {x: 532, y: 832, w: 216, h: 456, r: 24},
} as const;
export const GUS_PHONE = GUS_DESK.phone;

// ─── Pose ───────────────────────────────────────────────────────────────────

export type GusPose = {
  /** 0..1 the mug in his left hand from the desk up to his mouth (it goes behind his head at the top). */
  mugRaise?: number;
  /** 0..1 a smile: the cheek lifts, crinkles at the eye, the mustache corner rises. */
  smile?: number;
  /** 'dawn' (morning window light, default) or 'night'. `dawn` 0..1 overrides. */
  light?: 'dawn' | 'night';
  dawn?: number;
  /** Head pitch toward the phone, degrees (default 5). */
  lookDown?: number;
  /** Seconds, for breathing (0.2 Hz). */
  t?: number;
  /** 0..1 his thumb presses toward the screen (a tap). */
  thumb?: number;
};
const dflt = (p: GusPose) => ({
  mugRaise: clamp01(p.mugRaise ?? 0),
  smile: clamp01(p.smile ?? 0),
  dawn: clamp01(p.dawn ?? (p.light === 'night' ? 0 : 1)),
  lookDown: p.lookDown ?? 5,
  t: p.t ?? 0,
  thumb: clamp01(p.thumb ?? 0),
});
type Pose = ReturnType<typeof dflt>;

// ─── Parts ──────────────────────────────────────────────────────────────────

/** A tapered capsule from a (width wa) to b (width wb), round both ends. */
const capsule = (a: P, b: P, wa: number, wb: number) => {
  const d = sub(b, a);
  const l = Math.hypot(d[0], d[1]) || 1;
  const n: P = [-d[1] / l, d[0] / l];
  const ra = wa / 2;
  const rb = wb / 2;
  const f = (p: P) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  return `M${f(add(a, [n[0] * ra, n[1] * ra]))} L${f(add(b, [n[0] * rb, n[1] * rb]))} A${rb} ${rb} 0 0 0 ${f(add(b, [-n[0] * rb, -n[1] * rb]))} L${f(add(a, [-n[0] * ra, -n[1] * ra]))} A${ra} ${ra} 0 0 0 ${f(add(a, [n[0] * ra, n[1] * ra]))} Z`;
};
/** The edge of a capsule facing the window (up and right). */
const litEdge = (a: P, b: P, wa: number, wb: number, inset = 0.44) => {
  const d = sub(b, a);
  const l = Math.hypot(d[0], d[1]) || 1;
  let n: P = [-d[1] / l, d[0] / l];
  if (n[0] - n[1] < 0) n = [-n[0], -n[1]];
  const p1 = add(a, [n[0] * wa * inset, n[1] * wa * inset]);
  const p2 = add(b, [n[0] * wb * inset, n[1] * wb * inset]);
  return `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
};

/** A diner mug, local: base centre at 0,0, handle on the left. */
const Mug: React.FC<{pal: Pal; steam?: number}> = ({pal}) => (
  <g>
    <path d="M-30 -2 L-34 -78 Q-34 -84 -28 -84 L28 -84 Q34 -84 34 -78 L30 -2 Q30 4 24 4 L-24 4 Q-30 4 -30 -2 Z" fill={pal.mug} />
    <path d="M10 -84 L28 -84 Q34 -84 34 -78 L30 -2 Q30 4 24 4 L8 4 Z" fill={pal.mugDeep} opacity={0.5} />
    <rect x={-33} y={-62} width={66} height={12} fill={pal.mugBand} />
    <path d="M-33 -40 Q-58 -44 -56 -24 Q-54 -8 -30 -12" fill="none" stroke={pal.mug} strokeWidth={9} />
    <ellipse cx={0} cy={-84} rx={32} ry={6} fill={pal.mugDeep} />
    <path d="M30 -78 L27 -6" stroke={pal.rimHot} strokeWidth={2.4} opacity={0.8} strokeLinecap="round" />
  </g>
);

/** Short salt-and-pepper tufts across the back of his head (deterministic). */
const TUFTS = Array.from({length: 46}, (_, i) => {
  const r = (k: string) => random(`gus-tuft-${i}-${k}`);
  const a = -Math.PI * (0.05 + r('a') * 0.9);
  const rr = 0.35 + r('r') * 0.62;
  const x = Math.cos(a) * 100 * rr - 2;
  const y = -130 + Math.sin(a) * 100 * rr * 0.95 + r('y') * 40;
  return {x, y, len: 7 + r('l') * 8, tilt: 70 + r('t') * 40, light: r('c') > 0.45};
}).filter((t) => t.y > -222 && t.y < -44);

const Head: React.FC<{q: Pose; pal: Pal; uid: string; dark?: number}> = ({q, pal, uid, dark = 0}) => {
  const sm = q.smile;
  const k = 1 - dark;
  const skull = SKULL.map((p, i) => {
    // the cheek rounds out and lifts with the smile (points 9–11)
    if (i >= 8 && i <= 11) return [p[0] + sm * 4, p[1] - sm * 4] as C;
    return p;
  });
  const sil = (c: string) => mix(c, NIGHT.ink, dark);
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}skin`} x1="-110" y1="0" x2="140" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={sil(pal.skinDeep)} />
          <stop offset="0.72" stopColor={sil(pal.skin)} />
          <stop offset="1" stopColor={sil(mix(pal.skin, pal.rim, 0.35))} />
        </linearGradient>
        <radialGradient id={`${uid}crown`} cx="-4" cy="-236" r="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={sil(mix(pal.skin, pal.rim, 0.12))} />
          <stop offset="0.55" stopColor={sil(pal.skin)} stopOpacity={0.75} />
          <stop offset="1" stopColor={sil(pal.skin)} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${uid}hair`} x1="0" y1="-240" x2="0" y2="-30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={sil(mix(pal.hair, pal.hairHi, 0.2))} />
          <stop offset="0.6" stopColor={sil(pal.hair)} />
          <stop offset="1" stopColor={sil(pal.hairDeep)} />
        </linearGradient>
        <linearGradient id={`${uid}stub`} x1="0" y1="-110" x2="0" y2="-30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={sil(pal.hair)} stopOpacity={0} />
          <stop offset="1" stopColor={sil(pal.hairDeep)} stopOpacity={0.55} />
        </linearGradient>
      </defs>
      <path d={shape(skull)} fill={`url(#${uid}skin)`} />
      {/* grey stubble along the jaw he shows us */}
      <path d={shape([[100, -112], [128 + sm * 4, -92 - sm * 4], [124 + sm * 4, -70 - sm * 4], [116, -56], [100, -36], [72, -22], [60, -40], [86, -70]])} fill={`url(#${uid}stub)`} />
      <path d={`M126 ${-92 - sm * 3} Q136 ${-94 - sm * 4} 139 ${-86 - sm * 4}`} fill="none" stroke={sil(mix(pal.hair, pal.hairHi, 0.25))} strokeWidth={5} strokeLinecap="round" />
      <path d={shape(HAIR)} fill={`url(#${uid}hair)`} />
      {/* short salt-and-pepper tufts */}
      {k > 0.2
        ? TUFTS.map((t, i) => (
            <path key={i} d={`M${t.x.toFixed(1)} ${t.y.toFixed(1)} l${(Math.cos((t.tilt * Math.PI) / 180) * t.len).toFixed(1)} ${(Math.sin((t.tilt * Math.PI) / 180) * t.len).toFixed(1)}`} stroke={t.light ? pal.hairHi : pal.hairDeep} strokeWidth={2} opacity={(t.light ? 0.35 : 0.5) * k} strokeLinecap="round" />
          ))
        : null}
      {/* thinning crown */}
      <ellipse cx={-4} cy={-234} rx={58} ry={24} fill={`url(#${uid}crown)`} />
      {/* the far brow's tip and the smile's crinkles at the eye */}
      <path d={`M112 -170 Q124 ${-176 - sm * 2} 134 -168`} fill="none" stroke={sil(pal.hairDeep)} strokeWidth={4.5} strokeLinecap="round" />
      {sm > 0.02 ? <path d="M118 -150 l-11 -5 M118 -143 l-12 0 M119 -136 l-10 5" stroke={sil(pal.skinLine)} strokeWidth={1.8} opacity={sm} strokeLinecap="round" /> : null}
      {sm > 0.02 ? <path d={`M124 -86 Q118 -74 ${110 - sm * 2} -64`} fill="none" stroke={sil(pal.skinLine)} strokeWidth={1.8} opacity={sm * 0.7} strokeLinecap="round" /> : null}
      {/* ear, from behind */}
      <path d={shape(EAR)} fill={sil(pal.skin)} />
      <path d={shape(EAR)} fill={sil(pal.skinDeep)} opacity={0.35} />
      <path d="M66 -144 Q78 -154 88 -146 Q92 -126 86 -104" fill="none" stroke={sil(pal.skinLine)} strokeWidth={2.4} opacity={0.5} strokeLinecap="round" />
      <path d="M76 -162 Q92 -152 97 -126" fill="none" stroke={pal.rim} strokeWidth={2.6} opacity={pal.rimAmt * 0.8} strokeLinecap="round" />
      {/* reading glasses: temple over the ear, the lens edge past his cheek, the cord down behind the ear and round his neck */}
      <path d="M62 -154 L138 -156" stroke={sil(pal.frame)} strokeWidth={4} strokeLinecap="round" />
      <path d="M137 -172 Q145 -153 139 -134" fill="none" stroke={sil(pal.frame)} strokeWidth={5} strokeLinecap="round" />
      <path d="M139 -170 Q147 -153 141 -136" fill="none" stroke={pal.rimHot} strokeWidth={1.6} opacity={0.7 * pal.rimAmt} />
      <path d="M62 -152 C56 -120 60 -60 54 -26 C40 -12 -40 -12 -58 -26" fill="none" stroke={sil(pal.cord)} strokeWidth={2.2} strokeLinecap="round" />
      {/* the window light along his head and face */}
      <path d="M-60 -250 Q20 -268 96 -214 Q124 -182 134 -128 Q143 -110 136 -96" fill="none" stroke={pal.rim} strokeWidth={3.4} opacity={pal.rimAmt} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M-60 -250 Q20 -268 96 -214 Q124 -182 134 -128" fill="none" stroke={pal.rim} strokeWidth={12} opacity={0.12 * pal.rimAmt} strokeLinecap="round" />
    </g>
  );
};

// ─── Desk rig ───────────────────────────────────────────────────────────────

export type GusLayer = 'all' | 'back' | 'front';

/** The desk rig as an SVG <g> in S22 frame px. With layer 'all' the phone screen is dark unless `screen` (SVG, in frame px) is given. */
export const GusDeskArt: React.FC<GusPose & {layer?: GusLayer; screen?: React.ReactNode}> = ({layer = 'all', screen, ...pose}) => {
  const uid = useUid('gd');
  const q = dflt(pose);
  const pal = palette(q.dawn);
  const NP = GUS_DESK.neck;
  const PH = GUS_DESK.phone;
  const SC = GUS_DESK.screen;
  const b = breath(q.t, 0.2, 2);
  const by = -b;
  const raise = smoothstep(q.mugRaise);
  const headDeg = q.lookDown - 6 * raise;
  const back = layer !== 'front';
  const front = layer !== 'back';

  // right arm (frame right): upper arm hangs to the desk, the forearm comes forward to the phone (foreshortened)
  const shR: P = [232, 98 + by];
  const elR: P = [292, 372];
  const wrR: P = [PH.x + PH.w - 56 - NP[0], PH.y + PH.h + 24 - NP[1]];
  // left arm (frame left): the mug from the desk up to his mouth, behind his head at the top
  const shL: P = [-196, 100 + by];
  const mugRest: P = [-246, 318];
  const mugUp: P = [70, -56];
  const hand = arc(mugRest, mugUp, -70, raise);
  const [elL, wrL] = ik(shL, add(hand, [10, 26]), 190, 150, -1);
  const mugDeg = lerp(0, -10, raise);

  const knit = `url(#${uid}knit)`;
  const sleeve = (a: P, c: P, wa: number, wc: number) => (
    <>
      <path d={capsule(a, c, wa, wc)} fill={knit} />
      <path d={litEdge(a, c, wa, wc, 0.4)} stroke={pal.rim} strokeWidth={2.4} opacity={0.4 * pal.rimAmt} strokeLinecap="round" />
    </>
  );
  const forearm = (a: P, c: P, wa: number, wc: number) => (
    <>
      <path d={capsule(a, c, wa, wc)} fill={pal.skin} />
      <path d={capsule(a, c, wa, wc)} fill={pal.shade} />
      <path d={litEdge(a, c, wa, wc)} stroke={pal.rim} strokeWidth={2.4} opacity={0.7 * pal.rimAmt} strokeLinecap="round" />
      {/* the shoved-up sleeve, bunched at the elbow */}
      <g transform={place(a, angle(sub(c, a)))}>
        <path d={`M-4 ${-wa / 2 - 8} Q20 ${-wa / 2 - 12} 30 ${-wa / 2 - 2} L30 ${wa / 2 + 2} Q20 ${wa / 2 + 12} -4 ${wa / 2 + 8} Z`} fill={pal.knitHi} />
        <path d={`M8 ${-wa / 2 - 8} L8 ${wa / 2 + 8} M18 ${-wa / 2 - 9} L18 ${wa / 2 + 9}`} stroke={pal.knitDeep} strokeWidth={2} opacity={0.5} />
      </g>
    </>
  );
  // phone in local frame px (absolute), the hand's parts around it
  const phoneBody = (
    <g>
      <rect x={PH.x - 4} y={PH.y - 4} width={PH.w + 8} height={PH.h + 8} rx={PH.r + 4} fill={mix(pal.phone, pal.rim, 0.25)} />
      <rect x={PH.x} y={PH.y} width={PH.w} height={PH.h} rx={PH.r} fill={pal.phone} />
      <rect x={SC.x} y={SC.y} width={SC.w} height={SC.h} rx={SC.r} fill={NIGHT.ink} />
      <rect x={PH.x + PH.w / 2 - 30} y={PH.y + 10} width={60} height={14} rx={7} fill={NIGHT.ink} />
    </g>
  );
  const tx = PH.x + PH.w;
  const ty = PH.y + PH.h * 0.66;
  const press = q.thumb;
  const thumbTip: P = [tx - 16 - press * 30, ty - 30 + press * 6];
  const thumb = (
    <g>
      {/* thumb: from its root at the right edge, over the screen edge */}
      <path d={capsule([tx + 22, ty + 70], [tx + 4, ty + 6], 40, 32)} fill={pal.skin} />
      <path d={capsule([tx + 4, ty + 6], thumbTip, 32, 24)} fill={pal.skin} />
      <path d={capsule([tx + 4, ty + 6], thumbTip, 32, 24)} fill={pal.shade} opacity={0.6} />
      <path d={`M${thumbTip[0] - 4} ${thumbTip[1] - 4} Q${thumbTip[0] + 4} ${thumbTip[1] - 12} ${thumbTip[0] + 12} ${thumbTip[1] - 8}`} fill="none" stroke={pal.mug} strokeWidth={2.4} opacity={0.7} strokeLinecap="round" />
      <path d={`M${tx + 38} ${ty + 60} Q${tx + 26} ${ty} ${thumbTip[0] + 6} ${thumbTip[1] - 12}`} fill="none" stroke={pal.rim} strokeWidth={2.4} opacity={0.75 * pal.rimAmt} strokeLinecap="round" />
      {/* fingertips curling round the left edge */}
      {[0, 1, 2].map((i) => {
        const y = PH.y + PH.h * 0.56 + i * 34;
        return (
          <g key={i}>
            <path d={capsule([PH.x + 4, y], [PH.x - 12, y + 6], 26, 22)} fill={mix(pal.skin, pal.skinDeep, 0.25 + i * 0.12)} />
            <path d={`M${PH.x - 18} ${y + 2} q2 -8 10 -10`} fill="none" stroke={pal.rim} strokeWidth={1.6} opacity={0.4} strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
  // the hand behind the phone: heel of the palm below it, the outer edge past its right side, the wrist
  const palm = (
    <g>
      <path d={shape([[tx - 40, ty - 10], [tx + 20, ty + 4], [tx + 34, ty + 80], [tx + 22, PH.y + PH.h + 30], [tx - 30, PH.y + PH.h + 46], [tx - 110, PH.y + PH.h + 30], [tx - 120, PH.y + PH.h - 20]])} fill={pal.skinDeep} />
      <path d={`M${tx + 20} ${ty + 4} Q${tx + 38} ${ty + 40} ${tx + 34} ${ty + 80}`} fill="none" stroke={pal.rim} strokeWidth={2.4} opacity={0.6 * pal.rimAmt} strokeLinecap="round" />
    </g>
  );

  return (
    <g>
      <defs>
        <linearGradient id={`${uid}knit`} x1="-280" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.knitDeep} />
          <stop offset="0.55" stopColor={pal.knit} />
          <stop offset="1" stopColor={mix(pal.knit, pal.knitHi, 0.35)} />
        </linearGradient>
        <linearGradient id={`${uid}fall`} x1="0" y1="200" x2="0" y2="560" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.35 + 0.4 * pal.n} />
        </linearGradient>
      </defs>
      {back ? (
        <g>
          <g transform={`translate(${NP[0]} ${NP[1]})`}>
            {/* left upper arm, mostly behind his back */}
            <path d={capsule(shL, elL, 104, 84)} fill={pal.knitDeep} />
            {/* back of the cardigan */}
            <g transform={`translate(0 ${by})`}>
              <path d={shape(TORSO)} fill={knit} />
              <path d={shape(TORSO)} fill={`url(#${uid}fall)`} />
              <path d="M-150 60 Q-120 180 -136 320 M150 60 Q130 180 150 330" fill="none" stroke={pal.knitDeep} strokeWidth={4} opacity={0.6} strokeLinecap="round" />
              <path d="M-40 120 Q0 140 40 120" fill="none" stroke={pal.knitDeep} strokeWidth={3} opacity={0.4} strokeLinecap="round" />
              <path d="M70 4 Q160 26 242 78 Q280 120 292 220" fill="none" stroke={pal.rim} strokeWidth={3.4} opacity={pal.rimAmt} strokeLinecap="round" />
              {/* neck, chambray collar, the cardigan's ribbed neckline */}
              <path d={shape(NECK)} fill={pal.skinDeep} />
              <path d="M-66 0 Q0 -14 66 -4 L70 22 Q0 10 -70 26 Z" fill={pal.shirt} />
              <path d="M66 -4 L86 30 L60 26 Z" fill={pal.shirt} />
              <path d="M-70 26 Q0 10 70 22 L74 36 Q0 26 -76 42 Z" fill={pal.knitHi} />
              <path d="M-66 0 Q0 -14 66 -4 L86 30" fill="none" stroke={pal.rim} strokeWidth={2} opacity={0.6 * pal.rimAmt} />
            </g>
            {/* left arm with the mug (behind his head when it reaches his mouth) */}
            {forearm(elL, wrL, 64, 50)}
            <g transform={place(hand, mugDeg)}>
              <Mug pal={pal} />
              {/* fingers wrapped round the mug, the knuckles toward us */}
              <path d={shape([[-40, -66], [-10, -70], [14, -64], [18, -22], [-6, -14], [-40, -20], [-50, -44]])} fill={pal.skin} />
              <path d={shape([[-40, -66], [-10, -70], [14, -64], [18, -22], [-6, -14], [-40, -20], [-50, -44]])} fill={pal.shade} />
              <path d="M-36 -54 L14 -52 M-38 -40 L16 -38 M-38 -27 L16 -26" stroke={pal.skinLine} strokeWidth={1.6} opacity={0.45} strokeLinecap="round" />
              <path d="M-10 -70 Q10 -68 16 -50" fill="none" stroke={pal.rim} strokeWidth={2.2} opacity={0.7 * pal.rimAmt} strokeLinecap="round" />
            </g>
            {/* head, pitched toward the phone */}
            <g transform={`translate(0 ${by * 0.7}) rotate(${headDeg})`}>
              <Head q={q} pal={pal} uid={uid} />
            </g>
            {/* right arm to the phone */}
            {sleeve(shR, elR, 108, 88)}
            {forearm(elR, wrR, 68, 56)}
          </g>
          {palm}
          {phoneBody}
          {layer === 'all' && screen ? <g>{screen}</g> : null}
        </g>
      ) : null}
      {front ? thumb : null}
    </g>
  );
};

const camT = (c?: Crop) => {
  if (!c) return undefined;
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return `translate(${ox + c.x} ${oy + c.y}) scale(${c.scale}) translate(${-ox} ${-oy})`;
};

/** The desk rig as a full-frame layer. `camera` scales about (540, 960) then moves (same convention as the sets). */
export const GusDesk: React.FC<GusPose & {layer?: GusLayer; camera?: Crop; screen?: React.ReactNode; style?: React.CSSProperties}> = ({camera, style, ...rest}) => (
  <AbsoluteFill style={{pointerEvents: 'none', ...style}}>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <g transform={camT(camera)}>
        <GusDeskArt {...rest} />
      </g>
    </svg>
  </AbsoluteFill>
);

// ─── Silhouette at the window (S23; S27 at night) ───────────────────────────

export type GusSilhouetteProps = {
  /** 0..1 the mug (left hand) rises from his chest to a toast at head height. */
  mugRaise?: number;
  /** 'dawn' (ivory window behind him, default) or 'night' (Rita's red neon across the road). */
  light?: 'dawn' | 'night';
  /** What he holds up: the mug (S23) or binoculars (both hands, elbows out). */
  hold?: 'mug' | 'binoculars';
  /** 0..1 a smile on the sliver of face we see. */
  smile?: number;
  t?: number;
  /** Neck pivot in frame px and scale. Default: bottom right, leaving the window's centre clear. */
  x?: number;
  y?: number;
  scale?: number;
};

/** The silhouette as an SVG <g> (neck pivot at 0,0). */
export const GusSilhouetteArt: React.FC<Omit<GusSilhouetteProps, 'x' | 'y' | 'scale'>> = ({mugRaise = 0, light = 'dawn', hold = 'mug', smile = 0, t = 0}) => {
  const uid = useUid('gs');
  const dawn = light === 'dawn';
  const rim = dawn ? NIGHT.ivory : NIGHT.redSoft;
  const glow = dawn ? LIGHT.highlightSoft : NIGHT.red;
  const body = dawn ? mix(NIGHT.ink, LIGHT.inverse, 0.6) : NIGHT.ink;
  const edge = mix(body, rim, 0.18);
  const b = breath(t, 0.2, 2);
  const raise = smoothstep(clamp01(mugRaise));
  const bino = hold === 'binoculars';
  const sm = clamp01(smile);
  const headDeg = bino ? -3 : -6;
  // left arm (frame left): a toast toward the window; with binoculars both elbows go out
  const shL: P = [-238, 104 - b];
  const handL = bino ? ([40, -110] as P) : lerpP([-150, 200], [-250, -150], raise);
  const [elL, wrL] = ik(shL, handL, 190, 176, -1);
  const shR: P = [232, 98 - b];
  const handR: P = [150, -112];
  const [elR, wrR] = ik(shR, handR, 190, 176, 1);
  const limb = (a: P, c: P, wa: number, wc: number) => <path d={capsule(a, c, wa, wc)} fill={body} />;
  const limbRim = (a: P, c: P, wa: number, wc: number) => <path d={litEdge(a, c, wa, wc, 0.47)} stroke={rim} strokeWidth={3} opacity={0.85} strokeLinecap="round" />;
  const skull = SKULL.map((p, i) => (i >= 8 && i <= 11 ? ([p[0] + sm * 4, p[1] - sm * 4] as C) : p));
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}halo`}>
          <stop offset="0" stopColor={glow} stopOpacity={0.35} />
          <stop offset="1" stopColor={glow} stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* window light wrapping round his head and shoulders */}
      <ellipse cx={30} cy={-130} rx={250} ry={210} fill={`url(#${uid}halo)`} />
      <ellipse cx={40} cy={-150} rx={170} ry={150} fill={`url(#${uid}halo)`} />
      {bino ? (
        <>
          {limb(shR, elR, 108, 86)}
          {limbRim(shR, elR, 108, 86)}
          {limb(elR, wrR, 86, 60)}
        </>
      ) : null}
      <g transform={`translate(0 ${-b})`}>
        <path d={shape(TORSO)} fill={body} />
        {/* the cardigan's shawl collar breaking the neckline */}
        <path d="M-80 10 Q0 -8 80 6 L96 40 Q0 24 -96 44 Z" fill={edge} />
        <path d="M70 4 Q160 26 242 78 Q280 120 292 220" fill="none" stroke={rim} strokeWidth={3.2} opacity={0.85} strokeLinecap="round" />
        <path d="M-70 8 Q-150 28 -222 68 Q-262 110 -276 200" fill="none" stroke={rim} strokeWidth={2.2} opacity={0.45} strokeLinecap="round" />
        <path d={shape(NECK)} fill={body} />
      </g>
      {limb(shL, elL, 104, 84)}
      {limb(elL, wrL, 84, 60)}
      {limbRim(elL, wrL, 84, 60)}
      {/* head: solid, the window light along the crown, the brow, the nose tip, the glasses' edge */}
      <g transform={`rotate(${headDeg})`}>
        <path d={shape(skull)} fill={body} />
        <path d={shape(EAR)} fill={edge} opacity={0.6} />
        <path d="M76 -162 Q92 -152 97 -126" fill="none" stroke={rim} strokeWidth={2} opacity={0.5} strokeLinecap="round" />
        <path d="M-96 -214 Q-40 -262 20 -260 Q70 -250 100 -212 Q126 -180 132 -146 Q137 -128 141 -110 Q136 -98 128 -90 Q126 -76 118 -58" fill="none" stroke={rim} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M-96 -214 Q-40 -262 20 -260 Q70 -250 100 -212 Q126 -180 132 -146" fill="none" stroke={rim} strokeWidth={14} opacity={0.14} strokeLinecap="round" />
        <path d="M-104 -150 Q-108 -100 -84 -60" fill="none" stroke={rim} strokeWidth={2} opacity={0.35} strokeLinecap="round" />
        <path d="M137 -172 Q146 -153 140 -134" fill="none" stroke={body} strokeWidth={6} strokeLinecap="round" />
        <path d="M139 -170 Q148 -153 142 -136" fill="none" stroke={rim} strokeWidth={1.8} opacity={0.9} />
        <path d="M60 -152 L138 -156" stroke={edge} strokeWidth={3} strokeLinecap="round" />
        {bino ? (
          // the binoculars' far ends showing past his face
          <g>
            <path d="M126 -184 L176 -190 Q186 -190 186 -180 L186 -136 Q186 -126 176 -126 L126 -132 Z" fill={body} />
            <path d="M128 -184 L176 -190 Q186 -190 186 -180" fill="none" stroke={rim} strokeWidth={2.6} opacity={0.9} />
            <ellipse cx={186} cy={-158} rx={5} ry={26} fill={mix(body, rim, 0.3)} />
          </g>
        ) : null}
      </g>
      {bino ? null : (
        <g transform={place(wrL, lerp(10, -18, raise))}>
          <g transform="translate(14 -10)">
            <path d="M-30 -2 L-34 -78 Q-34 -84 -28 -84 L28 -84 Q34 -84 34 -78 L30 -2 Q30 4 24 4 L-24 4 Q-30 4 -30 -2 Z" fill={body} />
            <path d="M-33 -40 Q-58 -44 -56 -24 Q-54 -8 -30 -12" fill="none" stroke={body} strokeWidth={9} />
            <path d="M-28 -84 L28 -84 Q34 -84 34 -78 L30 -2" fill="none" stroke={rim} strokeWidth={2.6} opacity={0.9} strokeLinejoin="round" />
            {/* a wisp of steam lit by the window */}
            <path d="M4 -96 Q-6 -116 6 -134 Q16 -150 4 -166" fill="none" stroke={rim} strokeWidth={2.4} opacity={0.35 * raise} strokeLinecap="round" />
          </g>
          <path d={shape([[-30, -20], [-10, -40], [16, -36], [24, -8], [8, 12], [-24, 10]])} fill={body} />
        </g>
      )}
    </g>
  );
};

/** The silhouette as a full-frame layer. Default: neck at (790, 1330), scale 1.45 (head ≈ y 950–1330, shoulders off the bottom right). */
export const GusSilhouette: React.FC<GusSilhouetteProps & {style?: React.CSSProperties}> = ({x = 790, y = 1330, scale = 1.45, style, ...rest}) => (
  <AbsoluteFill style={{pointerEvents: 'none', ...style}}>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <GusSilhouetteArt {...rest} />
      </g>
    </svg>
  </AbsoluteFill>
);

/** Where the mug is on the silhouette (frame px) for a raise, e.g. to time the S23 clink against the glass. */
export const gusSilhouetteMug = (mugRaise: number, at: {x?: number; y?: number; scale?: number} = {}) => {
  const x = at.x ?? 790;
  const y = at.y ?? 1330;
  const s = at.scale ?? 1.45;
  const raise = smoothstep(clamp01(mugRaise));
  const p = lerpP([-150, 200], [-250, -150], raise);
  const top = add(p, rot([14, -94], lerp(10, -18, raise)));
  return {x: x + top[0] * s, y: y + top[1] * s};
};
