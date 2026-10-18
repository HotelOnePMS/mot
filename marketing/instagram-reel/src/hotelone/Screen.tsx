// A slice of the HotelOne app laid out at a real phone viewport (below the
// sm breakpoint, < 640 CSS px) and enlarged with CSS zoom. Zoom (unlike a
// scale transform) scales the layout box too, so text re-lays out crisply at
// the zoomed size and the element's footprint in the frame is exactly
// width x zoom by height x zoom px.
import React from 'react';
import {bodyStyle, ThemeProvider, useHO, type Mode} from './tokens.ts';

export type ScreenProps = {
  /** light = :root tokens (guest pages, the daytime console); dark = .dark (the night console). */
  mode: Mode;
  /** CSS zoom factor: the board's crop (S14 2.6x, S20 1.8x, S22 3x, S24 2.4x, S25 2.6x). */
  zoom?: number;
  /** Viewport width in CSS px. Must stay below 640 for the narrow layout (default 390, a common phone). */
  width?: number;
  /** Visible height in CSS px (overflow hidden). Omit to size to the content. */
  height?: number;
  /** Scroll offset in CSS px: content moves up by this much inside the viewport. Fractions are fine. */
  scrollY?: number;
  /** Paint the page background (default true). */
  background?: boolean | string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

/**
 * Renders children as the app would at a narrow viewport, then zooms. Everything inside reads
 * light/dark tokens from this Screen (useHO()), Inter with cv11/ss01/ss03, 16px/1.5 body text.
 */
export const Screen: React.FC<ScreenProps> = ({mode, zoom = 1, width = 390, height, scrollY = 0, background = true, style, children}) => {
  const t = useHO(mode);
  const bg = typeof background === 'string' ? background : background ? t.background : 'transparent';
  return (
    <ThemeProvider mode={mode}>
      <div
        style={{
          ...bodyStyle(t),
          position: 'relative',
          width,
          height,
          overflow: height !== undefined ? 'hidden' : undefined,
          background: bg,
          zoom,
          boxSizing: 'border-box',
          ...style,
        }}
      >
        <div style={{transform: scrollY ? `translateY(${-scrollY}px)` : undefined}}>{children}</div>
      </div>
    </ThemeProvider>
  );
};

/** The console page frame on phones: `mx-auto w-full max-w-7xl px-4 pb-12 pt-5` (sm:px-6 sm:pt-6 only applies at 640+). */
export const PageFrame: React.FC<{style?: React.CSSProperties; children: React.ReactNode}> = ({style, children}) => (
  <div style={{width: '100%', padding: '20px 16px 48px', boxSizing: 'border-box', ...style}}>{children}</div>
);
