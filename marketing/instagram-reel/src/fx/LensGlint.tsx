// fx/LensGlint: the binocular-lens cross glint (S01 f54–55, 2 frames, 40 px;
// S19 41.4, held 6 frames) and a highlight sweep across a lens (S09 18.1,
// 6 frames, across Rita's left reading-glasses lens).
import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {HEIGHT, WIDTH} from '../timeline.ts';
import {clamp01} from './noise.ts';

/**
 * Glint envelope: 0 before `at`, peak on `at`, then holds for `hold` frames
 * (2 for S01, 6 for S19). The last held frame drops to 0.55 so it reads as a flash, not a sticker.
 */
export const glintEnvelope = (frame: number, at: number, hold = 2) => {
  if (frame < at || frame >= at + hold) return 0;
  if (hold <= 2) return frame === at ? 1 : 0.6;
  return interpolate(frame - at, [0, 1, hold - 2, hold - 1], [0.85, 1, 0.9, 0.5], {extrapolateRight: 'clamp'});
};

export type LensGlintProps = {
  x: number;
  y: number;
  /** Ray half-length px (board: a 40 px cross ⇒ size 40 is the full span of the long ray / 2·20). */
  size?: number;
  /** 0..1 strength (use glintEnvelope()). */
  intensity: number;
  /** Rotation of the cross, degrees. */
  rotate?: number;
  color?: string;
  /** Tint of the soft halo (red/teal to sit in the scene). */
  halo?: string;
};

/** A 4-point star: two long tapered rays, two short diagonals, a hot core and a soft halo. Positioned in frame px. */
export const LensGlint: React.FC<LensGlintProps> = ({x, y, size = 40, intensity, rotate = 0, color = '#ffffff', halo = '#ffffff'}) => {
  const id = `lg${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const k = clamp01(intensity);
  if (k <= 0) return null;
  const L = size; // long ray half-length
  const w = Math.max(1.6, size * 0.06);
  const ray = (len: number, wid: number) => `M${-len} 0 Q 0 ${-wid} ${len} 0 Q 0 ${wid} ${-len} 0Z`;
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'screen', overflow: 'visible'}}>
      <defs>
        <radialGradient id={`${id}h`}>
          <stop offset="0" stopColor={halo} stopOpacity="0.55" />
          <stop offset="0.35" stopColor={halo} stopOpacity="0.16" />
          <stop offset="1" stopColor={halo} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}c`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="0.5" stopColor={color} stopOpacity="0.7" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${0.75 + 0.25 * k})`} opacity={k}>
        <circle r={L * 0.9} fill={`url(#${id}h)`} />
        <path d={ray(L * 1.25, w)} fill={color} />
        <path d={ray(L, w * 0.9)} fill={color} transform="rotate(90)" />
        <path d={ray(L * 0.42, w * 0.6)} fill={color} opacity={0.7} transform="rotate(45)" />
        <path d={ray(L * 0.42, w * 0.6)} fill={color} opacity={0.7} transform="rotate(-45)" />
        <circle r={w * 2.6} fill={`url(#${id}c)`} />
      </g>
    </svg>
  );
};

export type LensSweepProps = {
  /** 0..1 travel of the highlight across the lens. */
  progress: number;
  /** SVG path of the lens in frame px (clip). */
  lens: string;
  /** Lens bounding box in frame px (sets the travel). */
  box: {x: number; y: number; w: number; h: number};
  /** Band tilt, degrees from vertical. */
  angle?: number;
  /** Band width px. */
  width?: number;
  intensity?: number;
  color?: string;
};

/** A highlight band sweeping across a lens shape (S09). The band has a thin twin, like a real reflection of a window bar. */
export const LensSweep: React.FC<LensSweepProps> = ({progress, lens, box, angle = 24, width = 46, intensity = 1, color = '#ffffff'}) => {
  const id = `ls${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return null;
  const travel = box.w + box.h * Math.tan((angle * Math.PI) / 180) + width * 3;
  const x = box.x - width * 1.5 - box.h * Math.tan((angle * Math.PI) / 180) * 0.5 + p * travel;
  const env = Math.sin(Math.PI * p) ** 0.5 * intensity;
  const cy = box.y + box.h / 2;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{position: 'absolute', inset: 0, mixBlendMode: 'screen'}}>
        <defs>
          <clipPath id={`${id}c`}>
            <path d={lens} />
          </clipPath>
          <linearGradient id={`${id}g`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={color} stopOpacity="0" />
            <stop offset="0.5" stopColor={color} stopOpacity="1" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g clipPath={`url(#${id}c)`} opacity={env}>
          <g transform={`translate(${x} ${cy}) skewX(${-angle})`}>
            <rect x={-width / 2} y={-box.h} width={width} height={box.h * 2} fill={`url(#${id}g)`} opacity={0.75} />
            <rect x={width * 0.8} y={-box.h} width={width * 0.22} height={box.h * 2} fill={`url(#${id}g)`} opacity={0.5} />
          </g>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
