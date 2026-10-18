import React from 'react';
import {AbsoluteFill, Html5Audio, Sequence, staticFile} from 'remotion';
import {SCENES} from './timeline.ts';
import {SCENE_COMPONENTS} from './scenes/index.ts';
import {Captions} from './components/Captions.tsx';
import {GlobalFx} from './fx/GlobalFx.tsx';
import {loadFonts} from './fonts.ts';

loadFonts();

export type ReelProps = {placement: 'organic' | 'paid'; withAudio: boolean};

/** The whole film: one hard-cut <Sequence> per scene, then grade/grain, captions and the mix on top. */
export const Reel: React.FC<ReelProps> = ({placement, withAudio}) => (
  <AbsoluteFill style={{background: '#000'}}>
    {SCENES.map((sc) => {
      const Scene = SCENE_COMPONENTS[sc.name];
      if (!Scene) throw new Error(`No component for scene ${sc.name}`);
      return (
        <Sequence key={sc.name} from={sc.from} durationInFrames={sc.durationInFrames} name={sc.name}>
          <Scene placement={placement} />
        </Sequence>
      );
    })}
    <GlobalFx />
    <Captions placement={placement} />
    {withAudio ? <Html5Audio src={staticFile('audio/mix.wav')} /> : null}
  </AbsoluteFill>
);
