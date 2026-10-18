// Rita's car, parked nose-in to Gus's office. Seen from the passenger seat:
// Rita (char/Rita.tsx, drawn by the scene between the 'back' and 'front'
// layers) sits on the left facing right; the windshield on the right looks
// straight at the Starlite's office (the shared Lobby set, teal) under the
// STARLITE sign; the green dash clock reads 2:14; the steno pad is propped on
// the wheel; a thermos sits in the cup holder; the rearview mirror hangs from
// the top of the windshield and holds her own motel, reversed, with one white
// glow pulsing in its dark lobby window.
//
// Units: S04 frame px at the rest framing (identity camera), drawn oversize
// (x -300..1400, y -300..2200). Every moving part is a prop.
//
// Also exported for scenes that compose their own shots:
//   StenoPad / StenoPadArt (+ stenoPenTip): S04 tallies, S11 "Fri 23", S12 "$119?!" and "(I’m $129)", S21 on the floor mat
//   RearviewMirror: S17's push into the mirror
//   Thermos, Steam: S17's sip
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {DARK, FONT, LIGHT, NIGHT} from '../theme.ts';
import {handArrow, handEllipse, handLine, handTip, joinHand, layoutHand, type HandLayout, type Pt} from './hand.ts';
import {LobbyArt, type Crop, type LobbyProps} from './Lobby.tsx';
import {RitasMotelFacade} from './Highway.tsx';
import {Ink, StarliteSign, Stars, alpha, clamp01, mix, useUid} from './parts.tsx';

// ─── Steno pad ──────────────────────────────────────────────────────────────

/** Pad art box in pad units (spiral at the top). */
export const PAD_BOX = {w: 600, h: 900} as const;

/**
 * Which notes are on the pad and how far each is drawn (0 = not yet, 1 = done).
 * Notes draw at constant pen speed, in this order of strokes:
 *  - tonight: tonight's "20s" then its circle (S04, 8.1–8.7)
 *  - fri: "Fri 23" ("Fri" in the first 55%, "23" after; matches marks.ts S11.pen)
 *  - price: "$119?!" (each of $ 1 1 9 ?! takes one fifth: S12.price on 16ths)
 *  - underline: the double underline (each line one half)
 *  - margin: the arrow in the first 25%, then "(I’m $129)" (S12.margin)
 */
export type StenoNotes = {
  /** Earlier nights' columns already on the pad (tallies + circled "20s"), 0..4. Default 4. */
  nights?: number;
  tonight?: number;
  fri?: number;
  price?: number;
  underline?: number;
  margin?: number;
};

const NIGHT_TALLIES = [4, 3, 5, 2, 1];
const colX = (i: number) => 52 + i * 106;

/** Split a 0..1 progress across parts by fractions (e.g. [0.55, 0.45]). */
const split = (p: number, fr: number[]) => {
  let acc = 0;
  return fr.map((f) => {
    const v = p >= 1 ? 1 : clamp01((p - acc) / f);
    acc += f;
    return v > 0.9999 ? 1 : v < 1e-4 ? 0 : v;
  });
};

type PadInk = {key: string; layout: HandLayout; progress: number; width: number; opacity?: number};

const PAD = (() => {
  const twenty = (i: number) => joinHand(layoutHand('20s', {size: 34, x: colX(i) - 4, y: 300, slant: 0.18, seed: `20s-${i}`}), handEllipse(colX(i) + 25, 286, 46, 28, `c20-${i}`));
  const tallies = (i: number) =>
    joinHand(
      ...Array.from({length: Math.min(4, NIGHT_TALLIES[i])}, (_, k) => handLine(colX(i) + 6 + k * 12, 168 + (k % 2) * 2, colX(i) + 4 + k * 12, 228, `t${i}${k}`)),
      ...(NIGHT_TALLIES[i] >= 5 ? [handLine(colX(i) - 4, 214, colX(i) + 50, 176, `t${i}x`)] : []),
    );
  return {
    tallies: [0, 1, 2, 3, 4].map(tallies),
    twenty: [0, 1, 2, 3, 4].map(twenty),
    fri: layoutHand('Fri', {size: 46, x: 44, y: 124, slant: 0.22, seed: 'fri'}),
    d23: layoutHand('23', {size: 46, x: 150, y: 126, slant: 0.22, seed: 'd23'}),
    price: ['$', '1', '1', '9', '?!'].map((c, i) => layoutHand(c, {size: 64, x: 42 + [0, 36, 66, 96, 134][i], y: 420, slant: 0.2, seed: `p${i}`})),
    under: [handLine(36, 438, 316, 432, 'u1'), handLine(42, 452, 312, 449, 'u2')],
    arrow: handArrow(330, 404, 384, 392, 'arr'),
    margin: layoutHand('(I’m $129)', {size: 30, x: 392, y: 404, slant: 0.16, rotate: -5, seed: 'mar'}),
  };
})();

const padInks = (n: StenoNotes): PadInk[] => {
  const nights = Math.max(0, Math.min(4, n.nights ?? 4));
  const out: PadInk[] = [];
  for (let i = 0; i < 4; i++) {
    const done = i < nights ? 1 : 0;
    out.push({key: `t${i}`, layout: PAD.tallies[i], progress: done, width: 3.4, opacity: 0.82});
    out.push({key: `w${i}`, layout: PAD.twenty[i], progress: done, width: 3.4, opacity: 0.82});
  }
  out.push({key: 't4', layout: PAD.tallies[4], progress: nights >= 4 ? 1 : 0, width: 3.4});
  out.push({key: 'w4', layout: PAD.twenty[4], progress: n.tonight ?? 0, width: 3.6});
  const [fa, fb] = split(n.fri ?? 0, [0.55, 0.45]);
  out.push({key: 'fri', layout: PAD.fri, progress: fa, width: 4.2});
  out.push({key: 'd23', layout: PAD.d23, progress: fb, width: 4.2});
  split(n.price ?? 0, [0.2, 0.2, 0.2, 0.2, 0.2]).forEach((p, i) => out.push({key: `p${i}`, layout: PAD.price[i], progress: p, width: 5}));
  split(n.underline ?? 0, [0.5, 0.5]).forEach((p, i) => out.push({key: `u${i}`, layout: PAD.under[i], progress: p, width: 4.2}));
  const [ma, mb] = split(n.margin ?? 0, [0.25, 0.75]);
  out.push({key: 'arr', layout: PAD.arrow, progress: ma, width: 3.4});
  out.push({key: 'mar', layout: PAD.margin, progress: mb, width: 3.4});
  return out;
};

