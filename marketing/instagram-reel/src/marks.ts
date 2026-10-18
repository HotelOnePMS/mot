// The event clock: every timed beat that the picture and the soundtrack must
// agree on, taken from each shot's Motion, Sound and Music fields in
// STORYBOARD.md. Scenes import it to animate; scripts/make-audio.ts imports it
// to place sounds. All times are ABSOLUTE seconds on the film clock (0–62.5).
// Pictures snap to f(t) = round(t × 30); audio plays at t sample-exact, so a
// sound always starts inside the frame its picture lands on.
//
// Anything tied to speech is derived from the measured voice (timeline.ts:
// cue(), wordAt()), never from the board's literal numbers, because some lines
// moved after measuring. A derived mark that would leave its shot is clamped
// with within() and the comment says so. checkMarks() reports any mark outside
// its shot; it runs once at load and only warns.
//
// Plain JS plus erasable types (no enums, namespaces or `!`), with explicit
// .ts imports, so this loads in the Remotion bundle and directly in Node 22.
import {DURATION, FPS, SCENES, cue, f, s, scene, shot, wordAt} from './timeline.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A window in absolute seconds. */
export type Span = {readonly start: number; readonly end: number};
/** A visual beat that lasts a number of frames from its start (glints, dips, pops). */
export type Hit = {readonly t: number; readonly frames: number};
/** A jump-cut counter step: from `t` the counter shows `label` (no tween; 2-frame pop 1.08→1). */
export type Step = {readonly t: number; readonly label: string};
/** A pen stroke: draw `text` over [t, t + dur]. A pen-scratch sound plays over the same window. */
export type Stroke = {readonly t: number; readonly dur: number; readonly text: string};
/** A one-off sound effect. `end` is set for sounds with a length the picture depends on. */
export type Sfx = {readonly id: string; readonly shot: string; readonly t: number; readonly end?: number; readonly note?: string};

// ─── Internal helpers ───────────────────────────────────────────────────────

/** 120 BPM grid: beat 0.5 s, 8th 0.25 s, 16th 0.125 s. */
const SIXTEENTH = 0.125;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const must = (x: number | null, what: string): number => {
  if (x === null) throw new Error(`marks: ${what} is missing`);
  return x;
};
/** Clamp a derived time so [t, t + dur] stays inside its shot. */
const within = (shotId: string, t: number, dur = 0) => {
  const sh = shot(shotId);
  return r3(Math.min(Math.max(t, sh.start), sh.end - dur));
};
/** Snap to the nearest 16th of the 120 BPM grid. */
const to16th = (t: number) => Math.round(t / SIXTEENTH) * SIXTEENTH;
/** Evenly spaced times in [start, end), computed by index so floats don't drift. */
const grid = (start: number, end: number, step: number): number[] =>
  Array.from({length: Math.round((end - start) / step)}, (_, i) => r3(start + i * step));
const span = (start: number, end: number): Span => ({start: r3(start), end: r3(end)});

// ─── Shared event families ──────────────────────────────────────────────────

/**
 * Rita's ringtone, the old desk-bell trill (1.1 + 1.62 kHz, 20 Hz AM). ONE
 * generated buffer reused everywhere. When it rings it rings every 1.5 s, and
 * the cadence crosses the loop seam: 61.0 + 1.5 = 62.5 = frame 0's attack.
 * mix: 'full' = full level; 'ducked' = −9 dB plus a −6 dB high shelf above
 * 1 kHz under R01; 'glass' = through Gus's glass (LP 1.2 kHz, −14 dB, a further
 * −6 dB under G02). rattle: a 120 Hz cradle rattle sits under it.
 */
export const TRILL_CUES = [
  {t: 0, shot: 'S01', mix: 'full', rattle: true},
  {t: 1.5, shot: 'S01', mix: 'ducked', rattle: true},
  {t: 38.5, shot: 'S18', mix: 'full', rattle: true}, // the same sample as frame 0, unchanged
  {t: 40.0, shot: 'S18', mix: 'full', rattle: true}, // 0:20, the heartbeat skips under it
  {t: 41.5, shot: 'S19', mix: 'full', rattle: true}, // the last one, on the "Rita's lobby." slam
  {t: 61.0, shot: 'S27', mix: 'glass', rattle: false}, // across the highway, seen from Gus's side
] as const;
/** Trill onsets in seconds. */
export const TRILLS: readonly number[] = TRILL_CUES.map((x) => x.t);
/** Length of one trill. The phone buzz/bloom and the cradle rattle last this long. */
export const TRILL_LEN = 0.6;
/** Windows when Rita's FRONT DESK phone buzzes (±3 px at 30 Hz, bloom +15%) with its trill. S27: its glow pulses. */
export const PHONE_BUZZ: readonly Span[] = TRILLS.map((t) => span(t, t + TRILL_LEN));
/** The trill's reverse-reverb pre-echo swelling into the S18 smash cut (non-diegetic: her phone isn't ringing yet). */
export const TRILL_PRE_ECHO = span(37.9, 38.5);
/** The loop seam: the cut at 62.5 is the loop; the next trill (61.0 + 1.5) is frame 0's full-level attack. */
export const LOOP_SEAM = DURATION;

/**
 * Gus's ringtone: the motif's first two notes (D5 then A4) on a soft FM chime,
 * heard through his office glass (glass(): LP 1.2 kHz plus a 40 ms slap, −12 dB).
 * S02 speeds up with the counter; S07 is the far end of Rita's call.
 */
export const GUS_CHIMES = [3.0, 4.0, 4.5, 4.875, 12.5, 13.5, 14.5] as const;
/** S02: at 0:20 Gus's phone dies mid-chime. The 4.875 chime is cut here, 125 ms in, between D5 and A4 (A4 must start later than +0.125 s). No tail. */
export const GUS_CHIME_CUT = 5.0;

// Counters (jump cuts, no tween). The 0:20 step is always silent: no heartbeat, no tick.

