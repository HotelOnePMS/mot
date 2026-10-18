# HotelOne — "Across the Street (Ep. 1)", an Instagram Reel

A 62.5-second vertical Reel (1080×1920, 30 fps) for HotelOne, aimed at independent hotel and motel owners. Everything is made in code with [Remotion](https://www.remotion.dev/): the illustration, the HotelOne UI (rebuilt from the app on `claude/admiring-carson-fsuy74`), the voices (offline TTS) and the score (synthesized).

- **Video:** `out/hotelone-reel.mp4` (48 MB, H.264 6 Mb/s 2-pass, AAC 256k, −14.6 LUFS)
- **Cover:** `out/cover.jpg`
- **Board:** `STORYBOARD.md` (every shot, line, sound and claim) and the contact sheets `out/storyboard-1.jpg` / `-2.jpg`

## The story

At 2:13 AM a phone rings in an empty motel lobby. Across the highway, Rita watches her rival Gus's front-desk phone ring and stop at exactly 0:20, four nights running. She calls to catch him out. His AI front desk answers, says it's the AI front desk, quotes his real $119 rate and turns down her "few hours, cash?" by his own house rule. Then the opening shot comes back: the ringing, empty lobby was never Gus's. It was Rita's. Her 2:13 caller tried Gus next, and at breakfast the booking request is in Gus's inbox with the total already quoted. Not booked yet: Gus confirms, sends the link, and the guest books. Stinger: "Who's answering yours, Rita?"

Every product claim maps to the app code (STORYBOARD.md, "Claims and evidence"). The end card carries the fine print: fictional story, English voice, phone bookings are requests, 20-second forwarding is a mobile carrier code.

## Post copy

> Nobody works nights at the Starlite. So who picks up at 0:20? 👀
>
> Across the Street, Ep. 1: a fictional story about two motel owners, one highway and one phone.
>
> Missed calls are missed bookings. HotelOne is an AI front desk for independent hotels and motels. You keep your number and forward the calls you miss. On a mobile, \*\*61\*&lt;assistant number&gt;\*11\*20# sends any call nobody answers within 20 seconds. On a US landline, \*72 forwards every call, or ask your carrier for "forward when unanswered" (codes vary by carrier). It answers with your real prices and house rules, always tells callers it's a virtual assistant, and leaves booking requests and messages in your inbox. Phone bookings are requests: your team confirms, sends the link, and the guest books online.
>
> Free to start, no card needed → hotelone.site
> The assistant needs its own number (about $1.15/mo in the US) plus call minutes. Voice is English only. Plans and pricing at hotelone.site.
>
> Be honest: did you clock it before 0:38? 👇 (Ep. 2: Rita's turn.)
>
> #motelowner #hotelowner #innkeeper #independenthotel #hospitalitylife

## Build

```bash
cd marketing/instagram-reel
npm install
npm run fonts                     # copies the woff2 files into public/fonts
npm run audio                     # synthesizes public/audio/mix.wav (~20 s)
npx remotion render Reel out/master.mp4
node scripts/deliver.ts out/master.mp4 out/hotelone-reel.mp4 6M grain
npx remotion still Cover out/cover.jpg --image-format=jpeg
```

The full render takes about 5 minutes on 4 cores. `npm run studio` opens Remotion Studio; `node scripts/render-stills.ts` renders two stills per shot plus the contact sheets (`--scene <Name>`, `--frames 0,1155 --safe` for exact frames with the Instagram UI zones drawn).

The voice lines in `public/vo/` and their measured timings in `src/vo.ts` are committed, so rendering needs no TTS. To re-record (after editing `src/script.json`): set up Kokoro-82M as described at the top of `scripts/make-voice.py`, then `python -I scripts/make-voice.py --model model_quantized.onnx --voices voices.npz`. Line starts live in `script.json` (`at`); captions, the shared event clock (`src/marks.ts`) and the mix all re-time from the new measurements.

## Layout

| Path | What |
| --- | --- |
| `src/storyboard.json`, `STORYBOARD.md` | The board (`node scripts/storyboard-md.mjs` regenerates the .md) |
| `src/timeline.ts` | Shots, scenes and voice cues from the measured clips |
| `src/marks.ts` | Every event picture and sound share (trills, counters, clicks, the hang-up) |
| `src/scenes/` | One file per scene, hard-cut in `src/Reel.tsx` |
| `src/set/`, `src/char/` | The lobby (one set for both motels — the twist), highway, car; Rita and Gus |
| `src/hotelone/`, `src/ui/` | HotelOne UI rebuilds (house rules, inbox, toast, orb, logo); counter, generic phone |
| `src/fx/` | Binoculars, keyhole iris, red string, particle dive, grain/dither (`GlobalFx`) |
| `src/components/Captions.tsx` | Speaker-coded burned-in captions |
| `scripts/make-audio.ts` | Score, effects and voice treatments, mixed to `public/audio/mix.wav` |

Paid cutdowns (30 s and 15 s) and a hook A/B ("MOTEL OWNERS:" / "NO NIGHT CLERK?" eyebrow) are specified in STORYBOARD.md, "Production notes", but not rendered.