/** The pen tip (pad units) for these notes: the end of the newest stroke being written, or of the last one written. */
export const stenoPenTip = (n: StenoNotes): Pt => {
  const inks = padInks(n);
  const active = inks.filter((x) => x.progress > 0 && x.progress < 1);
  const pick = active.length ? active[active.length - 1] : [...inks].reverse().find((x) => x.progress >= 1 && ['w4', 'd23', 'p4', 'u1', 'mar'].includes(x.key));
  return pick ? handTip(pick.layout, pick.progress) : [300, 330];
};

export type StenoPadProps = {
  notes?: StenoNotes;
  /** Draw the pen at the writing point. */
  pen?: boolean;
  /** Lift the pen off the paper (0..1). */
  penLift?: number;
  /** Light on the paper: colour and amount (night: teal). */
  light?: string;
  lightAmount?: number;
  /** 0..1 how lit the paper is overall (night ≈ 0.78). */
  exposure?: number;
  /** 0..1 bands of teal light across the paper (S12), shifted by bandShift (pad units). */
  bands?: number;
  bandShift?: number;
  /** With `pen`: draw the cardigan cuff the pen disappears into (S12). Default true. */
  cuff?: boolean;
};

/** The steno pad as an SVG <g> in pad units (600×900, origin top-left). */
export const StenoPadArt: React.FC<StenoPadProps> = ({notes = {}, pen = false, penLift = 0, light = NIGHT.teal, lightAmount = 0.22, exposure = 0.8, bands = 0, bandShift = 0, cuff = true}) => {
  const uid = useUid('sp');
  const inkBlue = LIGHT.infoSoftForeground;
  const paper = mix(NIGHT.paper, LIGHT.successSoft, 0.35);
  const inks = padInks(notes);
  const tip = stenoPenTip(notes);
  const lift = clamp01(penLift);
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}p`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={paper} />
          <stop offset="1" stopColor={mix(paper, NIGHT.ink, 0.12)} />
        </linearGradient>
        <linearGradient id={`${uid}band`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={light} stopOpacity={0} />
          <stop offset="0.5" stopColor={light} stopOpacity={0.55} />
          <stop offset="1" stopColor={light} stopOpacity={0} />
        </linearGradient>
        <clipPath id={`${uid}c`}>
          <rect x={0} y={22} width={600} height={878} rx={6} />
        </clipPath>
      </defs>
      {/* card back + paper */}
      <rect x={-6} y={18} width={612} height={888} rx={8} fill={mix(NIGHT.brass, NIGHT.ink, 0.62)} />
      <rect x={0} y={22} width={600} height={878} rx={6} fill={`url(#${uid}p)`} />
      <g clipPath={`url(#${uid}c)`}>
        {Array.from({length: 24}, (_, i) => (
          <rect key={i} x={0} y={92 + i * 34} width={600} height={1.6} fill={alpha(LIGHT.info, 0.22)} />
        ))}
        <rect x={299} y={22} width={2.2} height={878} fill={alpha(LIGHT.destructive, 0.32)} />
        {inks.map((x) => (x.progress > 0 ? <Ink key={x.key} layout={x.layout} progress={x.progress} color={inkBlue} width={x.width} opacity={x.opacity ?? 1} /> : null))}
        {/* light on the paper */}
        <rect x={0} y={22} width={600} height={878} fill={light} opacity={lightAmount} style={{mixBlendMode: 'multiply'}} />
        <rect x={0} y={22} width={600} height={878} fill={NIGHT.ink} opacity={1 - clamp01(exposure)} />
        {bands > 0
          ? [0, 1, 2].map((i) => (
              <rect key={i} x={-300 + i * 330 + bandShift} y={-200} width={140 + i * 40} height={1400} fill={`url(#${uid}band)`} opacity={bands * (0.6 - i * 0.12)} transform="rotate(28 300 450)" />
            ))
          : null}
      </g>
      {/* spiral */}
      {Array.from({length: 19}, (_, i) => (
        <g key={i}>
          <rect x={22 + i * 30.5} y={0} width={10} height={42} rx={5} fill="none" stroke={mix(NIGHT.grey, NIGHT.ink, 0.25)} strokeWidth={3.4} />
          <circle cx={27 + i * 30.5} cy={34} r={4} fill={mix(NIGHT.ink, NIGHT.wall, 0.4)} />
        </g>
      ))}
      {pen ? <Pen x={tip[0]} y={tip[1] - lift * 14} lift={lift} cuff={cuff} /> : null}
    </g>
  );
};

