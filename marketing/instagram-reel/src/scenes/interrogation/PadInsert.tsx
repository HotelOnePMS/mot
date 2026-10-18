// S12 (24.0–27.0): top-down close-up of the steno pad on the wheel. The four circled "20s" tallies and
// tonight's fifth, "Fri 23" at the top, bands of teal light across the paper. Only the pen tip and a cuff
// silhouette are in frame (no drawn hand). "$119?!" stroke-draws on 16ths on "a hundred nineteen", a double
// underline, then an arrow and "(I’m $129)" in the margin. 2% push, hard cut at 27.0.
import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {PAD_BOX, StenoPadArt, stenoPenTip, type StenoNotes} from '../../set/CarInterior.tsx';
import {alpha, mix} from '../../set/parts.tsx';
import {perlin1} from '../../fx/noise.ts';
import {LIGHT, NIGHT} from '../../theme.ts';
import type {P} from '../../char/rig.ts';
import {S12, S12_AT, S13_AT, clamp, easeInOut, lf, notesAt, secOf} from './common.ts';

/** The pad in frame px: 820 wide (x 120–940); its written rows ("Fri 23" … the underline) land in y ≈ 560–1100. */
const PAD_W = 820;
const K = PAD_W / PAD_BOX.w;
const PAD_H = PAD_BOX.h * K;
const PAD_ROT = -1.6;
/** Teal light bands: angle (deg) and the slow drift of the light (pad units over the shot). */
const BAND_ANGLE = 28;

const padXY = (paid: boolean) => ({x: 120, y: paid ? 352 : 468});

/** Pad units → frame px (before the push). */
const toFrame = (p: P, paid: boolean): P => {
  const o = padXY(paid);
  const cx = PAD_W / 2;
  const cy = PAD_H / 2;
  const x = p[0] * K - cx;
  const y = p[1] * K - cy;
  const r = (PAD_ROT * Math.PI) / 180;
  return [o.x + cx + x * Math.cos(r) - y * Math.sin(r), o.y + cy + x * Math.sin(r) + y * Math.cos(r)];
};

const tipOf = (n: StenoNotes): P => {
  const t = stenoPenTip(n);
  return [t[0], t[1]];
};

/** Where the pen is (pad units) and how high it is lifted (0 = on the paper, 1 = well up), from absolute seconds. */
const penState = (frame: number): {tip: P; lift: number} => {
  const sec = secOf(frame);
  const notes = notesAt(sec);
  const writeStart = lf(S12.price[0].t);
  const marginEnd = S12.margin[S12.margin.length - 1];
  const writeEnd = lf(marginEnd.t + marginEnd.dur);
  const end23 = tipOf({nights: 4, tonight: 1, fri: 1});
  const dollar = tipOf({nights: 4, tonight: 1, fri: 1, price: 0.002});
  if (frame < writeStart) {
    // just finished "23": lift off, drift over the page while she listens ("a queen room"), then line up on the "$"
    const travel = interpolate(frame, [S12_AT + 4, writeStart - 1], [0, 1], {...clamp, easing: easeInOut});
    const wob: P = [perlin1('s12x', frame / 14) * 9, perlin1('s12y', frame / 17) * 7];
    const mid: P = [end23[0] + (dollar[0] - end23[0]) * travel + wob[0] * (1 - travel), end23[1] + (dollar[1] - end23[1]) * travel + wob[1] * (1 - travel)];
    const lift = interpolate(frame, [S12_AT, S12_AT + 5, writeStart - 6, writeStart], [0.2, 0.75, 0.6, 0], {...clamp, easing: easeInOut});
    return {tip: mid, lift};
  }
  const tip = tipOf(notes);
  // tiny hops between strokes; up and away at the end
  const lift = frame >= writeEnd ? interpolate(frame, [writeEnd, writeEnd + 3], [0.15, 0.8], clamp) : 0;
  return {tip, lift};
};

