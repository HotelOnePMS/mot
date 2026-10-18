// Gus's Starlite office in the morning: a backlit wall around a big picture window onto the lot
// (MorningLot), raised venetian blinds, a sill, and (S22) the front desk with its brass bell and key rack.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONT, LIGHT, NIGHT} from '../../theme.ts';
import {alpha, mix, useUid} from '../../set/parts.tsx';
import {MorningLot} from './Lot.tsx';

export type Rect = {x: number; y: number; w: number; h: number};
export type Cam = {scale: number; x: number; y: number};

const WALL = mix(mix(LIGHT.borderStrong, LIGHT.foreground, 0.3), LIGHT.highlightSoftForeground, 0.18);
const WALL_LIT = mix(WALL, LIGHT.highlightSoft, 0.3);
const CASING = mix(NIGHT.ink, WALL, 0.45);
const CASING_HI = mix(LIGHT.highlightSoft, WALL, 0.25);
const SLAT = mix(LIGHT.background, LIGHT.border, 0.4);
const DESK = LIGHT.highlightSoftForeground;

/** A camera as an SVG transform: frame = scale·p + (x, y). */
export const camT = (c: Cam) => `translate(${c.x} ${c.y}) scale(${c.scale})`;

const Blinds: React.FC<{r: Rect; depth: number}> = ({r, depth}) => {
  const n = Math.round(depth / 11);
  return (
    <g>
      <rect x={r.x} y={r.y} width={r.w} height={depth + 6} fill={mix(SLAT, WALL, 0.25)} />
      {Array.from({length: n}, (_, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y + i * 11} width={r.w} height={9} fill={SLAT} />
          <rect x={r.x} y={r.y + i * 11 + 7} width={r.w} height={2} fill={alpha(NIGHT.ink, 0.18)} />
        </g>
      ))}
      <rect x={r.x - 6} y={r.y + depth} width={r.w + 12} height={10} rx={3} fill={mix(SLAT, WALL, 0.45)} />
      <path d={`M${r.x + r.w * 0.82} ${r.y + depth + 10} V${r.y + depth + 190}`} stroke={alpha(NIGHT.ink, 0.35)} strokeWidth={2} />
      <rect x={r.x + r.w * 0.82 - 4} y={r.y + depth + 186} width={8} height={18} rx={4} fill={mix(SLAT, WALL, 0.5)} />
    </g>
  );
};

/**
 * Full-frame office layer. `open` = the window opening (frame px at camera identity); `lot` places the
 * MorningLot inside it; `mullionX`/`transomY` add glazing bars; `desk` draws the S22 counter.
 */
