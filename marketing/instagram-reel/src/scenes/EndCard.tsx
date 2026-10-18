import React from 'react';
import {Freeze} from 'remotion';
import type {SceneProps} from './types.ts';
import {Stinger} from './Stinger.tsx';
import {EndCardArt} from './endcard/EndCardArt.tsx';

/**
 * EndCard (S26, 54.5–60.0). Ivory end card in two beats; at 59.75 the LogoMark keyhole
 * irises open onto S27's first frame (the Stinger, frozen at its frame 0) so the cut at 60.0
 * is seamless.
 */
export const EndCard: React.FC<SceneProps> = ({placement}) => (
  <EndCardArt
    placement={placement}
    through={
      <Freeze frame={0}>
        <Stinger placement={placement} />
      </Freeze>
    }
  />
);