/** A ballpoint whose tip is at (x, y), barrel to the lower right; optionally a dark cardigan cuff swallowing its end (S12: no drawn hand). */
const Pen: React.FC<{x: number; y: number; lift: number; cuff: boolean}> = ({x, y, lift, cuff}) => {
  const sleeve = mix(NIGHT.redDeep, NIGHT.ink, 0.3);
  return (
    <g>
      <ellipse cx={x + 70 + lift * 30} cy={y + 46 + lift * 20} rx={80} ry={9} transform={`rotate(38 ${x + 70} ${y + 46})`} fill={alpha(NIGHT.ink, 0.2 * (1 - 0.6 * lift))} />
      <g transform={`translate(${x} ${y}) rotate(52)`}>
        <path d="M0 0 L22 -7 L22 7 Z" fill={mix(NIGHT.grey, NIGHT.ivory, 0.35)} />
        <rect x={22} y={-9} width={270} height={18} rx={6} fill={mix(NIGHT.ink, LIGHT.infoSoftForeground, 0.35)} />
        <rect x={22} y={-9} width={270} height={5} rx={2.5} fill={alpha(NIGHT.tealSoft, 0.35)} />
        <rect x={160} y={6} width={90} height={4} rx={2} fill={mix(NIGHT.grey, NIGHT.ivory, 0.2)} />
        {cuff ? (
          <g>
            <path d="M268 -64 Q300 -70 600 -84 L600 96 Q300 84 268 66 Q250 0 268 -64 Z" fill={sleeve} />
            <path d="M268 -64 Q250 0 268 66 L330 72 Q314 0 330 -68 Z" fill={mix(sleeve, NIGHT.ink, 0.25)} />
            {Array.from({length: 9}, (_, i) => -56 + i * 14).map((yy) => (
              <path key={yy} d={`M${270 - Math.abs(yy) * 0.12} ${yy} L${330 - Math.abs(yy) * 0.1} ${yy * 1.04}`} stroke={alpha(NIGHT.ink, 0.45)} strokeWidth={2.4} />
            ))}
            <path d="M268 -64 Q300 -70 600 -84" fill="none" stroke={alpha(NIGHT.tealSoft, 0.5)} strokeWidth={3} />
            <ellipse cx={262} cy={0} rx={10} ry={58} fill={NIGHT.ink} opacity={0.85} />
          </g>
        ) : null}
      </g>
    </g>
  );
};

/** The steno pad as a positioned full-frame layer: its top-left at (x, y), `width` frame px wide, rotated `rotate`°. */
export const StenoPad: React.FC<StenoPadProps & {x?: number; y?: number; width?: number; rotate?: number; style?: React.CSSProperties}> = ({x = 120, y = 480, width = 820, rotate = 0, style, ...rest}) => (
  <AbsoluteFill style={{pointerEvents: 'none', ...style}}>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${width / PAD_BOX.w})`}>
        <StenoPadArt {...rest} />
      </g>
    </svg>
  </AbsoluteFill>
);

// ─── Thermos + steam ────────────────────────────────────────────────────────

/** Native box of the thermos (local units). */
export const THERMOS_BOX = {w: 90, h: 250} as const;

/** Rising steam wisps above (0, 0). `amount` 0..1, `t` seconds for the drift. */
export const Steam: React.FC<{amount?: number; t?: number; scale?: number}> = ({amount = 1, t = 0, scale = 1}) => {
  if (amount <= 0.001) return null;
  return (
    <g transform={`scale(${scale})`} fill="none" strokeLinecap="round">
      {[0, 1, 2].map((i) => {
        const ph = t * (0.9 + i * 0.25) + i * 2.1;
        const rise = ((t * 0.35 + i * 0.33) % 1) * 30;
        const d = `M${-10 + i * 10} ${-rise} C ${-24 + i * 10 + Math.sin(ph) * 10} ${-40 - rise}, ${6 + i * 10 + Math.sin(ph + 1.4) * 14} ${-70 - rise}, ${-6 + i * 8 + Math.sin(ph + 2.2) * 12} ${-110 - rise}`;
        return <path key={i} d={d} stroke={NIGHT.ivory} strokeWidth={6 - i} opacity={amount * (0.22 - i * 0.05)} />;
      })}
    </g>
  );
};

/** The thermos (local box 90×250, cap on top). `capOff` shows the open stopper (S17 sip) with steam. */
export const Thermos: React.FC<{rim?: string; under?: string; capOff?: boolean; steam?: number; t?: number}> = ({rim = NIGHT.tealSoft, under = DARK.successSoftForeground, capOff = false, steam = 0, t = 0}) => {
  const uid = useUid('th');
  const body = mix(NIGHT.ink, NIGHT.tealDeep, 0.85);
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}b`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={mix(body, rim, 0.35)} />
          <stop offset="0.18" stopColor={body} />
          <stop offset="0.7" stopColor={mix(body, NIGHT.ink, 0.5)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={`${uid}m`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={mix(NIGHT.grey, rim, 0.3)} />
          <stop offset="0.3" stopColor={mix(NIGHT.grey, NIGHT.ink, 0.4)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
      </defs>
      <rect x={10} y={56} width={70} height={194} rx={12} fill={`url(#${uid}b)`} />
      <rect x={10} y={84} width={70} height={10} fill={alpha(NIGHT.ink, 0.45)} />
      <rect x={10} y={210} width={70} height={8} fill={alpha(NIGHT.ink, 0.35)} />
      <rect x={12} y={60} width={4} height={186} rx={2} fill={alpha(rim, 0.6)} />
      <path d="M12 246 Q45 254 78 246" fill="none" stroke={alpha(under, 0.5)} strokeWidth={3} />
      <path d={`M80 110 Q98 112 98 140 L98 170 Q98 190 80 190`} fill="none" stroke={mix(body, NIGHT.ink, 0.3)} strokeWidth={8} />
      {capOff ? (
        <g>
          <rect x={22} y={40} width={46} height={18} rx={5} fill={`url(#${uid}m)`} />
          <rect x={28} y={30} width={34} height={12} rx={5} fill={mix(NIGHT.ink, NIGHT.grey, 0.3)} />
          <g transform="translate(45 30)">
            <Steam amount={steam} t={t} />
          </g>
        </g>
      ) : (
        <g>
          <rect x={4} y={0} width={82} height={60} rx={10} fill={`url(#${uid}m)`} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={10 + i * 13} y={6} width={3} height={48} fill={alpha(NIGHT.ink, 0.35)} />
          ))}
          <rect x={6} y={2} width={3} height={56} rx={1.5} fill={alpha(rim, 0.7)} />
          {steam > 0 ? (
            <g transform="translate(45 0)">
              <Steam amount={steam} t={t} />
            </g>
          ) : null}
        </g>
      )}
    </g>
  );
};

// ─── Rearview mirror ────────────────────────────────────────────────────────

