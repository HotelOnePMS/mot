// S04's match-cut: S03's two binocular circles (r 440 at (300, 880) / (720, 880))
// become the two objective lenses of Rita's binoculars. Each disc is glass with
// a dark metal rim, a teal rim light from the windshield (upper right), the
// green dash under-light, a specular crescent and a faint red coating sheen
// (her own world in the glass). Inside: the teal lobby reflection. Outside: the
// dark that S03 had, opening up as the camera dollies back.
//
// Everything is frame px. The scene computes the discs (morphing from the S03
// circles onto ritaAPoints().objectives under its camera) and passes them in.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {GlassStreaks} from '../../fx/Binoculars.tsx';
import {alpha, mix, useUid} from '../../set/parts.tsx';
import {NIGHT} from '../../theme.ts';

/** One lens disc: centre, radii, rotation (deg). */
export type LensDisc = {cx: number; cy: number; rx: number; ry: number; rot: number};

/** The board's dash green (#74dca8): the clock and the under-light on her lenses. */
export const DASH_GREEN = '#74dca8';

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Closed ellipse outline as path data (for CSS clip-path and SVG). */
export const ellipsePath = ({cx, cy, rx, ry, rot}: LensDisc) => {
  const c = Math.cos(rad(rot));
  const s = Math.sin(rad(rot));
  const ax = rx * c;
  const ay = rx * s;
  const f = (v: number) => v.toFixed(2);
  return `M${f(cx + ax)} ${f(cy + ay)} A${f(rx)} ${f(ry)} ${f(rot)} 1 1 ${f(cx - ax)} ${f(cy - ay)} A${f(rx)} ${f(ry)} ${f(rot)} 1 1 ${f(cx + ax)} ${f(cy + ay)} Z`;
};

/** An arc of the unit circle from a0 to a1 (deg, SVG angles: 0 = right, 90 = down), at radius k. */
const arc = (a0: number, a1: number, k = 1) => {
  const p = (a: number) => `${(Math.cos(rad(a)) * k).toFixed(4)} ${(Math.sin(rad(a)) * k).toFixed(4)}`;
  return `M${p(a0)} A${k} ${k} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
};

const discT = (d: LensDisc) => `translate(${d.cx.toFixed(2)} ${d.cy.toFixed(2)}) rotate(${d.rot.toFixed(3)}) scale(${Math.max(0.01, d.rx).toFixed(3)} ${Math.max(0.01, d.ry).toFixed(3)})`;

export type LensMatchCutProps = {
  discs: [LensDisc, LensDisc];
  /** What the glass reflects (full-frame layer in frame px), already transformed. */
  children: React.ReactNode;
  /** 0..1 the dark outside the discs (1 = S03's black surround). */
  dark: number;
  /** 0..1 the whole overlay (fades as the discs land on the real lenses). */
  opacity: number;
  /** 0..1 glass streak strength (S03 carried 0.1 teal); dx shifts them. */
  streaks?: number;
  streakDx?: number;
  /** 0..1 how much of the physical rim / lights to draw (0 = S03's bare circles). */
  rim?: number;
};

export const LensMatchCut: React.FC<LensMatchCutProps> = ({discs, children, dark, opacity, streaks = 0, streakDx = 0, rim = 1}) => {
  const uid = useUid('lens');
  if (opacity <= 0.001) return null;
  const clip = `path('${discs.map(ellipsePath).join(' ')}')`;
  const metal = mix(NIGHT.ink, NIGHT.wallLow, 0.55);
  return (
    <AbsoluteFill style={{pointerEvents: 'none', opacity}}>
      {/* the surround: S03's black, opening as we pull back */}
      {dark > 0.001 ? (
        <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
          <defs>
            <mask id={`${uid}d`} maskUnits="userSpaceOnUse" x={0} y={0} width={1080} height={1920}>
              <rect width={1080} height={1920} fill="#fff" />
              {discs.map((d, i) => (
                <path key={i} d={ellipsePath(d)} fill="#000" />
              ))}
            </mask>
          </defs>
          <rect width={1080} height={1920} fill={NIGHT.ink} opacity={dark} mask={`url(#${uid}d)`} />
        </svg>
      ) : null}
      {/* the reflection, clipped to the union of the two lenses */}
      <AbsoluteFill style={{clipPath: clip, WebkitClipPath: clip}}>
        {children}
        {streaks > 0.001 ? <GlassStreaks opacity={streaks} color={NIGHT.teal} dx={streakDx} /> : null}
      </AbsoluteFill>
      {/* glass and rims: each disc masked by the other, so only the union's outline shows where they overlap */}
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <defs>
          <radialGradient id={`${uid}g`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse">
            <stop offset="0.58" stopColor={NIGHT.ink} stopOpacity={0} />
            <stop offset="0.86" stopColor={NIGHT.ink} stopOpacity={0.32} />
            <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.7} />
          </radialGradient>
          <radialGradient id={`${uid}s`} cx="-0.38" cy="-0.42" r="0.75" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0.16} />
            <stop offset="1" stopColor={NIGHT.tealSoft} stopOpacity={0} />
          </radialGradient>
          {discs.map((_, i) => {
            const other = discs[1 - i];
            return (
              <mask key={i} id={`${uid}m${i}`} maskUnits="userSpaceOnUse" x={-200} y={-200} width={1480} height={2320}>
                <rect x={-200} y={-200} width={1480} height={2320} fill="#fff" />
                <path d={ellipsePath(other)} fill="#000" />
              </mask>
            );
          })}
        </defs>
        {discs.map((d, i) => {
          const rmin = Math.min(d.rx, d.ry);
          const w = (k: number, min: number) => Math.max(min, rmin * k);
          return (
            <g key={i} mask={`url(#${uid}m${i})`}>
              <g transform={discT(d)}>
                {/* lens falloff (S03's soft edge) and a cool bloom upper-left */}
                <circle r={1} fill={`url(#${uid}g)`} />
                <circle r={1} fill={`url(#${uid}s)`} opacity={rim} />
                {/* the metal cell round the glass */}
                <circle r={1} fill="none" stroke={metal} strokeWidth={w(0.07, 2)} vectorEffect="non-scaling-stroke" opacity={0.35 + 0.65 * rim} />
                <circle r={1.0} fill="none" stroke={alpha(NIGHT.ink, 0.9)} strokeWidth={w(0.025, 1)} vectorEffect="non-scaling-stroke" opacity={rim} />
                {/* teal rim light from the windshield, upper right */}
                <path d={arc(-112, 8)} fill="none" stroke={NIGHT.tealSoft} strokeWidth={w(0.022, 1.5)} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.9 * rim} />
                <path d={arc(-84, -22, 0.965)} fill="none" stroke={NIGHT.phoneBloom} strokeWidth={w(0.008, 1)} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.7 * rim} />
                {/* green dash under-light, bottom */}
                <path d={arc(62, 138)} fill="none" stroke={DASH_GREEN} strokeWidth={w(0.016, 1.2)} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.55 * rim} />
                {/* specular crescent on the glass, upper left */}
                <path d={arc(196, 246, 0.8)} fill="none" stroke={NIGHT.ivory} strokeWidth={w(0.03, 1.2)} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.14 * rim} />
                {/* the coating's red sheen: her own world in the glass, lower right */}
                <path d={arc(18, 58, 0.88)} fill="none" stroke={NIGHT.redSoft} strokeWidth={w(0.022, 1)} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.26 * rim} />
              </g>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
