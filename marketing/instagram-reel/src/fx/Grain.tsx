// fx/Grain: animated film grain, ≤1 % and mid-tone weighted, refreshed every
// 6 frames. Six pre-generated, seamless 512 px grain tiles (public/fx/grain-N.png
// from scripts/make-fx-tiles.ts) are cycled and offset by a seeded random, so
// the browser never computes noise. Soft-light keeps blacks and whites clean.
import React from 'react';
import {AbsoluteFill, random, staticFile, useCurrentFrame} from 'remotion';
import {TILE, TiledImage} from './Dither.tsx';

export const GRAIN_TILES = 6;

export type GrainProps = {
  /** Soft-light opacity. 0.12 ≈ 0.9 % std in the mid-tones. */
  amount?: number;
  /** Frames per grain refresh (board: 6). */
  every?: number;
  /** Override the grain step (lets callers re-sync the grain, e.g. frame 1155 = frame 0). */
  step?: number;
};

/** Which tile and offset a grain step shows. */
export const grainState = (step: number) => ({
  tile: ((step % GRAIN_TILES) + GRAIN_TILES) % GRAIN_TILES,
  ox: Math.floor(random(`grain-x-${step}`) * TILE),
  oy: Math.floor(random(`grain-y-${step}`) * TILE),
});

export const Grain: React.FC<GrainProps> = ({amount = 0.12, every = 6, step}) => {
  const frame = useCurrentFrame();
  if (amount <= 0) return null;
  const st = grainState(step ?? Math.floor(frame / every));
  return (
    <AbsoluteFill style={{mixBlendMode: 'soft-light', opacity: amount, pointerEvents: 'none', overflow: 'hidden'}}>
      <TiledImage src={staticFile(`fx/grain-${st.tile}.png`)} ox={st.ox} oy={st.oy} />
    </AbsoluteFill>
  );
};
