// S26 end card geometry (frame px) and copy. Board: "Everything sits in a centre column, x 105–905."
import {CAPTION_BAND, COLUMN_X} from '../../theme.ts';

export const COL = {x: COLUMN_X, left: 105, right: 905, width: 800} as const;

/** Mark 64 px + 20 px gap + Wordmark 56 px, centred on the column, y 330–400. */
export const LOGO = {
  mark: 64,
  word: 56,
  gap: 20,
  /** Measured width of the 56 px Fraunces "HotelOne" (letter-spacing −0.025em). */
  wordWidth: 241,
  top: 333, // the 64 px tile, centred in y 330–400 (the 70 px row)
} as const;
export const LOGO_W = LOGO.mark + LOGO.gap + LOGO.wordWidth;
/** Top-left of the LogoMark (the 32-grid origin), for KeyholeIris. */
export const MARK_ORIGIN = {x: Math.round(COL.x - LOGO_W / 2), y: LOGO.top} as const;

export const HEADLINE = {
  lines: ['If nobody picks up', 'in 20 seconds, it does.'],
  size: 68,
  leading: 1.08,
  top: 456, // two 73.4 px lines centred in y 450–610
} as const;

/** Beat B (from 57.0), under the headline. */
export const BEAT_B = {
  line: {text: 'Keep your number. Free to start.', size: 40, top: 680, height: 50},
  button: {label: 'Start free', top: 790, height: 100, radius: 18, padX: 48, size: 40},
  url: {text: 'hotelone.site', size: 60, top: 930, height: 70},
} as const;

export const FINE_PRINT = {
  lines: [
    'Fictional story. Voice in English. Phone bookings are requests:',
    'your team confirms and sends a link; the guest books online.',
    '20-second forwarding is a mobile carrier code; landlines vary.',
    'The assistant’s own number and call minutes cost extra.',
  ],
  size: 24,
  leading: 1.3,
  /** Organic y 1350–1475. Paid: "the fine print moves up into y 1100–1225". */
  top: {organic: 1350, paid: 1100},
} as const;

/** Caption band per placement (Captions.tsx draws the AI line there; the orb sits to its left). */
export const bandTop = (placement: 'organic' | 'paid') => (placement === 'paid' ? 1000 : CAPTION_BAND.top);
/** 56 px orb; the gap leaves room for its fill to swell 1.3× with the voice. */
export const ORB = {size: 56, gap: 22} as const;
