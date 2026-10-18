// S20 TheKnot: board geometry (frame px) and the scene's clock in local frames.
// Every time comes from marks.ts (S20), converted with toLocalFrame(), so a
// nudge in the shared event clock moves the picture with the sound.
import {S20, toLocalFrame} from '../../marks.ts';

export const SCENE = 'TheKnot';
/** Absolute seconds → this scene's local frame. */
export const L = (sec: number) => toLocalFrame(sec, SCENE);

export type Panel = {x: number; y: number; w: number; h: number; rot: number};

/** TOP: Rita's front-desk phone, lock screen (board y 560–880). A print pinned a hair off square. */
export const TOP: Panel = {x: 90, y: 560, w: 840, h: 320, rot: -0.7};
/** BOTTOM: the Starlite's console inbox, dark theme at 1.8x (board y 960–1480). */
export const BOT: Panel = {x: 90, y: 960, w: 840, h: 520, rot: 0.35};
/** The console crop: 840 px / 1.8 = 466.7 CSS px (narrow layout, below the 640 sm breakpoint). */
export const ZOOM = 1.8;
export const CSS_W = BOT.w / ZOOM;

/**
 * Pinned tags: centre y per the board (520 and 925, the top one 4 px lower so it clears the red line's
 * descender). Rita's hangs from the left edge; the Starlite's from the right (x = its right edge) so the
 * red string, which drops left of centre, never crosses it.
 */
export const TAG_TOP = {x: 118, cy: 524};
export const TAG_BOT = {x: 902, cy: 925};

/** Headline zone (y 290–500): two Fraunces lines in 300–440, the red Inter line in 455–500. */
export const HEAD = {cx: 505, top: 300, lineH: 70, size: 64, line2Top: 446, line2Size: 44};

/** The giant total's ink pill (y 1170–1320), centred on the text column. */
export const PILL = {cx: 505, top: 1170, h: 150};

/** The slow push (100→106%) scales about this point, so the tag under the headline never rides up into it. */
export const PUSH_ORIGIN = {x: 505, y: 600};

/** Local frames of every beat (S20 in marks.ts). */
export const T = {
  panels: L(S20.panels.t),
  panelsEnd: L(S20.panels.t) + S20.panels.frames,
  circleLock: L(S20.circleLock),
  circleRow: L(S20.circleRow),
  circleDraw: 9,
  stringStart: L(S20.string.start),
  stringEnd: L(S20.string.end),
  pinA: L(S20.pins[0]),
  pinB: L(S20.pins[1]),
  headline: L(S20.headline),
  line2: L(S20.line2),
  circleTotal: L(S20.circleTotal),
  pop: L(S20.pop.t),
  popFrames: S20.pop.frames,
  end: L(S20.push.end),
} as const;

/** A panel-local point → board px (the panel rotates about its centre). */
export const panelToBoard = (p: Panel, pt: {x: number; y: number}) => {
  const a = (p.rot * Math.PI) / 180;
  const cx = p.w / 2;
  const cy = p.h / 2;
  const dx = pt.x - cx;
  const dy = pt.y - cy;
  return {x: p.x + cx + dx * Math.cos(a) - dy * Math.sin(a), y: p.y + cy + dx * Math.sin(a) + dy * Math.cos(a)};
};
