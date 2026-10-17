import { LOGO_GEOMETRY } from './Logo';
import { BRAND_HEX } from './colors';

export { BRAND_HEX };

/** The mark as plain SVG with hex colours, for next/og (Satori) images. */
export function OgMark({
  size,
  square = false,
  tile = BRAND_HEX.primary,
  keyhole = BRAND_HEX.ivory,
  sill = BRAND_HEX.highlight,
}: {
  size: number;
  /** Full-bleed square (app icons get their corners from the OS). */
  square?: boolean;
  tile?: string;
  keyhole?: string;
  sill?: string;
}) {
  const g = LOGO_GEOMETRY;
  return (
    <svg width={size} height={size} viewBox={g.viewBox} xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx={square ? 0 : g.tileRadius} fill={tile} />
      <circle cx={g.bow.cx} cy={g.bow.cy} r={g.bow.r} fill={keyhole} />
      <path d={g.stem} fill={keyhole} />
      <path d={g.threshold} stroke={sill} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600; style: 'normal' };

async function loadGoogleFont(family: string, weight: 400 | 600, signal: AbortSignal): Promise<ArrayBuffer> {
  // Without a browser user agent, Google Fonts serves TrueType, which Satori can read.
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, { signal })).text();
  const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
  if (!url) throw new Error('font url not found');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`font ${res.status}`);
  return res.arrayBuffer();
}

/**
 * The brand faces for generated images: Inter (text) and Fraunces (display).
 * Returns [] if Google Fonts can't be reached, so the image still renders
 * in the built-in sans.
 */
export async function loadBrandFonts(): Promise<OgFont[]> {
  const signal = AbortSignal.timeout(5000);
  const faces = [
    ['Inter', 400],
    ['Inter', 600],
    ['Fraunces', 400],
    ['Fraunces', 600],
  ] as const;
  try {
    const data = await Promise.all(faces.map(([family, weight]) => loadGoogleFont(family, weight, signal)));
    return faces.map(([name, weight], i) => ({ name, weight, data: data[i], style: 'normal' as const }));
  } catch {
    return [];
  }
}
