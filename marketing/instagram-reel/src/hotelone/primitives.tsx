// src/components/ui/{badge,button,card,segmented}.tsx and Avatar from
// primitives.tsx, rebuilt with inline styles at the app's CSS px sizes. Render
// them inside <Screen> (which zooms them to the shot's crop factor).
import React from 'react';
import {Icon, type IconName} from './icons.tsx';
import {LIGHT} from '../theme.ts';
import {alpha, RADIUS, shadow, TRACK_2XS, uiFont, useHO, type Mode, type Tokens} from './tokens.ts';

/** .dark --info-soft / --info-soft-foreground (globals.css; not in theme.ts DARK). */
const INFO_SOFT_DARK = '#132839';
const INFO_SOFT_FG_DARK = '#92d0fc';

// ─── Badge ──────────────────────────────────────────────────────────────────

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'neutral' | 'primary' | 'highlight' | 'success' | 'danger' | 'agent';

const badgeColors = (t: Tokens, v: BadgeVariant): {bg: string; fg: string; border: string} => {
  switch (v) {
    case 'default':
      return {bg: t.primary, fg: t.primaryForeground, border: 'transparent'};
    case 'secondary':
      return {bg: t.muted, fg: t.foreground, border: 'transparent'};
    case 'outline':
      return {bg: 'transparent', fg: t.foreground, border: t.border};
    case 'neutral':
      return {bg: t.muted, fg: t.mutedForeground, border: 'transparent'};
    case 'primary':
      return {bg: t.primarySoft, fg: t.primarySoftForeground, border: 'transparent'};
    case 'highlight':
      return {bg: t.highlightSoft, fg: t.highlightSoftForeground, border: 'transparent'};
    case 'success':
      return {bg: t.successSoft, fg: t.successSoftForeground, border: 'transparent'};
    case 'danger':
      return {bg: t.destructiveSoft, fg: t.destructiveSoftForeground, border: 'transparent'};
    case 'agent':
      return {bg: t.agentSoft, fg: t.agentSoftForeground, border: 'transparent'};
  }
};

