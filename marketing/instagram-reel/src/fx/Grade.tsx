// fx/Grade: the film's colour grade as cheap blend-mode overlays (no filters).
//   - look 'red' (Rita's world) / 'teal' (Gus's): lifted, tinted blacks
//     (lighten) + a soft-light hue push in the mids.
//   - look 'split': red on one side, teal on the other, with a soft divide
//     (S05 crane: Rita's lot left / the Starlite right; S07 split screen:
//     teal top, red bottom).
//   - flip 0..1: the night→light flip (S21). The grade lifts off in a band
//     that sweeps upward from the bottom, with a faint brass dawn edge.
// Use <Grade> as an overlay on top of a scene, or <NightLightWipe> to wipe
// between a night render and a day render with the same upward sweep.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {LIGHT, NIGHT} from '../theme.ts';
import {HEIGHT, WIDTH} from '../timeline.ts';
import {clamp01} from './noise.ts';

export type GradeLook = 'red' | 'teal' | 'split';

export type GradeProps = {
  look?: GradeLook;
  /** 0..1 overall strength. */
  amount?: number;
  /** split only: 'x' = vertical divide (left/right), 'y' = horizontal divide (top/bottom). */
  axis?: 'x' | 'y';
  /** split only: divide position px along the axis (default frame centre). */
  at?: number;
  /** split only: width of the blend across the divide, px. */
  softness?: number;
  /** split only: which side is red ('start' = left/top). */
  red?: 'start' | 'end';
  /** 0..1 night→light flip; the grade lifts off bottom-up. */
  flip?: number;
  /** Height of the flip's soft edge, px. */
  flipFeather?: number;
  /** Brass glow riding the flip edge, 0..1. */
  dawnGlow?: number;
};

const TINT = {
  red: {deep: NIGHT.redDeep, hue: NIGHT.red, deepA: 0.2, hueA: 0.2},
  teal: {deep: NIGHT.tealDeep, hue: NIGHT.teal, deepA: 0.24, hueA: 0.22},
} as const;

/** Mask that hides the part of a layer below the flip edge (edge sweeps bottom → top). */
export const flipMask = (flip: number, feather = 360) => {
  const p = clamp01(flip);
  // edge position measured from the bottom, px; starts below the frame, ends above it
  const edge = -feather + p * (HEIGHT + 2 * feather);
  const a = Math.max(-feather, edge - feather / 2);
  const b = edge + feather / 2;
  return `linear-gradient(to top, rgba(0,0,0,0) ${a.toFixed(1)}px, #000 ${b.toFixed(1)}px)`;
};

export const Grade: React.FC<GradeProps> = ({look = 'teal', amount = 1, axis = 'y', at, softness = 220, red = 'end', flip = 0, flipFeather = 360, dawnGlow = 1}) => {
  if (amount <= 0 || flip >= 1) return null;
  const len = axis === 'x' ? WIDTH : HEIGHT;
  const mid = at ?? len / 2;
  const dir = axis === 'x' ? 'to right' : 'to bottom';
  const [first, second] = red === 'start' ? (['red', 'teal'] as const) : (['teal', 'red'] as const);
  const grad = (key: 'deep' | 'hue') =>
    look === 'split'
      ? `linear-gradient(${dir}, ${TINT[first][key]} ${mid - softness / 2}px, ${TINT[second][key]} ${mid + softness / 2}px)`
      : TINT[look][key];
  const deepA = look === 'split' ? (TINT.red.deepA + TINT.teal.deepA) / 2 : TINT[look].deepA;
  const hueA = look === 'split' ? (TINT.red.hueA + TINT.teal.hueA) / 2 : TINT[look].hueA;
  const mask = flip > 0 ? flipMask(flip, flipFeather) : undefined;
  const maskStyle: React.CSSProperties = mask ? {WebkitMaskImage: mask, maskImage: mask} : {};
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <AbsoluteFill style={{background: grad('deep'), mixBlendMode: 'lighten', opacity: deepA * amount, ...maskStyle}} />
      <AbsoluteFill style={{background: grad('hue'), mixBlendMode: 'soft-light', opacity: hueA * amount, ...maskStyle}} />
      {flip > 0 && dawnGlow > 0 ? <DawnEdge flip={flip} feather={flipFeather} amount={dawnGlow * amount} /> : null}
    </AbsoluteFill>
  );
};

/** A soft brass band riding the flip edge (screen), strongest mid-sweep. */
const DawnEdge: React.FC<{flip: number; feather: number; amount: number}> = ({flip, feather, amount}) => {
  const p = clamp01(flip);
  const edge = -feather + p * (HEIGHT + 2 * feather);
  const y = HEIGHT - edge; // top-based
  const k = Math.sin(Math.PI * p) * amount;
  if (k <= 0.001) return null;
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: 'screen',
        opacity: 0.22 * k,
        background: `linear-gradient(to bottom, rgba(0,0,0,0) ${(y - feather * 0.7).toFixed(0)}px, ${NIGHT.brassLight} ${y.toFixed(0)}px, ${LIGHT.highlightSoft} ${(y + feather * 0.25).toFixed(0)}px, rgba(0,0,0,0) ${(y + feather).toFixed(0)}px)`,
      }}
    />
  );
};

export type NightLightWipeProps = {
  /** 0..1: 0 = all night, 1 = all day. */
  progress: number;
  night: React.ReactNode;
  day: React.ReactNode;
  feather?: number;
  /** Brass glow on the edge, 0..1. */
  dawnGlow?: number;
};

/** Wipes from a night render to a day render with a soft edge sweeping upward from the bottom (S21). */
export const NightLightWipe: React.FC<NightLightWipeProps> = ({progress, night, day, feather = 360, dawnGlow = 1}) => {
  const p = clamp01(progress);
  // the day layer is revealed below the edge: invert the flip mask
  const edge = -feather + p * (HEIGHT + 2 * feather);
  const a = Math.max(-feather, edge - feather / 2);
  const b = edge + feather / 2;
  const mask = `linear-gradient(to top, #000 ${a.toFixed(1)}px, rgba(0,0,0,0) ${b.toFixed(1)}px)`;
  return (
    <AbsoluteFill>
      {p < 1 ? <AbsoluteFill>{night}</AbsoluteFill> : null}
      {p > 0 ? <AbsoluteFill style={p < 1 ? {WebkitMaskImage: mask, maskImage: mask} : undefined}>{day}</AbsoluteFill> : null}
      {p > 0 && p < 1 && dawnGlow > 0 ? <DawnEdge flip={p} feather={feather} amount={dawnGlow} /> : null}
    </AbsoluteFill>
  );
};
