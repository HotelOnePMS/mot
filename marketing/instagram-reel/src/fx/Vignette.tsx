// fx/Vignette: a soft elliptical edge darkening (board S01: "edges −35 %").
// One radial gradient, normal blend. Centre defaults to the text column (x 505).
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {COLUMN_X} from '../theme.ts';

export type VignetteProps = {
  /** Darkening at the corners, 0..1 (0.35 = −35 %). */
  strength?: number;
  /** Where the fall-off starts, as a fraction of the ellipse radius. */
  inner?: number;
  cx?: number;
  cy?: number;
  /** Darkening colour (rgb triple). */
  rgb?: string;
};

export const Vignette: React.FC<VignetteProps> = ({strength = 0.35, inner = 0.5, cx = COLUMN_X, cy = 900, rgb = '0,0,0'}) =>
  strength <= 0 ? null : (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        background: `radial-gradient(ellipse 78% 62% at ${cx}px ${cy}px, rgba(${rgb},0) ${(inner * 100).toFixed(0)}%, rgba(${rgb},${(strength * 0.55).toFixed(3)}) ${((inner + 1) * 50 + 10).toFixed(0)}%, rgba(${rgb},${strength.toFixed(3)}) 100%)`,
      }}
    />
  );