/** S02, the counter's hero shot. At 5.00 it holds 0:20 and turns teal; the phone screen snaps black in 1 frame. */
export const S02_COUNTER: readonly Step[] = [
  {t: 3.0, label: '0:01'},
  {t: 3.5, label: '0:06'},
  {t: 4.0, label: '0:11'},
  {t: 4.25, label: '0:14'},
  {t: 4.5, label: '0:16'},
  {t: 4.75, label: '0:18'},
  {t: 4.875, label: '0:19'},
  {t: 5.0, label: '0:20'},
];
/** S07, on the split-screen seam. Starts at 0:04: the audience already knows the count. */
export const S07_COUNTER: readonly Step[] = [
  {t: 12.5, label: '0:04'},
  {t: 13.0, label: '0:07'},
  {t: 13.5, label: '0:10'},
  {t: 14.0, label: '0:13'},
  {t: 14.5, label: '0:16'},
  {t: 14.75, label: '0:17'},
  {t: 15.0, label: '0:18'},
  {t: 15.25, label: '0:19'},
  {t: 15.375, label: '0:20'},
];
/** S18, the red counter under Rita's phone. 40.0 = 0:20: one white flash, then nothing. */
export const S18_COUNTER: readonly Step[] = [
  {t: 39.0, label: '0:18'},
  {t: 39.5, label: '0:19'},
  {t: 40.0, label: '0:20'},
  {t: 40.25, label: '0:21'},
];
/** S19, the same counter running on, then frozen into MISSED CALL at 42.1 (the phone glow dies then too). */
export const S19_COUNTER: readonly Step[] = [
  {t: 40.5, label: '0:24'},
  {t: 41.0, label: '0:29'},
  {t: 41.5, label: '0:34'},
  {t: 42.0, label: '0:41'},
  {t: 42.1, label: 'MISSED CALL'},
];
/** The Twist scene (S18 + S19) shows one continuous counter. */
export const TWIST_COUNTER: readonly Step[] = [...S18_COUNTER, ...S19_COUNTER];
/** S27, Gus's binocular POV. Freezes on 0:19: the last frame (1874) holds it and the loop cuts to frame 0. */
export const S27_COUNTER: readonly Step[] = [
  {t: 60.0, label: '0:17'},
  {t: 60.75, label: '0:18'},
  {t: 61.5, label: '0:19'},
];
/** Every counter step pops 1.08→1 over this many frames. */
export const COUNTER_POP_FRAMES = 2;

/** S02 heartbeat: one beat on every counter jump, stopping at 5.00 (0:20), which leaves only cicadas. */
const S02_HEARTBEAT = S02_COUNTER.filter((x) => x.t < GUS_CHIME_CUT).map((x) => x.t);
/** S07 heartbeat accelerating on the grid: quarters 12.5–13.5, 8ths 13.5–15.0, 16ths 15.0–15.375. Silent from the 0:20 snap. Lands on every counter jump except 0:20. */
const S07_HEARTBEAT = [...grid(12.5, 13.5, 0.5), ...grid(13.5, 15.0, 0.25), ...grid(15.0, 15.375, SIXTEENTH)];
/** S18: on each counter tick (39.0, 39.5), SKIPS at 40.0, resumes at 40.25. */
const S18_HEARTBEAT = [39.0, 39.5, 40.25];
/**
 * S19 (inferred): the board says the heartbeat "resumes at 40.25" and the
 * counter keeps running, so it keeps landing on the S19 jumps until the 42.1
 * MISSED CALL freeze. The S19 Sound field doesn't list it; drop these if unwanted.
 */
const S19_HEARTBEAT = [40.5, 41.0, 41.5, 42.0];
/** Every heartbeat (55 Hz + 110–120 Hz layer + 2–4 kHz beater tick). */
export const HEARTBEAT: readonly number[] = [...S02_HEARTBEAT, ...S07_HEARTBEAT, ...S18_HEARTBEAT, ...S19_HEARTBEAT];
/** S18 0:20: silence where an answer should have been (only the trill plays). */
export const HEARTBEAT_SKIP = 40.0;

/** Dry clock ticks: every S02 counter jump before 0:20, and every S27 jump. */
export const CLOCK_TICKS: readonly number[] = [...S02_HEARTBEAT, ...S27_COUNTER.map((x) => x.t)];

/** S07: one US ringback burst (440+480 Hz, phone band) in Rita's ear, ducked −6 dB under her VO. */
export const RINGBACK = span(12.6, 14.6);
/** S07: the dry line-pickup CLICK. The shot hard-cuts at 15.5 on it (f(15.48) = 464, the shot's last frame). */
export const PICKUP_CLICK = 15.48;
/** S16: Rita taps End mid-reply. AI04 is hard-cut here, 135 ms into "they’ll"; end-call CLICK, the phone band cuts, the ostinato stops dead. */
export const HANGUP = r3(must(cue('AI04').cut, "cue('AI04').cut"));
/** S16: the tossed phone thuds onto the passenger seat (with a seat squeak), 75 ms after the click as on the board. */
export const PHONE_THUD = r3(HANGUP + 0.075);
/** S06: the thumb taps call (tap ripple, 2-frame screen flip to “Calling…”). */
export const CALL_TAP = 12.0;
/** S06: call-start blip, 880 Hz sine, 60 ms. */
export const CALL_BLIP = 12.05;
/** S24: Gus taps “Mark done” (press to .98, tap + check tick). */
export const MARK_DONE_TAP = 51.05;
/** S25: Gus taps “Copy booking link” (press to .98, tap + soft bell). The held Asus4 resolves to Dadd9 here: nothing resolves until a person acts. */
export const COPY_TAP = 52.5;
/** S25: the sonner toast slides down and pops. */
export const TOAST_POP = 52.55;
/** S23: Gus’s mug clinks the window glass, bridging the cut into S24. */
export const MUG_CLINK = 51.0;

