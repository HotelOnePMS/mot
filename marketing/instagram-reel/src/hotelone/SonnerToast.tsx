// The app's sonner toast (src/components/Providers.tsx ThemedToaster):
// richColors off, so every toast is the neutral popover surface with the icon
// carrying the tone (success = text-success), border = --border, radius
// calc(--radius + 4px) = 16, !shadow-lifted, title text-sm 500, close button
// on. On phones (max-width 639px) the toaster sits top-center: 16px from the
// top and sides, each toast the viewport width minus 32.
import React from 'react';
import {Easing, interpolate} from 'remotion';
import {Icon, SonnerSuccessIcon} from './icons.tsx';
import {RADIUS, shadow, useHO, type Mode} from './tokens.ts';

export const COPY_TOAST = 'Booking link copied — send it to the guest';
export const SAVED_TOAST = 'Voice settings saved — new calls use them right away';

export type SonnerToastProps = {
  title: string;
  type?: 'success' | 'normal';
  /** The app sets closeButton on the Toaster (top-left corner, half outside). */
  closeButton?: boolean;
  /** CSS px or any width (default 100% of its container). */
  width?: number | string;
  mode?: Mode;
  style?: React.CSSProperties;
};

/** One toast: padding 16, gap 6, items-center, 13px base, [data-icon] 16x16 (-3px / 4px margins), title 14/20 500. */
export const SonnerToast: React.FC<SonnerToastProps> = ({title, type = 'success', closeButton = true, width = '100%', mode, style}) => {
  const t = useHO(mode);
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width,
        padding: 16,
        background: t.popover,
        border: `1px solid ${t.border}`,
        color: t.foreground,
        borderRadius: RADIUS.xl,
        boxShadow: shadow(t, 'lifted'),
        fontSize: 13,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {type === 'success' ? (
        <span style={{display: 'flex', width: 16, height: 16, position: 'relative', justifyContent: 'flex-start', alignItems: 'center', flexShrink: 0, marginLeft: -3, marginRight: 4}}>
          <SonnerSuccessIcon color={t.success} />
        </span>
      ) : null}
      <div style={{display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0}}>
        <div style={{fontSize: 14, lineHeight: '20px', fontWeight: 500, color: 'inherit'}}>{title}</div>
      </div>
      {closeButton ? (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 24,
            height: 24,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: t.popover,
            color: t.mutedForeground,
            border: `1px solid ${t.border}`,
            borderRadius: '50%',
            transform: 'translate(-35%, -35%)',
            boxSizing: 'border-box',
          }}
        >
          <Icon name="x" size={12} strokeWidth={1.5} />
        </span>
      ) : null}
    </div>
  );
};

/**
 * The narrow-layout toaster: absolutely positioned at the top of its <Screen> (16px offsets).
 * `enter` is linear 0..1 over sonner's 400 ms (12 frames); the toast slides down from -100%
 * and fades in with CSS `ease`, as sonner's mount transition does.
 */
export const ToastViewport: React.FC<{enter: number; children: React.ReactNode; top?: number; style?: React.CSSProperties}> = ({enter, children, top = 16, style}) => {
  const k = interpolate(enter, [0, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.25, 0.1, 0.25, 1)});
  if (enter <= 0) return null;
  return (
    <div style={{position: 'absolute', top, left: 16, right: 16, zIndex: 50, ...style}}>
      <div style={{transform: `translateY(${(1 - k) * -100}%)`, opacity: k}}>{children}</div>
    </div>
  );
};
