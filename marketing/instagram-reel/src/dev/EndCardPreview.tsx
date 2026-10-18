// Dev preview for S26: the end card with the global captions, and a stand-in S27 view
// (teal binoculars on Rita's facade) behind the keyhole while the Stinger is a placeholder.
import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {scene} from '../timeline.ts';
import {EndCardArt} from '../scenes/endcard/EndCardArt.tsx';
import {Captions} from '../components/Captions.tsx';
import {Binoculars} from '../fx/Binoculars.tsx';
import {Highway} from '../set/Highway.tsx';

loadFonts();

const StandIn: React.FC = () => (
  <Binoculars rim="teal" drift={1} frame={0}>
    <Highway variant="facade" lobby={{phoneState: 'ringing', ringPulse: 0.6, buzz: 0}} />
  </Binoculars>
);

const EndCardPreviewComp: React.FC = () => (
  <AbsoluteFill>
    <EndCardArt placement="organic" through={<StandIn />} />
    <Sequence from={-scene('EndCard').from} layout="none">
      <Captions placement="organic" />
    </Sequence>
  </AbsoluteFill>
);

export const preview = {id: 'EndCardPreview', component: EndCardPreviewComp, durationInFrames: scene('EndCard').durationInFrames};
