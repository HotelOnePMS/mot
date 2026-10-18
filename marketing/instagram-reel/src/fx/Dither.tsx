// fx/Dither: a static 1–2 % per-pixel, per-channel dither so dark gradients
// don't band (in the master or after IG's transcode). The noise is a
// pre-generated tile (public/fx/dither.png, made by scripts/make-fx-tiles.ts),
// laid out 1:1 with <Img> (which holds the render until it has loaded) and
// blended with soft-light: neutral grey at 50 %, pure black and white stay
// clean, amplitude is largest in shadows/mid-tones where banding shows.
import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {HEIGHT, WIDTH} from '../timeline.ts';

export const TILE = 512;

/** A 1:1 tiled image covering the frame, shifted by (ox, oy) px. */
export const TiledImage: React.FC<{src: string; ox?: number; oy?: number; tile?: number}> = ({src, ox = 0, oy = 0, tile = TILE}) => {
  const x0 = -(((ox % tile) + tile) % tile);
  const y0 = -(((oy % tile) + tile) % tile);
  const cols = Math.ceil((WIDTH - x0) / tile);
  const rows = Math.ceil((HEIGHT - y0) / tile);
  const cells: React.ReactNode[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      cells.push(<Img key={`${i}-${j}`} src={src} style={{position: 'absolute', left: x0 + i * tile, top: y0 + j * tile, width: tile, height: tile, imageRendering: 'pixelated'}} />);
  return <>{cells}</>;
};

export type DitherProps = {
  /** Soft-light opacity. 0.07 ≈ ±1.5 % in the mid-tones, ±1 % in the shadows. */
  amount?: number;
};

export const Dither: React.FC<DitherProps> = ({amount = 0.07}) =>
  amount <= 0 ? null : (
    <AbsoluteFill style={{mixBlendMode: 'soft-light', opacity: amount, pointerEvents: 'none', overflow: 'hidden'}}>
      <TiledImage src={staticFile('fx/dither.png')} />
    </AbsoluteFill>
  );