/** Native box of the mirror (local units). */
export const MIRROR_BOX = {w: 480, h: 240} as const;

/**
 * The rearview mirror (local 480×240). Through the rear window behind her,
 * across the road: Rita's own motel, mirror-reversed: the red arrow sign and a
 * dark lobby window with one small white glow (`pulse`, use missedPulse()).
 */
export const RearviewMirror: React.FC<{pulse?: number; neon?: number; dawn?: number}> = ({pulse = 0.5, neon = 1, dawn = 0}) => {
  const uid = useUid('rv');
  const p = clamp01(pulse);
  return (
    <g>
      <defs>
        <clipPath id={`${uid}g`}>
          <rect x={16} y={16} width={448} height={208} rx={50} />
        </clipPath>
        <linearGradient id={`${uid}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(NIGHT.wallLow, NIGHT.tealSoft, 0.12)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <radialGradient id={`${uid}b`}>
          <stop offset="0" stopColor={NIGHT.phoneGlow} stopOpacity={0.9} />
          <stop offset="0.25" stopColor={NIGHT.phoneBloom} stopOpacity={0.45} />
          <stop offset="1" stopColor={NIGHT.phoneBloom} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={NIGHT.ivory} stopOpacity={0} />
          <stop offset="0.5" stopColor={NIGHT.ivory} stopOpacity={0.08} />
          <stop offset="1" stopColor={NIGHT.ivory} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* mount stem */}
      <rect x={226} y={-60} width={28} height={70} rx={8} fill={mix(NIGHT.ink, NIGHT.wall, 0.5)} />
      <rect x={6} y={6} width={468} height={228} rx={58} fill={`url(#${uid}h)`} />
      <rect x={6} y={6} width={468} height={228} rx={58} fill="none" stroke={alpha(NIGHT.tealSoft, 0.35)} strokeWidth={2} />
      <rect x={14} y={14} width={452} height={212} rx={52} fill={mix(NIGHT.grey, NIGHT.ink, 0.5)} />
      <g clipPath={`url(#${uid}g)`}>
        <rect x={16} y={16} width={448} height={208} fill={NIGHT.ink} />
        {/* outside, through the rear window: her own motel, reversed */}
        <g transform="translate(240 126) scale(-0.24 0.24) translate(-560 -800)">
          <RitasMotelFacade neon={neon} road lobby={{phoneState: 'missed', screen: p, doorNeon: 0.3, missedTime: '2:21'}} />
        </g>
        {/* the dark lobby; only the phone's glow carries (screen centre: facade (556.8, 966.5) → mirror) */}
        <rect x={100} y={106} width={280} height={90} fill={NIGHT.ink} opacity={0.35} />
        <circle cx={240.8} cy={166} r={26} fill={`url(#${uid}b)`} opacity={0.35 + 0.65 * p} />
        {/* the car's own cabin around the rear window */}
        <path d="M16 16 H464 V224 H16 Z M78 62 Q82 40 110 38 L370 38 Q398 40 402 62 L416 176 Q418 196 396 196 L84 196 Q62 196 64 176 Z" fill={mix(NIGHT.ink, NIGHT.wall, 0.3)} fillRule="evenodd" />
        <path d="M78 62 Q82 40 110 38 L370 38 Q398 40 402 62" fill="none" stroke={alpha(NIGHT.tealSoft, 0.25)} strokeWidth={2} />
        {/* rear headrests */}
        <rect x={110} y={150} width={78} height={70} rx={22} fill={mix(NIGHT.ink, NIGHT.wall, 0.45)} />
        <rect x={292} y={150} width={78} height={70} rx={22} fill={mix(NIGHT.ink, NIGHT.wall, 0.45)} />
        <rect x={110} y={150} width={78} height={4} rx={2} fill={alpha(NIGHT.tealSoft, 0.2)} />
        <rect x={292} y={150} width={78} height={4} rx={2} fill={alpha(NIGHT.tealSoft, 0.2)} />
        {dawn > 0 ? <rect x={16} y={16} width={448} height={208} fill={LIGHT.background} opacity={0.35 * dawn} /> : null}
        <path d="M60 224 L250 16 L320 16 L130 224 Z" fill={`url(#${uid}s)`} />
      </g>
    </g>
  );
};

// ─── Cabin ──────────────────────────────────────────────────────────────────

export type CarLayer = 'all' | 'back' | 'front';

export type CarInteriorProps = {
  /** 'back' = everything behind Rita (windows, view, pillar, headliner, dash, mirror); 'front' = wheel, pad, thermos; 'all' = both. */
  layer?: CarLayer;
  /** Camera on the set (same convention as the Lobby: scale about (ox, oy), default (540, 960), then move by (x, y)). */
  camera?: Crop;
  /** Green dash clock. */
  clock?: string;
  /** 0..1 the STARLITE sign through the windshield (flicker; S21 switch-off). */
  neon?: number;
  /** 0..1 dawn: sky ink → Lagoon → ivory, neon light falls away, the office glass goes to day. */
  dawn?: number;
  /** Gus's office through the windshield (the shared Lobby, teal). */
  office?: Omit<LobbyProps, 'crop'>;
  /** Steno pad on the wheel and its notes; false hides it (S12 uses StenoPad on its own). */
  pad?: StenoNotes | false;
  pen?: boolean;
  /** 0..1 the white glow in the rearview mirror (missed call, 1 Hz). */
  mirrorPulse?: number;
  /** 0..1 steam from the thermos; `time` (s) drives its drift. */
  steam?: number;
  time?: number;
  /** 0..1 a light sweep across the dash (S11 headlight reflection), by progress. */
  dashSweep?: number;
};

/** Where things sit at the rest framing (frame px). */
export const CAR = {
  windshield: {x: 650, y: 190, w: 750, h: 864},
  mirror: {x: 774, y: 204, w: 172, h: 86, scale: 172 / 480},
  clock: {x: 826, y: 1094, w: 112, h: 52},
  pad: {x: 512, y: 948, w: 272, h: 172},
  thermos: {x: 868, y: 1162, w: 74, h: 206},
  wheel: {cx: 640, cy: 1164},
  /** Starlite office window through the windshield. */
  office: {x: 726, y: 606, w: 600, h: 214},
  sign: {x: 704, y: 300, scale: 0.86},
} as const;

const camT = (c?: Crop) => {
  if (!c) return undefined;
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return `translate(${ox + c.x} ${oy + c.y}) scale(${c.scale}) translate(${-ox} ${-oy})`;
};

/** Sky colour at dawn progress k (ink → Lagoon → ivory). */
const skyAt = (k: number) => {
  const d = clamp01(k);
  return d < 0.5 ? mix(NIGHT.ink, LIGHT.primary, d * 2) : mix(LIGHT.primary, LIGHT.background, (d - 0.5) * 2);
};

const WindshieldView: React.FC<{neon: number; dawn: number; office?: Omit<LobbyProps, 'crop'>; uid: string}> = ({neon, dawn, office, uid}) => {
  const n = clamp01(neon);
  const d = clamp01(dawn);
  const O = CAR.office;
  const G = CAR.sign;
  const night = 1 - d;
  // the dawn sweeps upward from the bottom: lower stops lead
  const dk = (lead: number) => clamp01(d * 1.7 - lead);
  const day = (a: string, b: string, k: number) => mix(a, b, clamp01(k));
  const stucco = (k: number) => day(mix(NIGHT.wallLow, NIGHT.teal, 0.2 * n), mix(LIGHT.accent, LIGHT.borderStrong, 0.35), k);
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}sky`} x1="0" y1="190" x2="0" y2="600" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={skyAt(dk(0.7))} />
          <stop offset="0.6" stopColor={mix(skyAt(dk(0.45)), NIGHT.tealDeep, 0.35 * night)} />
          <stop offset="1" stopColor={mix(skyAt(dk(0.25)), NIGHT.tealDeep, 0.6 * night)} />
        </linearGradient>
        <linearGradient id={`${uid}wall`} x1="0" y1="560" x2="0" y2="930" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={stucco(dk(0.3))} />
          <stop offset="1" stopColor={day(mix(NIGHT.ink, NIGHT.tealDeep, 0.6), mix(LIGHT.accent, LIGHT.borderStrong, 0.6), dk(0))} />
        </linearGradient>
        <linearGradient id={`${uid}hood`} x1="0" y1="900" x2="0" y2="1060" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={day(mix(NIGHT.wall, NIGHT.teal, 0.12 * n), mix(NIGHT.ink, LIGHT.borderStrong, 0.55), dk(0))} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <clipPath id={`${uid}ow`}>
          <rect x={O.x} y={O.y} width={O.w} height={O.h} />
        </clipPath>
        <radialGradient id={`${uid}halo`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset="0" stopColor={NIGHT.teal} stopOpacity={0.5} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x={560} y={160} width={900} height={460} fill={`url(#${uid}sky)`} />
      <g opacity={night * night}>
        <Stars x={560} y={180} w={900} h={260} n={18} seed="windshield" size={1.3} opacity={0.6} />
      </g>
      <ellipse cx={G.x + 112} cy={430} rx={340} ry={260} fill={`url(#${uid}halo)`} opacity={n * night} />
      {/* the office front: roof edge with the canopy neon, stucco, the plate window */}
      <rect x={560} y={566} width={900} height={380} fill={`url(#${uid}wall)`} />
      <rect x={560} y={548} width={900} height={22} fill={day(mix(NIGHT.ink, NIGHT.wall, 0.6), LIGHT.mutedForeground, dk(0.35))} />
      <rect x={560} y={567} width={900} height={5} fill={NIGHT.teal} opacity={(0.3 + 0.6 * n) * night} />
      <rect x={560} y={572} width={900} height={18} fill={alpha(NIGHT.ink, 0.3)} />
      <rect x={O.x - 14} y={O.y - 14} width={O.w + 28} height={O.h + 28} fill={day(mix(NIGHT.ink, NIGHT.wall, 0.4), LIGHT.mutedForeground, dk(0.2))} />
      <g clipPath={`url(#${uid}ow)`}>
        <rect x={O.x} y={O.y} width={O.w} height={O.h} fill={NIGHT.ink} />
        <g opacity={1 - 0.8 * dk(0.2)} transform={`translate(${O.x + O.w * 0.3} ${O.y + O.h * 0.5}) scale(0.5) translate(-505 -905)`}>
          <LobbyArt tint="teal" windowView="none" phoneState="dark" {...office} />
        </g>
        <rect x={O.x} y={O.y} width={O.w} height={O.h} fill={skyAt(0.75)} opacity={0.7 * dk(0.2)} />
        <path d={`M${O.x + 60} ${O.y + O.h} L${O.x + 200} ${O.y} L${O.x + 250} ${O.y} L${O.x + 110} ${O.y + O.h} Z`} fill={NIGHT.ivory} opacity={0.05 + 0.12 * d} />
      </g>
      <rect x={O.x + O.w * 0.64} y={O.y} width={7} height={O.h} fill={day(mix(NIGHT.ink, NIGHT.wall, 0.4), LIGHT.mutedForeground, dk(0.2))} />
      {/* the rooftop sign, up through the top of the glass */}
      <g transform={`translate(${G.x} ${G.y}) scale(${G.scale})`}>
        <StarliteSign on={n} halo={night} pole={(560 - G.y) / G.scale - 300} />
      </g>
      {/* lot, then the hood of her car */}
      <rect x={560} y={930} width={900} height={160} fill={day(mix(NIGHT.ink, NIGHT.wallLow, 0.6), mix(LIGHT.accent, LIGHT.borderStrong, 0.5), dk(0))} />
      <ellipse cx={900} cy={940} rx={420} ry={40} fill={NIGHT.teal} opacity={0.12 * n * night} />
      <path d="M600 1080 L600 972 Q900 916 1460 936 L1460 1080 Z" fill={`url(#${uid}hood)`} />
      <path d="M600 972 Q900 916 1460 936" fill="none" stroke={day(NIGHT.tealSoft, LIGHT.background, d)} strokeWidth={2.5} opacity={0.3 + 0.4 * n * night + 0.3 * d} />
      <path d="M780 952 Q1000 930 1300 936" fill="none" stroke={alpha(NIGHT.ivory, 0.07 + 0.08 * d)} strokeWidth={12} strokeLinecap="round" />
    </g>
  );
};

const CarBack: React.FC<Required<Pick<CarInteriorProps, 'neon' | 'dawn' | 'clock' | 'mirrorPulse' | 'dashSweep'>> & {office?: Omit<LobbyProps, 'crop'>; uid: string}> = ({neon, dawn, clock, mirrorPulse, dashSweep, office, uid}) => {
  const d = clamp01(dawn);
  const night = 1 - d;
  const n = clamp01(neon);
  const green = DARK.successSoftForeground;
  const M = CAR.mirror;
  const C = CAR.clock;
  const rim = mix(NIGHT.tealSoft, LIGHT.background, d);
  const trim = mix(NIGHT.ink, NIGHT.wall, 0.75); // interior plastics
  const trimLit = mix(trim, NIGHT.wallLow, 0.6);
  const windshield = 'M650 226 Q1000 196 1400 190 L1400 1046 L782 1056 Z';
  const driverWin = 'M-300 384 Q150 344 552 340 Q578 342 584 368 L676 930 L-300 954 Z';
  return (
    <g>
      <defs>
        <clipPath id={`${uid}ws`}>
          <path d={windshield} />
        </clipPath>
        <clipPath id={`${uid}dw`}>
          <path d={driverWin} />
        </clipPath>
        <linearGradient id={`${uid}dwg`} x1="0" y1="340" x2="0" y2="950" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, skyAt(clamp01(d * 1.7 - 0.6)), 0.85)} />
          <stop offset="0.75" stopColor={mix(mix(NIGHT.ink, NIGHT.wall, 0.8), skyAt(clamp01(d * 1.7 - 0.2)), 0.7 * d)} />
          <stop offset="1" stopColor={mix(NIGHT.ink, LIGHT.borderStrong, 0.4 * d)} />
        </linearGradient>
        <linearGradient id={`${uid}dash`} x1="0" y1="1040" x2="0" y2="1340" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(trimLit, rim, 0.12)} />
          <stop offset="0.18" stopColor={trim} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={`${uid}pillar`} x1="560" y1="0" x2="780" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} />
          <stop offset="0.75" stopColor={trim} />
          <stop offset="1" stopColor={mix(trim, rim, 0.25)} />
        </linearGradient>
        <linearGradient id={`${uid}head`} x1="0" y1="-300" x2="0" y2="300" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} />
          <stop offset="1" stopColor={mix(trim, rim, 0.06 + 0.1 * d)} />
        </linearGradient>
        <radialGradient id={`${uid}red`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset="0" stopColor={NIGHT.red} stopOpacity={0.42} />
          <stop offset="1" stopColor={NIGHT.red} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${uid}grn`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset="0" stopColor={green} stopOpacity={0.4} />
          <stop offset="1" stopColor={green} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${uid}spill`} cx={0.5} cy={0.5} r={0.5}>
          <stop offset="0" stopColor={rim} stopOpacity={0.16} />
          <stop offset="1" stopColor={rim} stopOpacity={0} />
        </radialGradient>
        <filter id={`${uid}gl`} x="-40%" y="-60%" width="180%" height="220%">
          <feGaussianBlur stdDeviation={6} />
        </filter>
      </defs>
      {/* cabin */}
      <rect x={-300} y={-300} width={1700} height={2500} fill={NIGHT.ink} />
      {/* driver's window behind her: the night, her own sign glowing far off to the rear */}
      <g clipPath={`url(#${uid}dw)`}>
        <rect x={-300} y={330} width={1000} height={640} fill={`url(#${uid}dwg)`} />
        <ellipse cx={-60} cy={760} rx={420} ry={240} fill={`url(#${uid}red)`} opacity={0.9 * night} />
        {[[-150, 770, 7, NIGHT.red], [20, 790, 4, NIGHT.brassLight], [130, 784, 3, NIGHT.brassLight], [280, 800, 2.5, NIGHT.brassLight], [420, 806, 2, NIGHT.teal]].map(([x, y, r, c], i) => (
          <circle key={i} cx={x as number} cy={y as number} r={(r as number) * 3} fill={c as string} opacity={(i === 0 ? 0.4 : 0.22) * night} filter={`url(#${uid}gl)`} />
        ))}
        <path d="M-300 826 Q200 812 700 820 L700 980 L-300 980 Z" fill={mix(mix(NIGHT.ink, NIGHT.wall, 0.4), LIGHT.borderStrong, 0.35 * d)} />
        <path d="M-300 930 L640 600 L660 680 L-300 980 Z" fill={NIGHT.ivory} opacity={0.025} />
      </g>
      {/* windshield + view */}
      <g clipPath={`url(#${uid}ws)`}>
        <WindshieldView neon={neon} dawn={d} office={office} uid={uid} />
        <rect x={640} y={990} width={760} height={70} fill={green} opacity={0.07 * night} />
        <path d="M800 1056 L1090 190 L1160 190 L870 1056 Z" fill={NIGHT.ivory} opacity={0.03} />
      </g>
      {/* headliner, door frame, A-pillar */}
      <path d="M-300 -300 L1400 -300 L1400 190 Q1000 196 650 226 L566 232 Q200 256 -300 296 Z" fill={`url(#${uid}head)`} />
      <path d="M-300 296 Q200 256 566 232 L586 368 Q578 342 552 340 Q150 344 -300 384 Z" fill={trim} />
      <path d="M-300 384 Q150 344 552 340" fill="none" stroke={alpha(rim, 0.22)} strokeWidth={2.5} />
      <path d="M566 232 L650 226 L782 1056 L676 1062 Z" fill={`url(#${uid}pillar)`} />
      <path d="M650 226 L782 1056" stroke={rim} strokeWidth={3} opacity={0.4 + 0.3 * n * night} />
      <path d="M650 226 Q1000 196 1400 190" fill="none" stroke={rim} strokeWidth={2.5} opacity={0.35} />
      {/* folded visor + rearview mirror */}
      <path d="M700 188 Q1000 168 1400 164 L1400 196 Q1000 200 704 222 Z" fill={mix(trim, NIGHT.ink, 0.2)} />
      <g transform={`translate(${M.x} ${M.y}) scale(${M.scale})`}>
        <RearviewMirror pulse={mirrorPulse} neon={1} dawn={d} />
      </g>
      {/* dashboard */}
      <path d="M676 1062 L782 1056 L1400 1044 L1400 1420 L560 1420 L560 1100 Q600 1066 676 1062 Z" fill={`url(#${uid}dash)`} />
      <path d="M676 1062 L782 1056 L1400 1044" fill="none" stroke={rim} strokeWidth={2.5} opacity={0.45} />
      <ellipse cx={1000} cy={1070} rx={420} ry={60} fill={`url(#${uid}spill)`} opacity={0.6 + 0.4 * n * night} />
      {/* instrument hood behind the wheel, its green glow */}
      <path d="M548 1104 Q580 1010 690 1006 Q790 1006 812 1092 Z" fill={mix(trim, NIGHT.ink, 0.15)} />
      <path d="M566 1094 Q596 1020 690 1016 Q780 1016 800 1088" fill="none" stroke={alpha(green, 0.4 * night)} strokeWidth={2} />
      <ellipse cx={690} cy={1086} rx={150} ry={46} fill={`url(#${uid}grn)`} opacity={night} />
      {/* green dash clock */}
      <rect x={C.x - 6} y={C.y - 6} width={C.w + 12} height={C.h + 12} rx={12} fill={mix(trim, NIGHT.ink, 0.3)} />
      <rect x={C.x} y={C.y} width={C.w} height={C.h} rx={7} fill={NIGHT.ink} />
      <rect x={C.x + 1} y={C.y + 1} width={C.w - 2} height={3} rx={1.5} fill={alpha(rim, 0.25)} />
      <ellipse cx={C.x + C.w / 2} cy={C.y + C.h / 2} rx={120} ry={56} fill={`url(#${uid}grn)`} opacity={night} />
      <text x={C.x + C.w / 2} y={C.y + 39} textAnchor="middle" fontFamily={FONT.mono} fontWeight={500} fontSize={40} fill={green} filter={`url(#${uid}gl)`} opacity={0.8 * night}>
        {clock}
      </text>
      <text x={C.x + C.w / 2} y={C.y + 39} textAnchor="middle" fontFamily={FONT.mono} fontWeight={500} fontSize={40} fill={mix(green, NIGHT.ivory, 0.25)} opacity={0.45 + 0.55 * night}>
        {clock}
      </text>
      {/* vents */}
      {[0, 1].map((i) => (
        <g key={i}>
          <rect x={968 + i * 150} y={1104} width={120} height={38} rx={9} fill={mix(NIGHT.ink, trim, 0.5)} />
          {[0, 1, 2, 3].map((k) => (
            <rect key={k} x={976 + i * 150} y={1111 + k * 8} width={104} height={2.2} fill={alpha(NIGHT.ink, 0.85)} />
          ))}
          <rect x={968 + i * 150} y={1104} width={120} height={2} rx={1} fill={alpha(rim, 0.2)} />
        </g>
      ))}
      {dashSweep > 0 && dashSweep < 1 ? (
        <g clipPath={`url(#${uid}ws)`}>
          <rect x={560 + dashSweep * 1000 - 140} y={900} width={150} height={200} fill={NIGHT.ivory} opacity={0.14 * Math.sin(dashSweep * Math.PI)} transform="skewX(-28)" />
        </g>
      ) : null}
      {dashSweep > 0 && dashSweep < 1 ? <rect x={560 + dashSweep * 1000 - 120} y={1044} width={170} height={60} fill={NIGHT.ivory} opacity={0.12 * Math.sin(dashSweep * Math.PI)} transform="skewX(-35)" /> : null}
      {/* driver's seat headrest behind her head */}
      <path d="M150 640 Q150 560 240 556 Q330 556 336 640 L336 742 Q336 790 290 792 L196 792 Q150 790 150 742 Z" fill={mix(trim, NIGHT.ink, 0.25)} />
      <path d="M150 700 Q150 560 240 556 Q330 556 336 640" fill="none" stroke={alpha(NIGHT.red, 0.35 * night)} strokeWidth={3} />
      <rect x={196} y={792} width={12} height={56} fill={mix(NIGHT.grey, NIGHT.ink, 0.55)} />
      <rect x={282} y={792} width={12} height={56} fill={mix(NIGHT.grey, NIGHT.ink, 0.55)} />
      {/* door: belt line, panel, armrest */}
      <path d="M-300 954 L676 930 L690 990 L-300 1012 Z" fill={trim} />
      <path d="M-300 954 L676 930" stroke={alpha(rim, 0.25)} strokeWidth={2} />
      <path d="M-300 1012 L690 990 Q620 1300 560 1600 L-300 1600 Z" fill={mix(NIGHT.ink, trim, 0.45)} />
      <path d="M-300 1170 L560 1150 Q580 1160 578 1180 L-300 1206 Z" fill={trim} />
      <path d="M-300 1170 L560 1150" stroke={alpha(rim, 0.18)} strokeWidth={2} />
      <rect x={-120} y={1072} width={70} height={14} rx={7} fill={mix(NIGHT.grey, NIGHT.ink, 0.45)} />
      {d > 0 ? <rect x={-300} y={-300} width={1700} height={2500} fill={LIGHT.background} opacity={0.06 * d} /> : null}
    </g>
  );
};

