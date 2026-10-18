import type React from 'react';
import type {SceneProps} from './types.ts';
import {ColdOpen} from './ColdOpen.tsx';
import {Binoculars} from './Binoculars.tsx';
import {Stakeout} from './Stakeout.tsx';
import {Geography} from './Geography.tsx';
import {TheCall} from './TheCall.tsx';
import {WhoAnswers} from './WhoAnswers.tsx';
import {Interrogation} from './Interrogation.tsx';
import {ConsoleDive} from './ConsoleDive.tsx';
import {RitaSaysHi} from './RitaSaysHi.tsx';
import {Mirror} from './Mirror.tsx';
import {Twist} from './Twist.tsx';
import {TheKnot} from './TheKnot.tsx';
import {Morning} from './Morning.tsx';
import {EndCard} from './EndCard.tsx';
import {Stinger} from './Stinger.tsx';

/** Scene name (as in the storyboard) -> component. */
export const SCENE_COMPONENTS: Record<string, React.FC<SceneProps>> = {
  ColdOpen,
  Binoculars,
  Stakeout,
  Geography,
  TheCall,
  WhoAnswers,
  Interrogation,
  ConsoleDive,
  RitaSaysHi,
  Mirror,
  Twist,
  TheKnot,
  Morning,
  EndCard,
  Stinger,
};
