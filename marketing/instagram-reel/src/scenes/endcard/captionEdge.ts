// Where the global AI caption plate (components/Captions.tsx) starts on the left, so the
// VoiceOrb can sit just outside it. Captions centres a nowrap plate on COLUMN_X and pops it
// 0.92→1 over 4 frames from each chunk's start; widths below were measured from renders.
import {Easing, interpolate} from 'remotion';
import {activeChunk} from '../../components/Captions.tsx';
import {cue, FPS} from '../../timeline.ts';
import {COLUMN_X, EASE_POP} from '../../theme.ts';

/** Plate width (padding + AudioLines glyph + text) for each AI05 chunk, by chunk index. */
export const AI05_PLATE_W: readonly number[] = [546, 482, 208];

const CHUNKS = cue('AI05').chunks;

/** Left edge of the AI05 caption plate at absolute time t (s). Before the first chunk it is the first chunk's slot; between chunks it keeps the last one. */
export const captionLeft = (t: number): number => {
  const a = activeChunk(t);
  let index = 0;
  let pop = 1;
  if (a && a.cue.id === 'AI05') {
    index = a.index;
    const startFrame = Math.round(a.chunk.start * FPS);
    pop = interpolate(t * FPS, [startFrame, startFrame + 4], [0.92, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.bezier(...EASE_POP),
    });
  } else {
    // no caption on screen: the slot of the chunk that last started (or the first)
    for (let i = 0; i < CHUNKS.length; i++) if (t >= CHUNKS[i].start) index = i;
  }
  return COLUMN_X - (AI05_PLATE_W[index] * pop) / 2;
};