/** Lens/glass glints (visual; no sound on the board). */
export const GLINTS = [
  {shot: 'S01', t: r3(54 / FPS), frames: 2, what: "white cross glint off the sedan's windshield across the road (Rita's binocular lens)"},
  // "On 'How can I help?'": measured "How" is wordAt('AI01','How') ≈ 18.43, which would run the
  // 6-frame glint 4 frames past the 18.5 cut, so it is clamped to end on the cut (≈ 18.30).
  {shot: 'S09', t: within('S09', wordAt('AI01', 'How'), 6 / FPS), frames: 6, what: 'glint sweeps across the left lens of her reading glasses'},
  // The board gives no time for S13's glasses glint; it is put on "cash?", the trap.
  {shot: 'S13', t: within('S13', wordAt('R10', 'cash'), 6 / FPS), frames: 6, what: 'glasses glint as she springs the trap'},
  {shot: 'S19', t: 41.4, frames: 6, what: "the binocular glint again under the Starlite sign, now held (the ivory ring draws 41.4–41.8)"},
] as const;

/** Neon flicker dips (visual). The 60 Hz neon hum can dip with them. */
export const NEON_DIPS = [
  {shot: 'S01', t: r3(22 / FPS), frames: 3, sign: 'starlite', what: 'window neon dips once, 60%→100% (f22–f24)'},
  {shot: 'S05', t: 9.7, frames: 3, sign: 'rita', what: "Rita's sign: one 3-frame flicker dip"},
  {shot: 'S05', t: 10.4, frames: 3, sign: 'starlite', what: "the Starlite's sign: one 3-frame flicker dip"},
  {shot: 'S21', t: 47.0, frames: 3, sign: 'starlite', what: 'the Starlite sign stutters OFF for good (neon tick-off SFX)'},
] as const;

/**
 * Mute windows. At `start` every listed sound is hard-stopped (with `fade`);
 * the score stays silent until `end`. VO, ambience and later one-off SFX still play.
 */
export const MUTES = [
  {
    id: 'pickup',
    start: 15.5,
    end: 20.25,
    fade: 1 / FPS,
    cuts: 'everything still sounding at 15.5: Shepard riser, heartbeat, chime tails, ringback, truck',
    keeps: 'VO, cicadas and glass hum, the E6 sine (MUSIC.e6), the 17.9 strap creak and the 19.6 car pass',
  },
  {
    id: 'hangup',
    start: HANGUP,
    end: 37.0,
    fade: 0,
    cuts: 'the ostinato (stops dead) and the phone band (AI04 is hard-cut)',
    keeps: 'cicadas, the hang-up click, the phone thud and seat squeak, R13 "Show-off."',
  },
] as const;

/** S26: bandSweep() opens the AI voice from the phone band to full range (HP 320→40 Hz, LP 3.3→16 kHz), landing on "I will". Board: 56.4–57.0; derived from the measured "I" (≈ 57.21), keeping its 0.6 s length. */
const I_WILL = r3(wordAt('AI05', 'I'));
export const BAND_SWEEP = span(I_WILL - 0.6, I_WILL);
/** S26→S27: the LogoMark keyhole scales 1→40× as an iris mask. The iris cuts the music at its start. */
export const IRIS = span(59.75, 60.0);

// ─── Shot by shot ───────────────────────────────────────────────────────────
// Every value is an absolute second inside its shot (span ends may run on
// inside the same scene). Keys named frames/dur/hz are lengths, not times.

/** S01 ColdOpen 0.0–3.0. Frame 0 is clean and settled. Headline word-lighting: use cue('R01').words (R01 carries ~0.35 s over the cut). */
export const S01 = {
  trills: [0, 1.5],
  buzz: PHONE_BUZZ.slice(0, 2), // ±3 px 30 Hz phone buzz + bloom +15% + cradle rattle
  push: span(0, 3.0), // 100→106% on the phone screen, ease in-out
  question: {t: 1.25, frames: 4}, // "So who picks up at 0:20?" pops 0.92→1
  neonDip: {t: NEON_DIPS[0].t, frames: 3},
  glint: {t: GLINTS[0].t, frames: 2},
} as const;

/** S02 Binoculars 3.0–5.5. */
export const S02 = {
  counter: S02_COUNTER,
  chimes: [3.0, 4.0, 4.5, 4.875],
  chimeCut: GUS_CHIME_CUT,
  heartbeat: S02_HEARTBEAT, // + a dry clock tick on the same times
  stop: 5.0, // 0:20: phone screen snaps black (1 frame), counter turns teal, heartbeat and ticks stop
  thenItStops: {t: 5.1, frames: 12}, // "Then it stops." rises from a mask
} as const;

/** S03 Binoculars 5.5–7.0. */
export const S03 = {
  push: span(5.5, 7.0), // 100→104% linear
  thenItStopsOut: 6.0, // "Then it stops." fades out
  carPass: 6.0, // SFX only: one distant car, pan L→R, −30 dB
  pizz: 6.5, // music: one KS pizz D2 (−24 dB)
  zoomOut: span(6.6, 7.0), // image inside the circles 1→0.9, continues as S04's dolly
} as const;

/** S04 Stakeout 7.0–9.0. */
export const S04 = {
  dolly: span(7.0, 7.8), // 180%→100% out through the lenses, ease-out
  seatCreak: 7.1,
  pen: [{t: 8.1, dur: 0.6, text: '20s (circled)'}], // fifth tally stroke-draws; pen scribble over the same window
  cymbalSwell: span(8.4, 9.0), // music: reversed-cymbal swell into the S05 boom
} as const;

/** S05 Geography 9.0–11.0. Rita's missed-call window pulses at 1 Hz all shot: use missedPulse(). */
export const S05 = {
  boom: 9.0, // low D boom on 73/110/147 Hz, 1.2 s; the neon hum swells
  crane: span(9.0, 10.1), // scale 1.25→1, y +180→0, ease [0.22,1,0.36,1]
  title: span(9.05, 9.4), // "Across the Street" rises with the move
  bar: span(9.5, 10.0), // brass threshold bar draws left→right
  ritaDip: {t: NEON_DIPS[1].t, frames: 3},
  starliteDip: {t: NEON_DIPS[2].t, frames: 3},
  motif: [9.0, 9.5, 10.0, 10.5], // music: first full motif on celesta D5 A4 F5 E5 (held)
} as const;