export const PadInsert: React.FC<{frame: number; paid?: boolean}> = ({frame, paid = false}) => {
  const sec = secOf(frame);
  const notes = notesAt(sec);
  const k = interpolate(frame, [S12_AT, S13_AT], [0, 1], clamp);
  const push = 1 + 0.02 * k;
  const o = padXY(paid);
  // push about the written block's centre
  const fx = 505;
  const fy = o.y + 330;
  const bandShift = interpolate(frame, [S12_AT, S13_AT], [-70, 70]);
  // the light breathes a touch, like neon through glass
  const bands = 0.85 + 0.15 * perlin1('s12band', frame / 8);
  const pen = penState(frame);
  const prev = frame > S12_AT ? penState(frame - 1) : pen;
  const jump = Math.hypot(pen.tip[0] - prev.tip[0], pen.tip[1] - prev.tip[1]);
  const tipF = toFrame(pen.tip, paid);
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <defs>
          <linearGradient id="int-dash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={mix(NIGHT.tealDeep, NIGHT.ink, 0.15)} />
            <stop offset="0.35" stopColor={mix(NIGHT.tealDeep, NIGHT.ink, 0.6)} />
            <stop offset="1" stopColor={NIGHT.ink} />
          </linearGradient>
          <linearGradient id="int-lap" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
            <stop offset="1" stopColor={mix(NIGHT.redDeep, NIGHT.ink, 0.35)} stopOpacity={0.9} />
          </linearGradient>
          <linearGradient id="int-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={mix(NIGHT.wallLow, NIGHT.tealDeep, 0.5)} />
            <stop offset="0.45" stopColor={NIGHT.wall} />
            <stop offset="1" stopColor={NIGHT.ink} />
          </linearGradient>
          <linearGradient id="int-bandbg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={NIGHT.teal} stopOpacity={0} />
            <stop offset="0.5" stopColor={NIGHT.teal} stopOpacity={0.16} />
            <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
          </linearGradient>
          <radialGradient id="int-vig" cx="505" cy={o.y + 360} r="1150" gradientUnits="userSpaceOnUse">
            <stop offset="0.45" stopColor={NIGHT.ink} stopOpacity={0} />
            <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.72} />
          </radialGradient>
        </defs>
        <g transform={`translate(${fx} ${fy}) scale(${push}) translate(${-fx} ${-fy})`}>
          {/* beyond the pad: the dash and the windshield's teal spill at the top, her lap (red) at the bottom */}
          <rect x={-40} y={-40} width={1160} height={2000} fill="url(#int-dash)" />
          <rect x={-40} y={1100} width={1160} height={860} fill="url(#int-lap)" />
          {/* the wheel's top arc, emerging from under the pad on both sides */}
          <WheelRim cx={530} cy={o.y + 1230} r={900} />
          {/* light bands across the cabin: the same bands as on the paper (pad units), unclipped, under the pad */}
          <g transform={`translate(${o.x} ${o.y}) rotate(${PAD_ROT} ${PAD_W / 2} ${PAD_H / 2}) scale(${K})`}>
            {[0, 1, 2].map((i) => (
              <rect key={i} x={-300 + i * 330 + bandShift} y={-900} width={140 + i * 40} height={2700} fill="url(#int-bandbg)" opacity={bands * (0.6 - i * 0.12)} transform={`rotate(${BAND_ANGLE} 300 450)`} />
            ))}
          </g>
          {/* the pad's contact shadow: stacked soft rects instead of a blur filter */}
          {[28, 18, 9].map((g, i) => (
            <rect key={g} x={o.x - g + 10} y={o.y + 30 - g + 16} width={PAD_W + 2 * g} height={PAD_H + 2 * g} rx={20 + g} fill={NIGHT.ink} opacity={0.22 + i * 0.12} transform={`rotate(${PAD_ROT} ${o.x + PAD_W / 2} ${o.y + PAD_H / 2})`} />
          ))}
          <g transform={`translate(${o.x} ${o.y}) rotate(${PAD_ROT} ${PAD_W / 2} ${PAD_H / 2}) scale(${K})`}>
            <StenoPadArt notes={notes} bands={bands} bandShift={bandShift} exposure={0.88} lightAmount={0.18} />
            {jump > 60 ? <PenAndCuff x={prev.tip[0]} y={prev.tip[1]} lift={prev.lift} ghost /> : null}
            <PenAndCuff x={pen.tip[0]} y={pen.tip[1]} lift={pen.lift} />
          </g>
          {/* the ballpoint's tiny specular on the paper while it writes */}
          {pen.lift < 0.05 && frame >= lf(S12.price[0].t) ? <circle cx={tipF[0]} cy={tipF[1]} r={5} fill={NIGHT.tealSoft} opacity={0.25} /> : null}
        </g>
        <rect width={1080} height={1920} fill="url(#int-vig)" />
      </svg>
    </AbsoluteFill>
  );
};

/** A top-down slice of the leather wheel rim: dark band, teal rim light on the top edge, stitching. */
const WheelRim: React.FC<{cx: number; cy: number; r: number}> = ({cx, cy, r}) => {
  const w = 118;
  const arc = (rr: number) => `M${cx - rr} ${cy} A${rr} ${rr} 0 0 1 ${cx + rr} ${cy}`;
  return (
    <g>
      <path d={arc(r + 10)} fill="none" stroke={NIGHT.ink} strokeWidth={w + 40} opacity={0.6} />
      <path d={arc(r)} fill="none" stroke="url(#int-rim)" strokeWidth={w} />
      <path d={arc(r + w / 2 - 6)} fill="none" stroke={alpha(NIGHT.tealSoft, 0.55)} strokeWidth={4} />
      <path d={arc(r + w / 2 - 16)} fill="none" stroke={alpha(NIGHT.tealSoft, 0.12)} strokeWidth={14} />
      <path d={arc(r - 6)} fill="none" stroke={alpha(NIGHT.grey, 0.28)} strokeWidth={2.4} strokeDasharray="10 9" />
      <path d={arc(r - w / 2 + 4)} fill="none" stroke={alpha(NIGHT.ink, 0.9)} strokeWidth={8} />
    </g>
  );
};

