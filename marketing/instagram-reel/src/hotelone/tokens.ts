// HotelOne design tokens for the faithful UI rebuilds. Every colour comes from
// theme.ts (LIGHT = globals.css :root, DARK = .dark); this file only
// normalises the two sets to one shape, adds the app's radii, shadows and type
// scale (tailwind.config.ts), and provides the light/dark context that
// <Screen> sets for everything rendered inside it.
import React from 'react';
import {DARK, FONT, INTER_FEATURES, LIGHT} from '../theme.ts';

export type Mode = 'light' | 'dark';

export type Tokens = {
  mode: Mode;
  background: string;
  foreground: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  card: string;
  popover: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  border: string;
  /** --border-strong = --input */
  borderStrong: string;
  ring: string;
  primary: string;
  primaryHover: string;
  primaryForeground: string;
  primarySoft: string;
  primarySoftForeground: string;
  highlight: string;
  highlightSoft: string;
  highlightSoftForeground: string;
  success: string;
  successSoft: string;
  successSoftForeground: string;
  destructive: string;
  destructiveSoft: string;
  destructiveSoftForeground: string;
  agent: string;
  agentSoft: string;
  agentSoftForeground: string;
  agentGradientFrom: string;
  agentGradientTo: string;
  /** rgb triplet of --shadow, for rgba(). */
  shadow: string;
};

const pick = (m: typeof LIGHT | typeof DARK, mode: Mode, extra: Pick<Tokens, 'surfaceRaised' | 'popover'>): Tokens => ({
  mode,
  background: m.background,
  foreground: m.foreground,
  surface: m.surface,
  surfaceRaised: extra.surfaceRaised,
  surfaceSunken: m.surfaceSunken,
  card: m.card,
  popover: extra.popover,
  muted: m.muted,
  mutedForeground: m.mutedForeground,
  accent: m.accent,
  border: m.border,
  borderStrong: m.borderStrong,
  ring: m.ring,
  primary: m.primary,
  primaryHover: m.primaryHover,
  primaryForeground: m.primaryForeground,
  primarySoft: m.primarySoft,
  primarySoftForeground: m.primarySoftForeground,
  highlight: m.highlight,
  highlightSoft: m.highlightSoft,
  highlightSoftForeground: m.highlightSoftForeground,
  success: m.success,
  successSoft: m.successSoft,
  successSoftForeground: m.successSoftForeground,
  destructive: m.destructive,
  destructiveSoft: m.destructiveSoft,
  destructiveSoftForeground: m.destructiveSoftForeground,
  agent: m.agent,
  agentSoft: m.agentSoft,
  agentSoftForeground: m.agentSoftForeground,
  agentGradientFrom: m.agentGradientFrom,
  agentGradientTo: m.agentGradientTo,
  shadow: m.shadow,
});

/** Light :root has surface-raised = surface and popover = card (both #ffffff). */
export const HO: Record<Mode, Tokens> = {
  light: pick(LIGHT, 'light', {surfaceRaised: LIGHT.surface, popover: LIGHT.card}),
  dark: pick(DARK, 'dark', {surfaceRaised: DARK.surfaceRaised, popover: DARK.popover}),
};

/** Radii from --radius 0.75rem (tailwind.config.ts borderRadius). */
export const RADIUS = {sm: 8, md: 10, lg: 12, xl: 16, '2xl': 20, '3xl': 26, full: 9999} as const;

/** Type scale used by the rebuilt screens: [font-size, line-height] in CSS px. */
export const TEXT = {
  '2xs': [11, 16],
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28],
  '2xl': [24, 32],
} as const;

/** text-2xs carries 0.02em tracking. */
export const TRACK_2XS = '0.02em';

export const INTER = FONT.ui;
export const FRAUNCES = FONT.display;
export {INTER_FEATURES};

/** hex (#rgb / #rrggbb) -> rgba() with alpha. */
export const alpha = (hex: string, a: number): string => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Mix two hex colours (t = 0 -> a, 1 -> b), as an opaque hex. */
export const mix = (a: string, b: string, t: number): string => {
  const p = (hex: string) => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const A = p(a);
  const B = p(b);
  const k = Math.max(0, Math.min(1, t));
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
};

/** tailwind.config.ts boxShadow, tinted with the mode's --shadow. */
export const shadow = (t: Tokens, kind: 'xs' | 'soft' | 'lifted' | 'float' | 'glow'): string => {
  const s = (a: number) => `rgba(${t.shadow}, ${a})`;
  switch (kind) {
    case 'xs':
      return `0 1px 2px 0 ${s(0.05)}`;
    case 'soft':
      return `0 1px 2px ${s(0.04)}, 0 4px 12px -2px ${s(0.06)}`;
    case 'lifted':
      return `0 2px 4px ${s(0.04)}, 0 12px 32px -8px ${s(0.14)}`;
    case 'float':
      return `0 8px 16px -4px ${s(0.08)}, 0 24px 64px -12px ${s(0.22)}`;
    case 'glow':
      return `0 0 0 1px ${alpha(t.agent, 0.25)}, 0 8px 32px -6px ${alpha(t.agent, 0.35)}`;
  }
};

/** .bg-aurora: linear-gradient(120deg, from 0%, to 50%, from 100%) at background-size 200%. `phase` 0..1 = background-position 0% -> 100%. */
export const aurora = (t: Tokens, phase = 0): React.CSSProperties => ({
  backgroundImage: `linear-gradient(120deg, ${t.agentGradientFrom} 0%, ${t.agentGradientTo} 50%, ${t.agentGradientFrom} 100%)`,
  backgroundSize: '200% 200%',
  backgroundPosition: `${Math.max(0, Math.min(1, phase)) * 100}% 50%`,
});

const ThemeContext = React.createContext<Mode>('light');

/** Sets the light/dark tokens for every HotelOne component inside. <Screen> provides one. */
export const ThemeProvider: React.FC<{mode: Mode; children: React.ReactNode}> = ({mode, children}) =>
  React.createElement(ThemeContext.Provider, {value: mode}, children);

/** The tokens for `mode`, or for the surrounding <Screen>/<ThemeProvider>. */
export const useHO = (mode?: Mode): Tokens => {
  const ctx = React.useContext(ThemeContext);
  return HO[mode ?? ctx];
};

/** Inter with the app's stylistic sets: set on every top-level primitive so it renders right outside <Screen> too. */
export const uiFont: React.CSSProperties = {fontFamily: INTER, fontFeatureSettings: INTER_FEATURES, WebkitFontSmoothing: 'antialiased', textRendering: 'optimizeLegibility'};

/**
 * Body text defaults (globals.css html/body): Inter with cv11/ss01/ss03, antialiased, and
 * text-rendering: optimizeLegibility (kerning on at every size: without it lines are a hair wider
 * and wrap a word earlier than the app does).
 */
export const bodyStyle = (t: Tokens): React.CSSProperties => ({
  fontFamily: INTER,
  fontFeatureSettings: INTER_FEATURES,
  WebkitFontSmoothing: 'antialiased',
  textRendering: 'optimizeLegibility',
  color: t.foreground,
  fontSize: 16,
  lineHeight: 1.5,
});
