// The hook frame: Rita's red lobby (set/Lobby.tsx) under the frame-0 text block.
// S01 (ColdOpen) and S18 (Twist) both render THIS component with the same
// props on their first frame, so film frame 1155 pixel-matches frame 0.
//
// Text block (board S01, centred on x 505, on a soft ink plate y 280–680):
//   y 300–345  "2:13 AM"                                JetBrains Mono 500 44, 0.08em, brass
//   y 370–530  "Nobody works nights / at the Starlite."  Inter 600 72 / 1.08, ivory (word-lit)
//   y 580–645  "So who picks up at 0:20?"               Inter 600 54, "0:20" mono teal
import React from 'react';
import {AbsoluteFill, Easing, interpolate} from 'remotion';
import {Lobby, HOOK_CROP, buzzOffset, type Crop} from '../../set/Lobby.tsx';
import {TRILLS, TRILL_LEN} from '../../marks.ts';
import {cue, f} from '../../timeline.ts';
import {COLUMN_X, EASE_POP, FONT, INTER_FEATURES, NIGHT} from '../../theme.ts';

const ease = Easing.bezier(...EASE_POP);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** rgba() from a #rrggbb theme token. */
export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Board geometry of the text block (frame px). */
export const HOOK_TEXT = {
  x: COLUMN_X,
  eyebrow: {top: 300, size: 44},
  headline: {top: 370, size: 72, leading: 1.08},
  question: {top: 580, size: 54},
  /** S18 "Nobody." */
  nobody: {top: 670, size: 96},
  plate: {top: 280, bottom: 680},
} as const;

/** The R01 headline, word by word (index = cue('R01').words index). */
const WORDS = ['Nobody', 'works', 'nights', 'at', 'the', 'Starlite'] as const;
const LINES = [
  [0, 1, 2],
  [3, 4, 5],
] as const;

// ─── Sync helpers ───────────────────────────────────────────────────────────

/**
 * Trill envelope at an absolute second: 1 through the 0.6 s trill, releasing over its
 * last 0.1 s. Returns the envelope and frames since the trill began (for buzz parity,
 * so frame 0 and frame 1155 buzz to the same side).
 */
export const trillAt = (sec: number): {env: number; since: number} => {
  for (const t of TRILLS) {
    if (sec >= t - 1e-6 && sec < t + TRILL_LEN) {
      const d = sec - t;
      return {env: interpolate(d, [0, TRILL_LEN - 0.1, TRILL_LEN], [1, 1, 0], clamp), since: Math.round(d * 30)};
    }
  }
  return {env: 0, since: 0};
};

/** Phone buzz (set px) and ring pulse for an absolute second. */
export const ringAt = (sec: number) => {
  const {env, since} = trillAt(sec);
  return {buzz: buzzOffset(since, env, 3), ringPulse: env};
};

/**
 * Brass underline per R01 word at an absolute second: [in, out] fractions of the word.
 * The bar wipes in from the left as she says the word (4 frames, EASE_POP) and slides
 * off to the right as the next word starts, so one bar travels through the headline.
 */
export const underlinesAt = (sec: number): Array<[number, number]> => {
  const words = cue('R01').words;
  return WORDS.map((_, i) => {
    const start = f(words[i].start);
    const next = i + 1 < words.length ? f(words[i + 1].start) : Infinity;
    const fr = sec * 30;
    const a = interpolate(fr, [start, start + 4], [0, 1], {...clamp, easing: ease});
    const b = next === Infinity ? 0 : interpolate(fr, [next, next + 4], [0, 1], {...clamp, easing: ease});
    return [a, b];
  });
};

// ─── Pieces ─────────────────────────────────────────────────────────────────

/** Soft radial ink plate (#07090d at `alpha`, ~120 px feather) behind a text band. */
export const InkPlate: React.FC<{top: number; bottom: number; width?: number; alpha?: number; opacity?: number; feather?: number; x?: number}> = ({top, bottom, width = 1000, alpha = 0.55, opacity = 1, feather = 120, x = HOOK_TEXT.x}) => {
  if (opacity <= 0) return null;
  const h = bottom - top + feather * 2;
  const w = width + feather * 2;
  // the solid core covers the band; the last ~feather px fade to nothing
  const core = Math.max(0, Math.min(0.92, 1 - (feather * 1.25) / (h / 2)));
  return (
    <div
      style={{
        position: 'absolute',
        left: x - w / 2,
        top: top - feather,
        width: w,
        height: h,
        opacity,
        background: `radial-gradient(closest-side, ${rgba(NIGHT.ink, alpha)} 0%, ${rgba(NIGHT.ink, alpha)} ${Math.round(core * 100)}%, ${rgba(NIGHT.ink, alpha * 0.45)} ${Math.round((core + (1 - core) * 0.5) * 100)}%, ${rgba(NIGHT.ink, 0)} 100%)`,
      }}
    />
  );
};

const TEXT_SHADOW = `0 2px 14px ${rgba(NIGHT.ink, 0.55)}`;

/** One headline word with its brass bar. */
const Word: React.FC<{text: string; bar: [number, number]}> = ({text, bar}) => {
  const [a, b] = bar;
  const on = a - b > 0.001;
  return (
    <span style={{position: 'relative', display: 'inline-block'}}>
      {text}
      {on ? (
        <span
          style={{
            position: 'absolute',
            left: `${b * 100}%`,
            width: `${(a - b) * 100}%`,
            top: 74,
            height: 4,
            borderRadius: 2,
            background: NIGHT.brass,
            boxShadow: `0 0 10px ${rgba(NIGHT.brass, 0.55)}`,
          }}
        />
      ) : null}
    </span>
  );
};

