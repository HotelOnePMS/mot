import React from 'react';
import {Composition} from 'remotion';
import {Reel, type ReelProps} from './Reel.tsx';
import {FPS, HEIGHT, TOTAL_FRAMES, WIDTH} from './timeline.ts';

/**
 * Work-in-progress previews: every src/dev/*Preview.tsx exports
 * `preview = {id, component, durationInFrames, width?, height?}` and shows up
 * as its own composition (render it with scripts/render-stills.ts --comp <id>).
 */
type Preview = {id: string; component: React.FC; durationInFrames: number; width?: number; height?: number};
type Ctx = {keys: () => string[]; (key: string): {preview?: Preview}};
// webpack resolves require.context at bundle time.
const ctx = (require as unknown as {context: (dir: string, recursive: boolean, re: RegExp) => Ctx}).context('./dev', false, /Preview\.tsx$/);
const PREVIEWS: Preview[] = ctx.keys().map((k) => ctx(k).preview).filter((p): p is Preview => Boolean(p));

export const Root: React.FC = () => (
  <>
    <Composition id="Reel" component={Reel} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{placement: 'organic', withAudio: true} satisfies ReelProps} />
    <Composition id="ReelSilent" component={Reel} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{placement: 'organic', withAudio: false} satisfies ReelProps} />
    {PREVIEWS.map((p) => (
      <Composition key={p.id} id={p.id} component={p.component} durationInFrames={p.durationInFrames} fps={FPS} width={p.width ?? WIDTH} height={p.height ?? HEIGHT} />
    ))}
  </>
);
