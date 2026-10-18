// src/components/brand/Logo.tsx, rebuilt with inline styles. Same geometry
// (LOGO_GEOMETRY, verbatim), same colour roles: a Lagoon tile, a keyhole in
// primary-foreground and a brass threshold bar; light/dark per the theme.
import React from 'react';
import {FRAUNCES, useHO, type Mode} from './tokens.ts';

/**
 * Keyhole geometry on a 32x32 grid (verbatim from the app). The keyhole is an
 * "O" over a "1" (One) and the brass bar beneath it is the room's threshold.
 */
export const LOGO_GEOMETRY = {
  viewBox: '0 0 32 32',
  tileRadius: 9,
  bow: {cx: 16, cy: 11.5, r: 5},
  stem: 'M14.15 14.2 12.7 20.7Q12.5 21.8 13.7 21.8H18.3Q19.5 21.8 19.3 20.7L17.85 14.2Z',
  threshold: 'M10.5 25.6h11',
} as const;

export type LogoMarkProps = {
  /** Rendered size in px (the app default is h-8 w-8 = 32). */
  size?: number;
  mode?: Mode;
  /** Colour overrides (default: primary / primary-foreground / highlight of the mode). */
  tile?: string;
  keyhole?: string;
  sill?: string;
  /** 0..1 draws the brass threshold left to right (S26: over 8 frames from 54.55). Default 1. */
  threshold?: number;
  style?: React.CSSProperties;
};

/** The HotelOne mark. Light: #085f81 tile, #ffffff keyhole, #cc8e24 sill. Dark: #30a7cf, #0c111d, #e1ae47. */
export const LogoMark: React.FC<LogoMarkProps> = ({size = 32, mode, tile, keyhole, sill, threshold = 1, style}) => {
  const t = useHO(mode);
  const g = LOGO_GEOMETRY;
  const k = Math.max(0, Math.min(1, threshold));
  return (
    <svg viewBox={g.viewBox} width={size} height={size} style={{flexShrink: 0, display: 'block', ...style}} aria-hidden>
      <rect width="32" height="32" rx={g.tileRadius} fill={tile ?? t.primary} />
      <circle cx={g.bow.cx} cy={g.bow.cy} r={g.bow.r} fill={keyhole ?? t.primaryForeground} />
      <path d={g.stem} fill={keyhole ?? t.primaryForeground} />
      {k > 0 ? (
        <path d={`M10.5 25.6h${(11 * k).toFixed(3)}`} stroke={sill ?? t.highlight} strokeWidth="2" strokeLinecap="round" fill="none" />
      ) : null}
    </svg>
  );
};

export type WordmarkProps = {
  /** Font size in px (the app default is text-xl = 20). */
  size?: number;
  /** Text colour (inherited in the app; default the mode's foreground). */
  color?: string;
  mode?: Mode;
  style?: React.CSSProperties;
};

/** "Hotel" (Fraunces 400) + "One" (Fraunces 600), leading-none, tracking-tight. */
export const Wordmark: React.FC<WordmarkProps> = ({size = 20, color, mode, style}) => {
  const t = useHO(mode);
  return (
    <span
      style={{
        fontFamily: FRAUNCES,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '-0.025em',
        color: color ?? t.foreground,
        whiteSpace: 'nowrap',
        display: 'inline-block',
        ...style,
      }}
    >
      <span style={{fontWeight: 400}}>Hotel</span>
      <span style={{fontWeight: 600}}>One</span>
    </span>
  );
};

export type LogoProps = {
  /** Mark size in px (default 32). */
  markSize?: number;
  /** Wordmark font size in px (default 20). */
  wordSize?: number;
  /** Gap between mark and wordmark (default gap-2.5 = 10px). */
  gap?: number;
  /** Mark only (compact). */
  compact?: boolean;
  color?: string;
  mode?: Mode;
  threshold?: number;
  style?: React.CSSProperties;
};

/** Mark + wordmark (inline-flex items-center gap-2.5). End card: markSize 64, wordSize 56, gap 20. S14: 40 / 30. */
export const Logo: React.FC<LogoProps> = ({markSize = 32, wordSize = 20, gap = 10, compact, color, mode, threshold, style}) => (
  <span style={{display: 'inline-flex', alignItems: 'center', gap, ...style}}>
    <LogoMark size={markSize} mode={mode} threshold={threshold} />
    {compact ? null : <Wordmark size={wordSize} color={color} mode={mode} />}
  </span>
);