/** S06 TheCall 11.0–12.5. Note: measured R06 runs to ≈ 12.16, so the 12.0 tap lands on "I." (on purpose: tap on the punch). */
export const S06 = {
  hover: span(11.0, 12.0), // 2% push, thumb hovers over the call button
  tap: CALL_TAP, // tap ripple (40 px soft white circle) + 2-frame screen flip to "Calling… 00:00"
  blip: CALL_BLIP,
  whip: span(12.25, 12.5), // phone whips up toward her ear (motion blur); cloth rustle at the start
  strapClink: 12.3, // the board gives no time; inferred to ride the whip-up
} as const;

/** S07 TheCall 12.5–15.5. Split screen: Gus's ringing phone on top, Rita on the call below. */
export const S07 = {
  counter: S07_COUNTER,
  chimes: [12.5, 13.5, 14.5], // across the lot, through glass
  ringback: RINGBACK, // in her ear
  heartbeat: S07_HEARTBEAT,
  truck: {t: 13.0, frames: 6}, // headlight bar sweeps R→L across both halves; 6-frame ±6 px shake
  truckDoppler: span(12.8, 13.5), // SFX: pitch-dropping whoosh, pan R→L
  knuckles: 14.5, // her knuckles tighten (highlight)
  screenOff: 15.375, // 0:20: Gus's screen snaps dark (top half)
  flinch: {t: r3(s(f(PICKUP_CLICK) - 1)), frames: 2}, // 4 px jolt over the two frames ending on the click frame
  click: PICKUP_CLICK,
  riser: span(12.5, PICKUP_CLICK), // music: Shepard riser
  hardMute: 15.5, // MUTES[0]
} as const;

/** S08 WhoAnswers 15.5–17.5. Nothing moves but dust. The E6 "ringing ears" sine is MUSIC.e6. */
export const S08 = {
  push: span(15.5, 17.5), // 100→110% linear, drift 1 px
  nobodyTouched: {t: 16.0, frames: 12}, // "Nobody touched the phone." rises from a mask
} as const;

/** S09 WhoAnswers 17.5–18.5. */
export const S09 = {
  drift: span(17.5, 18.5), // reflection drifts 12 px L→R; 2% push
  strapCreak: 17.9, // small leather creak from the binocular strap
  glint: {t: GLINTS[1].t, frames: 6}, // clamped (see GLINTS)
} as const;

/** S10 WhoAnswers 18.5–20.5. The A3 pizz pickup (MUSIC.pickup, 20.25) now sits under the end of R08's "Gus.". */
export const S10 = {
  eyebrow: {t: 18.7, frames: 6},
  narrow: 19.1,
  lightSweep: {t: 19.6, frames: 10}, // passing car light L→R across the cabin, 15% white
  carPass: 19.6, // SFX: distant car pass, −32 dB
} as const;

// S11/S12 handwriting, derived from the measured AI02 ("Friday the twenty-third,
// a queen room is a hundred nineteen.").
// "Fri 23" starts on "Friday" (≈ 23.40). The board's 0.7 s write would run to
// ≈ 24.10, past the 24.0 cut (S12 already shows it written), so it is clamped
// to end at the board's 23.95.
const FRI_START = within('S11', wordAt('AI02', 'Friday'), 0.4);
const FRI_END = r3(Math.min(FRI_START + 0.7, 23.95));
const FRI_SPLIT = r3(FRI_START + (FRI_END - FRI_START) * 0.55);
// "$119?!" stroke-draws on 16ths: "$" one 16th before "hundred", then "1" on
// "hundred" (≈ 25.77), "1", "9", "?!". Then a double underline (two 16ths), then
// the margin arrow and "(I’m $129)", held so they end by 26.9 (3 frames before the cut).
const PRICE_START = r3(to16th(wordAt('AI02', 'hundred')) - SIXTEENTH);
const PRICE_STROKES: Stroke[] = ['$', '1', '1', '9', '?!'].map((text, i) => ({t: r3(PRICE_START + i * SIXTEENTH), dur: SIXTEENTH, text}));
const UNDERLINE_START = r3(PRICE_START + 5 * SIXTEENTH);
const MARGIN_START = within('S12', r3(UNDERLINE_START + 2 * SIXTEENTH), 0.5);

/** S11 Interrogation 20.5–24.0. The heist ostinato enters on the 20.5 downbeat (MUSIC.ostinato). */
export const S11 = {
  push: span(20.5, 24.0), // 3% push across the shot
  penClick: 20.6, // lands in the gap between R08 (ends ≈ 20.56) and R09 ("Got" ≈ 20.68)
  headlight: 22.0, // a headlight reflection slides across the dash
  brows: r3(wordAt('AI02', 'We')), // on "We do.": brows lift 4 px
  pen: [
    {t: FRI_START, dur: r3(FRI_SPLIT - FRI_START), text: 'Fri'},
    {t: FRI_SPLIT, dur: r3(FRI_END - FRI_SPLIT), text: '23'},
  ], // pen scratch over the same windows
} as const;

/** S12 Interrogation 24.0–27.0. Top-down steno pad. Pen scratch synced to each stroke. R10 J-cuts in at cue('R10').at. */
export const S12 = {
  push: span(24.0, 27.0), // 2% push
  price: PRICE_STROKES, // "$119?!"
  underline: [
    {t: UNDERLINE_START, dur: SIXTEENTH, text: 'underline 1'},
    {t: r3(UNDERLINE_START + SIXTEENTH), dur: SIXTEENTH, text: 'underline 2'},
  ],
  margin: [
    {t: MARGIN_START, dur: 0.1, text: 'arrow'},
    {t: r3(MARGIN_START + 0.1), dur: 0.3, text: '(I’m $129)'},
  ],
  thin: 26.5, // music: the ostinato thins to bass + tick
} as const;

/** S13 Interrogation 27.0–28.5. */
export const S13 = {
  push: span(27.0, 28.5), // slow 3% push
  glint: {t: GLINTS[2].t, frames: 6}, // on "cash?" (board gives no time)
  dive: 28.35, // camera starts diving toward the phone's speaker grille (radial blur) into S14
} as const;

