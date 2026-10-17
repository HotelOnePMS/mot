/**
 * Brand colours as hex, for places that can't read CSS variables
 * (generated images, the web manifest, the browser theme colour).
 * Converted from the light/dark tokens in app/globals.css — keep in sync.
 */
export const BRAND_HEX = {
  background: '#fbfaf8', // --background (light)
  backgroundDark: '#0c1017', // --background (dark)
  foreground: '#111827', // --foreground (light)
  muted: '#575d6b', // --muted-foreground (light)
  primary: '#085f81', // --primary (light) — Lagoon
  primaryHover: '#074d69', // --primary-hover (light)
  primarySoft: '#e9f7fb', // --primary-soft (light)
  highlight: '#cc8e24', // --highlight (light) — Brass
  highlightSoft: '#fbf2e0', // --highlight-soft (light)
  inverse: '#131a2a', // --inverse (light)
  ivory: '#ffffff', // --primary-foreground (light)
} as const;
