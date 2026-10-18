// Colours and type for the reel. HotelOne's own tokens are copied from the app's
// src/app/globals.css (light :root and .dark) on the latest app branch; the
// night palette is the film's (red = Rita's world, teal = Gus's).

/** HotelOne light theme (guest pages, daytime console). */
export const LIGHT = {
  background: '#fbfaf8',
  foreground: '#111827',
  surface: '#ffffff',
  surfaceSunken: '#f6f4f1',
  card: '#ffffff',
  muted: '#f3f2ee',
  mutedForeground: '#575d6b',
  accent: '#efede8',
  border: '#e5e2dc',
  borderStrong: '#838995',
  ring: '#0a7199',
  primary: '#085f81', // Lagoon
  primaryHover: '#074d69',
  primaryForeground: '#ffffff',
  primarySoft: '#e9f7fb',
  primarySoftForeground: '#07516e',
  highlight: '#cc8e24', // Brass
  highlightSoft: '#fbf2e0',
  highlightSoftForeground: '#7b420a',
  success: '#15754a',
  successSoft: '#e8f7f0',
  successSoftForeground: '#0e623c',
  warning: '#f59f0a',
  warningSoft: '#fff5db',
  warningSoftForeground: '#834107',
  destructive: '#c52020',
  destructiveSoft: '#feecec',
  destructiveSoftForeground: '#a21a1a',
  info: '#1066c1',
  infoSoft: '#ebf5ff',
  infoSoftForeground: '#114d97',
  agent: '#673bce', // violet belongs to the AI agent only
  agentSoft: '#f4f0fe',
  agentSoftForeground: '#522da9',
  agentGradientFrom: '#6133cc',
  agentGradientTo: '#1c4cce',
  inverse: '#131a2a',
  inverseForeground: '#f8f6f2',
  overlay: '#080c16',
  shadow: '17, 24, 39', // rgb of --shadow for rgba()
} as const;

/** HotelOne dark theme (night console). */
export const DARK = {
  background: '#0c1017',
  foreground: '#f5f3f0',
  surface: '#131720',
  surfaceRaised: '#191e29',
  surfaceSunken: '#090b11',
  card: '#131720',
  popover: '#171c26',
  muted: '#1f232e',
  mutedForeground: '#a4aab7',
  accent: '#252a37',
  border: '#2b303b',
  borderStrong: '#6a7181',
  ring: '#49b9df',
  primary: '#30a7cf',
  primaryHover: '#51b5d6',
  primaryForeground: '#0c111d',
  primarySoft: '#132f39',
  primarySoftForeground: '#8ed7eb',
  highlight: '#e1ae47',
  highlightSoft: '#372b15',
  highlightSoftForeground: '#f4d07b',
  success: '#35b67a',
  successSoft: '#142e22',
  successSoftForeground: '#74dca8',
  warning: '#f4b02a',
  destructive: '#eb5c5c',
  destructiveSoft: '#3b1616',
  destructiveSoftForeground: '#fa9e9e',
  info: '#49acf3',
  agent: '#a184f5',
  agentSoft: '#251c40',
  agentSoftForeground: '#c3affd',
  agentGradientFrom: '#5b35b6',
  agentGradientTo: '#2048b6',
  inverse: '#07090d',
  inverseForeground: '#f5f3f0',
  overlay: '#030407',
  shadow: '2, 4, 8',
} as const;

/** The film's night palette. */
export const NIGHT = {
  ink: '#07090d',
  wall: '#0c1017',
  wallLow: '#151a22',
  ivory: '#f5f3f0',
  grey: '#a4aab7',
  brass: '#e1ae47',
  brassLight: '#f4d07b',
  red: '#eb5c5c', // Rita's world
  redSoft: '#fa9e9e',
  redDeep: '#3b1616',
  teal: '#30a7cf', // Gus's world
  tealBright: '#49b9df',
  tealSoft: '#8ed7eb',
  tealDeep: '#132f39',
  phoneGlow: '#ffffff',
  phoneBloom: '#c9f3ff',
  phoneGlowTeal: '#e0f7ff',
  tape: '#e9dcc0',
  paper: '#e9e3d6',
} as const;

export const FONT = {
  ui: "'Inter', ui-sans-serif, system-ui, sans-serif",
  display: "'Fraunces', ui-serif, Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  tight: "'Inter Tight', 'Inter', sans-serif",
  emoji: "'Noto Color Emoji'",
} as const;

/** Inter's stylistic sets used by the app's display copy. */
export const INTER_FEATURES = "'cv11', 'ss01', 'ss03'";

/** Instagram Reels UI zones (px in the 1080x1920 frame). Keep text out of them. */
export const SAFE = {top: 270, bottom: 380, right: 140, left: 60} as const;
/** Text column centre used by the board (the right UI rail pushes the optical centre left). */
export const COLUMN_X = 505;

/** Captions band (organic placement). */
export const CAPTION_BAND = {top: 1200, bottom: 1300, maxWidth: 800} as const;

/** Easing used for pops in the board: cubic-bezier(0.22, 1, 0.36, 1). */
export const EASE_POP = [0.22, 1, 0.36, 1] as const;