/** S14 ConsoleDive 28.5–31.5. */
export const S14 = {
  dive: span(28.5, 28.9), // scale 1→6 into the grille; particle whoosh peaks at the end (the resolve)
  converge: span(28.9, 29.2), // particles converge, card fades up y +20→0
  uiTick: 29.2, // soft UI tick as the field lights (the board places it with the card; inferred at the end of the converge)
  headline: 29.25, // "Gus typed it once." rises
  // "30.0, on the measured onset of 'day-use'": wordAt('AI03','day-use') ≈ 30.22. Highlighter swipe SFX at t.
  highlight: {t: r3(wordAt('AI03', 'day-use')), frames: 10},
  rateCell: {start: 30.3, dock: 30.5}, // springs in from the right (bounce .18) and must first reach its dock at `dock`, where the spring "tock" plays (on the beat and the 30.5 celesta note)
  subLine: 30.5, // "His prices. His rules." rises
  whip: span(31.3, 31.5), // whip-pan right with motion blur; whoosh, its tail runs into S15
} as const;

/** S15 RitaSaysHi 31.5–33.0. */
export const S15 = {
  blurResolve: {t: 31.5, frames: 4},
  lower: span(31.6, 32.3), // binoculars lower 120 px, ease-out
  strapCreak: 31.6, // the board gives no time; inferred at the start of the lowering
} as const;

/** S16 RitaSaysHi 33.0–37.0. */
export const S16 = {
  headTilt: span(33.2, 33.6),
  hangup: HANGUP, // taps End; click; phone band and ostinato cut
  toss: {start: HANGUP, land: PHONE_THUD, end: 36.15}, // quick arc onto the passenger seat, one 6 px bounce
  thud: PHONE_THUD,
  turn: 36.15, // she turns her head toward the phone, just before "Show-off." (≈ 36.28)
} as const;

/** S17 Mirror 37.0–38.5. Use missedPulse() for the white glow in the mirror (peaks at 37.5 and 38.5). */
export const S17 = {
  push: span(37.0, 38.5), // 100→240% into the rearview mirror, ease in-out
  text: 37.1, // "Rita missed one thing." rises
  sip: 37.1, // thermos sip + lid clink
  glowPeaks: [37.5, 38.5],
  preEcho: TRILL_PRE_ECHO,
} as const;

/** S18 Twist 38.5–40.5. Its first frame pixel-matches frame 0. */
export const S18 = {
  trills: [38.5, 40.0],
  buzz: PHONE_BUZZ.slice(2, 4), // the 40.0 buzz runs into S19 (same scene, continuous)
  question: {t: 38.75, frames: 4}, // the hook question pops exactly as in S01
  dim: 39.0, // eyebrow + headline dim to 25%; the red counter appears
  counter: S18_COUNTER,
  flash: 40.0, // one white flash on the counter at 0:20
  nobody: {t: 40.0, frames: 6}, // "Nobody." slams 1.2→1
  heartbeat: S18_HEARTBEAT,
  heartbeatSkip: HEARTBEAT_SKIP,
  pullBack: 40.4, // first camera move; carries into S19
} as const;

/** S19 Twist 40.5–42.5. */
export const S19 = {
  move: span(40.5, 41.3), // pull-back and pan right, scale 1.06→0.92, x +260 px, ease in-out
  textOut: span(40.6, 40.9), // the question and "Nobody." fade out
  glint: {t: GLINTS[3].t, frames: 6},
  ring: span(41.4, 41.8), // hand-drawn ivory ring circles the sedan
  slam: {t: 41.5, frames: 6}, // "Rita's lobby." slams 1.2→1 with a 1-frame white flash
  trill: 41.5,
  buzz: PHONE_BUZZ.slice(4, 5),
  counter: S19_COUNTER,
  heartbeat: S19_HEARTBEAT, // inferred, see S19_HEARTBEAT
  missed: 42.1, // counter freezes → "MISSED CALL"; the phone glow dies
  beep: [
    {t: 42.1, dur: 0.09, hz: 1800},
    {t: 42.19, dur: 0.09, hz: 1400},
    {t: 42.28, dur: 0.09, hz: 950},
  ], // three-tone descending call-ended beep
  deadAir: span(42.37, 42.5), // the board's "0.4 s of dead air" counted from 42.1, ending on the cut
} as const;

/** S20 TheKnot 42.5–46.5. Detective board. The drone returns under it (MUSIC.drone). */
export const S20 = {
  push: span(42.5, 46.5), // 100→106%
  panels: {t: 42.5, frames: 8}, // top slides from above, bottom from below; panel whooshes
  circleLock: 43.0, // red marker circle around "(928) 555-0147" on the lock screen; marker squeak
  circleRow: 43.25, // around "+1 (928) 555-0147" in Sam's row; marker squeak
  string: span(43.5, 44.0), // red string draws circle to circle; "zip"
  pins: [43.5, 44.0], // a pin pops at each end; a tick per pin
  headline: 44.0, // "Her 2:13 caller / tried Gus next." rises; soft sub thump
  line2: 44.75, // "She watched it ring." rises
  circleTotal: 45.4, // marker circles "Quoted total: $238.00"; marker squeak (the circle closes on the 45.5 pop)
  pop: {t: 45.5, frames: 8}, // "$238.00" pops 0.6→1.08→1; sub impact + saw stab (Dm♭9)
} as const;

/** S21 Morning 46.5–48.0. Dawn time-lapse. */
export const S21 = {
  grade: span(46.5, 47.5), // sky and grade sweep night→light, upward from the bottom
  label: 46.7, // "6:52 AM" fades in, pill crossfades ink→ivory
  signOff: {t: NEON_DIPS[3].t, frames: 3}, // the Starlite sign stutters off; neon tick-off
  roofCreak: 47.4, // the board gives no time for the faint car-roof creak; inferred
} as const;

/** S22 Morning 48.0–50.0. */
export const S22 = {
  push: span(48.0, 48.5), // wide → into Gus's phone, scale 1→3.4; push whoosh
  sip: 48.05, // coffee sip
  focusRing: 48.7, // focus ring fades in on Rita's row
  snort: 49.1, // Gus snorts off-screen (breath SFX)
} as const;