export type BadgeProps = {
  variant?: BadgeVariant;
  size?: 'default' | 'sm';
  icon?: IconName;
  /** Text colour override (the inbox passes text-muted-foreground on the outline badge). */
  color?: string;
  mode?: Mode;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

/**
 * ui/badge.tsx. Default: rounded-full border px-2.5 py-0.5 text-xs 500 leading-5, icon 14.
 * sm: gap-1 px-2 py-0 text-2xs (11px, 0.02em) leading-[18px], icon 12.
 * The inbox source badge is `<Badge variant="outline" size="sm" icon={Phone} className="text-muted-foreground">`.
 */
export const Badge: React.FC<BadgeProps> = ({variant = 'default', size = 'default', icon, color, mode, style, children}) => {
  const t = useHO(mode);
  const c = badgeColors(t, variant);
  const sm = size === 'sm';
  return (
    <span
      style={{
        ...uiFont,
        display: 'inline-flex',
        maxWidth: '100%',
        alignItems: 'center',
        gap: sm ? 4 : 6,
        whiteSpace: 'nowrap',
        borderRadius: RADIUS.full,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: color ?? c.fg,
        padding: sm ? '0 8px' : '2px 10px',
        fontSize: sm ? 11 : 12,
        letterSpacing: sm ? TRACK_2XS : undefined,
        lineHeight: sm ? '18px' : '20px',
        fontWeight: 500,
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={sm ? 12 : 14} /> : null}
      {children}
    </span>
  );
};

// ─── Button ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'outline' | 'soft';
export type ButtonSize = 'default' | 'sm' | 'lg';

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading lucide icon (size-4). */
  icon?: IconName;
  /** Trailing lucide icon. */
  iconRight?: IconName;
  /** Text colour override, e.g. the inbox's ghost buttons use `text-primary`. */
  color?: string;
  /** Horizontal padding override (the inbox's ghost buttons use px-2 = 8). */
  paddingX?: number;
  /** 0..1 press: active:scale-[0.98]. */
  pressed?: number;
  /** 0..1 hover/pressed background (ghost -> accent, secondary -> accent, default -> primary-hover). */
  hover?: number;
  mode?: Mode;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

const SIZES: Record<ButtonSize, {h: number; px: number; r: number; fs: number}> = {
  default: {h: 40, px: 16, r: RADIUS.lg, fs: 14},
  sm: {h: 36, px: 12, r: RADIUS.md, fs: 13},
  lg: {h: 48, px: 24, r: RADIUS.xl, fs: 16},
};

/** ui/button.tsx: inline-flex gap-2 rounded-lg text-sm 500, icons 16. sm h-9 rounded-md px-3 text-[13px]; lg h-12 rounded-xl px-6 text-base. */
export const Button: React.FC<ButtonProps> = ({variant = 'default', size = 'default', icon, iconRight, color, paddingX, pressed = 0, hover = 0, mode, style, children}) => {
  const t = useHO(mode);
  const s = SIZES[size];
  const h = Math.max(0, Math.min(1, hover));
  let bg = 'transparent';
  let fg = t.foreground;
  let border: string | undefined;
  let boxShadow: string | undefined;
  switch (variant) {
    case 'default':
      bg = h >= 0.5 ? t.primaryHover : t.primary;
      fg = t.primaryForeground;
      boxShadow = shadow(t, 'xs');
      break;
    case 'secondary':
      bg = h >= 0.5 ? t.accent : t.muted;
      break;
    case 'ghost':
      bg = h > 0 ? alpha(t.accent, h) : 'transparent';
      break;
    case 'outline':
      bg = t.surface;
      border = `1px solid ${alpha(t.borderStrong, 0.5)}`;
      boxShadow = shadow(t, 'xs');
      break;
    case 'soft':
      bg = t.primarySoft;
      fg = t.primarySoftForeground;
      break;
  }
  const scale = 1 - 0.02 * Math.max(0, Math.min(1, pressed));
  return (
    <span
      style={{
        ...uiFont,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
        height: s.h,
        padding: `0 ${paddingX ?? s.px}px`,
        borderRadius: s.r,
        fontSize: s.fs,
        lineHeight: '20px',
        fontWeight: 500,
        background: bg,
        color: color ?? fg,
        border,
        boxSizing: 'border-box',
        boxShadow,
        transform: scale !== 1 ? `scale(${scale})` : undefined,
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={16} /> : null}
    </span>
  );
};

// ─── Card ───────────────────────────────────────────────────────────────────

/** ui/card.tsx: rounded-2xl border bg-card shadow-soft. Pass padding via style (the inbox uses p-0 + divide-y). */
export const Card: React.FC<{mode?: Mode; style?: React.CSSProperties; shadowKind?: 'xs' | 'soft' | 'lifted' | 'float'; children?: React.ReactNode}> = ({mode, style, shadowKind = 'soft', children}) => {
  const t = useHO(mode);
  return (
    <div
      style={{
        ...uiFont,
        borderRadius: RADIUS['2xl'],
        border: `1px solid ${t.border}`,
        background: t.card,
        color: t.foreground,
        boxShadow: shadow(t, shadowKind),
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ─── Avatar ─────────────────────────────────────────────────────────────────

export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

/** primitives.tsx Avatar: initials circle, tone by name hash (primary-soft / info-soft / secondary). md = 36px text-xs 600. */
export const Avatar: React.FC<{name: string; size?: number; mode?: Mode; style?: React.CSSProperties}> = ({name, size = 36, mode, style}) => {
  const t = useHO(mode);
  const tones = [
    {bg: t.primarySoft, fg: t.primarySoftForeground},
    {bg: t.mode === 'light' ? LIGHT.infoSoft : INFO_SOFT_DARK, fg: t.mode === 'light' ? LIGHT.infoSoftForeground : INFO_SOFT_FG_DARK},
    {bg: t.muted, fg: t.foreground},
  ];
  const tone = tones[Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length];
  return (
    <span
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: RADIUS.full,
        background: tone.bg,
        color: tone.fg,
        fontSize: size <= 28 ? 11 : size >= 48 ? 14 : 12,
        fontWeight: 600,
        lineHeight: 1,
        ...style,
      }}
    >
      {initials(name)}
    </span>
  );
};

// ─── SegmentedControl ───────────────────────────────────────────────────────

/**
 * framer-motion's {type: 'spring', bounce: 0.18, duration: 0.45} (the SegmentedControl layoutId pill) as a
 * Remotion spring config: damping ratio 1 - bounce = 0.82, natural frequency 2π / duration.
 * Usage: spring({frame: frame - start, fps: 30, config: LAYOUT_SPRING}). Also fits the board's other "bounce .18" springs.
 */
export const LAYOUT_SPRING = {mass: 1, stiffness: Math.round((2 * Math.PI / 0.45) ** 2), damping: Math.round(((4 * Math.PI * 0.82) / 0.45) * 10) / 10} as const;

export type SegmentedProps = {
  /** Option labels, e.g. ['To handle · 2', 'Done · 0']. */
  options: string[];
  /** Index of the active option. */
  value: number;
  size?: 'sm' | 'md';
  /**
   * Animate the framer layoutId pill from an earlier state to this one:
   * progress 0 = the old geometry (old active index and/or old labels), 1 = now.
   * Feed it a spring (bounce .18, .45 s) from the scene. Labels change at once,
   * as in the app; only the pill travels/resizes.
   */
  from?: {value?: number; options?: string[]; progress: number};
  /**
   * When the row is wider than its box (phones), the app scrolls the selected option into view and
   * fades the hidden edge (28px mask). 'end' = scrolled fully right with the start edge faded (the
   * voice page's four tabs with "Messages" selected). Default 'start' (no overflow handling).
   */
  scrolled?: 'start' | 'end';
  mode?: Mode;
  style?: React.CSSProperties;
};

/**
 * ui/segmented.tsx: track rounded-xl bg-muted p-1 ring-1 ring-inset ring-border, gap-0.5;
 * options h-8 rounded-lg 500 (sm px-2.5 text-xs, md px-3 text-[13px]);
 * active pill bg-surface shadow-xs ring-1 ring-border-strong/25.
 */
export const SegmentedControl: React.FC<SegmentedProps> = ({options, value, size = 'md', from, scrolled = 'start', mode, style}) => {
  const t = useHO(mode);
  const px = size === 'sm' ? 10 : 12;
  const fs = size === 'sm' ? 12 : 13;
  const lh = size === 'sm' ? '16px' : '20px';
  const p = from ? Math.max(0, Math.min(1, from.progress)) : 1;
  const animating = Boolean(from) && p < 0.999;
  const pillStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: RADIUS.lg,
    background: t.surface,
    boxShadow: `0 0 0 1px ${alpha(t.borderStrong, 0.25)}, ${shadow(t, 'xs')}`,
  };
  const option = (label: string, active: boolean, ghost = false, key?: React.Key) => (
    <span
      key={key}
      style={{
        position: 'relative',
        zIndex: ghost ? undefined : 1,
        display: 'inline-flex',
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        height: 32,
        padding: `0 ${px}px`,
        borderRadius: RADIUS.lg,
        fontSize: fs,
        lineHeight: lh,
        fontWeight: 500,
        color: active ? t.foreground : t.mutedForeground,
        visibility: ghost ? 'hidden' : undefined,
        boxSizing: 'border-box',
      }}
    >
      {active && !ghost && !animating ? <span style={{...pillStyle, zIndex: -1}} /> : null}
      {label}
    </span>
  );
  const oldOptions = from?.options ?? options;
  const oldValue = from?.value ?? value;
  // The pill's geometry as a blend of two in-flow layouts: an element's layout width under
  // CSS zoom is zoom x its natural width, so zoom(1-p) old + zoom(p) new = lerp(old, new).
  const ghostRow = (opts: string[], upto: number) => opts.slice(0, upto).map((o, i) => <span key={i} style={{display: 'inline-flex', marginRight: 2}}>{option(o, false, true)}</span>);
  const blend = (a: React.ReactNode, b: React.ReactNode) => (
    <>
      {p < 0.999 ? <span style={{display: 'inline-flex', zoom: Math.max(1e-4, 1 - p)}}>{a}</span> : null}
      {p > 0.001 ? <span style={{display: 'inline-flex', zoom: Math.max(1e-4, p)}}>{b}</span> : null}
    </>
  );
  return (
    <div
      style={{
        ...uiFont,
        position: 'relative',
        display: 'inline-flex',
        maxWidth: '100%',
        alignItems: 'center',
        gap: 2,
        overflow: 'hidden',
        justifyContent: scrolled === 'end' ? 'flex-end' : undefined,
        maskImage: scrolled === 'end' ? 'linear-gradient(to right, transparent, #000 28px, #000)' : undefined,
        WebkitMaskImage: scrolled === 'end' ? 'linear-gradient(to right, transparent, #000 28px, #000)' : undefined,
        borderRadius: RADIUS.xl,
        background: t.muted,
        padding: 4,
        boxShadow: `inset 0 0 0 1px ${t.border}`,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {animating ? (
        <div style={{position: 'absolute', top: 4, left: 4, height: 32, display: 'flex', alignItems: 'flex-start', pointerEvents: 'none', zIndex: 0}}>
          {blend(ghostRow(oldOptions, oldValue), ghostRow(options, value))}
          <span style={{position: 'relative', display: 'flex', alignItems: 'flex-start', height: 32}}>
            <span style={pillStyle} />
            {blend(option(oldOptions[oldValue] ?? '', true, true), option(options[value] ?? '', true, true))}
          </span>
        </div>
      ) : null}
      {options.map((o, i) => option(o, i === value, false, i))}
    </div>
  );
};
