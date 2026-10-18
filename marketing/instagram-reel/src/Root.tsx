import React from 'react';
import {Composition} from 'remotion';
import {Reel, type ReelProps} from './Reel.tsx';
import {FPS, HEIGHT, TOTAL_FRAMES, WIDTH} from './timeline.ts';

export const Root: React.FC = () => (
  <>
    <Composition id="Reel" component={Reel} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{placement: 'organic', withAudio: true} satisfies ReelProps} />
    <Composition id="ReelSilent" component={Reel} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{placement: 'organic', withAudio: false} satisfies ReelProps} />
  </>
);
