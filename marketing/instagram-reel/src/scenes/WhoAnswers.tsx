import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SceneProps} from './types.ts';

/** WhoAnswers (S08, S09, S10). Placeholder until the scene is built. */
export const WhoAnswers: React.FC<SceneProps> = () => (
  <AbsoluteFill style={{background: '#1a1a1a', color: '#888', fontSize: 64, fontFamily: 'Inter', justifyContent: 'center', alignItems: 'center'}}>
    WhoAnswers · S08, S09, S10
  </AbsoluteFill>
);