/** S23 Morning 50.0–51.0. */
export const S23 = {
  mug: span(50.05, 50.4), // the mug rises toward the window, ease-out
  clink: MUG_CLINK, // on the cut
} as const;

/** S24 Morning 51.0–51.5. */
export const S24 = {
  tap: MARK_DONE_TAP,
  slide: span(51.1, 51.35), // Rita's row slides x −120 px and fades; soft swish
  segment: 51.3, // "To handle · 1 | Done · 1" (layoutId spring, bounce .18)
  close: span(51.35, 51.5), // the list closes up with a spring
} as const;

/** S25 Morning 51.5–54.5. */
export const S25 = {
  text1: 51.5, // "2:14 AM caller. Total already quoted." rises
  marker: span(51.75, 52.15), // brass marker sweep across "Quoted total: $238.00"; marker swipe SFX at the start
  copyTap: COPY_TAP,
  toast: TOAST_POP,
  text2: 52.75, // "Not booked yet: …" rises, holds to the end
  out: span(54.25, 54.5), // phone scales to 92% and crossfades into the ivory end card
} as const;

/** S26 EndCard 54.5–60.0. Fine print stays from 54.9 to the iris. */
export const S26 = {
  bell: 54.5, // soft bell on the logo
  logo: 54.5,
  bar: {t: 54.55, frames: 8}, // the logo's brass threshold bar draws
  headline: 54.7,
  orb: 54.8, // VoiceOrb + AI caption fade up
  finePrint: 54.9,
  bandSweep: BAND_SWEEP,
  iWill: I_WILL, // the orb pings here; the cadence lands here (MUSIC.cadence.dadd9)
  // Board: the orb fades out at 57.6, 0.17 s after its planned AI05 end (57.43). AI05 now ends
  // later (≈ 57.78), so the same 0.17 s is kept after the measured end.
  orbOut: r3(cue('AI05').end + 0.17),
  beatB: [57.0, 57.1, 57.2], // "Keep your number…", button, URL (3-frame stagger). Board time: now 0.21 s before the measured "I".
  iris: IRIS,
} as const;

/** S27 Stinger 60.0–62.5. No fade-out: the cut at 62.5 is the loop. */
export const S27 = {
  counter: S27_COUNTER,
  ticks: S27_COUNTER.map((x) => x.t),
  label: span(60.05, 60.4), // "Next night · 2:13 AM" types on (16ths)
  trill: 61.0, // muffled through glass; the phone glow pulses with it
  buzz: PHONE_BUZZ.slice(5, 6),
  // Board: cicadas only from 62.1, just after G02 (planned to end 62.09). G02 now ends ≈ 62.2.
  cicadasOnly: r3(Math.max(62.1, cue('G02').end)),
  fadeOut: span(62.46, LOOP_SEAM), // the last 40 ms fade to nothing; the cicada tail absorbs the IG loop gap
  loop: LOOP_SEAM,
} as const;

/** Every shot's marks, by shot id. */
export const MARKS = {S01, S02, S03, S04, S05, S06, S07, S08, S09, S10, S11, S12, S13, S14, S15, S16, S17, S18, S19, S20, S21, S22, S23, S24, S25, S26, S27} as const;

// ─── Sound effects (flat list for scripts/make-audio.ts) ────────────────────
// One-offs only. Trills (TRILL_CUES), Gus's chimes (GUS_CHIMES), heartbeats
// (HEARTBEAT), clock ticks (CLOCK_TICKS), the ringback (RINGBACK) and the
// call-ended beep (S19.beep) are their own families above.

const scratches = (shotId: string, strokes: readonly Stroke[]): Sfx[] =>
  strokes.map((x) => ({id: 'penScratch', shot: shotId, t: x.t, end: r3(x.t + x.dur), note: x.text}));