/** "So who picks up at 0:20?" with the teal mono time. */
export const HookQuestion: React.FC<{since: number; opacity?: number}> = ({since, opacity = 1}) => {
  if (since < 0) return null;
  const s = interpolate(since, [0, 4], [0.92, 1], {...clamp, easing: ease});
  const o = interpolate(since, [-1, 1], [0, 1], clamp) * opacity;
  if (o <= 0) return null;
  const q = HOOK_TEXT.question;
  return (
    <div
      style={{
        position: 'absolute',
        left: HOOK_TEXT.x - 440,
        width: 880,
        top: q.top,
        height: 65,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT.ui,
        fontFeatureSettings: INTER_FEATURES,
        fontWeight: 600,
        fontSize: q.size,
        lineHeight: 1,
        letterSpacing: '-0.015em',
        color: NIGHT.ivory,
        whiteSpace: 'nowrap',
        textShadow: TEXT_SHADOW,
        opacity: o,
        transform: `scale(${s})`,
        transformOrigin: '50% 50%',
      }}
    >
      So who picks up at&nbsp;
      <span style={{fontFamily: FONT.mono, fontWeight: 500, letterSpacing: '-0.01em', color: NIGHT.tealSoft, textShadow: `0 0 18px ${rgba(NIGHT.teal, 0.45)}, ${TEXT_SHADOW}`}}>0:20</span>?
    </div>
  );
};

export type HookTextProps = {
  /** Brass underline state per word (underlinesAt). Omit for none (frame 0, S18). */
  underlines?: Array<[number, number]>;
  /** Frames since the question popped (negative or omitted = not yet). */
  question?: number;
  /** 0..1: eyebrow + headline dim to 25% (S18 39.0). */
  dim?: number;
  /** 0..1 opacity of the whole block (S19 fade-out). */
  opacity?: number;
};

/** The frame-0 text block on its ink plate. */
export const HookText: React.FC<HookTextProps> = ({underlines, question = -1, dim = 0, opacity = 1}) => {
  if (opacity <= 0) return null;
  const head = HOOK_TEXT.headline;
  const lit = 1 - 0.75 * dim;
  return (
    <AbsoluteFill style={{opacity}}>
      <InkPlate top={HOOK_TEXT.plate.top} bottom={HOOK_TEXT.plate.bottom} />
      <div
        style={{
          position: 'absolute',
          left: HOOK_TEXT.x - 400,
          width: 800,
          top: HOOK_TEXT.eyebrow.top,
          height: 45,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT.mono,
          fontWeight: 500,
          fontSize: HOOK_TEXT.eyebrow.size,
          lineHeight: 1,
          letterSpacing: '0.08em',
          // trailing tracking would push the centred word left
          paddingLeft: '0.08em',
          color: NIGHT.brass,
          textShadow: `0 0 16px ${rgba(NIGHT.brass, 0.3)}, ${TEXT_SHADOW}`,
          opacity: lit,
        }}
      >
        2:13 AM
      </div>
      <div
        style={{
          position: 'absolute',
          left: HOOK_TEXT.x - 450,
          width: 900,
          top: head.top,
          textAlign: 'center',
          fontFamily: FONT.ui,
          fontFeatureSettings: INTER_FEATURES,
          fontWeight: 600,
          fontSize: head.size,
          lineHeight: head.leading,
          letterSpacing: '-0.02em',
          color: NIGHT.ivory,
          textShadow: TEXT_SHADOW,
          opacity: lit,
        }}
      >
        {LINES.map((line, li) => (
          <div key={li} style={{whiteSpace: 'nowrap'}}>
            {line.map((wi, k) => (
              <React.Fragment key={wi}>
                {k > 0 ? ' ' : null}
                <Word text={WORDS[wi]} bar={underlines ? underlines[wi] : [0, 0]} />
                {wi === 5 ? '.' : null}
              </React.Fragment>
            ))}
          </div>
        ))}
      </div>
      <HookQuestion since={question} />
    </AbsoluteFill>
  );
};

export type HookFrameProps = HookTextProps & {
  /** Camera on the lobby set. HOOK_CROP on frame 0 and S18. */
  crop?: Crop;
  /** Absolute second, for the trill buzz/bloom (S01 0.0/1.5, S18 38.5/40.0, S19 41.5). */
  sec: number;
  windowNeon?: number;
  glint?: number;
  phoneBlur?: number;
  /** Phone screen level (S19 42.1: the glow dies). */
  screen?: number;
  /** Text layers drawn above the hook text (S18/S19 additions). */
  children?: React.ReactNode;
};

/**
 * The hook frame, shared by ColdOpen (S01) and Twist (S18–S19). Given the same
 * props it renders the same pixels, so S18's first frame matches frame 0.
 */
export const HookFrame: React.FC<HookFrameProps> = ({crop = HOOK_CROP, sec, windowNeon = 1, glint = 0, phoneBlur = 0, screen = 1, children, ...text}) => {
  const {buzz, ringPulse} = ringAt(sec);
  return (
    <AbsoluteFill style={{background: NIGHT.ink, overflow: 'hidden'}}>
      <Lobby tint="red" crop={crop} buzz={buzz} ringPulse={screen > 0 ? ringPulse : 0} windowNeon={windowNeon} glint={glint} phoneBlur={phoneBlur} screen={screen} />
      <HookText {...text} />
      {children}
    </AbsoluteFill>
  );
};
