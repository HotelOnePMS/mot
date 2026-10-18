import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {StingerView} from './stinger/StingerView.tsx';

/**
 * Stinger (S27, 60.0–62.5): Gus's binocular POV of Rita's Motor Inn, her FRONT DESK phone
 * ringing. Holds 0:19 with the phone mid-glow to the last frame (1874); no fade-out: the
 * hard cut to frame 0 is the loop. See stinger/StingerView.tsx.
 */
export const Stinger: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <StingerView frame={frame} />
    </AbsoluteFill>
  );
};