const CarFront: React.FC<{pad: StenoNotes | false; pen: boolean; steam: number; time: number; dawn: number; neon: number}> = ({pad, pen, steam, time, dawn, neon}) => {
  const uid = useUid('cf');
  const d = clamp01(dawn);
  const night = 1 - d;
  const green = DARK.successSoftForeground;
  const P = CAR.pad;
  const T = CAR.thermos;
  const W = CAR.wheel;
  const rim = mix(NIGHT.tealSoft, LIGHT.background, d);
  const trim = mix(NIGHT.ink, NIGHT.wall, 0.75);
  const rot = -16;
  const ring = `M${W.cx - 206} ${W.cy} A206 134 0 1 1 ${W.cx + 206} ${W.cy} A206 134 0 1 1 ${W.cx - 206} ${W.cy} Z M${W.cx - 176} ${W.cy} A176 108 0 1 0 ${W.cx + 176} ${W.cy} A176 108 0 1 0 ${W.cx - 176} ${W.cy} Z`;
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}w`} x1="0" y1={W.cy - 140} x2="0" y2={W.cy + 140} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(trim, rim, 0.18)} />
          <stop offset="0.3" stopColor={trim} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
      </defs>
      {/* steering wheel: hub, spokes, rim */}
      <g transform={`rotate(${rot} ${W.cx} ${W.cy})`}>
        <path d={`M${W.cx - 180} ${W.cy + 6} L${W.cx - 50} ${W.cy + 10} L${W.cx - 50} ${W.cy + 30} L${W.cx - 176} ${W.cy + 28} Z`} fill={mix(trim, NIGHT.ink, 0.3)} />
        <path d={`M${W.cx + 180} ${W.cy + 6} L${W.cx + 50} ${W.cy + 10} L${W.cx + 50} ${W.cy + 30} L${W.cx + 176} ${W.cy + 28} Z`} fill={mix(trim, NIGHT.ink, 0.3)} />
        <ellipse cx={W.cx} cy={W.cy + 14} rx={66} ry={46} fill={mix(trim, NIGHT.ink, 0.15)} />
        <ellipse cx={W.cx} cy={W.cy + 8} rx={52} ry={34} fill={trim} />
        <path d={`M${W.cx - 50} ${W.cy} Q${W.cx} ${W.cy - 30} ${W.cx + 50} ${W.cy}`} fill="none" stroke={alpha(rim, 0.25)} strokeWidth={2} />
        <path d={ring} fill={`url(#${uid}w)`} fillRule="evenodd" />
        <path d={`M${W.cx - 200} ${W.cy - 10} A204 132 0 0 1 ${W.cx + 120} ${W.cy - 112}`} fill="none" stroke={rim} strokeWidth={2.5} opacity={0.35 + 0.35 * neon * night + 0.3 * d} />
        <path d={`M${W.cx - 190} ${W.cy + 60} A204 132 0 0 0 ${W.cx + 150} ${W.cy + 96}`} fill="none" stroke={alpha(green, 0.4 * night)} strokeWidth={2.5} />
      </g>
      {pad ? (
        <g transform={`translate(${P.x} ${P.y}) rotate(-3) scale(${P.w / PAD_BOX.w} ${(P.w / PAD_BOX.w) * 0.62})`}>
          <StenoPadArt notes={pad} pen={pen} cuff={false} exposure={0.64 + 0.36 * d} lightAmount={0.28 * night} />
        </g>
      ) : null}
      {/* thermos in the cup holder */}
      <g transform={`translate(${T.x} ${T.y}) scale(${T.w / THERMOS_BOX.w})`}>
        <Thermos rim={rim} steam={steam} t={time} />
      </g>
      <path d={`M${T.x - 18} ${T.y + T.h - 26} Q${T.x + T.w / 2} ${T.y + T.h - 40} ${T.x + T.w + 18} ${T.y + T.h - 26} L${T.x + T.w + 22} ${T.y + T.h + 40} L${T.x - 22} ${T.y + T.h + 40} Z`} fill={mix(trim, NIGHT.ink, 0.2)} />
      <path d={`M${T.x - 18} ${T.y + T.h - 26} Q${T.x + T.w / 2} ${T.y + T.h - 40} ${T.x + T.w + 18} ${T.y + T.h - 26}`} fill="none" stroke={alpha(rim, 0.3)} strokeWidth={2} />
    </g>
  );
};

