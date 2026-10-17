import type * as React from 'react';

/**
 * Per-hotel brand colour for guest pages (white-label).
 *
 * A hotel picks any colour, so we never use it raw: every value we emit is
 * checked with the WCAG contrast formula and nudged (same hue, lighter or
 * darker) until the pairings it is used for pass AA (4.5:1):
 *  - `--brand` against the page surfaces, so text-brand links and icons read;
 *  - `--brand-foreground` (white or dark ink, whichever contrasts more) on it,
 *    so the bg-brand call to action reads;
 *  - `--brand-soft-foreground` on `--brand-soft` (and on the page).
 * Light and dark get their own set. Values are HSL triplets ("H S% L%"),
 * the format of the tokens in globals.css.
 */

type Hsl = { h: number; s: number; l: number };

const fmt = ({ h, s, l }: Hsl) => `${h} ${s}% ${l}%`;

function parseHex(hex: string | null | undefined): [number, number, number] | null {
  const raw = hex?.trim().replace(/^#/, '') ?? '';
  const full = /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, (c) => c + c) : raw;
  const m = full.match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** WCAG 2.x relative luminance. */
function luminance(c: Hsl): number {
  const [r, g, b] = hslToRgb(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two colours (1–21). */
export function contrastRatio(a: Hsl, b: Hsl): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Step lightness (same hue and saturation) until `ok` holds, or the end of the range. */
function nudge(c: Hsl, dir: -1 | 1, ok: (c: Hsl) => boolean): Hsl {
  let cur = c;
  while (!ok(cur) && (dir < 0 ? cur.l > 0 : cur.l < 100)) cur = { ...cur, l: cur.l + dir };
  return cur;
}

const AA = 4.5;

// Mirrors globals.css. The worst-case surface per theme is the one closest
// in lightness to the brand colour (muted in light, surface-raised in dark).
const LIGHT = {
  surfaces: [
    { h: 40, s: 30, l: 98 }, // background
    { h: 40, s: 18, l: 94.5 }, // muted / secondary
  ],
  ink: { h: 222, s: 40, l: 11 },
};
const DARK = {
  surfaces: [
    { h: 222, s: 30, l: 7 }, // background
    { h: 222, s: 24, l: 13 }, // surface-raised
  ],
  ink: { h: 222, s: 40, l: 8 },
};
const WHITE: Hsl = { h: 0, s: 0, l: 100 };

const passesOn = (surfaces: Hsl[]) => (c: Hsl) => surfaces.every((s) => contrastRatio(c, s) >= AA);
const bestText = (fill: Hsl, ink: Hsl) => (contrastRatio(WHITE, fill) >= contrastRatio(ink, fill) ? WHITE : ink);

export interface BrandPalette {
  brand: string;
  brandForeground: string;
  soft: string;
  softForeground: string;
}

/** The AA-safe brand palette for a hotel colour, for light and dark themes. */
export function brandPalette(hex: string | null | undefined): { light: BrandPalette; dark: BrandPalette } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const base = rgbToHsl(rgb);

  // Light: darken until it reads as text on the page; the CTA text is then
  // whichever of white or ink contrasts more (white, in practice).
  const lBrand = nudge(base, -1, passesOn(LIGHT.surfaces));
  const lSoft: Hsl = { h: base.h, s: Math.min(base.s, 70), l: 95 };
  const lSoftFg = nudge({ ...lBrand, l: Math.min(lBrand.l, 30) }, -1, passesOn([lSoft, ...LIGHT.surfaces]));

  // Dark: soften the saturation a touch and lighten until it reads on the
  // darkest-but-one surface; the CTA text becomes dark ink.
  const dBase: Hsl = { ...base, s: Math.min(base.s, 80) };
  const dBrand = nudge(dBase, 1, passesOn(DARK.surfaces));
  const dSoft: Hsl = { h: base.h, s: Math.min(base.s, 45), l: 15 };
  const dSoftFg = nudge({ ...dBrand, l: Math.max(dBrand.l, 72) }, 1, passesOn([dSoft, ...DARK.surfaces]));

  return {
    light: { brand: fmt(lBrand), brandForeground: fmt(bestText(lBrand, LIGHT.ink)), soft: fmt(lSoft), softForeground: fmt(lSoftFg) },
    dark: { brand: fmt(dBrand), brandForeground: fmt(bestText(dBrand, DARK.ink)), soft: fmt(dSoft), softForeground: fmt(dSoftFg) },
  };
}

/** "#0E7490" → "192 82% 31%" (the token format our CSS variables use). */
export function hexToHslTriplet(hex: string | null | undefined): string | null {
  const rgb = parseHex(hex);
  return rgb ? fmt(rgbToHsl(rgb)) : null;
}

/**
 * CSS variables that re-skin the `brand` utilities (bg-brand, text-brand,
 * bg-brand-soft, ring-brand…) with a property's colour. Sets the light values
 * as --brand* and the dark ones as --brand-dark*; add BRAND_DARK_CLASS (or use
 * `brandScope`) on the same element so dark mode swaps them in.
 */
export function brandStyle(hex: string | null | undefined): React.CSSProperties | undefined {
  const p = brandPalette(hex);
  if (!p) return undefined;
  return {
    ['--brand' as string]: p.light.brand,
    ['--brand-foreground' as string]: p.light.brandForeground,
    ['--brand-soft' as string]: p.light.soft,
    ['--brand-soft-foreground' as string]: p.light.softForeground,
    ['--brand-dark' as string]: p.dark.brand,
    ['--brand-dark-foreground' as string]: p.dark.brandForeground,
    ['--brand-dark-soft' as string]: p.dark.soft,
    ['--brand-dark-soft-foreground' as string]: p.dark.softForeground,
  };
}

/**
 * In dark mode, swap in the --brand-dark* values set by brandStyle. The rules
 * are !important so they win over the inline light values. Only add it next
 * to a valid brandStyle (it points at variables only brandStyle defines).
 */
export const BRAND_DARK_CLASS =
  'dark:![--brand:var(--brand-dark)] dark:![--brand-foreground:var(--brand-dark-foreground)] dark:![--brand-soft:var(--brand-dark-soft)] dark:![--brand-soft-foreground:var(--brand-dark-soft-foreground)]';

/** `style` + `className` for a guest-page wrapper; empty when the colour is missing or invalid. */
export function brandScope(hex: string | null | undefined): { style?: React.CSSProperties; className: string } {
  const style = brandStyle(hex);
  return style ? { style, className: BRAND_DARK_CLASS } : { className: '' };
}
