# Across the Street (Ep. 1), a HotelOne Reel

> Two motels face each other across a highway. For four nights Rita has watched her rival Gus’s front-desk phone ring in his empty office and stop at exactly 0:20. At 2:21 AM she calls to catch him out. His AI front desk answers and says plainly that it is the AI front desk. It reads back the date, quotes his real price and turns down her “few hours, cash?” by his own house rule. Then the opening shot returns. The empty lobby with the ringing phone was never his. It was hers. Her 2:13 caller tried Gus next, and at breakfast that booking request is waiting in Gus’s inbox with the total already quoted. Nothing is booked until Gus confirms and sends the link.

**Runtime** 62.5s · **Format** 1080×1920, 30 fps · **Score** 120 BPM

## Cast (Kokoro-82M voices)

| Role | Voice | Speed | Treatment |
| --- | --- | --- | --- |
| RITA (owner, Rita’s Motor Inn) | `af_nicole` | 1.05 | Dry close-mic: +2 dB at 150 Hz, 90 Hz high-pass, sitting 3 dB under the AI. Car-cabin room tone at −40 dB under every line. Her phone lines are unfiltered because she is the near end of the call. AGEING: after TTS, every Rita clip gets a −1.5 semitone time-preserving pitch shift (ffmpeg asetrate=24000*0.917,aresample=24000,atempo=1.0905). This lowers pitch and formants together, so she reads older and heavier without changing timing. One clip per sentence, butted with 0.10–0.15 s gaps. The TTS is never asked to whisper; any hush comes from level and EQ. “…That’s Gus’s rule.” is rendered as “That’s Gus’s rule.” and the caption adds the “…”. |
| AI FRONT DESK (the Starlite’s HotelOne voice) | `af_heart` | 1 | Whenever heard through Rita’s phone: phoneBand() = HP 320 Hz, 2× LP 3300 Hz, tanh(v·2.2)/1.6 saturation, 0.002 noise floor. Hard-cut mid-word at Rita’s hang-up (35.875, inside “they’ll”). End card (S26): starts in the same phone band, then bandSweep() opens it to full range (HP 320→40 Hz, LP 3.3→16 kHz over 56.4–57.0, landing on “I will”) with a small-room reverb (0.6 s, 12% wet). The voice steps out of the phone and into the room. |
| GUS (owner, Starlite Motor Court) | `am_michael` | 1 | S23: warm and dry with a small office reverb (0.4 s, 10%), and a mug clink against the window after the line. S27: −4 dB and darker (LP 7 kHz), muttered at the window. |

## Story at a glance

| Shot | Time | Scene | Line |
| --- | --- | --- | --- |
| S01 | 0:00.0–0:03.0 | ColdOpen | **RITA:** Nobody works nights at the Starlite. |
| S02 | 0:03.0–0:05.5 | Binoculars | **RITA:** Twenty seconds. |
| S03 | 0:05.5–0:07.0 | Binoculars | **RITA:** And nobody’s in there. |
| S04 | 0:07.0–0:09.0 | Stakeout | **RITA:** Four nights I’ve watched. |
| S05 | 0:09.0–0:11.0 | Geography | **RITA:** Gus can’t afford a night clerk. |
| S06 | 0:11.0–0:12.5 | TheCall | **RITA:** Neither can I. |
| S07 | 0:12.5–0:15.5 | TheCall | **RITA:** Come on, Gus. Pick up. |
| S08 | 0:15.5–0:17.5 | WhoAnswers | **AI FRONT DESK:** Starlite Motor Court, AI front desk. How can I help? |
| S09 | 0:17.5–0:18.5 | WhoAnswers | — |
| S10 | 0:18.5–0:20.5 | WhoAnswers | **RITA:** Sure it is, Gus. |
| S11 | 0:20.5–0:24.0 | Interrogation | **RITA:** Got a room Friday, for two?<br>**AI FRONT DESK:** We do. Friday the twenty-third, a queen room is a hundred nineteen. |
| S12 | 0:24.0–0:27.0 | Interrogation | — |
| S13 | 0:27.0–0:28.5 | Interrogation | **RITA:** Just a few hours, cash? |
| S14 | 0:28.5–0:31.5 | ConsoleDive | **AI FRONT DESK:** Sorry — we don’t offer day-use rooms. |
| S15 | 0:31.5–0:33.0 | RitaSaysHi | **RITA:** …That’s Gus’s rule. |
| S16 | 0:33.0–0:37.0 | RitaSaysHi | **RITA:** Rita says hi.<br>**AI FRONT DESK:** I’ve passed that to the team — they’ll—<br>**RITA:** Show-off. |
| S17 | 0:37.0–0:38.5 | Mirror | — |
| S18 | 0:38.5–0:40.5 | Twist | — |
| S19 | 0:40.5–0:42.5 | Twist | — |
| S20 | 0:42.5–0:46.5 | TheKnot | — |
| S21 | 0:46.5–0:48.0 | Morning | — |
| S22 | 0:48.0–0:50.0 | Morning | — |
| S23 | 0:50.0–0:51.0 | Morning | **GUS:** Hi, Rita. |
| S24 | 0:51.0–0:51.5 | Morning | — |
| S25 | 0:51.5–0:54.5 | Morning | — |
| S26 | 0:54.5–1:00.0 | EndCard | **AI FRONT DESK:** If nobody picks up in twenty seconds… I will. |
| S27 | 1:00.0–1:02.5 | Stinger | **GUS:** Who’s answering yours, Rita? |

## Shot by shot

### S01 · ColdOpen · 0:00.0–0:03.0 (3.0s)