export const Office: React.FC<{
  open: Rect;
  lot: Cam;
  camera?: Cam;
  lotCamera?: Cam;
  mullionX?: number;
  transomY?: number;
  blinds?: number;
  desk?: number;
  t: number;
  clock?: string;
}> = ({open, lot, camera = {scale: 1, x: 0, y: 0}, lotCamera, mullionX, transomY, blinds = 110, desk, t, clock}) => {
  const uid = useUid('mo');
  const o = open;
  const lc = lotCamera ?? camera;
  return (
    <AbsoluteFill>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <defs>
          <clipPath id={`${uid}w`}>
            <rect x={o.x} y={o.y} width={o.w} height={o.h} />
          </clipPath>
          <radialGradient id={`${uid}spill`} cx={o.x + o.w / 2} cy={o.y + o.h * 0.55} r={Math.max(o.w, o.h) * 0.85} gradientUnits="userSpaceOnUse">
            <stop offset="0.45" stopColor={WALL_LIT} />
            <stop offset="1" stopColor={WALL} />
          </radialGradient>
          <linearGradient id={`${uid}d`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={mix(DESK, LIGHT.highlight, 0.25)} />
            <stop offset="0.08" stopColor={DESK} />
            <stop offset="1" stopColor={mix(DESK, NIGHT.ink, 0.45)} />
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={1080} height={1920} fill={WALL} />
        <g transform={camT(camera)}>
          <rect x={-600} y={-600} width={2280} height={3120} fill={`url(#${uid}spill)`} />
          {/* the view, with its own (shallower) camera for parallax */}
          <g clipPath={`url(#${uid}w)`}>
            <g transform={`translate(${-camera.x / camera.scale} ${-camera.y / camera.scale}) scale(${1 / camera.scale})`}>
              <g transform={camT(lc)}>
                <g transform={camT(lot)}>
                  <MorningLot t={t} />
                </g>
              </g>
            </g>
            {/* glass: faint diagonal reflections */}
            <path d={`M${o.x + o.w * 0.1} ${o.y} L${o.x + o.w * 0.26} ${o.y} L${o.x - o.w * 0.1} ${o.y + o.h} L${o.x - o.w * 0.26} ${o.y + o.h} Z`} fill={alpha(LIGHT.surface, 0.1)} />
            <path d={`M${o.x + o.w * 0.34} ${o.y} L${o.x + o.w * 0.38} ${o.y} L${o.x + o.w * 0.02} ${o.y + o.h} L${o.x - o.w * 0.02} ${o.y + o.h} Z`} fill={alpha(LIGHT.surface, 0.08)} />
            <Blinds r={{x: o.x, y: o.y, w: o.w, h: o.h}} depth={blinds} />
          </g>
          {/* casing, glazing bars and sill */}
          <rect x={o.x - 28} y={o.y - 28} width={o.w + 56} height={o.h + 56} fill="none" stroke={CASING} strokeWidth={28} />
          <rect x={o.x - 14} y={o.y - 14} width={o.w + 28} height={o.h + 28} fill="none" stroke={alpha(CASING_HI, 0.5)} strokeWidth={2} />
          {mullionX !== undefined ? (
            <>
              <rect x={mullionX - 9} y={o.y} width={18} height={o.h} fill={CASING} />
              <rect x={mullionX - 9} y={o.y} width={3} height={o.h} fill={alpha(CASING_HI, 0.55)} />
            </>
          ) : null}
          {transomY !== undefined ? (
            <>
              <rect x={o.x} y={transomY - 8} width={o.w} height={16} fill={CASING} />
              <rect x={o.x} y={transomY - 8} width={o.w} height={3} fill={alpha(CASING_HI, 0.55)} />
            </>
          ) : null}
          <rect x={o.x - 48} y={o.y + o.h + 14} width={o.w + 96} height={22} rx={4} fill={mix(CASING_HI, WALL, 0.3)} />
          <rect x={o.x - 48} y={o.y + o.h + 34} width={o.w + 96} height={14} fill={alpha(NIGHT.ink, 0.25)} />
          {clock ? (
            <g transform={`translate(${o.x + o.w - 220} ${o.y - 150})`}>
              <rect x={0} y={0} width={176} height={74} rx={10} fill={NIGHT.ink} />
              <text x={88} y={53} textAnchor="middle" fontFamily={FONT.mono} fontWeight={700} fontSize={46} fill={mix(NIGHT.teal, NIGHT.ink, 0.25)}>
                {clock}
              </text>
            </g>
          ) : null}
          {desk !== undefined ? (
            <g>
              {/* key rack on the wall at the left */}
              <rect x={20} y={560} width={96} height={170} rx={6} fill={mix(DESK, NIGHT.ink, 0.35)} />
              {[0, 1].map((r) =>
                [0, 1, 2].map((c) => (
                  <g key={`${r}${c}`} transform={`translate(${42 + c * 26} ${600 + r * 70})`}>
                    <circle cx={0} cy={0} r={3} fill={LIGHT.highlight} />
                    <rect x={-3} y={4} width={6} height={30} rx={2} fill={mix(LIGHT.highlight, LIGHT.highlightSoft, 0.3)} />
                  </g>
                )),
              )}
              {/* the front desk */}
              <rect x={-200} y={desk} width={1480} height={1920 - desk + 400} fill={`url(#${uid}d)`} />
              <rect x={-200} y={desk} width={1480} height={6} fill={alpha(LIGHT.highlightSoft, 0.55)} />
              {/* brass bell */}
              <g transform={`translate(905 ${desk + 2})`}>
                <ellipse cx={0} cy={0} rx={52} ry={9} fill={alpha(NIGHT.ink, 0.3)} />
                <path d="M-40 -4 Q-40 -54 0 -56 Q40 -54 40 -4 Z" fill={LIGHT.highlight} />
                <path d="M-24 -40 Q-10 -52 8 -50" fill="none" stroke={alpha(LIGHT.surface, 0.8)} strokeWidth={5} strokeLinecap="round" />
                <rect x={-4} y={-68} width={8} height={14} rx={3} fill={mix(LIGHT.highlight, NIGHT.ink, 0.3)} />
                <rect x={-46} y={-6} width={92} height={8} rx={4} fill={mix(LIGHT.highlight, NIGHT.ink, 0.35)} />
              </g>
            </g>
          ) : null}
        </g>
      </svg>
    </AbsoluteFill>
  );
};