/** Rita's car interior as a full-frame layer (see the file header). */
export const CarInterior: React.FC<CarInteriorProps & {style?: React.CSSProperties}> = ({
  layer = 'all',
  camera,
  clock = '2:14',
  neon = 1,
  dawn = 0,
  office,
  pad = {},
  pen = false,
  mirrorPulse = 0.5,
  steam = 0,
  time = 0,
  dashSweep = 0,
  style,
}) => {
  const uid = useUid('car');
  return (
    <AbsoluteFill style={{background: layer === 'front' ? 'transparent' : NIGHT.ink, pointerEvents: 'none', ...style}}>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <g transform={camT(camera)}>
          {layer !== 'front' ? <CarBack neon={neon} dawn={dawn} clock={clock} mirrorPulse={mirrorPulse} dashSweep={dashSweep} office={office} uid={uid} /> : null}
          {layer !== 'back' ? <CarFront pad={pad} pen={pen} steam={steam} time={time} dawn={dawn} neon={neon} /> : null}
        </g>
      </svg>
    </AbsoluteFill>
  );
};

/** Frame px of a rest-framing point under a camera (for placing Rita or text on the set). */
export const carToFrame = (p: {x: number; y: number}, c: Crop = {scale: 1, x: 0, y: 0}) => {
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return {x: ox + (p.x - ox) * c.scale + c.x, y: oy + (p.y - oy) * c.scale + c.y};
};

/** A camera that puts the rearview mirror at frame rect (x, y, w) — S17's base framing is mirrorCamera(300, 520, 480). */
export const mirrorCamera = (x: number, y: number, w: number): Crop => {
  const M = CAR.mirror;
  const scale = w / M.w;
  return {scale, ox: 0, oy: 0, x: x - M.x * scale, y: y - M.y * scale};
};