**Visual.** RITA’S LOBBY. This is the misdirect: everyone will read it as the Starlite. Built from set/Lobby.tsx, which is drawn oversize (≥1440×2100 units, window side extended right). S01 and S18 use the identical crop transform. Flat illustration, front-on, static 1–2% dither baked into the gradients, soft vignette (edges −35%), lit only by red neon.
- Wall: vertical gradient #0c1017 (top) → #151a22 at the counter line. Red spill #eb5c5c at 35% from the left.
- Glass door at the left edge (x 0–150, y 560–1110): the BACK of a red neon sign, mirror-reversed and blurred 6 px: “NNI ROTOM S’ATIR”. This is a rewatch clue.
- Counter: wood top edge at y 1110, full width, red rim light, front face #0c1017.
- DEAD CENTRE (x 405–605, y 760–1110): an old smartphone (200×410 px, bezel #1b1f27) standing in a black charging cradle.
  - Masking tape on the cradle base (y 1080–1105, #e9dcc0, rotated −2°) reads “FRONT DESK” in black marker.
  - The screen is the brightest thing in frame: #ffffff with a cyan #c9f3ff bloom (radius 90 px) pooling on the counter.
  - Generic incoming-call UI, no OS branding: a 56 px handset glyph, “Incoming call” (Inter 500 22 px #111827) and the number “(928) 555-0147” (Inter 600 26 px). The number pays off in S20.
- Left of the phone: a brass service bell (#e1ae47, highlight #f4d07b) at x 250–340, y 1050–1110. Right: an open guest register (cream #e9e3d6 tinted red) at x 650–860.
- A small red 7-segment LED clock on the wall (x 90–260, y 720–780) reads “2:13”.
- WINDOW, upper right (x 660–1010, y 620–960): a dark highway outside (horizon y 860). Across it, the small teal neon sign “STARLITE ★ MOTOR COURT” over “VACANCY” (x 760–960, y 680–790, #30a7cf/#49b9df), with a dark sedan parked under it (x 790–930, y 880–935).
- Soft radial ink plate (#07090d at 55%, feather 120 px) behind the text block, y 280–680.
Everything except the question is present and fully settled on frame 0, so frame 0 works on its own as the autoplay still and as the loop landing. There is no counter in this shot; S02 is the counter’s hero shot.

**Motion.** - Frame 0 is clean and settled: no flash, no scale-in.
- The camera pushes in 100%→106% over 0–3.0 s (ease in-out), anchored on the phone screen (505, 935).
- During each trill (0.00–0.60 and 1.50–2.10): ±3 px horizontal phone buzz at 30 Hz, and the screen bloom rises 15%.
- The headline is word-lit: as Rita speaks each word (times from vo.ts), it gets a 4 px brass underline. No words are dimmed.
- 1.25: the question pops in (scale 0.92→1 over 4 frames, ease [0.22,1,0.36,1]).
- The window neon dips once (f22–f24, 60%→100%).
- f54–f55 (1.80 s): a 2-frame white cross glint (40 px) off the sedan’s windshield across the road. Nothing points at it: it is Rita’s binocular lens.
- Out: hard cut at 3.0 on the beat.

**On-screen text.** Centred on x 505, on the ink plate:
- y 300–345: “2:13 AM” (JetBrains Mono 500, 44 px, tracking 0.08em, brass #e1ae47).
- y 370–530: “Nobody works nights / at the Starlite.” (Inter 600, 72 px, leading 1.08, ivory #f5f3f0, two lines). This headline IS the caption for Rita’s line, so there is no caption plate in this shot.
- y 580–645, from 1.25: “So who picks up at 0:20?” (Inter 600, 54 px, ivory, with “0:20” in JetBrains Mono 500, teal #8ed7eb).

> **RITA:** Nobody works nights at the Starlite.

**Sound.** - Frame 0: Rita’s ringtone, the old desk-bell trill (1.1 kHz + 1.62 kHz partials, 20 Hz AM, 0.6 s, 0.4 s small-room reverb), at FULL level.
- 1.50: the same trill, ducked −9 dB with a −6 dB high-shelf above 1 kHz under the VO.
- A cradle rattle (120 Hz buzz) under each trill.
- Bed from frame 0 with no fade-in: cicadas (band-passed chirps), far highway hum (LP noise at 180 Hz) and 60 Hz neon buzz at −38 dB.
- R01 runs 0.70–3.27, carrying 0.27 s over the cut: “Nobody works” 0.70–1.88, “nights” 1.98–2.13, “at the Starlite.” 2.46–3.27.

**Music.** No music. The D1 drone (tanh, then HP 60 Hz, plus a 180–250 Hz body layer) at −30 dB from frame 0.

**Claims.** answers-unanswered-calls-20s

### S02 · Binoculars · 0:03.0–0:05.5 (2.5s)

**Visual.** Hard cut to RITA’S BINOCULAR POV from her car, parked in the Starlite lot, looking through Gus’s office plate glass.
- A black #000 frame with two overlapping soft circles (r 410, centres (330, 900) and (690, 900), feather 18 px, a 1 px red/cyan chromatic fringe on the rims).
- Inside: the STARLITE office, with two diagonal teal reflection streaks on the glass at 12%. It is the same Lobby set as S01 with tint: teal (key #30a7cf, shadows #132f39, walls #0c1017): an empty counter, a key rack with 8 brass keys and an empty office chair.
- Centre (x 450–560, y 820–1050): Gus’s front-desk smartphone in a cradle with a neat printed label “FRONT DESK”. Its screen glows pale teal-white #e0f7ff and buzzes.
- Series bug, top-left on the black (x 80–420, y 300–336), text only, no logo: “Across the Street · Ep. 1” (Inter 500, 26 px, #a4aab7).
- A giant counter centred above the circles.

**Motion.** - Handheld drift of 2–3 px (Perlin, 0.6 Hz) on the mask and the image.
- The counter jump-cuts (no tween; 2-frame pop 1.08→1): 3.00 “0:01”, 3.50 “0:06”, 4.00 “0:11”, 4.25 “0:14”, 4.50 “0:16”, 4.75 “0:18”, 4.875 “0:19”, 5.00 “0:20”.
- At 5.00 the phone screen snaps to black in 1 frame, mid-chime. The counter holds “0:20” and turns teal #8ed7eb.
- 5.10: “Then it stops.” rises from a mask over 12 frames.
- Out: hard cut at 5.5.

**On-screen text.** - Series bug top-left (y 300–336).
- Counter centred on x 505: label “RINGING” (JetBrains Mono 500, 30 px, #8ed7eb) at y 370; value (JetBrains Mono 500, 200 px, ivory) at y 400–560.
- From 5.10, at y 1080–1150 on an ink plate: “Then it stops.” (Inter 600, 60 px, ivory).
Caption (Rita) at y 1240: “20 seconds.” She says it just before the phone stops.

> **RITA:** Twenty seconds.

**Sound.** - Gus’s ringtone, a soft FM two-note chime (D5–A4), through his office glass: glass() = LP 1.2 kHz plus a 40 ms slap, −12 dB. It plays at 3.00, 4.00, 4.50 and 4.875, speeding up with the counter.
- At 5.00 the 4.875 chime is cut 125 ms in, between D5 and A4, with no tail.
- A heartbeat (55 Hz + 110 Hz layer + beater tick) plus a dry clock tick on every counter jump. Both stop at 5.00, leaving only cicadas.
- R02 3.90–4.89.

**Music.** No score: the heartbeat is the pulse.

**Claims.** answers-unanswered-calls-20s

### S03 · Binoculars · 0:05.5–0:07.0 (1.5s)

**Visual.** A tighter cut-in on the same POV. It is still TWO circles, now r 440 with centres (300, 880) and (720, 880): exactly where S04’s binocular objective lenses sit on its first frame. Inside: Gus’s phone dark in its cradle and the empty chair, in teal light, with dust motes drifting. Nobody enters. The series bug stays top-left, the counter is gone, and “Then it stops.” holds until 6.0.

**Motion.** - A slow push 100→104% (linear) with continued drift.
- From 6.6 the image inside the circles starts a slow zoom-out (1→0.9) that continues as S04’s dolly.
- Hard cut at 7.0.

**On-screen text.** “Then it stops.” held at y 1080–1150, fading out at 6.0. Caption (Rita) at y 1240: “And nobody’s” → “in there.”

> **RITA:** And nobody’s in there.

**Sound.** Cicadas and a faint glass hum. One distant car pass (pan L→R, −30 dB) at 6.0. R03 5.60–6.94 (“And nobody’s” 5.60–6.43, “in there.” 6.47–6.94).

**Music.** A single KS pizz on D2 at 6.5 (−24 dB), foreshadowing the ostinato.

### S04 · Stakeout · 0:07.0–0:09.0 (2.0s)

**Visual.** Match-cut: the frame opens on the two objective lenses of Rita’s binoculars at S03’s circle positions, filled with the teal lobby reflection. The camera dollies back through them to reveal RITA.
- Rita, Rig A (3/4 medium close-up in the car): 50s, grey bob, burgundy cardigan, reading glasses on a beaded chain. At night her face is mostly silhouette, with a teal rim through the windshield and green under-light from the dash. The acting reads through the glasses glint, brows and mouth line. The cabin is otherwise ink #07090d.
- Rita at x 180–640, y 620–1180, in 3/4 view facing right.
- Through the top of the windshield (x 600–960, y 380–700, partly behind the text): the teal “STARLITE ★” sign and Gus’s lit office window. She is parked nose-in to his office.
- Dashboard (y 1100–1140): a green dash clock reading “2:14” (JetBrains Mono 40 px, #74dca8) at x 700–800. This is a clue. A thermos sits in the cup holder.
- A steno pad propped on the wheel (x 560–860, y 960–1120) has four columns of tally marks, each labelled “20s” and circled in pen.

**Motion.** - 7.0–7.8: dolly-out from 180% to 100% (ease-out) as the lens rims settle into the binocular shapes.
- 8.1–8.7: her pen draws a fifth circled “20s” (stroke draw).
- Breathing: ±2 px shoulder rise at 0.25 Hz.
- Hard cut at 9.0.

**On-screen text.** - y 300–400: “Rita.” (Fraunces 600, 96 px, ivory #f5f3f0).
- y 420–470: “Rita’s Motor Inn” (Inter 600, 44 px, #fa9e9e). The red-soft colour ties her to the red world and matches the reversed door sign in S01.
Caption (Rita) at y 1240: “Four nights” → “I’ve watched.”

> **RITA:** Four nights I’ve watched.

**Sound.** Seat creak at 7.1. Pen scribble 8.1–8.7. Cabin room tone at −40 dB. Cicadas muffled by glass. R04 7.20–8.97 (“Four nights” 7.20–7.88, “I’ve watched.” 8.05–8.97).

**Music.** The pizz pulse enters on D2 quarters at −28 dB. A reversed-cymbal swell runs 8.4→9.0.

### S05 · Geography · 0:09.0–0:11.0 (2.0s)

**Visual.** WIDE NIGHT SHOT: a high crane looking down a two-lane highway, laid out so the geography reads at phone size. The road runs BETWEEN the two lots.
- Sky y 0–600, #07090d → #0c1017, with a few stars.
- The highway recedes as a vertical band: asphalt #131720, dashed centre line #2b303b, from x 400–680 at the bottom of the scene (y 1180) to a vanishing point at (540, 560).
- LEFT lot (x 60–400, y 620–1150): RITA’S MOTOR INN, single-storey, facing the road.
  - A tall red neon arrow sign (x 90–330, y 600–880) reads “RITA’S” / “MOTOR INN” / “VACANCY” in #eb5c5c with glow.
  - Her red-lit office window (x 250–360, y 980–1040) holds one tiny white rectangle that pulses slowly (1 Hz soft fade). It is her phone’s missed-call notification, the fair-play clue.
- RIGHT lot (x 680–1020, y 620–1150): THE STARLITE MOTOR COURT, with a teal neon star sign (x 720–960, y 600–860) reading “STARLITE ★” / “MOTOR COURT” in #30a7cf/#49b9df, and a teal office window. The two signs face each other across the road.
- Rita’s sedan is parked in the Starlite lot, nose-in to Gus’s office (x 720–880, y 1060–1130), with a teal glint on the windshield.
- A hand-drawn ivory arrow (2 px, slight wobble) runs from the label “Rita” (Inter 600, 30 px, ivory) at (590, 1130) to the car.
- Title over the sky, with no logo and no “A HOTELONE SHORT”: “Across the Street” (Fraunces 600, 72 px, ivory, about 600 px wide) at y 300–375, with a 2 px brass #e1ae47 threshold bar under it (x 330–750, y 392).

**Motion.** - Crane: scale 1.25→1.00 and y-offset +180→0 px over 9.0–10.1 (ease [0.22,1,0.36,1]), then a 1% drift.
- The title rises with the move (9.05–9.40). The brass bar draws left→right over 9.5–10.0.
- Each neon sign does one 3-frame flicker dip: Rita’s at 9.7, the Starlite’s at 10.4.
- The missed-call pulse in Rita’s window runs continuously at 1 Hz (it is not the ring cadence: her caller has already hung up).
- Hard cut at 11.0.

**On-screen text.** “Across the Street” plus the brass bar; the label “Rita” with its arrow to the sedan. Caption (Rita) at y 1240: “Gus can’t afford” → “a night clerk.”

> **RITA:** Gus can’t afford a night clerk.

**Sound.** A low boom at 9.0 (D, voiced on its 73/110/147 Hz harmonics, 1.2 s). The neon hum swells. R05 9.10–10.90 (“Gus can’t afford” 9.10–9.95, “a night clerk.” 9.95–10.90).

**Music.** The FIRST FULL STATEMENT of the 20-second motif on celesta: D5 (9.0), A4 (9.5), F5 (10.0), E5 (10.5, held), over a soft D-minor pad (D3–F3–A3). The pizz pulse continues, all ducked under R05.

### S06 · TheCall · 0:11.0–0:12.5 (1.5s)

**Visual.** Macro on Rita’s own phone in her left hand: generic dark OS UI with no brand, bezel #1b1f27, screen at x 260–760, y 560–1160.
- A contact card: an initials avatar “S” in a teal circle, the name “Starlite — front desk”, and a green call button. The status bar reads “2:21”.
- Her right thumb (cardigan-cuff silhouette) hovers over the call button while she speaks. On a rewatch, the line is the clue that her own desk is empty.
- 12.0: the thumb taps call. The screen flips to “Starlite — front desk” / “Calling…” / “00:00”.
- 12.25: the phone whips up toward her ear (motion blur).

**Motion.** 11.0–12.0: a 2% push with a slight thumb hover. 12.0: a tap ripple (soft white 40 px circle) and a 2-frame screen flip. 12.25–12.5: whip-up blur. Cut at 12.5.

**On-screen text.** UI copy only: “Starlite — front desk”, “Calling…”. Caption (Rita) at y 1240: “Neither can I.”

> **RITA:** Neither can I.

**Sound.** R06 11.05–11.97. Tap at 12.0. Call-start blip at 12.05 (880 Hz sine, 60 ms). Cloth rustle at 12.25. Binocular strap clink.

**Music.** The D-minor pad sustains. The pulse drops out to leave air.

### S07 · TheCall · 0:12.5–0:15.5 (3.0s)

**Visual.** HORIZONTAL SPLIT SCREEN with a 10 px ink seam at y 955–965.
- TOP (y 0–955): binocular POV (two circles, r 330, centres (360, 600) and (650, 600)) on the Starlite’s empty teal lobby. Gus’s FRONT DESK phone lights up (#e0f7ff) and rings.
- BOTTOM (y 965–1920): Rita, Rig B (profile silhouette, facing right), phone pressed to her ear. Lit green from below by the dash and teal from the side through the windshield; the binoculars rest on the wheel. She is framed so her head sits at y 1320–1520, the phone at y 1330–1480 and her shoulder line at the 1540 UI edge, all clear of the caption band.
- ON THE SEAM: label “RINGING” (JetBrains Mono 26 px, #8ed7eb) on its own row at y 800–830. Below it, a giant counter (JetBrains Mono 500, 180 px, #f5f3f0) on an ink pill (#07090d at 85%, radius 28, padding 24/40) at y 856–1064, centred on (505, 960).
- 13.0: a truck passes. A headlight bar sweeps right→left across both halves with a 200 px glare bloom (#fff8e0).

**Motion.** - The counter jump-cuts with a 2-frame pop, starting at 0:04 because the audience already knows the count: 12.50 “0:04”, 13.00 “0:07”, 13.50 “0:10”, 14.00 “0:13”, 14.50 “0:16”, 14.75 “0:17”, 15.00 “0:18”, 15.25 “0:19”, 15.375 “0:20”.
- A 3% push on both halves. A 6-frame ±6 px camera shake for the truck at 13.0.
- Rita’s knuckles tighten (highlight) at 14.5.
- 15.375–15.5: in the TOP half Gus’s screen snaps dark; in the BOTTOM half Rita flinches (2 frames, 4 px jolt).
- Hard cut at 15.5 on the click.

**On-screen text.** The counter and its “RINGING” label on the seam. Caption (Rita) at y 1240: “Come on, Gus.” → “Pick up.”

> **RITA:** Come on, Gus. Pick up.

**Sound.** - In Rita’s ear (centre, phone band): one US ringback burst, 440+480 Hz, 12.6–14.6, ducked −6 dB under her VO.
- Across the lot: Gus’s glass-muffled D5–A4 chime at 12.5, 13.5 and 14.5. We hear both ends of one call.
- Heartbeat accelerating on the grid: quarters 12.5–13.5, 8ths 13.5–15.0, 16ths 15.0–15.375.
- Truck doppler whoosh 12.8–13.5 (pitch-dropping noise, pan R→L).
- A dry line-pickup CLICK at 15.48.
- R07, two clips: “Come on, Gus.” 13.55–14.52, “Pick up.” 14.70–15.34.

**Music.** A Shepard riser (stacked octave sines on a rising loop) 12.5–15.48, then a HARD MUTE of everything at 15.5 (1-frame fade).

**Claims.** answers-unanswered-calls-20s, keep-your-number

### S08 · WhoAnswers · 0:15.5–0:17.5 (2.0s)

**Visual.** Hard cut to a tight single-circle binocular POV (r 470, centre (505, 800), teal fringe) on the Starlite counter. It is still empty: Gus’s phone dark in its cradle, the chair empty, the key rack still. Nothing moves but dust. The voice we hear is not in this room; it is in Rita’s ear.

**Motion.** A slow push 100→110% over 2.0 s (linear), with drift cut to 1 px. At 16.0, “Nobody touched the phone.” rises from a mask over 12 frames. Hard cut at 17.5.

**On-screen text.** - y 330–400: “Nobody touched the phone.” (Inter 600, 56 px, ivory, on an ink plate).
- AI caption (teal #8ed7eb, with a 28 px AudioLines glyph leading each chunk) at y 1240: “Starlite Motor Court,” → “AI front desk.” The second chunk is in 700 weight. The caption continues into S09.

> **AI FRONT DESK (phone band):** Starlite Motor Court, AI front desk. How can I help?

**Sound.** Near-silence: cicadas and a faint glass hum. AI01 plays through Rita’s phone as two clips: “Starlite Motor Court,” 15.75–16.75 and “AI front desk.” 16.97–17.96 (one clip, carrying over the cut), then “How can I help?” 18.11–18.98.

**Music.** No score. One E6 sine starts at −34 dB on the click and ducks to −44 dB from 15.75, like ringing ears.

**Claims.** ai-disclosure, answers-unanswered-calls-20s

### S09 · WhoAnswers · 0:17.5–0:18.5 (1.0s)

**Visual.** Extreme close-up of Rita’s reading glasses (frame area x 90–940, y 640–1120). In each lens, the reflection of the empty teal Starlite lobby drifts (a reflection layer at 60% with slight barrel distortion). Behind the lenses her eyes are dark silhouettes. The beaded chain catches a highlight. No facial animation is needed: the reflection and the glint carry the beat.

**Motion.** The reflection drifts 12 px L→R. At 18.1, on “How can I help?”, a glint sweeps across the left lens (6 frames). A 2% push. Hard cut at 18.5.

**On-screen text.** The AI caption continues (teal): “How can I help?” (from 18.11).

**Sound.** Cicadas. A small leather creak from the binocular strap at 17.9. AI01 ends at 18.98.

**Music.** The E6 sine holds at −44 dB.

**Claims.** ai-disclosure

### S10 · WhoAnswers · 0:18.5–0:20.5 (2.0s)

**Visual.** Rig A medium close-up: Rita in 3/4 view, phone at her ear, binoculars in her lap. Deadpan, she raises one eyebrow and narrows her eyes toward the Starlite, sure that Gus is putting on a voice. Teal rim light on her left side, green dash glow under her chin.

**Motion.** - The eyebrow rises over 6 frames at 18.7. The eyes narrow at 19.1.
- ±2 px breathing and a 1% push keep the frame alive; the face itself stays still for the comedy.
- 19.6: a passing car’s light sweeps across the cabin L→R (10 frames, 15% white).
- Hard cut at 20.5.

**On-screen text.** Caption (Rita) at y 1240: “Sure it is, Gus.” No emoji.

> **RITA:** Sure it is, Gus.

**Sound.** Cicadas. A distant car pass (−32 dB) under the light sweep at 19.6. R08 19.15–20.21. A dry pizz “plink” pickup at 20.25.

**Music.** The E6 sine is gone by 20.0. Pickup into the ostinato: A3 pizz at 20.25.

### S11 · Interrogation · 0:20.5–0:24.0 (3.5s)

**Visual.** Rig A: Rita leans over the wheel, phone at her ear, pen hovering over the steno pad (pad at x 300–760, y 980–1160, clear of the caption band). Through the windshield, the Starlite office window, still empty and teal. She is interrogating the voice.

**Motion.** - A 3% push across the shot. A pen click at 20.6.
- 22.0: a headlight reflection slides across the dash.
- 22.6, on “We do.”: her brows lift 4 px.
- 23.25–23.95: on “Friday the twenty-third”, her pen writes “Fri 23” at the top of the pad (stroke draw).
- Hard cut at 24.0.

**On-screen text.** Captions at y 1240:
- Rita: “Got a room Friday,” → “for two?”
- AI (teal, AudioLines glyph): “We do.” → “Friday the 23rd,” (carrying into S12).
Handwritten on the pad: “Fri 23”.

> **RITA:** Got a room Friday, for two?
> **AI FRONT DESK (phone band):** We do. Friday the twenty-third, a queen room is a hundred nineteen.

**Sound.** - Pen click at 20.6.
- R09 20.60–22.36 (“Got a room Friday,” 20.60–21.68, “for two?” 21.91–22.36).
- AI02 in two clips: “We do.” 22.55–23.08, then “Friday the twenty-third, a queen room is a hundred nineteen.” 23.23–26.40, carrying over the cut.
- Pen scratch 23.25–23.95.

**Music.** 20.5, on the downbeat: the PIZZICATO HEIST OSTINATO starts (D minor; KS pizz 8ths D3 D3 F3 D3 A3 D3 F3 E3, a muted wood tick on offbeats, pizz bass on beats 1 and 3), ducked −8 dB under speech.

**Claims.** real-prices-from-live-data

### S12 · Interrogation · 0:24.0–0:27.0 (3.0s)

**Visual.** Top-down close-up of the steno pad on the wheel (x 120–940, y 520–1150): the four circled “20s” tallies and tonight’s fifth, “Fri 23” in blue ink at the top, and bands of teal light across the paper. Only the pen tip and a cuff silhouette are in frame; no drawn hand.

**Motion.** - 25.45–26.10: “$119?!” stroke-draws on 16ths, synced to “a hundred nineteen”.
- 26.10–26.35: a double underline draws under it.
- 26.40–26.90: a small arrow and “(I’m $129)” are scrawled in the margin: she is pricier AND unanswered.
- A 2% push. Hard cut at 27.0.

**On-screen text.** Handwritten on the pad: “Fri 23”, “$119?!”, “(I’m $129)”.
Captions at y 1240: AI (teal): “a queen room” → “is $119.” Then Rita (from 26.60): “Just a few hours,”.

**Sound.** Pen scratch synced to each stroke. AI02 ends at 26.40. R10 starts at 26.60 as a J-cut into S13.

**Music.** The ostinato continues and thins to bass plus tick from 26.5.

**Claims.** real-prices-from-live-data

### S13 · Interrogation · 0:27.0–0:28.5 (1.5s)

**Visual.** Rig A: Rita, sly, sets a trap. A half-smile (mouth corner up 4 px), a sideways glance at camera and a glasses glint. Phone at her ear, binoculars against her chest.

**Motion.** A slow 3% push. At 28.35 the camera starts to dive toward the phone’s speaker grille (radial blur), carrying into S14.

**On-screen text.** Caption (Rita) at y 1240: “Just a few hours,” → “cash?”

> **RITA:** Just a few hours, cash?

**Sound.** R10 26.60–28.15 (“Just a few hours,” 26.60–27.55, “cash?” 27.60–28.15).

**Music.** Bass plus tick under the sneaky line.

### S14 · ConsoleDive · 0:28.5–0:31.5 (3.0s)

**Visual.** 28.5–28.9: a macro dive into the speaker grille of Rita’s phone. The grille holes break into about 600 teal particles (#30a7cf → #8ed7eb) that stream forward and resolve into ONE field of the HotelOne staff console in DARK theme (.dark tokens from globals.css).

- LOCKUP (x 80–600, y 580–630). This is the film’s first brand mark: LogoMark 40 px (dark variant: tile #30a7cf, keyhole #0c1017, sill #e1ae47), Wordmark “Hotel”/“One” (Fraunces 400/600, 30 px, #f5f3f0), then “· Voice front desk” (Inter 500, 24 px, #a4aab7).
- FLOATING CARD: bg #131720, 1 px border #2b303b, radius 36 px, float shadow tinted #020408, at x 80–940, y 640–1100. It is a crop of the real “How it sounds” card: the card’s top edge, with the Voice, Hand-off number and Greeting fields, is faded out above the crop, so the shot never claims House rules is the first field. UI at 2.6× in the narrow layout:
  - Field label “House rules” (Inter 500, 36 px, #f5f3f0).
  - The real hint line (“Anything the voice should always do or never say. It still can’t invent prices or availability.”) under the label at 20% opacity, defocused.
  - Textarea (bg #090b11, border #6a7181 at 50%, radius 26, text 36 px, line height 52 px), lines:
    - “We don’t offer day-use rooms.” (full opacity, #f5f3f0).
    - “Dogs under 30 lb are welcome for $25 a night.” (40%, wraps to two lines).
    - “Quiet hours start at 10 PM.” (40%).
- RATE CELL, docking over the card’s top-right corner (x 772–940, y 560–720): one rate-calendar cell in its sm-and-up rendering (rounded-lg, bg #191e29, border #2b303b):
  - Day number “23” (#a4aab7).
  - “$119” (600, #f5f3f0, tabular).
  - A thin occupancy bar (bg-primary at 70%, 58% filled).
  - “7/12 sold” (2xs, #a4aab7).
  - No custom-price dot.
  - A small eyebrow above it, right-aligned at y 530–552: “Queen Room · Fri” (Inter 500, 20 px, #a4aab7).
There is no VoiceOrb, no “Speaking” status pill and no aurora line. The console has no live-call view, so the shot doesn’t imply one.

**Motion.** - 28.5–28.9: scale 1→6 into the grille with radial blur.
- 28.9–29.2: the particles converge (ease [0.22,1,0.36,1]). The card fades up from y +20 to 0, with a soft UI tick as the field lights.
- 29.25: the headline rises.
- 30.0, on the measured onset of “day-use”: a highlight sweeps left→right across “We don’t offer day-use rooms.” over 10 frames (bg #132f39, text #8ed7eb).
- 30.5: the rate cell springs in from the right (bounce .18) and docks, and the sub-line rises.
- 31.3–31.5: whip-pan right with motion blur into S15.

**On-screen text.** - y 300–380, from 29.25: “Gus typed it once.” (Fraunces 600, 72 px, ivory).
- y 395–445, from 30.5: “His prices. His rules.” (Inter 600, 40 px, #a4aab7).
- The lockup and the UI copy as listed.
- AI caption (teal) at y 1240: “Sorry —” → “we don’t offer” → “day-use rooms.”

> **AI FRONT DESK (phone band):** Sorry — we don’t offer day-use rooms.

**Sound.** A particle whoosh 28.5–28.9, peaking at the resolve. A soft UI tick as the field lights. A highlighter swipe at 30.0. A spring “tock” as the rate cell docks at 30.5. AI03 28.80–30.81, rendered as two clips: “Sorry —” 28.80–29.26 and “we don’t offer day-use rooms.” 29.37–30.81.

**Music.** The ostinato brightens to a D-minor add9 voicing. The celesta motif rides on top at 29.0 / 29.5 / 30.0 / 30.5, ducked under AI03.

**Claims.** house-rules, real-prices-from-live-data

### S15 · RitaSaysHi · 0:31.5–0:33.0 (1.5s)

**Visual.** The whip-pan lands back in the car (Rig A). Rita slowly lowers the binoculars and looks across at the Starlite with grudging recognition: that is Gus’s rule, all right. Teal light on her face, the sign in the windshield.

**Motion.** Motion blur resolves over 4 frames. The binoculars lower 120 px over 31.6–32.3 (ease-out). A 2% push. Hard cut at 33.0.

**On-screen text.** Caption (Rita) at y 1240: “…That’s Gus’s rule.”

> **RITA:** …That’s Gus’s rule.

**Sound.** Whoosh tail. Binocular strap creak. R11 31.70–32.95.

**Music.** The ostinato continues, pizz plus bass.

**Claims.** house-rules

### S16 · RitaSaysHi · 0:33.0–0:37.0 (4.0s)

**Visual.** Rig A: Rita, phone at her ear, gives a tiny smug smile and tips her head toward the Starlite as she leaves her message. At 35.875 she taps End mid-reply and tosses the phone onto the passenger seat, where it bounces once. At 36.15 she glances at it, unimpressed and a little impressed: “Show-off.”

**Motion.** - The head tilt eases over 33.2–33.6.
- The toss is a quick arc, 35.875–36.15, with one 6 px bounce.
- She turns her head toward the phone at 36.15.
- Hard cut at 37.0.

**On-screen text.** Captions at y 1240:
- Rita: “Rita says hi.”
- AI (teal): “I’ve passed that” → “to the team — they’ll—”. The caption is chopped mid-word on the click.
- Rita: “Show-off.”

> **RITA:** Rita says hi.
> **AI FRONT DESK (phone band):** I’ve passed that to the team — they’ll—
> **RITA:** Show-off.

**Sound.** - R12 33.10–34.14.
- AI04 is the full real string, “I’ve passed that to the team — they’ll get back to you.”, rendered by TTS and played from 34.25: “I’ve passed that” 34.25–34.89, “to the team —” 34.92–35.48, “they’ll” onset 35.74. It is hard-cut at 35.875, 135 ms into “they’ll”.
- 35.875: end-call CLICK, and the phone band cuts.
- 35.95: the phone thuds onto the seat, with a seat squeak.
- R13 “Show-off.” 36.25–36.94.

**Music.** The ostinato thins under AI04, then STOPS DEAD on the hang-up click at 35.875, as the comic button. Silence and cicadas after.

**Claims.** takes-a-message

### S17 · Mirror · 0:37.0–0:38.5 (1.5s)

**Visual.** Rita settles back and sips from the thermos (a steam curl). Slow push into her rearview mirror (x 300–780, y 520–760, growing to fill y 420–1100). In the mirror, behind her across the road: her own motel. We see the red neon arrow sign shape from S05, mirror-reversed, and a dark lobby window with one small white glow pulsing slowly (1 Hz soft fade): the missed-call notification, not a ring. The shot holds a beat too long.

**Motion.** The push into the mirror goes from 100% to 240% over 1.5 s (ease in-out). The glow pulses at 37.5 and 38.5. The text rises at 37.1. Hard cut at 38.5.

**On-screen text.** y 300–380: “Rita missed one thing.” (Fraunces 600, 72 px, ivory #f5f3f0).

**Sound.** A thermos sip and lid clink at 37.1. Cicadas. A reverse-reverb pre-echo of the trill swells 37.9→38.5 into the smash cut (non-diegetic).

**Music.** One felt-piano D2 at 37.0 with a long tail.

### S18 · Twist · 0:38.5–0:40.5 (2.0s)

**Visual.** SMASH CUT to the EXACT opening frame: the same Lobby set and crop as frame 0, the same red lobby, the LED clock at 2:13, the FRONT DESK phone blazing with “(928) 555-0147”, and “2:13 AM” and “Nobody works nights / at the Starlite.” in place. The first frame must pixel-match frame 0.
- 38.75: the hook question “So who picks up at 0:20?” pops in, exactly as in S01.
- 39.0: the eyebrow and headline dim to 25%. A large RED counter appears under the phone.
- 40.0: at 0:20, nothing happens. White flash on the counter, then “Nobody.” slams in red under the question. Read now, it is Rita’s desk that nobody works at night: she is in her car. The same question gets answered twice: “AI front desk” for Gus, “Nobody.” for Rita.

**Motion.** - Phone buzz on the trills at 38.5 and 40.0.
- The counter jump-cuts with a pop: 39.00 “RINGING 0:18”, 39.50 “0:19”, 40.00 “0:20” (one white flash, then nothing), 40.25 “0:21”.
- 40.0: “Nobody.” slams in (scale 1.2→1 over 6 frames).
- No camera move until 40.4, when a pull-back begins and carries into S19.

**On-screen text.** - y 300–345 and y 370–530: the frame-0 eyebrow and headline, dimming to 25% at 39.0.
- y 580–645, from 38.75: “So who picks up at 0:20?” (as in S01).
- y 670–770, from 40.0: “Nobody.” (Fraunces 600, 96 px, #eb5c5c, on the ink plate).
- y 1120–1200: “RINGING 0:18 → 0:21” (JetBrains Mono 500, 72 px, #eb5c5c). The caption band is free, since nobody speaks.

**Sound.** The SAME trill sample as frame 0, unchanged, at 38.5 and 40.0. Cradle rattle. A heartbeat on each counter tick (39.0, 39.5). It SKIPS at 40.0 (0:20): silence where an answer should have been, only the trill. It resumes at 40.25. Cicadas.

**Music.** No music.

### S19 · Twist · 0:40.5–0:42.5 (2.0s)

**Visual.** The camera keeps moving: it pulls back from the phone and pans right to the window, using the oversize Lobby set’s extended right side so no edge shows. Across the highway: the teal STARLITE ★ MOTOR COURT sign and, parked under it, RITA’S SEDAN. The binocular glint flashes again, now held for 6 frames, and a thin hand-drawn ivory ring (3 px, wobbly) circles the car. The red lobby frames the view in the foreground: the phone soft-focus at lower left, the brass bell, the LED clock. The question and “Nobody.” fade out over 40.6–40.9.

**Motion.** - Pull-back and pan over 40.5–41.3 (ease in-out, scale 1.06→0.92, x-pan +260 px).
- Glint at 41.4 for 6 frames. The ring draws over 41.4–41.8.
- 41.5: “Rita’s lobby.” SLAMS in (scale 1.2→1 over 6 frames, with a 1-frame white flash).
- The red counter keeps running at y 1120–1200: 40.50 “0:24”, 41.00 “0:29”, 41.50 “0:34”, 42.00 “0:41”.
- 42.1: it freezes and flips to “MISSED CALL” (mono, #eb5c5c), and the phone glow dies.
- Hard cut at 42.5.

**On-screen text.** - y 380–480: “Rita’s lobby.” (Fraunces 600, 96 px, red #eb5c5c, on an ink plate).
- The counter, then “MISSED CALL”, at y 1120–1200.

**Sound.** The same trill at 41.5, the last one (cadence 38.5 / 40.0 / 41.5). 42.1: a three-tone descending call-ended beep (1800 → 1400 → 950 Hz, 90 ms each). Then 0.4 s of dead air.

**Music.** No music.

### S20 · TheKnot · 0:42.5–0:46.5 (4.0s)

**Visual.** A vertical split in DETECTIVE-BOARD style, on an ink #0c1017 board with faint fibrous noise. The headline zone is y 290–500.

TOP PANEL (y 560–880): Rita’s FRONT DESK phone lock screen, generic OS. Big time “2:14”, and a notification card reading “Missed call” / “(928) 555-0147” / “2:13 AM”. A pinned tag above it at y 520: “Rita’s desk · 2:13 AM” (JetBrains Mono 28 px, #fa9e9e).

BOTTOM PANEL (y 960–1480): the Starlite’s HotelOne console in DARK theme, page Voice front desk → Messages, at the narrow layout rendered at 1.8× (about 490 CSS px wide, still below the sm breakpoint). A pinned tag above it at y 925: “The Starlite · inbox” (mono 28 px, #8ed7eb). The list is newest first, as the real API sorts it. The card (bg #131720, border #2b303b, divide-y) shows:
- Article 1, a 70 px strip at 30% opacity: “Rita · [Phone] Phone call · 2m ago” / “Rita says hi to Gus.”
- Article 2, the hero:
  - Header: “Sam Ortiz” (600, #f5f3f0), an outline sm badge “[Phone] Phone call” (#a4aab7) and “10m ago”.
  - Message, blurred to 40% except “Quoted total: $238.00”, which stays crisp: “Phone booking request: Queen Room, Fri, Oct 23 to Sun, Oct 25 (2 nights), 2 guests. Quoted total: $238.00. Confirm with the guest, then send them this link to finish booking.”
  - First row of ghost sm buttons in primary #30a7cf: “[Phone] +1 (928) 555-0147” (crisp) and “[Mail] sam.ortiz@example.com” (40%). The panel crops below this row.

**Motion.** - 42.5: the top panel slides in from above and the bottom from below (8 frames, ease [0.22,1,0.36,1]).
- 43.0: a red marker circle draws around “(928) 555-0147” on the lock screen. 43.25: the same around “+1 (928) 555-0147” in Sam’s row.
- 43.5–44.0: a 2 px red string (#eb5c5c, slight sag) draws from circle to circle, with a pin popping at each end.
- 44.0: the headline rises. 44.75: the second line rises.
- 45.5: the marker circles “Quoted total: $238.00”, and “$238.00” pops out giant (scale 0.6→1.08→1 over 8 frames) on an ink pill over the bottom panel, y 1170–1320.
- A slow push 100→106% throughout. Hard cut at 46.5.

**On-screen text.** - y 300–440, from 44.0: “Her 2:13 caller / tried Gus next.” (Fraunces 600, 64 px, ivory, two lines).
- y 455–500, from 44.75: “She watched it ring.” (Inter 600, 44 px, #fa9e9e). It sends rewatchers back to S02: the dash clock (2:14) and Sam’s row (10m ago at about 2:24) line up.
- From 45.5: “$238.00” (JetBrains Mono 500, 140 px, #eb5c5c).
- The pinned tags and the real UI copy as listed.

**Sound.** Panel whooshes at 42.5. Marker squeaks at 43.0, 43.25 and 45.4. A “zip” as the string draws (43.5–44.0), with a tick per pin. A soft sub thump at 44.0. At 45.5, a sub impact plus the dissonant saw stab (Dm♭9), decaying over about 1 s.

**Music.** The D drone (on its harmonics) under the board, plus the stab at 45.5.

**Claims.** phone-booking-request-team-confirms, messages-inbox, takes-a-message

### S21 · Morning · 0:46.5–0:48.0 (1.5s)

**Visual.** DAWN TIME-LAPSE inside Rita’s car (Rig A, pose asleep): head tilted on the headrest, binoculars on her chest. The steno pad has slipped to the floor mat, showing “$119?!” and “(I’m $129)”. Through the windshield the sky sweeps from ink #07090d through Lagoon #085f81 to ivory #fbfaf8. The Starlite sign outside flickers off. The whole palette flips from night to light, ending on HotelOne’s light tokens.

**Motion.** - The sky and grade transition over 46.5–47.5, sweeping upward from the bottom.
- The Starlite sign stutters off at 47.0 (3 frames).
- Sleep breathing at 0.2 Hz, ±3 px. A 1.5% push.
- The time label fades in at 46.7 on a pill whose colour crossfades from ink to ivory.
- Hard cut at 48.0.

**On-screen text.** y 300–380: “6:52 AM” (JetBrains Mono 500, 72 px): ivory on an ink pill first, ending as #111827 on an ivory pill.

**Sound.** Synth birdsong, a neon tick-off at 47.0, a faint car-roof creak, and morning room tone.

**Music.** The 20-second motif returns in D MAJOR (D5–A4–F♯5–E5) on warm FM e-piano at 46.5 / 47.0 / 47.5 / 48.0, over an Asus4 pad (A–D–E) held UNRESOLVED. The pizz is gone. The same melody, reframed, is the musical twist.

### S22 · Morning · 0:48.0–0:50.0 (2.0s)

**Visual.** 48.0–48.5: GUS (one desk rig: 40s, rolled sleeves, stubble) at the Starlite desk in morning light, a mug in his left hand and HIS PHONE in his right. There is no laptop: the narrow layout is then exactly the real UI. Gus at x 120–620, y 700–1400; the phone at x 520–760, y 820–1300.

The camera pushes into the phone screen: the HotelOne console in LIGHT theme at the real narrow (phone) layout, bg #fbfaf8, Voice front desk → Messages. It settles on a crop at an effective 3×, so text-sm renders at 42 px, on the top of the list (newest first):
- SegmentedControl sm “To handle · 2 | Done · 0” (track #f3f2ee, active pill #ffffff) near the top edge, at y about 420–500.
- A Card (bg #ffffff, border #e5e2dc). Article 1:
  - “Rita” (600, #111827), an outline sm badge “[Phone] Phone call” (#575d6b) and “5h ago”.
  - Message: “Rita says hi to Gus.” (text-sm, leading-relaxed, 42 px).
  - A ghost sm button “[Phone] +1 (928) 555-0163” in Lagoon #085f81, with the secondary sm “[Check] Mark done” (bg #f3f2ee) wrapping under it, as the real narrow CSS does.
- Article 2’s top edge (“Sam Ortiz …”) is visible below, cut by the frame.

**Motion.** - 48.0–48.5: push from the wide shot into the phone (scale 1→3.4, ease [0.22,1,0.36,1]).
- 48.5–50.0: hold for 1.5 s on Rita’s row with a 1% drift. A focus ring (2 px #085f81 at 30%) fades in on the row at 48.7.
- Hard cut at 50.0.

**On-screen text.** UI copy only.

**Sound.** A coffee sip at 48.05. The push whoosh. At 49.1, Gus snorts off-screen (a short breath SFX, not TTS).

**Music.** The Asus4 holds, with light e-piano fragments and no resolution.

**Claims.** takes-a-message, messages-inbox

### S23 · Morning · 0:50.0–0:51.0 (1.0s)

**Visual.** Over Gus’s shoulder (Gus a dark silhouette against the bright window) toward his office window in ivory morning light. Outside in the Starlite lot sits Rita’s sedan, with Rita asleep against the headrest and the dead neon sign above. Gus raises his mug toward the window.

**Motion.** The mug rises over 50.05–50.4 (ease-out). A 1.5% push. Hard cut at 51.0.

**On-screen text.** Caption (Gus, #7b420a on a brass-soft #fbf2e0 plate, brass underline) at y 1240: “Hi, Rita. 👋”

> **GUS:** Hi, Rita.

**Sound.** G01 50.10–50.92. Birdsong. A mug clink against the window glass at 51.0, bridging the cut.

**Music.** The motif once more, softly, on e-piano (D5 50.0, A4 50.5, F♯5 51.0, E5 51.5) over the held Asus4.

### S24 · Morning · 0:51.0–0:51.5 (0.5s)

**Visual.** Back on the phone, with the crop at 2.4× so the segmented control and both rows show. Gus’s thumb (a soft flat shape, no detailed hand) taps “[Check] Mark done” on Rita’s row. The row slides out, the SegmentedControl pill springs to “To handle · 1 | Done · 1”, and Sam’s row rises to the top.

**Motion.** - 51.05: the tap (button press to scale .98).
- 51.10–51.35: the row slides x −120 px and fades out.
- 51.30: the segment labels update (layoutId spring, bounce .18).
- 51.35–51.50: the list closes up with a spring.
- Cut at 51.5.

**On-screen text.** UI copy only: “To handle · 1 | Done · 1”.

**Sound.** A tap, a check tick at 51.05, and a soft swish as the row slides.

**Music.** The Asus4 still holds.

**Claims.** messages-inbox

### S25 · Morning · 0:51.5–0:54.5 (3.0s)

**Visual.** The phone at a 2.6× crop on Sam’s row, now first in the list. The phone’s top edge (status bar) sits at about y 380 in frame.
- “Sam Ortiz”, an outline sm badge “[Phone] Phone call” and “5h ago”.
- Message: “Phone booking request: Queen Room, Fri, Oct 23 to Sun, Oct 25 (2 nights), 2 guests. Quoted total: $238.00. Confirm with the guest, then send them this link to finish booking.”
- Ghost sm buttons in Lagoon #085f81, wrapping to two rows: “[Phone] +1 (928) 555-0147”, “[Mail] sam.ortiz@example.com”, “[Copy] Copy booking link”. The secondary “[Check] Mark done” sits below.
- From 52.55, a sonner toast at the top-centre of the phone screen (the real narrow position), y 400–490: bg #ffffff, border #e5e2dc, lifted shadow, a green CircleCheck #15754a and the text “Booking link copied — send it to the guest”.

**Motion.** - 51.5: text 1 rises.
- 51.75–52.15: a brass marker sweep (#cc8e24 at 30%) across “Quoted total: $238.00”.
- 52.5: Gus’s thumb taps “Copy booking link” (press to .98).
- 52.55: the toast slides down.
- 52.75: text 2 rises and holds to the end of the shot.
- 54.25–54.5: the phone scales to 92% and crossfades into the ivory end card.

**On-screen text.** - y 290–340, from 51.5: “2:14 AM caller. Total already quoted.” (Inter 600, 38 px, #111827).
- y 1215–1300, from 52.75, on an ivory plate, two lines: “Not booked yet: Gus confirms,” / “sends the link, and Sam books.” (Inter 600, 36 px, #111827). The caption band is free, since nobody speaks.
- The toast copy as listed.

**Sound.** A marker swipe at 51.75. A tap at 52.5. A soft bell at 52.5. The sonner toast pop at 52.55.

**Music.** 52.5: on the tap, the held Asus4 RESOLVES to D (Dadd9). Nothing resolves until a person acts. Light D-major e-piano comping follows, swelling into the end card.

**Claims.** phone-booking-request-team-confirms, messages-inbox

### S26 · EndCard · 0:54.5–1:00.0 (5.5s)

**Visual.** IVORY END CARD (#fbfaf8, light theme) in two beats. Everything sits in a centre column, x 105–905.

PERSISTENT (from Beat A to the iris):
- y 330–400: LogoMark 64 px (tile #085f81, keyhole #ffffff, threshold #cc8e24, rx 9/32) plus the Wordmark “Hotel” (Fraunces 400) and “One” (Fraunces 600), 56 px, #111827, 20 px gap.
- y 450–610: headline “If nobody picks up / in 20 seconds, it does.” (Fraunces 400, 68 px, leading 1.08, #111827).
- y 1350–1475: fine print, four lines (Inter 400, 24 px, leading 1.3, #575d6b), on screen from 54.9 to the iris:
  “Fictional story. Voice in English. Phone bookings are requests:”
  “your team confirms and sends a link; the guest books online.”
  “20-second forwarding is a mobile carrier code; landlines vary.”
  “The assistant’s own number and call minutes cost extra.”

BEAT A (54.5–57.0):
- y 1200–1290: the AI caption (Lagoon) with a 56 px VoiceOrb to its left (aurora #6133cc→#1c4cce, white Mic icon, radial sheen). This is the only violet on the card. It fades out at 57.6.

BEAT B (from 57.0), added under the headline:
- y 680–730: “Keep your number. Free to start.” (Inter 600, 40 px, #111827).
- y 790–890: a Lagoon lg button (bg #085f81, radius 18, h 100, padding 0 48) reading “Start free →” (Inter 600, 40 px, #ffffff), centred. “Start free” is the real marketing signup label.
- y 930–1000: “hotelone.site” (Inter 600, 60 px, #085f81), centred: the biggest type in Beat B.
There is no step card, no dial-code chip and no price on screen; those go in the IG caption.

**Motion.** - Elements fade up from y 10 to 0, staggered: logo 54.5 (its brass threshold bar draws over 8 frames from 54.55), headline 54.7, orb and caption 54.8, fine print 54.9.
- Beat B: the line at 57.0, the button at 57.1, the URL at 57.2 (3-frame stagger).
- The button breathes (scale 1→1.02 over 1 s). The orb scales with the voice level and pings on “I will”.
- 59.75–60.0: the LogoMark keyhole (bow r 5 at 16,11.5 plus the stem path, from LOGO_GEOMETRY) scales 1→40× as an iris mask, opening onto S27.

**On-screen text.** All end-card copy as listed. AI caption (Lagoon #085f81 with the AudioLines glyph) at y 1240: “If nobody picks up” → “in 20 seconds…” → “I will.”

> **AI FRONT DESK (phone band → full range):** If nobody picks up in twenty seconds… I will.

**Sound.** A soft bell on the logo at 54.5. AI05 54.98–57.43: “If nobody picks up” 54.98–55.90, “in twenty seconds…” 55.90–56.78, “I will.” 57.00–57.43. bandSweep() opens the phone band to full range over 56.4–57.0, landing on “I will”, so the voice steps out of the phone into the room.

**Music.** The full motif on e-piano doubled by celesta in D major (D5 55.0, A4 55.5, F♯5 56.0, E5 56.5). An A7sus → A → Dadd9 cadence lands on “I” at 57.0 and rings out, with light comping under Beat B. The iris cuts the music at 59.75.

**Claims.** answers-unanswered-calls-20s, keep-your-number, start-free, setup-caveats, phone-booking-request-team-confirms

### S27 · Stinger · 1:00.0–1:02.5 (2.5s)

**Visual.** The keyhole iris opens directly onto GUS’S BINOCULAR POV from the Starlite. There is no black title card. These lenses have a TEAL rim fringe and a calmer 1 px drift. We look across the highway at RITA’S MOTOR INN: the red neon arrow sign at top-left and her red-lit office window, with the S01 lobby props seen from outside. Her FRONT DESK phone glows white and buzzes on the counter. The roles are reversed.

The final frame (frame 1874) holds the counter at “0:19” with the phone mid-glow. The loop then hard-cuts straight into frame 0: the same red lobby, the same “2:13 AM”, the same trill sample. Rita’s frame-0 line, “Nobody works nights at the Starlite.”, now plays as her deflection of Gus’s question.

**Motion.** - 60.05–60.4: the label types on in 16ths and holds for the whole stinger.
- The counter jump-cuts: 60.0 “0:17”, 60.75 “0:18”, 61.5 “0:19”, then freezes.
- The phone glow pulses with the muffled trill at 61.0.
- No fade-out: the cut at 62.5 is the loop.

**On-screen text.** - y 290–340: “Next night · 2:13 AM” (JetBrains Mono 500, 44 px, ivory).
- Counter: label “RINGING” (mono 26 px, #fa9e9e) at y 380–410; value (JetBrains Mono 500, 140 px, ivory) at y 420–560.
- Caption (Gus, brass #f4d07b on an ink plate) at y 1240: “Who’s answering” → “yours, Rita?”

> **GUS:** Who’s answering yours, Rita?

**Sound.** - Rita’s trill once at 61.0, muffled by distance and glass (LP 1.2 kHz, −14 dB, a further −6 dB under G02).
- Ticks on each counter jump.
- G02 60.55–62.09, low (“Who’s answering” 60.55–61.45, “yours, Rita?” 61.45–62.09).
- 62.1–62.5: cicadas only. The last 40 ms fade to nothing. The next trill (61.0 + 1.5) is frame 0’s full-level attack, and the cicada tail absorbs any AAC/IG loop gap.

**Music.** Silence 60.0–60.25. Then the motif in MINOR on the muted celesta (D5 60.25, A4 60.75, F5 61.25, E5 61.75, decayed by 62.2), unresolved, ducked under G02, so the loop plays as a recurrence.

## Music

Original synthesised score in D minor on a 120 BPM grid: beat = 0.5 s = 15 frames, 8th = 0.25 s. Every cut lands on a beat. No vocals, no licensed audio. Audio events sit sample-exact at the listed times; visual marks snap to round(t×30).

PALETTE (built to survive phone speakers and not sound like chiptune):
- Karplus-Strong pizzicato with body formants at about 250, 450 and 900 Hz, plus a short room.
- Modal celesta and bells: inharmonic partials ×1, 2.76, 5.4 and 8.9, with a hammer-noise transient.
- Additive felt piano: stretched partials, a low-passed noise hammer and per-partial decay.
- Warm FM e-piano and a soft pad.
- Heartbeat: a 55 Hz sine plus a saturated 110–120 Hz layer and a soft 2–4 kHz beater tick, so it reads on a phone.
- Drone: D1, tanh-saturated, then high-passed at 60 Hz so it lives on 73/110/147 Hz, with a 180–250 Hz body layer.
- Dry clock tick, Shepard riser and synth birdsong.
- Stab: an honest synth stab, a 7-saw detuned stack through a fast-closing 24 dB low-pass, plus a plate.

THE 20-SECOND MOTIF: four quarter notes, D5–A4–F5–E5, with E5 held. Gus’s ringtone is its first two notes (D5–A4) on a soft FM chime, so the motif is literally his phone. Rita’s ringtone is an unmusical old desk-bell trill (1.1 + 1.62 kHz, 20 Hz AM, 0.6 s, one trill every 1.5 s). It is the frame-0 sound and the loop seam.

0.0–3.0 (S01): no music. The drone starts at −30 dB on frame 0 with no fade-in, under cicadas, far highway hum and 60 Hz neon buzz. The trill plays at full level at 0.0. The 1.5 trill is ducked −9 dB with a −6 dB high-shelf above 1 kHz so it doesn’t mask R01.
3.0–5.5 (S02): the pulse is the heartbeat plus a clock tick on every counter jump. Gus’s chime plays through his office glass (glass(): LP 1.2 kHz plus a 40 ms slap, −12 dB) at 3.0, 4.0, 4.5 and 4.875, speeding up with the counter. At 5.0 (0:20) the last chime is cut 125 ms in, between D5 and A4, the heartbeat stops and only cicadas remain.
5.5–7.0 (S03): cicadas. One KS pizz D2 at 6.5 (−24 dB) foreshadows the ostinato.
7.0–9.0 (S04): pizz pulse on D2 quarters at −28 dB. A reversed-cymbal swell runs 8.4→9.0.
9.0–11.0 (S05): a low D boom (on its harmonics) at 9.0. FIRST FULL MOTIF on celesta: D5 9.0, A4 9.5, F5 10.0, E5 10.5 held, over a D-minor pad (D3–F3–A3). The pizz continues, all ducked under R05.
11.0–12.5 (S06): the pad sustains and the pulse drops out. Call blip at 12.05.
12.5–15.5 (S07): a Shepard riser 12.5→15.48. The heartbeat accelerates on the grid: quarters 12.5–13.5, 8ths 13.5–15.0, 16ths 15.0–15.375. One US ringback burst (440+480 Hz, phone band) plays 12.6–14.6 in Rita’s ear while Gus’s glass-muffled chime rings at 12.5, 13.5 and 14.5, so we hear both ends of one call. Truck doppler 12.8–13.5. CLICK at 15.48, then a HARD MUTE of everything at 15.5.
15.5–20.25 (S08–S10): near-silence. One E6 sine starts at −34 dB on the click, ducks to −44 dB from AI01’s first word (15.75) and is gone by 20.0. Cicadas. The AI voice is alone.
20.25: A3 pizz pickup. 20.5: the HEIST OSTINATO enters on the downbeat. Per 4-beat phrase: 8th-note staccato KS pizz D3 D3 F3 D3 A3 D3 F3 E3, a muted wood tick on offbeats, and pizz bass on beats 1 and 3. Ducked −8 dB under speech (12 ms attack / 320 ms release).
26.5–28.5 (S12 tail–S13): it thins to bass plus tick under “Just a few hours, cash?”.
28.5–31.5 (S14): it brightens to a D-minor add9 voicing, with the celesta motif on top at 29.0/29.5/30.0/30.5 under the UI ticks, ducked under AI03.
31.5–35.875: pizz plus bass, thinning under AI04. It STOPS DEAD on Rita’s hang-up CLICK at 35.875 (a 16th that chops “they’ll”).
35.875–37.0: silence and cicadas under “Show-off.”
37.0–38.5 (S17): one felt-piano D2 at 37.0 with a long tail. A reverse-reverb pre-echo of the trill swells 37.9→38.5 into the smash cut. It is non-diegetic: her phone is not ringing at this point in the story.
38.5–42.5 (TWIST): NO music. The identical trill sample plays at 38.5, 40.0 and 41.5. A heartbeat lands on each counter tick (39.0, 39.5) and SKIPS at 40.0 (0:20): silence where an answer should have been, under “Nobody.”. It resumes at 40.25. At 42.1 a three-tone descending call-ended beep, then 0.4 s of dead air.
42.5–46.5 (S20): the drone returns (harmonics). Panel whooshes, marker squeaks, a zip as the string draws with pin ticks, and a soft sub thump at 44.0 under the headline. At 45.5 a sub impact and a dissonant saw stab (D–F–A–E♭, Dm♭9) hit on the giant “$238.00”, decaying over about 1 s.
46.5–48.0 (DAWN): the motif in D MAJOR (D5–A4–F♯5–E5) on warm e-piano at 46.5/47.0/47.5/48.0, over an Asus4 pad (A–D–E) that is HELD unresolved, with synth birdsong. The pizz is gone.
48.0–52.5: the Asus4 keeps hanging under the inbox, “Hi, Rita.” and Mark done, with light e-piano fragments that never resolve. The motif plays once more, softly, at 50.0/50.5/51.0/51.5 under and after “Hi, Rita.”. Mug clink at 51.0, mark-done tick at 51.05.
52.5: Gus taps “Copy booking link” and the suspension RESOLVES to D (Dadd9: D–F♯–A–E), with a soft bell and the toast pop. This is the musical rule: nothing resolves until a person acts. 52.5–54.5: light D-major e-piano comping swells into the end card.
54.5–60.0 (END CARD): a bell on the logo at 54.5. The full motif plays on e-piano doubled by celesta (D5 55.0, A4 55.5, F♯5 56.0, E5 56.5). An A7sus (56.0) → A (56.5) → Dadd9 cadence lands on the “I” of “I will” at 57.0 and rings out, with light comping under Beat B.
59.75: the keyhole iris cuts the music. 60.0–60.25 silence.
60.25–62.5 (STINGER): the motif returns in MINOR on the muted celesta: D5 60.25, A4 60.75, F5 61.25, E5 61.75 (unresolved, decayed by 62.2), ducked under G02. Rita’s trill plays once at 61.0 through glass (LP 1.2 kHz, −14 dB, a further −6 dB under G02), with ticks on the counter. The last 0.4 s is cicadas only. The trill cadence (61.0 + 1.5) lands on the loop’s frame-0 trill attack at 62.5, and the cicada tail absorbs the 20–150 ms AAC/IG restart gap, so the seam survives delivery.
MIX: VO gated RMS −19 dBFS, voice bus pre-limited at −9 dBFS, MUSIC 0.2, SFX 0.85, ambience 0.2, master +5.5 dB into a −1.5 dBFS look-ahead limiter, about −15 LUFS, true peak ≤ −1 dBTP after AAC. The hard mutes at 15.5 and 35.875 are part of the arrangement.

## Captions

- Burned in for every spoken line: Inter 600, 52 px, font-feature-settings cv11/ss01/ss03, 2–4 words per chunk (at most 24 characters), one line.
- Centred on x 505 in the band y 1200–1300 (max width 800 px, x 105–905), clear of the Reels UI (top 270 px, bottom 380 px, right 140 px). Paid renders (placement = 'paid') move the band to y 1000–1100.
- EXCEPTION, S01: Rita’s first line has no caption plate. The frame-0 headline “Nobody works nights / at the Starlite.” IS its caption, word-lit: each word gets the 4 px brass underline as she speaks it. No words are dimmed, so frame 0 stays a full-contrast still.
- Plates: rounded-12 with 20/10 px padding; rgba(7,9,13,0.72) at night, rgba(251,250,248,0.92) by day.
- Speaker coding:
  - RITA: ivory #f5f3f0.
  - AI FRONT DESK: teal #8ed7eb at night, Lagoon #085f81 by day. Every AI chunk opens with a 28 px AudioLines glyph, so viewers always know which voice is the product.
  - GUS: brass #f4d07b at night, #7b420a on brass-soft #fbf2e0 by day.
- Active word: full opacity plus a 4 px underline in the speaker colour (the logo’s brass threshold bar, reused). Other words sit at 70%.
- Each chunk pops in from scale 0.92 to 1 over 4 frames (ease [0.22,1,0.36,1]).
- Chunk boundaries come from vo.ts offsets measured on the rendered clips (one clip per sentence, plus RMS pause snapping), never from character counts.
- Numerals for prices, seconds and dates: “20 seconds.”, “Friday the 23rd,”, “is $119.”, “in 20 seconds…”. Story words stay words (“Four nights”).
- One emoji only: 👋 on Gus’s daytime “Hi, Rita.” (Noto Color Emoji, installed). No emoji in the night scenes.
- Chunk list:
  - R01 = the S01 headline.
  - R02 “20 seconds.”
  - R03 “And nobody’s” → “in there.”
  - R04 “Four nights” → “I’ve watched.”
  - R05 “Gus can’t afford” → “a night clerk.”
  - R06 “Neither can I.”
  - R07 “Come on, Gus.” → “Pick up.”
  - AI01 “Starlite Motor Court,” → “AI front desk.” → “How can I help?”
  - R08 “Sure it is, Gus.”
  - R09 “Got a room Friday,” → “for two?”
  - AI02 “We do.” → “Friday the 23rd,” → “a queen room” → “is $119.”
  - R10 “Just a few hours,” → “cash?”
  - AI03 “Sorry —” → “we don’t offer” → “day-use rooms.”
  - R11 “…That’s Gus’s rule.”
  - R12 “Rita says hi.”
  - AI04 “I’ve passed that” → “to the team — they’ll—”
  - R13 “Show-off.”
  - G01 “Hi, Rita. 👋”
  - AI05 “If nobody picks up” → “in 20 seconds…” → “I will.”
  - G02 “Who’s answering” → “yours, Rita?”
- Placement rules: kinetic headlines stay in y 290–700 and counters in y 370–1200, so captions never collide with them. Kinetic text uses the caption band only when nobody is speaking (S18 counter, S25 “Not booked yet…”).

## Cover frame

A custom cover for the grid, the Reels tab and DM shares. Everything that matters sits inside the central 3:4 crop (y 240–1680) and inside x 90–930. There is no logo: the account itself is HotelOne, and the cover should read as an episode, not an ad.
- Background: Rita’s binocular POV (two soft circles) of the TEAL Starlite lobby, with Gus’s FRONT DESK phone glowing #e0f7ff on the empty counter and a faint red rim of Rita’s world at the frame edges.
- Top (y 330–375): “ACROSS THE STREET · EP. 1” (Inter 600, 30 px, tracking 0.12em, brass #e1ae47).
- Centre (y 420–700): “WHO PICKS UP / AT 0:20?” (Fraunces 600, 100 px, ivory #f5f3f0, two lines; “WHO PICKS UP” measures about 750 px, inside the 840 px safe width).
- Bottom (y 1180–1340): “2:13 AM” (JetBrains Mono 500, 120 px, teal #8ed7eb) on an ink pill.
- Static 1–2% dither and a vignette.
The feed autoplay thumbnail is frame 0: Rita’s red lobby with “2:13 AM / Nobody works nights at the Starlite.”. The cover asks the same question as the hook, and the two images pair as red and teal across a series grid.

## Instagram post

Nobody works nights at the Starlite. So who picks up at 0:20? 👀

Across the Street, Ep. 1: a fictional story about two motel owners, one highway and one phone.

Missed calls are missed bookings. HotelOne is an AI front desk for independent hotels and motels. You keep your number and forward the calls you miss. On a mobile, **61*<assistant number>*11*20# sends any call nobody answers within 20 seconds. On a US landline, *72 forwards every call, or ask your carrier for “forward when unanswered” (codes vary by carrier). It answers with your real prices and house rules, always tells callers it’s a virtual assistant, and leaves booking requests and messages in your inbox. Phone bookings are requests: your team confirms, sends the link, and the guest books online.

Free to start, no card needed → hotelone.site
The assistant needs its own number (about $1.15/mo in the US) plus call minutes. Voice is English only. Plans and pricing at hotelone.site.

Be honest: did you clock it before 0:38? 👇 (Ep. 2: Rita’s turn.)

#motelowner #hotelowner #innkeeper #independenthotel #hospitalitylife

## Claims and evidence

| Claim | Said in the ad | Evidence (on the latest app branch) |
| --- | --- | --- |
| ai-disclosure | Spoken (S08–S09): “Starlite Motor Court, AI front desk. How can I help?” IG caption: “always tells callers it’s a virtual assistant”. | src/server/voice/sessions.ts L229–234, phoneGreeting(): “Callers are always told they’re talking to a virtual assistant, whatever greeting the hotel set.” A custom greeting is used verbatim only if it matches /virtual assistant\|\bAI\b\|automated/i; “AI front desk” matches \bAI\b, so this greeting plays word for word. A greeting that doesn’t match gets “Just so you know, I’m the hotel’s virtual assistant.” appended. L273 sets it as the phone agent’s firstMessage. src/server/voice/live.ts L542: “If asked, say you are the hotel’s virtual assistant.” |
| answers-unanswered-calls-20s | On screen: “So who picks up at 0:20?” (S01, S18) and “If nobody picks up / in 20 seconds, it does.” (S26). Spoken: “If nobody picks up in twenty seconds… I will.” Shown: Gus’s phone stops ringing at 0:20 and the voice answers. Fine print: “20-second forwarding is a mobile carrier code; landlines vary.” | src/app/admin/voice/PhoneLine.tsx L386–402, step 3. DialCode “**61*{number}*11*20#”, labelled “Mobiles: forward calls nobody answers within 20 seconds”. “*72 … US landlines: forward every call”. Note: “Codes vary by carrier (Verizon uses its own). Your carrier or phone system can also set ‘forward when unanswered’ for you.” Both front-desk phones are drawn as smartphones in cradles, so the 20-second behaviour shown is literally the mobile code. src/server/voice/elevenlabs.ts gives each hotel its own phone agent. PHONE_TOOLS are in src/server/voice/live.ts L297. |
| keep-your-number | End card: “Keep your number. Free to start.” In the story, Rita dials the Starlite’s own front-desk number and the assistant answers. IG caption: “You keep your number and forward the calls you miss.” plus the codes. | src/app/admin/voice/PhoneLine.tsx L386: step title “Keep your hotel number — forward calls to the assistant”. L222: “Keep your number: forward the calls you can’t pick up.” L389–399: the dial codes and labels. |
| real-prices-from-live-data | Spoken: “We do. Friday the twenty-third, a queen room is a hundred nineteen.” (caption “is $119.”). On screen (S14): “His prices. His rules.” and a rate cell reading “23 · $119 · 7/12 sold” under “Queen Room · Fri”. | src/server/voice/live.ts backend rules: “Facts come only from tools. Never invent prices, availability, amenities or policies.” and “Quote exact prices from check_availability” (L558–559). The phone prompt also says “Say prices as natural amounts”. L532: “Repeat dates back before acting on them”, which is why the voice reads back “Friday the twenty-third”. CHECK_AVAILABILITY is in PHONE_TOOLS (L297). The House rules hint in src/app/admin/voice/page.tsx L306 reads “It still can’t invent prices or availability.” src/app/admin/rate-calendar/page.tsx L436–461: the cell shows whole(price) (“$119”) at sm and up, an occupancy bar and “{sold}/{total} sold”; the dot appears only when isCustom, so none is drawn. The $119 Queen Room, 7/12 sold and the date are fictional story data. |
| house-rules | Spoken: “Sorry — we don’t offer day-use rooms.” On screen: “Gus typed it once.” The House rules field shows “We don’t offer day-use rooms.” (highlighted), then “Dogs under 30 lb are welcome for $25 a night.” and “Quiet hours start at 10 PM.” (dimmed). Rita: “…That’s Gus’s rule.” | src/app/admin/voice/page.tsx L306: Field “House rules”, hint “Anything the voice should always do or never say. It still can’t invent prices or availability.” L219: the save toast “Voice settings saved — new calls use them right away”. src/server/voice/live.ts L570 adds “House rules from the hotel:\n{houseRules}” to the backend instructions. The first two rule lines match the seed wording in prisma/seed.js L373. The third is a quiet-hours rule that doesn’t need saying on every call, so none of the AI’s three spoken lines breaks a rule shown on screen. The voice is not claimed to quote house rules word for word. |
| takes-a-message | Spoken: “I’ve passed that to the team — they’ll—”, cut off by Rita’s hang-up. Inbox row: “Rita · Phone call · 2m ago / 5h ago · Rita says hi to Gus.” | src/server/voice/guestTools.ts L112–118: leave_message saves a guestRequest with the caller ID as the callback number and says “I’ve passed that to the team — they’ll get back to you.” src/server/voice/live.ts L238–250: LEAVE_MESSAGE, “Pass a message or callback request to the hotel team”. L247: the saved text is the model’s own summary (“What the guest needs, in one or two sentences”), hence “Rita says hi to Gus.” |
| phone-booking-request-team-confirms | Inbox row: “Phone booking request: Queen Room, Fri, Oct 23 to Sun, Oct 25 (2 nights), 2 guests. Quoted total: $238.00. Confirm with the guest, then send them this link to finish booking.” On screen: “$238.00” (S20); “2:14 AM caller. Total already quoted.” and “Not booked yet: Gus confirms, / sends the link, and Sam books.” (S25). Toast: “Booking link copied — send it to the guest”. Fine print: “Phone bookings are requests: your team confirms and sends a link; the guest books online.” | src/server/concierge/shared.ts L132: “Nothing is booked until the guest finishes online”. L134–157, submitBookingRequest, with the message format at L146: “Phone booking request: {room}, {formatDay weekday} to {…} ({n} nights), {g} guests. Quoted total: $X.XX. Confirm with the guest, then send them this link to finish booking: {link}”. The spoken say-text adds “It isn’t booked until then.” src/server/dates.ts L58–66: formatDay ‘weekday’ gives “Fri, Oct 23”. src/server/voice/live.ts REQUEST_BOOKING: “The team confirms it and sends the guest a link to finish booking online — it is not booked until then. Never take card details by phone.” src/app/admin/voice/page.tsx L376–382: bookingLink() strips the URL and turns the trailing colon into a period. guestTools.ts uses the caller ID as the phone number, giving the “+1 (928) 555-0147” button. Name and email are requested per live.ts L561. $119 × 2 nights = $238.00, matching the quoted rate. |
| messages-inbox | UI copy: “Voice front desk”, “To handle · 2 \| Done · 0”, “Phone call”, “2m ago”, “10m ago”, “5h ago”, “+1 (928) 555-0147”, “Copy booking link”, the toast “Booking link copied — send it to the guest”, “Mark done”, then “To handle · 1 \| Done · 1”. Rita’s newer row is listed above Sam’s. | src/app/api/admin/voice/requests/route.ts L14: orderBy [{status:'desc'},{createdAt:'desc'}], so the newest open message is first, and page.tsx L427–429 keeps that order. src/app/admin/voice/page.tsx: L384 SOURCE PHONE label “Phone call”; L440–441 SegmentedControl “To handle · N” / “Done · N”; L496 the toast; L502 “Copy booking link”; L509 “Mark done”; L566–567 the title “Voice front desk”. src/lib/format.ts L56–65: timeAgo gives “2m ago” and “10m ago” for 2:22 and 2:14 viewed at about 2:24, and “5h ago” for both at 6:52 (Math.round(4.5) and Math.round(4.63) are both 5). L108–119: formatPhone. src/components/Providers.tsx: sonner sits top-center on narrow screens, which is why Gus uses his phone, not a laptop. |
| missed-calls-line | IG caption: “Missed calls are missed bookings.” | src/app/page.tsx L106, FEATURES Voice front desk lead: “Missed calls are missed bookings. This clerk never sleeps and never puts anyone on hold.” |
| start-free | End card: button “Start free →”, the line “Keep your number. Free to start.”, and “hotelone.site”. IG caption: “Free to start, no card needed → hotelone.site” and “Plans and pricing at hotelone.site.” | src/components/Navigation.tsx L75: the marketing signup label is ‘Start free’. src/app/page.tsx L189 FAQ: “Nothing up front. Start free, no card needed, and only pay when you go live.” L251: hero chips “Free to start”, “No card needed”, “Keep your current system”. No price is stated in the ad, because pricing exists only as landing copy and there is no billing code. |
| setup-caveats | Fine print: “Fictional story. Voice in English. Phone bookings are requests: your team confirms and sends a link; the guest books online. 20-second forwarding is a mobile carrier code; landlines vary. The assistant’s own number and call minutes cost extra.” IG caption: “The assistant needs its own number (about $1.15/mo in the US) plus call minutes. Voice is English only.” | src/app/admin/voice/PhoneLine.tsx L349: “a local number from Twilio — about $1.15 a month in the US.” L389–402: the mobile 20-second code, US landline *72 forwards every call, and “Codes vary by carrier”. L418: “Calls cost about $0.08–0.10 a minute in ElevenLabs, plus your phone provider’s rate.” src/server/voice/elevenlabs.ts L194 and L320: language: 'en'. src/server/concierge/shared.ts L132: “Nothing is booked until the guest finishes online”. |

## Production notes

BUILD TARGET
- Package: marketing/instagram-reel. Composition id “Reel”, 1080×1920, 30 fps, 1875 frames (62.5 s). Output: out/hotelone-reel.mp4.
- One dependency-free src/reel/timeline.ts on a 120 BPM grid (BEAT = 15 frames). Every cut is on a beat, so every cut is a whole frame: 0, 3.0, 5.5, 7.0, 9.0, 11.0, 12.5, 15.5, 17.5, 18.5, 20.5, 24.0, 27.0, 28.5, 31.5, 33.0, 37.0, 38.5, 40.5, 42.5, 46.5, 48.0, 50.0, 51.0, 51.5, 54.5, 60.0, 62.5.
- The file holds:
  - SHOTS[{id, scene, from, to}] (the 27 shots above);
  - CLIPS[{id, at}] with the start times listed below;
  - MARKS (counter steps, clicks, mutes, glints, the 52.5 copy tap, the 35.875 hang-up);
  - wordAt() for caption and SFX sync.
- Visual marks snap to round(t×30). Audio events are placed sample-exact. Visuals, captions and the mixer all import this one file.

VO, MEASURED (kokoro_onnx 0.6.1, model_quantized.onnx; trimmed speech length → placement)
Rita = af_nicole at 1.05; AI = af_heart at 1.0; Gus = am_michael at 1.0; all lang en-us. One clip per sentence, butted with 0.10–0.15 s gaps.
- R01 “Nobody works nights at the Starlite.” 2.57 s → 0.70–3.27
- R02 “Twenty seconds.” 0.99 → 3.90–4.89
- R03 “And nobody’s in there.” 1.34 → 5.60–6.94
- R04 “Four nights I’ve watched.” 1.77 → 7.20–8.97
- R05 “Gus can’t afford a night clerk.” 1.80 → 9.10–10.90
- R06 “Neither can I.” 0.92 → 11.05–11.97
- R07a “Come on, Gus.” 0.97 → 13.55–14.52; R07b “Pick up.” 0.64 → 14.70–15.34
- AI01a “Starlite Motor Court, AI front desk.” 2.21 → 15.75–17.96 (internal pause at +1.00); AI01b “How can I help?” 0.87 → 18.11–18.98
- R08 “Sure it is, Gus.” 1.06 → 19.15–20.21
- R09 “Got a room Friday, for two?” 1.76 → 20.60–22.36
- AI02a “We do.” 0.53 → 22.55–23.08; AI02b “Friday the twenty-third, a queen room is a hundred nineteen.” 3.17 → 23.23–26.40 (pause at +1.13; caption “$119”)
- R10 “Just a few hours, cash?” 1.55 → 26.60–28.15
- AI03a “Sorry —” → 28.80–29.26; AI03b “we don’t offer day-use rooms.” → 29.37–30.81. Split into two clips so cutdowns can drop “Sorry —”.
- R11 “That’s Gus’s rule.” 1.25 → 31.70–32.95 (the caption adds “…”)
- R12 “Rita says hi.” 1.04 → 33.10–34.14
- AI04 “I’ve passed that to the team — they’ll get back to you.” 2.41, played from 34.25. “they’ll” starts at +1.49 (34.25 + 1.49 = 35.74). It is hard-cut at 35.875.
- R13 “Show-off.” 0.69 → 36.25–36.94
- G01 “Hi, Rita.” 0.82 → 50.10–50.92
- AI05 “If nobody picks up in twenty seconds… I will.” 2.45 → 54.98–57.43 (pause at +1.80; “I will” lands at 57.00)
- G02 “Who’s answering yours, Rita?” 1.54 → 60.55–62.09
Test renders: /tmp/claude-0/-home-user-mot/5bf4cf1f-e547-5909-98d3-fa44e39531b5/scratchpad/reelprobe/v2/out/*.wav. Scripts: m2.py and m3.py in the same v2 folder. Earlier probes are in reelprobe/out.
Rita’s budgets use af_nicole, the slowest candidate. For comparison, af_sarah and af_bella read R01 in 1.82 s and 1.77 s.

VO PIPELINE
1. Write src/reel/script.json with one entry per CLIP (id, speaker, text, caption text).
2. Run make-voice.py with /tmp/claude-0/-home-user-mot/5bf4cf1f-e547-5909-98d3-fa44e39531b5/scratchpad/kokoro/.venv/bin/python -I, the model at …/scratchpad/kokoro/model_quantized.onnx and voices at …/scratchpad/kokoro/voices.npz, with output paths changed to public/reel/vo and src/reel/vo.ts.
3. Post-process Rita’s clips with the ageing shift: ffmpeg asetrate=24000*0.917,aresample=24000,atempo=1.0905.
4. Snap word and chunk offsets to RMS pauses (10 ms hop, gate 0.006, minimum gap 80 ms) and write them to vo.ts. Captions, the S14 “day-use” highlight, the S16 hang-up and the S26 cadence all read these measured offsets, never character-count estimates.
5. Before locking, blind-test Rita in af_nicole, af_sarah and af_bella (all aged) at phone-speaker volume. Start times stay fixed whichever voice wins.

SCENE FILES (src/reel/scenes/)
- ColdOpen.tsx (S01)
- Binoculars.tsx (S02–S03)
- Stakeout.tsx (S04)
- Geography.tsx (S05)
- TheCall.tsx (S06–S07)
- WhoAnswers.tsx (S08–S10)
- Interrogation.tsx (S11–S13)
- ConsoleDive.tsx (S14)
- RitaSaysHi.tsx (S15–S16)
- Mirror.tsx (S17)
- Twist.tsx (S18–S19): it reuses the ColdOpen set, props, text block and crop transform verbatim, so frame 1155 is pixel-identical to frame 0.
- TheKnot.tsx (S20)
- Morning.tsx (S21–S25)
- EndCard.tsx (S26)
- Stinger.tsx (S27)
src/reel/Reel.tsx maps each scene to a <Sequence> (hard cuts), with global overlays on top: Grade/Vignette, Dither/Grain, Captions, and <Html5Audio src=reel/mix.wav> when withAudio. It takes a placement prop, 'organic' | 'paid'.

REUSABLE COMPONENTS
- set/Lobby.tsx: ONE motel lobby (counter, cradle phone, brass bell, register, key rack, LED clock, window, door glass), drawn oversize at ≥1440×2100 units with the window side extended right. Props: {tint: 'red'|'teal', label: 'tape'|'printed', windowView, phoneState: 'ringing'|'dark'|'missed', screenNumber, crop}. It serves Rita’s lobby (S01, S18, S19, and S27 seen from outside) and the Starlite (S02, S03, S07, S08). Sharing it halves the illustration cost and is what makes the misdirect work.
- set/Highway.tsx: the S05 crane, with a vertical receding road between the two lots, the signs facing each other, neon flicker and the 1 Hz missed-call pulse. Also the S27 background.
- set/CarInterior.tsx: windshield view, dash clock, steno pad (handwriting stroke-draw for “20s”, “Fri 23”, “$119?!”, “(I’m $129)”), thermos and rearview mirror.
- char/Rita.tsx, TWO rigs only:
  - RigA, a 3/4 medium close-up in the car, with layered lids, brows, a mouth line, a glasses glint and arm/binocular groups. Poses: binocularsUp, lowerBinoculars, eyebrowRaise, smirk, headTilt, toss, sip, asleep. It covers S04, S10, S11, S13, S15, S16, S17 and S21.
  - RigB, a profile silhouette, for S07.
  - At night, faces stay mostly silhouette, with a teal rim and green under-light. S09 is a glasses-reflection close-up with no face. S12 shows only a pen tip and a cuff silhouette.
- char/Gus.tsx: one desk rig (phone in the right hand, mug in the left, mugRaise), plus a backlit silhouette for S23.
- fx/Binoculars.tsx: double or single circle mask, Perlin drift, chromatic fringe, rim colour (red/cyan for Rita, teal for Gus).
- fx/Grade.tsx: the red/teal split grade, plus the night→light flip.
- fx/Dither.tsx: static 1–2% per-pixel dither baked into gradients. Grain.tsx: animated grain at ≤1%, mid-tones only, refreshed every 6 frames.
- fx/HeadlightSweep.tsx, fx/LensGlint.tsx, fx/RedString.tsx (marker circles, sagging string, pins), fx/ParticleDive.tsx (speaker grille → particles → card), fx/KeyholeIris.tsx (LOGO_GEOMETRY copied from src/components/brand/Logo.tsx).
- ui/Counter.tsx: a jump-cut mono counter with label and colour variants (ivory, teal, red) and a “MISSED CALL” state.
- ui/GenericPhone.tsx: incoming call, contact card, calling, lock screen with missed-call notification. No OS branding.
- hotelone/: faithful rebuilds driven by CSS variables from globals.css (:root and .dark), rendered through Screen() with CSS zoom at the real narrow (below-sm) layout. Includes:
  - LogoMark and Wordmark;
  - Badge (outline sm) and Button (default, secondary, ghost sm, lg);
  - SegmentedControl (layoutId spring);
  - HouseRulesField (Field label, hint and Textarea, dark), shown as a crop of the How it sounds card;
  - RateCell (sm-and-up rendering: day number, whole() price, occupancy bar, “x/y sold”, dot only if isCustom);
  - MessagesList and MessageRow (newest first, the real bookingLink() stripping, narrow wrapping of Mark done);
  - SonnerToast (top-center on narrow);
  - VoiceOrb (used on the end card only).
  VoiceStatus, PhoneLineStep and DialCode are no longer used.
- Captions.tsx: speaker-coded per the captions style, plus a headline word-lit mode for S01.

AUDIO
- Fork make-call-audio.ts into scripts/make-reel-audio.ts, keeping its voice, duck and master blocks.
- Chains:
  - phoneBand(): HP 320, 2× LP 3300, tanh, noise. Used for AI01–AI04, the AI05 start and the ringback.
  - glass(): LP 1.2 kHz plus a 40 ms slap. Used for Gus’s chime in S02 and S07 and the stinger trill. It replaces the old acrossRoad(), because Rita is parked in Gus’s lot.
  - bandSweep(): automates HP/LP from the phone band to full range over 56.4–57.0.
- Hard-mute windows: score 15.5–20.25 (only the E6 sine plays), and everything except ambience 35.875–37.0. Heartbeat skip at 40.0.
- The trill is a single generated buffer, reused at 0.0, 1.5 (ducked), 38.5, 40.0, 41.5 and 61.0 (glass). The cadence continues across the loop seam.
- Synthesis per the palette: Karplus-Strong pizz with body formants, modal celesta, additive felt piano, FM e-piano, and an honest saw stab. The drone is high-passed at 60 Hz with a 180–250 Hz body; the heartbeat gets a 110–120 Hz layer and a 2–4 kHz beater, so the low end reads on phones without eating limiter headroom.
- MIX_REPORT=1 to check per-shot levels. Target −15 LUFS and ≤ −1 dBTP via deliver.ts.

REVIEW AND DELIVERY
- Render stills at 45% and at end−3 of every shot, and build contact sheets (out/storyboard-N.jpg) with an IG safe-zone overlay (top 270, bottom 380, right 140) before the full render.
- Pixel-diff frame 0 against frame 1155.
- Measure every kinetic line in Chrome with the real fonts. Lines that must fit the 800 px column: S01 headline at 72 px, S05 title at 72 px, S17 at 72 px, S25 text 1 at 38 px, the cover at 100 px.
- Deliver with deliver.ts at 2-pass 10M, then upload as a Trial Reel and inspect the IG transcode on a phone for banding and crawling grain before posting the master.

PAID CUTDOWNS (re-mixed from the same timeline; the master audio is never chopped)
- 30 s: 0–5.5 (hook, 0:20 stop), 7.0–9.0 (Rita), 13.0–20.5 (call, count, “AI front desk”, “Sure it is, Gus”), 28.5–31.0 (dive and house rule, AI03b only), 38.5–46.0 (twist, knot and $238), 54.5–59.5 (CTA) = 30.0 s.
- 15 s: 0–5.5, 15.5–19.0, 29.0–31.0 (AI03b only), 54.5–58.5 with Beat B moved up to 56.0 = 15.0 s.
- Paid renders use placement='paid': the caption band at y 1000–1100, and end-card CTA elements kept above y 1250 (the fine print moves up into y 1100–1225).

HOOK A/B FOR TRIAL REELS (the master keeps “2:13 AM”)
Swap the frame-0 eyebrow for “MOTEL OWNERS:” or “NO NIGHT CLERK?”. The headline and question stay the same.

WHAT CHANGED IN THIS REVISION, AND WHY
- One text system at frame 0: the headline is Rita’s line, and the hook question “So who picks up at 0:20?” pays off in S18 with “Nobody.”.
- No brand lockup at 2.5 s or 8.5 s. The first brand mark is in S14.
- S05/S06: “Gus can’t afford a night clerk.” / “Neither can I.” S05 now draws the road between the motels.
- The S14 console is cut to a single House rules field plus the $119 cell. The coffee rule, the docked orb and the Speaking pill are gone.
- S20: “Her 2:13 caller / tried Gus next.”, with a giant $238.00. The inbox is newest first everywhere.
- The morning is re-blocked on Gus’s phone, ending on the copy-link resolve, with truthful “Not booked yet…” wording.
- The end card is cut to headline, “Keep your number. Free to start.”, “Start free →” and the URL, plus 24 px fine print, with one extra bar.
- All VO is re-timed from measured renders, with Rita at 1.05. S01 is +1 beat. S07, S09, S15 and S17 are trimmed, and the static S12 lobby insert is cut.

RISKS AND MITIGATIONS
1. The twist depends on geography. Red = Rita and teal = Gus must hold everywhere: the door glass, the window view, the S05 lots and labels, the mirror. Test at 360×640 with five cold viewers, asking “whose lobby was the first shot?” after one watch. If fewer than three get it, enlarge the S05 sign names and add a small “Rita’s motel” label on the left lot.
2. TTS lengths are now measured, but any re-render (voice swap or text change) must re-run the measurement and regenerate vo.ts. If a line grows, move later cuts by whole beats in timeline.ts and re-derive the cutdowns.
3. Facial acting is limited to two Rita rigs and silhouettes; comedy comes from stillness, glints, brows and a 4 px mouth corner. Review S10, S13 and S16 at phone size.
4. Dark gradients will band: static dither, light grain and a 2-pass 10 Mb/s master, then check the IG transcode.
5. UI density: S14 at 2.6×, S20 at 1.8× cropped, S22 at 3×, S24–S25 at 2.4–2.6×. All use the real narrow CSS, with Mark done wrapping as it really does. Review stills at phone size.
6. Truth guardrails:
   - The Starlite, Rita’s Motor Inn, Sam Ortiz, all prices (including “(I’m $129)”), “7/12 sold” and the 555 numbers are fiction. The end card says “Fictional story.”
   - The greeting contains “AI”, so phoneGreeting() uses it verbatim.
   - Story compression: the real voice would run check_availability first and might use a short filler, which is left out. The ad never says “let me check”.
   - The inbox is shown newest first. No live-call monitoring view is shown. Nothing implies a caller is booked: the copy-link tap is followed by “Not booked yet: Gus confirms, sends the link, and Sam books.” and the matching fine print.
   - Never show SMS, card payment by phone, auto-booking of callers, OTA sync, multilingual voice or a price/plan.
   - These are story lines, not product claims: “Nobody works nights at the Starlite”, “Gus can’t afford a night clerk”, “Neither can I”, “That’s Gus’s rule”, “Her 2:13 caller tried Gus next”, “She watched it ring” and “Rita missed one thing”. “Tried Gus next” means the guest redialled; it is not call rerouting.
7. No third-party logos. All phone OS UI is generic, and the only brand drawn is HotelOne’s own.
