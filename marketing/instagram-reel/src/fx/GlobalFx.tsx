// Film-wide overlay, on every frame (Reel.tsx draws it above the scenes and
// below the captions): a static 1–2 % dither so dark gradients don't band
// after IG's transcode, animated ≤1 % mid-tone grain refreshed every 6
// frames, and a whisper of vignette at night only.
//
// Frame 1155 (S18) must pixel-match frame 0, so the grain clock restarts at
// the Twist: frame 1155 shows the same grain tile and offset as frame 0.
import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {scene} from '../timeline.ts';
import {Dither} from './Dither.tsx';
import {Grain} from './Grain.tsx';
import {Vignette} from './Vignette.tsx';

const GRAIN_EVERY = 6;
const TWIST = scene('Twist').from; // 1155
const MORNING = scene('Morning').from; // night → light flip over its first second
const STINGER = scene('Stinger').from; // night again

/** The grain step for a film frame (restarts at the Twist so f1155 ≡ f0). */
export const grainStep = (frame: number) => Math.floor((frame >= TWIST ? frame - TWIST : frame) / GRAIN_EVERY);

/** Night-only vignette strength: on until the Morning flip, off for the day scenes, back for the stinger. */
const nightVignette = (frame: number) => {
  if (frame >= STINGER) return 1;
  return interpolate(frame, [MORNING, MORNING + 30], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
};

export const GlobalFx: React.FC = () => {
  const frame = useCurrentFrame();
  const v = nightVignette(frame);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {v > 0 ? <Vignette strength={0.14 * v} inner={0.55} /> : null}
      <Dither amount={0.07} />
      <Grain amount={0.12} step={grainStep(frame)} />
    </AbsoluteFill>
  );
};