/**
 * The ballpoint, tip at (x, y) in pad units, barrel up-and-away to the lower right, disappearing into the
 * cuff of her red cardigan (a silhouette with a teal rim; no hand). `lift` raises it off the paper: the
 * shadow slides away and softens. `ghost` draws a faint motion-smear copy for one-frame jumps.
 */
const PenAndCuff: React.FC<{x: number; y: number; lift: number; ghost?: boolean}> = ({x, y, lift, ghost = false}) => {
  const sleeve = mix(NIGHT.redDeep, NIGHT.ink, 0.2);
  const sleeveLit = mix(NIGHT.redDeep, NIGHT.red, 0.22);
  const barrel = mix(NIGHT.ink, LIGHT.infoSoftForeground, 0.42);
  const L = Math.max(0, Math.min(1, lift));
  const ty = y - L * 12;
  // barrel direction (52°) and the shadow's throw (down-left, away from the windshield light), pad units
  const d: P = [Math.cos((52 * Math.PI) / 180), Math.sin((52 * Math.PI) / 180)];
  const off: P = [-(10 + 34 * L), 12 + 30 * L];
  const s0: P = [x + off[0] * L, y + off[1] * L];
  const s1: P = [x + d[0] * 250 + off[0], y + d[1] * 250 + off[1]];
  return (
    <g opacity={ghost ? 0.2 : 1}>
      {!ghost ? (
        <g opacity={0.16 * (1 - 0.55 * L)}>
          <path d={`M${s0[0]} ${s0[1]} L${s1[0]} ${s1[1]}`} stroke={NIGHT.ink} strokeWidth={22 + 14 * L} strokeLinecap="round" opacity={0.5} />
          <path d={`M${s0[0]} ${s0[1]} L${s1[0]} ${s1[1]}`} stroke={NIGHT.ink} strokeWidth={10 + 6 * L} strokeLinecap="round" />
        </g>
      ) : null}
      <g transform={`translate(${x} ${ty}) rotate(52)`}>
        {/* nib and cone */}
        <path d="M0 0 L8 -2.6 L8 2.6 Z" fill={NIGHT.ink} />
        <path d="M6 -3 L26 -8 L26 8 L6 3 Z" fill={mix(NIGHT.grey, NIGHT.ivory, 0.45)} />
        <path d="M6 -3 L26 -8 L26 -4 Z" fill={alpha(NIGHT.ivory, 0.7)} />
        {/* grip and barrel */}
        <rect x={26} y={-10} width={70} height={20} rx={7} fill={mix(barrel, NIGHT.ink, 0.45)} />
        {Array.from({length: 6}, (_, i) => (
          <rect key={i} x={32 + i * 10} y={-10} width={3} height={20} fill={alpha(NIGHT.ink, 0.35)} />
        ))}
        <rect x={96} y={-10} width={200} height={20} rx={6} fill={barrel} />
        <rect x={96} y={-10} width={200} height={6} rx={3} fill={alpha(NIGHT.tealSoft, 0.42)} />
        <rect x={180} y={8} width={96} height={5} rx={2.5} fill={mix(NIGHT.grey, NIGHT.ivory, 0.25)} />
        {/* her sleeve: a ribbed cardigan cuff swallowing the pen, widening into the sleeve and out of frame */}
        <path d="M300 -78 Q520 -104 1400 -200 L1400 210 Q520 112 300 82 Q284 0 300 -78 Z" fill={sleeve} />
        {/* the lit top edge of the sleeve (windshield side) and a soft fold */}
        <path d="M300 -78 Q520 -104 1400 -200 L1400 -150 Q520 -70 312 -50 Z" fill={sleeveLit} opacity={0.55} />
        <path d="M430 30 Q700 40 1400 110" fill="none" stroke={alpha(NIGHT.ink, 0.45)} strokeWidth={10} strokeLinecap="round" />
        {/* rib knit cuff */}
        <path d="M262 -70 Q244 0 262 72 L336 84 Q318 0 336 -80 Z" fill={mix(sleeve, NIGHT.ink, 0.28)} />
        {Array.from({length: 11}, (_, i) => -66 + i * 13.5).map((yy) => (
          <path key={yy} d={`M${264 - Math.abs(yy) * 0.1} ${yy} L${334 - Math.abs(yy) * 0.06} ${yy * 1.08}`} stroke={alpha(NIGHT.ink, 0.5)} strokeWidth={3} />
        ))}
        <path d="M262 -70 Q244 0 262 72" fill="none" stroke={alpha(NIGHT.tealSoft, 0.3)} strokeWidth={2.5} />
        <path d="M262 -70 L336 -80 Q520 -104 1400 -200" fill="none" stroke={alpha(NIGHT.tealSoft, 0.6)} strokeWidth={3.5} />
        <ellipse cx={258} cy={0} rx={11} ry={58} fill={NIGHT.ink} opacity={0.9} />
      </g>
    </g>
  );
};