export const SFX: readonly Sfx[] = [
  {id: 'carPass', shot: 'S03', t: S03.carPass, note: 'distant, pan L→R, −30 dB'},
  {id: 'seatCreak', shot: 'S04', t: S04.seatCreak},
  {id: 'penScribble', shot: 'S04', t: S04.pen[0].t, end: r3(S04.pen[0].t + S04.pen[0].dur)},
  {id: 'boom', shot: 'S05', t: S05.boom, note: 'low D on 73/110/147 Hz, 1.2 s; the neon hum swells'},
  {id: 'tap', shot: 'S06', t: S06.tap},
  {id: 'callBlip', shot: 'S06', t: S06.blip, end: r3(S06.blip + 0.06), note: '880 Hz sine'},
  {id: 'clothRustle', shot: 'S06', t: S06.whip.start},
  {id: 'strapClink', shot: 'S06', t: S06.strapClink, note: 'binocular strap (time inferred)'},
  {id: 'truckDoppler', shot: 'S07', t: S07.truckDoppler.start, end: S07.truckDoppler.end, note: 'pitch-dropping noise, pan R→L; passes the camera at 13.0'},
  {id: 'pickupClick', shot: 'S07', t: PICKUP_CLICK, note: 'dry; then MUTES[0] at 15.5'},
  {id: 'strapCreak', shot: 'S09', t: S09.strapCreak, note: 'small leather creak'},
  {id: 'carPass', shot: 'S10', t: S10.carPass, note: 'distant, −32 dB, under the light sweep'},
  {id: 'penClick', shot: 'S11', t: S11.penClick},
  ...scratches('S11', S11.pen),
  ...scratches('S12', [...S12.price, ...S12.underline, ...S12.margin]),
  {id: 'particleWhoosh', shot: 'S14', t: S14.dive.start, end: S14.dive.end, note: 'peaks at the resolve (end)'},
  {id: 'uiTick', shot: 'S14', t: S14.uiTick, note: 'soft, as the field lights'},
  {id: 'highlighterSwipe', shot: 'S14', t: S14.highlight.t, end: r3(S14.highlight.t + S14.highlight.frames / FPS)},
  {id: 'springTock', shot: 'S14', t: S14.rateCell.dock},
  {id: 'whipWhoosh', shot: 'S14', t: S14.whip.start, end: S14.whip.end, note: 'tail carries into S15'},
  {id: 'strapCreak', shot: 'S15', t: S15.strapCreak, note: 'binoculars lowered (time inferred)'},
  {id: 'hangupClick', shot: 'S16', t: HANGUP, note: 'end-call click; the phone band cuts'},
  {id: 'phoneThud', shot: 'S16', t: PHONE_THUD, note: 'onto the passenger seat, with a seat squeak'},
  {id: 'thermosSip', shot: 'S17', t: S17.sip, note: 'sip and lid clink'},
  {id: 'panelWhoosh', shot: 'S20', t: S20.panels.t, note: 'two panels, from above and below'},
  {id: 'markerSqueak', shot: 'S20', t: S20.circleLock},
  {id: 'markerSqueak', shot: 'S20', t: S20.circleRow},
  {id: 'stringZip', shot: 'S20', t: S20.string.start, end: S20.string.end},
  {id: 'pinTick', shot: 'S20', t: S20.pins[0]},
  {id: 'pinTick', shot: 'S20', t: S20.pins[1]},
  {id: 'subThump', shot: 'S20', t: S20.headline, note: 'soft'},
  {id: 'markerSqueak', shot: 'S20', t: S20.circleTotal},
  {id: 'subImpact', shot: 'S20', t: S20.pop.t, note: 'with the saw stab (MUSIC.stab)'},
  {id: 'neonTickOff', shot: 'S21', t: S21.signOff.t},
  {id: 'roofCreak', shot: 'S21', t: S21.roofCreak, note: 'faint car-roof creak (time inferred)'},
  {id: 'pushWhoosh', shot: 'S22', t: S22.push.start, end: S22.push.end},
  {id: 'coffeeSip', shot: 'S22', t: S22.sip},
  {id: 'snort', shot: 'S22', t: S22.snort, note: 'short breath SFX, off-screen, not TTS'},
  {id: 'mugClink', shot: 'S23', t: MUG_CLINK, note: 'against the window glass, bridging the cut'},
  {id: 'tap', shot: 'S24', t: MARK_DONE_TAP},
  {id: 'checkTick', shot: 'S24', t: MARK_DONE_TAP},
  {id: 'rowSwish', shot: 'S24', t: S24.slide.start, end: S24.slide.end},
  {id: 'markerSwipe', shot: 'S25', t: S25.marker.start, end: S25.marker.end},
  {id: 'tap', shot: 'S25', t: COPY_TAP},
  {id: 'softBell', shot: 'S25', t: COPY_TAP},
  {id: 'toastPop', shot: 'S25', t: TOAST_POP},
  {id: 'logoBell', shot: 'S26', t: S26.bell, note: 'soft bell on the logo'},
];

/** Ambience beds (continuous; ducked under nothing, cut by nothing). */
export const AMBIENCE = {
  /** Cicadas, far highway hum, 60 Hz neon buzz at −38 dB, from frame 0 with no fade-in. S08–S09 add a faint glass hum. */
  night: [span(0, 46.5), span(60.0, LOOP_SEAM)],
  /** S05: the neon hum swells under the crane. */
  neonSwell: span(9.0, 11.0),
  /** Synth birdsong and morning room tone (car interior, then Gus's office). */
  morning: span(46.5, 54.5),
} as const;

// ─── Music (score events on the 120 BPM grid) ───────────────────────────────

/** Motif pitches. Minor = the 20-second motif (Gus's ringtone is its first two notes); major = the dawn reframe. */
export const MOTIF_PITCHES = {minor: ['D5', 'A4', 'F5', 'E5'], major: ['D5', 'A4', 'F#5', 'E5']} as const;
/** Every statement of the motif: four quarter-note onsets, E5 held. */
export const MOTIFS = [
  {shot: 'S05', mode: 'minor', voice: 'celesta', notes: [9.0, 9.5, 10.0, 10.5], note: 'first full statement, over the D-minor pad, ducked under R05'},
  {shot: 'S14', mode: 'minor', voice: 'celesta', notes: [29.0, 29.5, 30.0, 30.5], note: 'on top of the add9 ostinato, under the UI ticks, ducked under AI03'},
  {shot: 'S21', mode: 'major', voice: 'epiano', notes: [46.5, 47.0, 47.5, 48.0], note: 'warm FM e-piano over the held Asus4'},
  {shot: 'S23', mode: 'major', voice: 'epiano', notes: [50.0, 50.5, 51.0, 51.5], note: 'softly, under and after "Hi, Rita."'},
  {shot: 'S26', mode: 'major', voice: 'epiano+celesta', notes: [55.0, 55.5, 56.0, 56.5], note: 'full motif doubled'},
  {shot: 'S27', mode: 'minor', voice: 'mutedCelesta', notes: [60.25, 60.75, 61.25, 61.75], note: 'unresolved, decayed by 62.2, ducked under G02'},
] as const;

