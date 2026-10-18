// Dev preview for the S26 → S27 hand-off: the keyhole iris (59.75–60.0) opening
// onto StingerView at negative stinger-local frames, then the stinger itself.
//   f0–7   iris over an ivory card (StingerView frames −8..−1)
//   f8–82  the stinger (StingerView frames 0..74)
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {KeyholeIris} from '../fx/KeyholeIris.tsx';
import {MARK_ORIGIN} from '../scenes/endcard/layout.ts';
import {StingerView} from '../scenes/stinger/StingerView.tsx';
import {LIGHT} from '../theme.ts';

loadFonts();

const IRIS_FRAMES = 8;

const StingerPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const local = frame - IRIS_FRAMES;
  if (local < 0) {
    return (
      <AbsoluteFill style={{background: LIGHT.background}}>
        <KeyholeIris progress={(frame + 1) / IRIS_FRAMES} origin={MARK_ORIGIN} size={64}>
          <AbsoluteFill style={{background: '#000'}}>
            <StingerView frame={local} />
          </AbsoluteFill>
        </KeyholeIris>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <StingerView frame={local} />
    </AbsoluteFill>
  );
};

export const preview = {id: 'StingerPreview', component: StingerPreviewComp, durationInFrames: 83};
