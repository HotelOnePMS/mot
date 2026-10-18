// Burned-in captions for every spoken line (most Reels play muted).
// Speaker-coded: Rita ivory, the AI teal (Lagoon by day) behind an AudioLines
// glyph, Gus brass. The spoken word is full opacity with a 4 px underline in
// the speaker colour (the logo's brass threshold bar, reused); the rest of the
// chunk sits at 70%. Chunk times come from the measured clips (src/vo.ts).
import React from 'react';
import {interpolate, Easing, useCurrentFrame} from 'remotion';
import {CUES, FPS, type Cue, type Role, type Timed} from '../timeline.ts';
import {CAPTION_BAND, COLUMN_X, EASE_POP, FONT, INTER_FEATURES, LIGHT, NIGHT} from '../theme.ts';

/** Lines whose caption is drawn by the scene itself (S01: the headline is the caption). */
const SCENE_DRAWN = new Set<string>(['R01']);
/** Daylight runs from the morning to the end card. */
const DAY = {start: 46.5, end: 60.0};
const HOLD = 0.25; // seconds a chunk lingers after its last word, unless the next one starts

const style = (role: Role, day: boolean) => {
  if (role === 'ai') return {color: day ? LIGHT.primary : NIGHT.tealSoft, plate: day ? 'rgba(251,250,248,0.92)' : 'rgba(7,9,13,0.72)'};
  if (role === 'gus') return day ? {color: LIGHT.highlightSoftForeground, plate: LIGHT.highlightSoft} : {color: NIGHT.brassLight, plate: 'rgba(7,9,13,0.72)'};
  return {color: day ? LIGHT.foreground : NIGHT.ivory, plate: day ? 'rgba(251,250,248,0.92)' : 'rgba(7,9,13,0.72)'};
};

const AudioLines: React.FC<{color: string}> = ({color}) => (
  <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" style={{flexShrink: 0, marginRight: 12}}>
    <path d="M2 10v3" />
    <path d="M6 6v11" />
    <path d="M10 3v18" />
    <path d="M14 8v7" />
    <path d="M18 5v13" />
    <path d="M22 10v3" />
  </svg>
);

type Active = {cue: Cue; chunk: Timed; index: number};

/** Every chunk start across all lines, to know when the next caption takes over. */
const STARTS = CUES.flatMap((c) => c.chunks.map((k) => k.start)).sort((a, b) => a - b);

export const activeChunk = (t: number): Active | null => {
  for (const cue of CUES) {
    for (let i = 0; i < cue.chunks.length; i++) {
      const chunk = cue.chunks[i];
      const next = STARTS.find((x) => x > chunk.start + 1e-6) ?? Infinity;
      const until = Math.min(cue.cut ?? Infinity, Math.max(chunk.end + HOLD, chunk.end), next);
      if (t >= chunk.start - 0.03 && t < until) return {cue, chunk, index: i};
    }
  }
  return null;
};

export const Captions: React.FC<{placement?: 'organic' | 'paid'}> = ({placement = 'organic'}) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const active = activeChunk(t);
  if (!active || SCENE_DRAWN.has(active.cue.id)) return null;
  const {cue, chunk} = active;
  const day = t >= DAY.start && t < DAY.end;
  const {color, plate} = style(cue.role, day);

  // Pop in over 4 frames from the chunk's first frame.
  const startFrame = Math.round(chunk.start * FPS);
  const pop = interpolate(frame, [startFrame, startFrame + 4], [0.92, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(...EASE_POP),
  });

  // Map displayed tokens to spoken words when they line up one-to-one.
  const tokens = chunk.text.split(' ');
  const spoken = cue.words.filter((w) => w.start >= chunk.start - 1e-3 && w.start < chunk.end - 1e-3 && /[\p{L}\p{N}]/u.test(w.text));
  const visibleTokens = tokens.filter((x) => /[\p{L}\p{N}$]/u.test(x));
  const oneToOne = spoken.length === visibleTokens.length;
  // Only the most recently started word is current, until shortly after it ends.
  const lastStarted = spoken.filter((w) => t >= w.start).pop();
  const currentWord = lastStarted && t < lastStarted.end + 0.08 ? lastStarted : undefined;
  let vi = 0;

  const top = placement === 'paid' ? 1000 : CAPTION_BAND.top;
  return (
    <div
      style={{
        position: 'absolute',
        left: COLUMN_X - CAPTION_BAND.maxWidth / 2,
        width: CAPTION_BAND.maxWidth,
        top,
        height: CAPTION_BAND.bottom - CAPTION_BAND.top,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 20px',
          borderRadius: 12,
          background: plate,
          transform: `scale(${pop})`,
          fontFamily: `${FONT.ui}, ${FONT.emoji}`,
          fontFeatureSettings: INTER_FEATURES,
          fontWeight: 600,
          fontSize: 52,
          lineHeight: 1.15,
          color,
          whiteSpace: 'nowrap',
          boxShadow: day ? '0 8px 24px -8px rgba(17,24,39,0.25)' : 'none',
          borderBottom: cue.role === 'gus' && day ? `3px solid ${LIGHT.highlight}` : undefined,
        }}
      >
        {cue.role === 'ai' ? <AudioLines color={color} /> : null}
        {tokens.map((tok, i) => {
          const isWord = /[\p{L}\p{N}$]/u.test(tok);
          const w = isWord && oneToOne ? spoken[vi++] : undefined;
          const on = !oneToOne || !w ? true : t >= w.start;
          const current = Boolean(w && w === currentWord);
          return (
            <span
              key={i}
              style={{
                opacity: on ? 1 : 0.7,
                marginRight: i < tokens.length - 1 ? '0.26em' : 0,
                paddingBottom: 4,
                borderBottom: `4px solid ${current ? color : 'transparent'}`,
              }}
            >
              {tok}
            </span>
          );
        })}
      </div>
    </div>
  );
};
