import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SceneProps} from './types.ts';

/** Binoculars (S02, S03). Placeholder until the scene is built. */
export const Binoculars: React.FC<SceneProps> = () => (
  <AbsoluteFill style={{background: '#1a1a1a', color: '#888', fontSize: 64, fontFamily: 'Inter', justifyContent: 'center', alignItems: 'center'}}>
    Binoculars · S02, S03
  </AbsoluteFill>
);
