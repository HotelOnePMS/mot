// fx/KeyholeIris (S26 → S27, 59.75–60.0): the HotelOne LogoMark keyhole
// (bow circle + stem, LOGO_GEOMETRY on the 32 grid) scales 1 → 40× as an iris
// mask, opening from the end card onto the next shot. Children = what shows
// THROUGH the keyhole; the caller draws the end card underneath.
import React from 'react';
import {AbsoluteFill, Easing} from 'remotion';
import {LIGHT} from '../theme.ts';
import {HEIGHT, WIDTH} from '../timeline.ts';
import {clamp01} from './noise.ts';

/** Copied verbatim from the app's src/components/brand/Logo.tsx. */
export const LOGO_GEOMETRY = {
  viewBox: '0 0 32 32',
  tileRadius: 9,
  bow: {cx: 16, cy: 11.5, r: 5},
  stem: 'M14.15 14.2 12.7 20.7Q12.5 21.8 13.7 21.8H18.3Q19.5 21.8 19.3 20.7L17.85 14.2Z',
  threshold: 'M10.5 25.6h11',
} as const;

/**
 * The keyhole as ONE outline (bow ∪ stem), derived from LOGO_GEOMETRY: the stem's
 * sides leave the bow circle at (13.756, 15.968) and (18.244, 15.968). One path
 * means the rim stroke has no seam where the stem meets the bow.
 */
export const KEYHOLE_PATH = 'M13.756 15.968A5 5 0 1 1 18.244 15.968L19.3 20.7Q19.5 21.8 18.3 21.8H13.7Q12.5 21.8 12.7 20.7Z';

/**
 * Scale at which the bow alone, centred on the frame, covers all of it: the
 * iris must end fully open. NOTE: the board says 1→40×, but 40× of the 64 px
 * end-card mark is a 400 px bow, which leaves the end card showing; the
 * default therefore grows to cover (≈116× for 64 px). Pass maxScale={40} to
 * get the board's literal number.
 */
export const coverScale = (size: number) => (Math.hypot(WIDTH, HEIGHT) / 2 / ((LOGO_GEOMETRY.bow.r * size) / 32)) * 1.04;

/** Iris scale for progress 0..1: exponential so the opening feels like a constant-speed dolly (1 → maxScale). */
export const irisScale = (progress: number, maxScale = 40) => Math.pow(maxScale, Easing.in(Easing.quad)(clamp01(progress)));

export type KeyholeIrisProps = {
  /** 0..1 opening (S26: 59.75 → 60.0, 7–8 frames). 0 = the keyhole exactly as drawn in the LogoMark. */
  progress: number;
  /** Frame px of the LogoMark's top-left corner (the 32-grid origin). */
  origin: {x: number; y: number};
  /** LogoMark size in px (S26: 64). */
  size: number;
  /** Final scale. Default: coverScale(size), so the frame is fully open at progress 1. */
  maxScale?: number;
  /** Where the bow centre travels to as it opens (frame px). Default the frame centre. */
  to?: {x: number; y: number};
  /** Thin rim drawn around the keyhole edge while it opens (Lagoon on the ivory card). */
  rim?: string;
  children: React.ReactNode;
};

export const KeyholeIris: React.FC<KeyholeIrisProps> = ({progress, origin, size, maxScale, to = {x: WIDTH / 2, y: HEIGHT / 2}, rim = LIGHT.primary, children}) => {
  const id = `kh${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const p = clamp01(progress);
  if (p <= 0) return null;
  if (p >= 1) return <AbsoluteFill>{children}</AbsoluteFill>;
  const unit = size / 32;
  const max = maxScale ?? coverScale(size);
  const sc = irisScale(p, max);
  // the bow centre glides from its place in the mark to `to` in step with its
  // growth, so the mark's own keyhole stays inside the opening the whole time
  const bow = LOGO_GEOMETRY.bow;
  const glide = (sc - 1) / (max - 1);
  const bx = origin.x + bow.cx * unit + (to.x - (origin.x + bow.cx * unit)) * glide;
  const by = origin.y + bow.cy * unit + (to.y - (origin.y + bow.cy * unit)) * glide;
  // grid → frame: translate(bow centre) scale(unit*sc) translate(-bow)
  const tf = `translate(${bx.toFixed(2)} ${by.toFixed(2)}) scale(${(unit * sc).toFixed(4)}) translate(${-bow.cx} ${-bow.cy})`;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <svg width={0} height={0} style={{position: 'absolute'}}>
        <defs>
          <clipPath id={id} clipPathUnits="userSpaceOnUse">
            {/* clipPath may not contain <g>: the transform goes on the path */}
            <path d={KEYHOLE_PATH} transform={tf} />
          </clipPath>
        </defs>
      </svg>
      <AbsoluteFill style={{clipPath: `url(#${id})`}}>{children}</AbsoluteFill>
      {rim ? (
        <svg width="100%" height="100%" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
          <g transform={tf} fill="none" stroke={rim} strokeWidth={(2.2 / (unit * sc)).toFixed(4)} strokeLinejoin="round" opacity={1 - p * 0.6}>
            <path d={KEYHOLE_PATH} />
          </g>
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};
