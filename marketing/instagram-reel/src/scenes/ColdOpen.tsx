import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SceneProps} from './types.ts';

/** ColdOpen (S01). Placeholder until the scene is built. */
export const ColdOpen: React.FC<SceneProps> = () => (
  <AbsoluteFill style={{background: '#1a1a1a', color: '#888', fontSize: 64, fontFamily: 'Inter', justifyContent: 'center', alignItems: 'center'}}>
    ColdOpen · S01
  </AbsoluteFill>
);