export const MUSIC = {
  /** D1 drone (tanh, HP 60 Hz, 180–250 Hz body). S01 from frame 0 at −30 dB (S02 is "no score", so it ends on the cut: inferred); it returns under the S20 board. */
  drone: [span(0, 3.0), span(42.5, 46.5)],
  /** S03: a single KS pizz D2 foreshadowing the ostinato. */
  pizzHint: S03.pizz,
  /** S04–S05: pizz pulse on D2 quarters (−28 dB); it drops out at 11.0 to leave air. */
  pizzPulse: grid(7.0, 11.0, 0.5),
  cymbalSwell: S04.cymbalSwell,
  /** S05–S06: soft D-minor pad (D3–F3–A3), sustaining through S06 (end inferred at the S07 cut). */
  pad: span(9.0, 12.5),
  /** S07: Shepard riser, then the hard mute at 15.5. */
  riser: S07.riser,
  /** S08–S10: one E6 sine, −34 dB from the click, ducking to −44 dB from AI01's first word, gone by 20.0. */
  e6: {start: PICKUP_CLICK, duck: r3(cue('AI01').words[0].start), end: 20.0},
  /** S10: A3 pizz pickup into the ostinato. */
  pickup: 20.25,
  /**
   * The pizzicato heist ostinato (D minor, KS pizz 8ths D3 D3 F3 D3 A3 D3 F3 E3,
   * wood tick on offbeats, pizz bass on beats 1 and 3), ducked −8 dB under speech.
   */
  ostinato: {
    start: 20.5, // on the S11 downbeat
    thin: 26.5, // bass + tick only, under "Just a few hours, cash?"
    bright: 28.5, // D-minor add9 voicing in S14
    settle: 31.5, // pizz + bass
    thinUnderAI04: r3(cue('AI04').at), // thins under the AI's reply
    stop: HANGUP, // STOPS DEAD on the hang-up click (a 16th that chops "they’ll")
  },
  /** S17: one felt-piano D2 with a long tail. */
  feltPiano: 37.0,
  /** S18–S19: no music at all (trills, heartbeat and the beep only). */
  twistSilent: span(38.5, 42.5),
  /** S20: dissonant saw stab (D–F–A–E♭, Dm♭9) with a sub impact on the giant "$238.00", decaying ~1 s. */
  stab: S20.pop.t,
  /** S21–S25: Asus4 pad (A–D–E) held unresolved from the dawn; it resolves to Dadd9 on the copy tap. */
  asus4: {start: 46.5, resolve: COPY_TAP},
  /** S25: light D-major e-piano comping after the resolve, swelling into the end card. */
  comping: span(COPY_TAP, 54.5),
  /**
   * S26 cadence: A7sus → A → Dadd9 landing on the "I" of "I will" (board 57.0;
   * the measured "I" is ≈ 57.21, so the resolution breathes a little late).
   */
  cadence: {a7sus: 56.0, a: 56.5, dadd9: I_WILL},
  /** The keyhole iris cuts the music. */
  irisCut: IRIS.start,
  /** S27: silence before the stinger motif. */
  silence: span(60.0, 60.25),
} as const;

// ─── Helpers for scenes ─────────────────────────────────────────────────────

/** An absolute second → a frame inside a scene's <Sequence> (its frame 0 is the scene's first frame). Same as timeline's local(). */
export const toLocalFrame = (sec: number, sceneName: string): number => f(sec) - scene(sceneName).from;

/** Frames elapsed since a mark, from a scene's local frame (negative before it). Feed it to interpolate(). */
export const framesSince = (localFrame: number, sec: number, sceneName: string): number => localFrame - toLocalFrame(sec, sceneName);

/**
 * The counter step showing at a scene's local frame, or null before the first.
 * `since` is frames since that step landed (0 and 1 are the 2-frame pop).
 */
export const activeStep = <T extends Step>(steps: readonly T[], localFrame: number, sceneName: string): {step: T; index: number; since: number} | null => {
  for (let index = steps.length - 1; index >= 0; index--) {
    const since = framesSince(localFrame, steps[index].t, sceneName);
    if (since >= 0) return {step: steps[index], index, since};
  }
  return null;
};

/** Rita's missed-call notification glow (S05, S17): a 1 Hz soft fade, 0..1, peaking at every n + 0.5 s (37.5 and 38.5 in S17). */
export const missedPulse = (sec: number): number => 0.5 + 0.5 * Math.cos(2 * Math.PI * (sec - 0.5));

// ─── Self-check ─────────────────────────────────────────────────────────────

const LENGTH_KEYS = new Set(['frames', 'dur', 'hz']);

/** Lists every mark outside its shot (span ends may run on inside the scene), unordered counters, and SFX outside their shot. Empty = all good. */
export const checkMarks = (): string[] => {
  const problems: string[] = [];
  const eps = 1e-6;
  for (const [id, marks] of Object.entries(MARKS)) {
    const sh = shot(id);
    const sc = scene(sh.scene);
    const visit = (v: unknown, path: string, key: string): void => {
      if (typeof v === 'number') {
        if (LENGTH_KEYS.has(key)) return;
        const hi = key === 'end' ? sc.end : sh.end;
        if (v < sh.start - eps || v > hi + eps) problems.push(`${id}.${path} = ${v} is outside ${sh.start}–${hi}`);
      } else if (Array.isArray(v)) {
        v.forEach((x, i) => visit(x, `${path}[${i}]`, key));
      } else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.t === 'number' && typeof o.frames === 'number' && o.t + o.frames / FPS > sc.end + eps) problems.push(`${id}.${path} runs past the scene end ${sc.end}`);
        if (typeof o.t === 'number' && typeof o.dur === 'number' && o.t + o.dur > sh.end + eps) problems.push(`${id}.${path} runs past the shot end ${sh.end}`);
        if (typeof o.start === 'number' && typeof o.end === 'number' && o.end < o.start) problems.push(`${id}.${path} ends before it starts`);
        for (const [k, x] of Object.entries(o)) visit(x, path ? `${path}.${k}` : k, k);
      }
    };
    visit(marks, '', '');
  }
  for (const [name, steps] of Object.entries({S02_COUNTER, S07_COUNTER, TWIST_COUNTER, S27_COUNTER})) {
    steps.forEach((x, i) => {
      if (i > 0 && f(x.t) <= f(steps[i - 1].t)) problems.push(`${name}[${i}] (${x.t}) does not land on a later frame than the step before`);
    });
  }
  for (const x of SFX) {
    const sh = shot(x.shot);
    if (x.t < sh.start - 1e-6 || x.t > sh.end + 1e-6) problems.push(`SFX ${x.id} at ${x.t} is outside ${x.shot} (${sh.start}–${sh.end})`);
  }
  if (SCENES[SCENES.length - 1].end !== LOOP_SEAM) problems.push('the last scene does not end on the loop seam');
  return problems;
};

const PROBLEMS = checkMarks();
if (PROBLEMS.length) console.warn(`marks.ts: ${PROBLEMS.length} mark(s) out of place:\n  ${PROBLEMS.join('\n  ')}`);
