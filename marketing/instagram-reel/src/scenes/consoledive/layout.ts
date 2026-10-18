// S14 ConsoleDive layout (frame px) and timing (scene-local frames).
// Every number the scene, the particle targets and the ring overlay share lives here.
import {S14} from '../../marks.ts';
import {local} from '../../timeline.ts';

const L = (sec: number) => local('ConsoleDive', sec);

/** Scene-local frames (frame 0 = 28.5). Derived from marks.ts, never from the board's literal numbers. */
export const T = {
  diveEnd: L(S14.converge.start), // 12: grille dive done, particles start converging
  resolve: L(S14.converge.end), // 21: particles land, card fully up
  tick: L(S14.uiTick), // 21: the field lights (soft UI tick)
  headline: L(S14.headline), // 23
  highlight: L(S14.highlight.t), // 52: measured onset of "day-use"
  highlightFrames: S14.highlight.frames, // 10
  cellStart: L(S14.rateCell.start), // 54
  cellDock: L(S14.rateCell.dock), // 60: first reaches its dock (the "tock")
  subLine: L(S14.subLine), // 60
  whip: L(S14.whip.start), // 84
  end: L(S14.whip.end), // 90 (first frame of S15)
} as const;

/** UI zoom of the card. The real narrow card is 16 px text / 26 px leading; at 2.2x that is 35 px type
 *  (the board's 36) and the card still ends above the caption band. See the report for why not 2.6x. */
export const Z = 2.2;
/** Card width in CSS px (a 382 CSS px phone, px-4 page), so rule 2 wraps as "…welcome for" / "$25 a night."
 *  At Z that is 770 px, x 120–890, centred on the text column (board x 80–940: see the report). */
export const CARD_CSS_W = 350;

const LABEL_TOP = 652;
const CARD_TOP = 596; // the card's real top edge, hidden by the fade
const TA_TOP = LABEL_TOP + 28 * Z; // label 20 + gap 8
const TA_H = 126 * Z; // rows 4 x 26 + py 10 x 2 + border
const HINT_TOP = TA_TOP + TA_H + 8 * Z;
const CARD_BOTTOM = HINT_TOP + 40 * Z + 20 * Z + 1 * Z;

export const CARD = {
  x: 120,
  w: CARD_CSS_W * Z,
  top: CARD_TOP,
  labelTop: LABEL_TOP,
  padTopCss: (LABEL_TOP - CARD_TOP) / Z,
  taTop: TA_TOP,
  taH: TA_H,
  hintTop: HINT_TOP,
  bottom: CARD_BOTTOM,
  /** The fade that hides the fields above House rules: transparent at fadeFrom, opaque at fadeTo (frame y). */
  fadeFrom: 612,
  fadeTo: 652,
} as const;

/** Text x inside the textarea: card border 1 + p-5 20 + textarea border 1 + px-3 12. */
const TEXT_X = CARD.x + 34 * Z;
const line = (i: number) => TA_TOP + (1 + 10 + 13 + 26 * i) * Z;

/** Rows the particles land on (centre lines): label, the 4 textarea lines, the 2 hint lines. */
export const PARTICLE_ROWS = [
  {x: CARD.x + 21 * Z, y: LABEL_TOP + 10 * Z, w: 76 * Z},
  {x: TEXT_X, y: line(0), w: 212 * Z},
  {x: TEXT_X, y: line(1), w: 262 * Z},
  {x: TEXT_X, y: line(2), w: 90 * Z},
  {x: TEXT_X, y: line(3), w: 196 * Z},
  {x: CARD.x + 21 * Z, y: HINT_TOP + 10 * Z, w: 300 * Z},
  {x: CARD.x + 21 * Z, y: HINT_TOP + 30 * Z, w: 190 * Z},
];

export const PARTICLE_TARGET = {x: CARD.x, y: CARD.fadeTo - 6, w: CARD.w, h: CARD_BOTTOM - (CARD.fadeTo - 6), r: 20 * Z};

/** Lockup: LogoMark 40 + Wordmark 30 + "· Voice front desk" 24 (board x 80–600, y 580–630). */
export const LOCKUP = {x: 120, y: 562, mark: 40, word: 30, sub: 24} as const;

/** Rate cell: one sm+ cell (92 x 88 CSS) docked over the card's top-right corner (board x 772–940, y 560–720). */
export const CELL = {x: 738, y: 560, cssW: 92, zoom: 168 / 92, travel: 400, tilt: 5} as const;
export const EYEBROW = {right: 906, top: 530, size: 20, lh: 22} as const;

/** Headline y 300–380 (Fraunces 600 72), sub-line y 395–445 (Inter 600 40), centred on the text column. */
export const HEAD = {cx: 505, top: 300, size: 72, lh: 80} as const;
export const SUB = {cx: 505, top: 395, size: 40, lh: 50} as const;

/** Where S13's dive lands and S14's grille opens. */
export const DIVE_CENTER = {x: 505, y: 880} as const;
