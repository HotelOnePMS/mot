// Soundtrack for “Across the Street (Ep. 1)”.
//
//   node scripts/make-audio.ts               write public/audio/mix.wav, print a summary
//   MIX_REPORT=1 node scripts/make-audio.ts  also print per-shot bus levels and per-line speech margins
//
// Everything is synthesized here except the recorded voice lines
// (public/vo/<id>.wav, 24 kHz mono). Voice placement comes from src/timeline.ts
// (CUES: at, end, cut, phone) and every other event from src/marks.ts, so a
// sound lands inside the frame of its picture. The score follows STORYBOARD.md
// “Music”: D minor at 120 BPM, the 20-second motif D5–A4–F5–E5, Gus’s FM chime
// (the motif’s first two notes) and Rita’s desk-bell trill.
//
// Signal flow
//   voice    treated per role (Rita dry close-mic; the AI through phoneBand()
//            whenever heard via Rita’s phone, bandSweep() into the room on the
//            end card; Gus in a small office, darker in S27), level-matched,
//            gently compressed and pre-limited at −9 dBFS.
//   music    one bus per score section, each with its own room, so a hard stop
//            (15.5 pickup, the hang-up, the 38.5 smash cut, the 59.75 iris)
//            also kills that section’s reverb tail.
//   sfx      one-off effects. Anything still sounding when a MUTES window opens
//            is cut there. sfxFree holds sounds with fixed levels that are never
//            ducked or muted (the trills, the pickup and hang-up clicks, the
//            thud); phone holds the ringback (phone band, −6 dB under Rita).
//   amb      cicadas, highway, neon, glass hum, cabin tone, morning room and
//            birdsong; the perspective (muffled in the car, open in the lot)
//            follows the shot.
//   Music, sfx and ambience duck under the voice (12 ms attack, 320 ms release).
//   Master: auto-gain to −14.5 LUFS integrated, a true-peak look-ahead limiter
//   at −1.5 dBTP, the 40 ms fade on the loop seam, TPDF dither, 16-bit.
//
// Plain JS plus erasable types, explicit .ts imports: runs directly in Node 22.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CUES, FPS, SHOTS, TOTAL_FRAMES, type Cue} from '../src/timeline.ts';
import {
  AMBIENCE,
  BAND_SWEEP,
  CLOCK_TICKS,
  GUS_CHIMES,
  GUS_CHIME_CUT,
  HEARTBEAT,
  IRIS,
  MOTIFS,
  MOTIF_PITCHES,
  MUSIC,
  MUTES,
  NEON_DIPS,
  RINGBACK,
  S02,
  S19,
  S27,
  SFX,
  TRILL_CUES,
  TRILL_LEN,
  TRILL_PRE_ECHO,
  type Sfx,
  type Span,
} from '../src/marks.ts';
import {mtof, mulberry32, readWav, upsample2, writeWav} from './lib/dsp.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'public', 'audio', 'mix.wav');
const REPORT = Boolean(process.env.MIX_REPORT);

const SR = 48000;
const LENGTH = TOTAL_FRAMES / FPS; // 62.5 s
const N = Math.round(LENGTH * SR);
const TAU = 2 * Math.PI;
const rand = mulberry32(0x2132213);
const noise = () => rand() * 2 - 1;
const dB = (x: number) => Math.pow(10, x / 20);
const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const at = (t: number) => Math.round(t * SR);
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smooth = (u: number) => {
  const x = clamp(u);
  return x * x * (3 - 2 * x);
};
/** 'D5', 'F#5', 'Eb4' → MIDI. */
const note = (name: string): number => {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`make-audio: bad note ${name}`);
  return 'C_D_EF_G_A_B'.indexOf(m[1]) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
};

/**
 * The board writes levels as dB on the final mix (“drone at −30 dB”, “car pass
 * −30 dB”). Sources are built before the master gain is known, so they are set
 * at board level minus the master gain this mix normally lands on; the summary
 * prints the real master gain so this stays honest.
 */
const MASTER_EST = 9;
const BOARD = (x: number) => dB(x - MASTER_EST);

// ─── Building blocks ────────────────────────────────────────────────────────

type Stereo = {L: Float32Array; R: Float32Array};
const stereo = (n: number): Stereo => ({L: new Float32Array(n), R: new Float32Array(n)});
const newBus = () => stereo(N);

/** Topology-preserving state-variable filter with all three outputs; coefficients cached while fc/q hold. */
class SVF {
  lp = 0;
  bp = 0;
  hp = 0;
  s1 = 0;
  s2 = 0;
  fc = -1;
  q = -1;
  k = 1;
  a1 = 0;
  a2 = 0;
  a3 = 0;
  tune(fc: number, q: number) {
    if (fc === this.fc && q === this.q) return;
    this.fc = fc;
    this.q = q;
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 5), SR * 0.49)) / SR);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  run(x: number) {
    const v3 = x - this.s2;
    const v1 = this.a1 * this.s1 + this.a2 * v3;
    const v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1;
    this.s2 = 2 * v2 - this.s2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
  }
  low(x: number, fc: number, q = Math.SQRT1_2) {
    this.tune(fc, q);
    this.run(x);
    return this.lp;
  }
  high(x: number, fc: number, q = Math.SQRT1_2) {
    this.tune(fc, q);
    this.run(x);
    return this.hp;
  }
  /** Band-pass normalized to unity gain at fc. */
  band(x: number, fc: number, q = 1) {
    this.tune(fc, q);
    this.run(x);
    return this.bp * this.k;
  }
  /** Peaking EQ, gainDb at fc. */
  peak(x: number, fc: number, q: number, gainDb: number) {
    this.tune(fc, q);
    this.run(x);
    return x + (dB(gainDb) - 1) * this.k * this.bp;
  }
  /** High shelf above fc. */
  shelf(x: number, fc: number, gainDb: number) {
    this.tune(fc, Math.SQRT1_2);
    this.run(x);
    return x + (dB(gainDb) - 1) * this.hp;
  }
}

const polyblep = (t: number, dt: number) => {
  if (t < dt) {
    const u = t / dt;
    return u + u - u * u - 1;
  }
  if (t > 1 - dt) {
    const u = (t - 1) / dt;
    return u * u + u + u + 1;
  }
  return 0;
};
/** Band-limited saw oscillator. */
const saw = (f: number) => {
  let ph = rand();
  const dt = f / SR;
  return () => {
    ph += dt;
    if (ph >= 1) ph -= 1;
    return 2 * ph - 1 - polyblep(ph, dt);
  };
};

/** Renders a mono generator of `dur` seconds. */
const render = (dur: number, gen: (t: number) => number): Float32Array => {
  const n = Math.max(1, Math.round(dur * SR));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = gen(i / SR);
  return out;
};
const peakAbs = (x: Float32Array) => {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
/** Scales a mono buffer to a peak of `to`. */
const normPeak = (x: Float32Array, to = 1) => {
  const p = peakAbs(x);
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] *= to / p;
  return x;
};
/** Scales a mono buffer to an RMS of `to` (over its non-silent part). */
const normRms = (x: Float32Array, to = 1) => {
  let s = 0;
  let n = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== 0) (s += x[i] * x[i]), n++;
  const r = Math.sqrt(s / Math.max(1, n));
  if (r > 0) for (let i = 0; i < x.length; i++) x[i] *= to / r;
  return x;
};
const normStereoPeak = (x: Stereo, to = 1) => {
  const p = Math.max(peakAbs(x.L), peakAbs(x.R));
  if (p > 0) for (let i = 0; i < x.L.length; i++) (x.L[i] *= to / p), (x.R[i] *= to / p);
  return x;
};
/** K-weighting at 48 kHz (ITU-R BS.1770): the pre-filter high shelf, then the RLB high-pass, direct form I. */
const biquad = (x: ArrayLike<number>, c: readonly number[]) => {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
};
const kWeight = (x: ArrayLike<number>) =>
  biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]), [1, -2, 1, -1.99004745483398, 0.99007225036621]);
/**
 * Loudness of a mono speech clip: K-weighted, 200 ms blocks every 50 ms, gated at −70 LUFS and −10 LU
 * relative (BS.1770 with blocks short enough for one-line clips). Levels lines by how loud they sound,
 * so a phone-band line and a dry close-mic line can be set relative to each other.
 */
const speechLufs = (x: ArrayLike<number>) => {
  const y = kWeight(x);
  const block = Math.round(0.2 * SR);
  const hop = Math.round(0.05 * SR);
  const z: number[] = [];
  for (let s = 0; s + block <= y.length; s += hop) {
    let acc = 0;
    for (let i = s; i < s + block; i++) acc += y[i] * y[i];
    z.push(acc / block);
  }
  const lk = (v: number) => -0.691 + 10 * Math.log10(v + 1e-20);
  const abs = z.filter((v) => lk(v) > -70);
  const rel = lk(abs.reduce((a, v) => a + v, 0) / Math.max(1, abs.length)) - 10;
  const gated = abs.filter((v) => lk(v) > rel);
  return lk(gated.reduce((a, v) => a + v, 0) / Math.max(1, gated.length));
};
/** Mixes `src` into `dst` at a sample offset. */
const addInto = (dst: Float32Array, src: Float32Array, offset = 0, gain = 1) => {
  for (let i = 0; i < src.length; i++) {
    const j = i + offset;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * gain;
  }
};
/** Sum of decaying sine partials [freq, amp, tau] (bells, clinks, ticks). */
const modal = (parts: Array<[number, number, number]>, len: number, click = 0, clickFc = 4000): Float32Array => {
  const ph = parts.map(() => rand() * TAU);
  const hp = new SVF();
  return render(len, (t) => {
    let v = 0;
    for (let k = 0; k < parts.length; k++) {
      const [f, a, tau] = parts[k];
      if (f < SR * 0.45) v += a * Math.exp(-t / tau) * Math.sin(TAU * f * t + ph[k]);
    }
    v *= Math.min(1, t / 0.0006);
    if (click > 0 && t < 0.004) v += hp.high(noise(), clickFc) * click * Math.exp(-t / 0.0008);
    return v * (len - t < 0.01 ? (len - t) / 0.01 : 1);
  });
};

// Placement on buses. A clip that is still sounding when a MUTES window opens
// is cut there (fading over the mute’s fade AFTER the cut time).
const MUTE_CUTS = MUTES.map((m) => ({t: m.start, fade: Math.max(m.fade, 0.001)}));
type Pan = number | ((t: number) => number);
type PlaceOpts = {gain?: number; pan?: Pan; cut?: number; fade?: number; mute?: boolean};
const panGains = (p: number): [number, number] => {
  const a = ((clamp(p, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; // centre = unity in both channels
};
const place = (bus: Stereo, t0: number, clip: Float32Array | Stereo, o: PlaceOpts = {}) => {
  const mono = clip instanceof Float32Array;
  const cl = mono ? clip : clip.L;
  const cr = mono ? clip : clip.R;
  let cut = o.cut ?? Infinity;
  let fade = o.fade ?? 0.003;
  if (o.mute !== false) {
    for (const m of MUTE_CUTS) if (t0 < m.t - 1e-9 && t0 + cl.length / SR > m.t && m.t < cut) (cut = m.t), (fade = m.fade);
  }
  const i0 = at(t0);
  const iCut = Number.isFinite(cut) ? at(cut) : Number.MAX_SAFE_INTEGER;
  const nf = Math.max(1, Math.round(fade * SR));
  const gain = o.gain ?? 1;
  const pan = o.pan ?? 0;
  const panFn = typeof pan === 'function' ? pan : null;
  let [pl, pr] = mono ? panGains(typeof pan === 'number' ? pan : 0) : [1, 1];
  for (let k = 0; k < cl.length; k++) {
    const i = i0 + k;
    if (i < 0) continue;
    if (i >= N || i >= iCut + nf) break;
    let g = gain;
    if (i >= iCut) g *= 1 - (i - iCut) / nf;
    if (panFn && mono) [pl, pr] = panGains(panFn(k / SR));
    bus.L[i] += cl[k] * g * pl;
    bus.R[i] += cr[k] * g * pr;
  }
};

// Freeverb-style stereo reverb with an RT60: wet only, unity power gain for noise.
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
type VerbOpts = {rt: number; size?: number; damp?: number; pre?: number; hp?: number; lp?: number; from?: number; to?: number};
const reverbWet = (src: Stereo, o: VerbOpts): Stereo => {
  const n = src.L.length;
  const from = Math.max(0, o.from ?? 0);
  const to = Math.min(n, o.to ?? n);
  const out = stereo(n);
  const size = o.size ?? 1;
  const damp = o.damp ?? 0.3;
  const pre = Math.round((o.pre ?? 0) * SR);
  const inp = new Float32Array(n);
  const hp = new SVF();
  const lp = new SVF();
  for (let i = from; i < to; i++) {
    let x = 0.5 * (src.L[i] + src.R[i]);
    if (o.hp) x = hp.high(x, o.hp);
    if (o.lp) x = lp.low(x, o.lp);
    if (i + pre < to) inp[i + pre] = x;
  }
  const chans: Array<[Float32Array, number]> = [
    [out.L, 0],
    [out.R, 23],
  ];
  for (const [ch, spread] of chans) {
    for (const len0 of COMBS) {
      const len = Math.max(2, Math.round(((len0 + spread) * size * SR) / 44100));
      const g = Math.pow(10, (-3 * len) / (o.rt * SR));
      const gin = Math.sqrt((1 - g * g) / COMBS.length);
      const buf = new Float32Array(len);
      let p = 0;
      let store = 0;
      for (let i = from; i < to; i++) {
        const y = buf[p];
        store = y * (1 - damp) + store * damp;
        buf[p] = inp[i] * gin + store * g;
        ch[i] += y;
        if (++p >= len) p = 0;
      }
    }
    // Diffusion: true Schroeder allpasses (unity magnitude; Freeverb's own “allpass” adds ~3.7 dB per stage).
    for (const len0 of ALLPASSES) {
      const len = Math.max(2, Math.round(((len0 + spread) * size * SR) / 44100));
      const buf = new Float32Array(len);
      let p = 0;
      for (let i = from; i < to; i++) {
        const b = buf[p];
        const v = ch[i] + 0.5 * b;
        ch[i] = b - 0.5 * v;
        buf[p] = v;
        if (++p >= len) p = 0;
      }
    }
  }
  return out;
};
/** A clip plus its own room (dry + wet·reverb), padded for the tail. */
const withRoom = (x: Float32Array | Stereo, rt: number, wet: number, o: Partial<VerbOpts> = {}): Stereo => {
  const L = x instanceof Float32Array ? x : x.L;
  const R = x instanceof Float32Array ? x : x.R;
  const n = L.length + Math.round(rt * 1.2 * SR);
  const s = stereo(n);
  s.L.set(L);
  s.R.set(R);
  const w = reverbWet(s, {rt, ...o});
  for (let i = 0; i < n; i++) {
    s.L[i] += w.L[i] * wet;
    s.R[i] += w.R[i] * wet;
  }
  return s;
};
/** Gus’s office glass, glass(): LP 1.2 kHz plus a 40 ms slap. */
const glass = (x: Float32Array): Float32Array => {
  const slap = Math.round(0.04 * SR);
  const n = x.length + slap;
  const y = new Float32Array(n);
  const a = new SVF();
  const b = new SVF();
  for (let i = 0; i < n; i++) y[i] = b.low(a.low(i < x.length ? x[i] : 0, 1200), 1200);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = y[i] + (i >= slap ? y[i - slap] * 0.42 : 0);
  return out;
};
/**
 * phoneBand(): HP 320 Hz, 2× LP 3.3 kHz, tanh(v·2.2)/1.6, 0.002 noise floor.
 * `open(i)` 0→1 is bandSweep(): HP 320→40 Hz, LP 3.3→16 kHz, the drive and the
 * line noise fading out, so the voice steps out of the phone into the room.
 */
const phoneBand = (x: Float32Array, open: (i: number) => number = () => 0): Float32Array => {
  const hp = new SVF();
  const lp1 = new SVF();
  const lp2 = new SVF();
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const s = open(i);
    const hpf = 320 * Math.pow(40 / 320, s);
    const lpf = 3300 * Math.pow(16000 / 3300, s);
    let v = hp.high(x[i], hpf, 0.8);
    v = lp1.low(v, lpf, 0.8);
    v = lp2.low(v, lpf, 0.8);
    out[i] = (1 - s) * (Math.tanh(v * 2.2) / 1.6 + noise() * 0.002) + s * v * (2.2 / 1.6);
  }
  return out;
};

// ─── Buses ──────────────────────────────────────────────────────────────────

const voice = newBus();
const music = newBus(); // the score sections, ducked
const musicFree = newBus(); // the E6 “ringing ears” sine: fixed levels from the board
const sfx = newBus(); // ducked, muted by MUTES
const sfxFree = newBus(); // fixed levels, never ducked or muted
const phone = newBus(); // the ringback in Rita’s ear, −6 dB under her VO
const amb = newBus(); // ambience, ducked a little

// ─── Voice ──────────────────────────────────────────────────────────────────

/** Sets a clip's speech loudness (speechLufs, mono) to `target`. */
const setSpeech = (x: Float32Array, target: number) => {
  const g = dB(target - speechLufs(x));
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
};
/** Feed-forward RMS compressor (dialogue levelling). */
const compress = (x: Float32Array, thrDb: number, ratio: number) => {
  const det = Math.exp(-1 / (0.005 * SR));
  const atk = Math.exp(-1 / (0.004 * SR));
  const rel = Math.exp(-1 / (0.09 * SR));
  let ms = 0;
  let gr = 0;
  for (let i = 0; i < x.length; i++) {
    ms = x[i] * x[i] + (ms - x[i] * x[i]) * det;
    const lvl = 10 * Math.log10(ms + 1e-12);
    const want = lvl > thrDb ? (lvl - thrDb) * (1 - 1 / ratio) : 0;
    gr = want > gr ? want + (gr - want) * atk : want + (gr - want) * rel;
    x[i] *= dB(-gr);
  }
};

/** Speech loudness per role (speechLufs, mono, pre-master). Rita sits 3 dB under the AI (Cast table). */
const VOICE_DB = {rita: -25, ai: -22, gus: -23.5} as const;
const ritaSpans: Span[] = [];

for (const c of CUES) {
  const {sr, data} = readWav(path.join(root, 'public', 'vo', `${c.id}.wav`));
  if (sr !== 24000) throw new Error(`make-audio: ${c.id}.wav is ${sr} Hz, expected 24 kHz`);
  let x = setSpeech(upsample2(data), -21); // a known level into the phone band’s drive and the compressor
  let target: number = VOICE_DB[c.role];
  let room: {rt: number; wet: number; damp: number} | null = null;
  let roomOpen: ((i: number) => number) | null = null;

  if (c.role === 'rita') {
    // Dry close-mic: 90 Hz high-pass, +2 dB at 150 Hz. Unfiltered on the phone: she is the near end.
    const hp1 = new SVF();
    const hp2 = new SVF();
    const pk = new SVF();
    for (let i = 0; i < x.length; i++) x[i] = pk.peak(hp2.high(hp1.high(x[i], 90), 90), 150, 0.9, 2);
    ritaSpans.push({start: c.at, end: c.end});
  } else if (c.role === 'ai') {
    if (c.id === 'AI05') {
      // End card: phone band, then bandSweep() opens it over BAND_SWEEP, landing on “I will”, into a small room.
      const open = (i: number) => smooth((c.at + i / SR - BAND_SWEEP.start) / (BAND_SWEEP.end - BAND_SWEEP.start));
      x = phoneBand(x, open);
      room = {rt: 0.6, wet: 0.12, damp: 0.35};
      roomOpen = open;
    } else if (c.phone) {
      x = phoneBand(x);
    }
  } else {
    // Gus: warm and dry with a small office reverb (0.4 s, 10%). S27: −4 dB and darker (LP 7 kHz).
    const dark = c.id === 'G02';
    const hp = new SVF();
    const warm = new SVF();
    const lp1 = new SVF();
    const lp2 = new SVF();
    for (let i = 0; i < x.length; i++) {
      let v = warm.peak(hp.high(x[i], 80), 220, 0.8, 1.5);
      if (dark) v = lp2.low(lp1.low(v, 7000), 7000);
      x[i] = v;
    }
    if (dark) target -= 5; // measures ≈ −4 dB against G01 once its wetter room is counted
    room = {rt: 0.4, wet: dark ? 0.12 : 0.1, damp: dark ? 0.65 : 0.35};
  }

  compress(x, -18, 2.5);
  setSpeech(x, target);
  // Clip edges: 2 ms in, 6 ms out, so a trimmed TTS file never starts or stops on a step.
  for (let i = 0; i < at(0.002); i++) x[i] *= i / at(0.002);
  for (let i = 0; i < at(0.006); i++) x[x.length - 1 - i] *= i / at(0.006);

  let clip: Float32Array | Stereo = x;
  if (room) {
    // The room is fed by the processed voice (on the end card, only as the band opens: the phone has no room).
    const st = stereo(x.length + at(room.rt * 1.2));
    for (let i = 0; i < x.length; i++) st.L[i] = st.R[i] = x[i] * (roomOpen ? roomOpen(i) : 1);
    const wet = reverbWet(st, {rt: room.rt, size: 0.42, damp: room.damp, pre: 0.006});
    for (let i = 0; i < st.L.length; i++) {
      const dry = i < x.length ? x[i] : 0;
      st.L[i] = dry + wet.L[i] * room.wet;
      st.R[i] = dry + wet.R[i] * room.wet;
    }
    clip = st;
  }
  // AI04 is hard-cut mid-word at its .cut (the hang-up click lands there). G02’s room
  // tail is closed at S27.cicadasOnly so the last beat is cicadas only.
  const cut = c.cut ?? (c.id === 'G02' ? S27.cicadasOnly : undefined);
  place(voice, c.at, clip, {cut, fade: c.cut !== null ? 0.001 : 0.08, mute: false});
}

/** Look-ahead limiter in place: holds `peaks` under `ceiling` with a ramped attack. Returns the max gain reduction (dB). */
const limiter = (b: Stereo, ceiling: number, peaks: Float32Array, look = 0.004, release = 0.08): number => {
  const n = b.L.length;
  const W = Math.max(1, Math.round(look * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = peaks[i] > ceiling ? ceiling / peaks[i] : 1;
  // Sliding minimum over [i, i + W - 1].
  const mn = new Float32Array(n);
  const dq = new Int32Array(n);
  let h = 0;
  let tl = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tl > h && need[dq[tl - 1]] >= need[i]) tl--;
    dq[tl++] = i;
    while (dq[h] > i + W - 1) h++;
    mn[i] = need[dq[h]];
  }
  // Box average over [i - W + 1, i]: ramps down ahead of each peak and reaches its gain on it.
  const rel = Math.exp(-1 / (release * SR));
  let sum = W; // the window starts full of unity gain
  let g = 1;
  let maxGr = 0;
  for (let i = 0; i < n; i++) {
    sum += mn[i] - (i >= W ? mn[i - W] : 1);
    const target = Math.min(1, sum / W);
    g = target < g ? target : target + (g - target) * rel;
    b.L[i] *= g;
    b.R[i] *= g;
    maxGr = Math.max(maxGr, -toDb(g));
  }
  return maxGr;
};
const samplePeaks = (b: Stereo) => {
  const p = new Float32Array(b.L.length);
  for (let i = 0; i < p.length; i++) p[i] = Math.max(Math.abs(b.L[i]), Math.abs(b.R[i]));
  return p;
};
// Pre-limit the voice bus at −9 dBFS (board MIX) so speech can sit forward.
const voicePeaks = samplePeaks(voice);
const voiceGr = limiter(voice, dB(-9), voicePeaks, 0.003, 0.06);
let voiceHot = 0;
for (let i = 0; i < N; i++) if (voicePeaks[i] > dB(-6)) voiceHot++;

// Ducking amount 0..1 from the voice bus: a fast speech detector, then 12 ms attack / 320 ms release.
const duckAmt = new Float32Array(N);
{
  const fAtk = Math.exp(-1 / (0.001 * SR));
  const fRel = Math.exp(-1 / (0.04 * SR));
  const atk = 1 - Math.exp(-1 / (0.012 * SR));
  const rel = 1 - Math.exp(-1 / (0.32 * SR));
  let e = 0;
  let a = 0;
  for (let i = 0; i < N; i++) {
    const x = Math.max(Math.abs(voice.L[i]), Math.abs(voice.R[i]));
    e = x > e ? x + (e - x) * fAtk : x + (e - x) * fRel;
    const want = clamp((toDb(e) + 46) / 12);
    a += (want - a) * (want > a ? atk : rel);
    duckAmt[i] = a;
  }
}
const DUCK_DB = {music: 8, sfx: 5, phone: 6, amb: 3} as const;

// Car-cabin room tone at −40 dB under every Rita line.
{
  const lp = new SVF();
  const lp2 = new SVF();
  const bp = new SVF();
  let brown = 0;
  const tone = render(LENGTH, () => {
    brown = brown * 0.996 + noise() * 0.06;
    return lp2.low(lp.low(brown, 260), 260) + bp.band(noise(), 520, 1.2) * 0.05;
  });
  normRms(tone);
  const env = new Float32Array(N);
  for (const sp of ritaSpans) {
    const a = at(sp.start - 0.12);
    const b = at(sp.end + 0.15);
    const ramp = at(0.08);
    for (let i = Math.max(0, a); i < Math.min(N, b); i++) env[i] = Math.max(env[i], Math.min(1, (i - a) / ramp, (b - i) / ramp));
  }
  const g = BOARD(-40);
  for (let i = 0; i < N; i++) {
    amb.L[i] += tone[i] * env[i] * g;
    amb.R[i] += tone[(i + 7919) % N] * env[i] * g;
  }
}

// ─── Instruments ────────────────────────────────────────────────────────────

/** Karplus-Strong pizzicato: finger-plucked noise burst, two-point loss filter, body formants (~250/450/900 Hz), short room. */
const pizz = (m: number, o: {stacc?: number; t60?: number; bright?: number; room?: number} = {}): Stereo => {
  const f0 = mtof(m);
  const period = SR / f0;
  const t60 = o.t60 ?? clamp(1.5 * Math.pow(110 / f0, 0.5), 0.35, 2.2);
  const stacc = o.stacc ?? 0.2;
  const len = Math.min(stacc + 0.14, t60 + 0.05);
  const n = Math.round(len * SR);
  const ne = Math.round(period);
  const bright = o.bright ?? 0.5;
  const elp = new SVF();
  const raw = new Float32Array(ne);
  for (let i = 0; i < ne; i++) raw[i] = elp.low(noise(), 700 + 3200 * bright, 0.7);
  const beta = Math.max(1, Math.round(ne * 0.19)); // pluck position
  const exc = new Float32Array(ne);
  let mean = 0;
  for (let i = 0; i < ne; i++) mean += (exc[i] = raw[i] - (i >= beta ? raw[i - beta] * 0.85 : 0)) / ne;
  for (let i = 0; i < ne; i++) exc[i] -= mean;
  const rhoA = Math.pow(10, -3 / (t60 * f0));
  const rhoB = Math.pow(10, -3 / (0.06 * f0)); // finger damping after the staccato length
  const D = period - 0.5;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const rho = t < stacc ? rhoA : rhoB;
    const pos = i - D;
    let fb = 0;
    if (pos >= 1) {
      const j = Math.floor(pos);
      const fr = pos - j;
      const a = y[j] + (y[j + 1] - y[j]) * fr;
      const b = y[j - 1] + (y[j] - y[j - 1]) * fr;
      fb = 0.5 * (a + b);
    }
    y[i] = (i < ne ? exc[i] : 0) + rho * fb;
  }
  const dc = new SVF();
  const b1 = new SVF();
  const b2 = new SVF();
  const b3 = new SVF();
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = dc.high(y[i], 45);
    out[i] = 0.55 * v + 0.9 * b1.band(v, 250, 2.2) + 0.6 * b2.band(v, 450, 3) + 0.38 * b3.band(v, 900, 3.5);
    if (n - i < 240) out[i] *= (n - i) / 240;
  }
  normPeak(out);
  return withRoom(out, 0.32, o.room ?? 0.25, {size: 0.35, damp: 0.4});
};

/** Modal celesta: inharmonic partials ×1, 2.76, 5.4, 8.9 with a hammer-noise transient. */
const celesta = (m: number, o: {len?: number; muted?: boolean} = {}): Float32Array => {
  const f0 = mtof(m);
  const ratios = [1, 2.76, 5.4, 8.9];
  const amps = [1, 0.38, 0.16, 0.07];
  const scale = Math.pow(523 / f0, 0.35) * (o.muted ? 0.28 : 1);
  const taus = [1.5, 0.5, 0.2, 0.09].map((x) => x * scale);
  const len = o.len ?? (o.muted ? 0.9 : 2.6);
  const ph = ratios.map(() => rand() * TAU);
  const bp = new SVF();
  const lp = new SVF();
  return render(len, (t) => {
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const f = f0 * ratios[k];
      if (f < SR * 0.45) v += amps[k] * Math.exp(-t / taus[k]) * Math.sin(TAU * f * t + ph[k]);
    }
    v *= Math.min(1, t / 0.0012);
    if (t < 0.015) v += bp.band(noise(), 2600, 0.9) * 0.3 * Math.exp(-t / 0.003);
    if (o.muted) v = lp.low(v, 2600);
    return v * (len - t < 0.05 ? (len - t) / 0.05 : 1);
  });
};

/** Warm FM e-piano: ratio-1 body with a decaying index, a ratio-14 tine bark, slow tremolo. */
const epiano = (m: number, dur: number, vel = 1): Float32Array => {
  const f = mtof(m);
  const len = dur + 1.3;
  let pc = rand() * TAU;
  let pm = rand() * TAU;
  let pt = 0;
  const bright = 0.55 + 0.6 * vel;
  const decay = 1.7 * Math.pow(262 / f, 0.4);
  const w = (TAU * f) / SR;
  return render(len, (t) => {
    pc += w;
    pm += w;
    pt += w * 14;
    const idx = bright * (1.25 * Math.exp(-t / 0.22) + 0.22);
    const tine = 0.55 * vel * Math.exp(-t / 0.012) * Math.sin(pt);
    const env = Math.min(1, t / 0.003) * Math.exp(-t / decay) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.22));
    const trem = 1 + 0.08 * Math.sin(TAU * 4.6 * t);
    return Math.sin(pc + idx * Math.sin(pm) + tine) * env * trem * (len - t < 0.03 ? (len - t) / 0.03 : 1);
  });
};
/** A chord on the e-piano, rolled by `roll` seconds per note. */
const epChord = (bus: Stereo, t0: number, notes: number[], dur: number, peakDb: number, roll = 0.012, vel = 0.8) => {
  notes.forEach((m, k) => {
    const x = normPeak(epiano(m, dur, vel), BOARD(peakDb) / Math.sqrt(notes.length));
    place(bus, t0 + k * roll, x, {pan: ((k / Math.max(1, notes.length - 1)) * 2 - 1) * 0.3, mute: false});
  });
};

/** Additive felt piano: stretched partials, per-partial two-stage decay, a low-passed noise hammer. */
const feltPiano = (m: number, len: number): Float32Array => {
  const f0 = mtof(m);
  const B = 0.00032;
  const parts: Array<{f: number; a: number; tf: number; ts: number; ph: number}> = [];
  for (let n = 1; n <= 28; n++) {
    const f = n * f0 * Math.sqrt(1 + B * n * n);
    if (f > 6000) break;
    parts.push({f, a: Math.pow(n, -0.7) / (1 + Math.pow(f / 950, 2)), tf: 0.5 / (1 + 0.12 * n), ts: 7 / (1 + 0.22 * n), ph: rand() * TAU});
  }
  const lp = new SVF();
  return render(len, (t) => {
    let v = 0;
    for (const p of parts) {
      const env = 0.55 * Math.exp(-t / p.tf) + 0.45 * Math.exp(-t / p.ts);
      v += p.a * env * 0.5 * (Math.sin(TAU * p.f * t + p.ph) + Math.sin(TAU * p.f * 1.0007 * t + p.ph * 1.3));
    }
    const hammer = t < 0.08 ? lp.low(noise(), 700, 0.6) * Math.exp(-t / 0.012) * 0.35 : 0;
    return (v + hammer) * Math.min(1, t / 0.004);
  });
};

/** Soft pad: detuned saw pairs per note (spread across L/R), low-passed, slow attack. */
const pad = (notes: number[], dur: number, o: {attack?: number; release?: number; cutoff?: number; detune?: number} = {}): Stereo => {
  const attack = o.attack ?? 0.6;
  const release = o.release ?? 0.8;
  const cutoff = o.cutoff ?? 1100;
  const det = o.detune ?? 7;
  const c = (cents: number) => Math.pow(2, cents / 1200);
  const oscL = notes.flatMap((m) => [saw(mtof(m) * c(det)), saw(mtof(m) * c(-det * 0.6))]);
  const oscR = notes.flatMap((m) => [saw(mtof(m) * c(-det)), saw(mtof(m) * c(det * 0.6))]);
  const len = dur + release * 4;
  const n = Math.round(len * SR);
  const out = stereo(n);
  const fl = [new SVF(), new SVF()];
  const fr = [new SVF(), new SVF()];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = smooth(t / attack) * (t < dur ? 1 : Math.exp(-(t - dur) / release));
    const fc = cutoff * (1 + 0.12 * Math.sin(TAU * 0.13 * t));
    let l = 0;
    let r = 0;
    for (const o2 of oscL) l += o2();
    for (const o2 of oscR) r += o2();
    l = fl[1].low(fl[0].low(l / oscL.length, fc, 0.6), fc * 1.6, 0.5);
    r = fr[1].low(fr[0].low(r / oscR.length, fc, 0.6), fc * 1.6, 0.5);
    out.L[i] = l * env;
    out.R[i] = r * env;
  }
  return out;
};
const padRms = (p: Stereo, to: number) => {
  let s = 0;
  let k = 0;
  for (let i = 0; i < p.L.length; i++) if (p.L[i] !== 0) (s += p.L[i] * p.L[i] + p.R[i] * p.R[i]), (k += 2);
  const r = Math.sqrt(s / Math.max(1, k));
  for (let i = 0; i < p.L.length; i++) (p.L[i] *= to / r), (p.R[i] *= to / r);
  return p;
};

/** D1 drone: detuned saws, tanh-saturated, high-passed at 60 Hz (lives on 73/110/147 Hz) plus a 180–250 Hz body. */
const drone = (dur: number, fadeIn: number): Float32Array => {
  const f = mtof(note('D1'));
  const a = saw(f * Math.pow(2, 3 / 1200));
  const b = saw(f * Math.pow(2, -3 / 1200));
  const h1 = new SVF();
  const h2 = new SVF();
  const body = new SVF();
  const top = new SVF();
  const x = render(dur, (t) => {
    const drive = 2.2 + 0.4 * Math.sin(TAU * 0.11 * t);
    const s = Math.tanh(drive * 0.5 * (a() + b()));
    const hp = h2.high(h1.high(s, 60), 60);
    const bod = body.band(s, 215, 1.3) * (1.1 + 0.25 * Math.sin(TAU * 0.07 * t + 1));
    return top.low(hp + bod, 1400);
  });
  normRms(x);
  const nf = Math.max(1, at(fadeIn));
  for (let i = 0; i < Math.min(nf, x.length); i++) x[i] *= i / nf;
  for (let i = 0; i < Math.min(at(0.05), x.length); i++) x[x.length - 1 - i] *= i / at(0.05);
  return x;
};

/** Shepard-Risset riser: eight octave-spaced sines climbing on a loop under a Gaussian window, accelerating. */
const shepard = (dur: number): Float32Array => {
  const voices = 8;
  const ph = new Float64Array(voices);
  let p = 0;
  return render(dur, (t) => {
    const u = t / dur;
    p += (0.35 + 0.9 * u * u) / SR; // octaves per second, accelerating
    let v = 0;
    for (let k = 0; k < voices; k++) {
      const x = (k + p) % voices; // octaves above 55 Hz
      const f = 55 * Math.pow(2, x);
      ph[k] += (TAU * f) / SR;
      const w = Math.exp(-((x - 3.8) * (x - 3.8)) / (2 * 1.3 * 1.3));
      v += Math.sin(ph[k]) * w;
    }
    return v * Math.min(1, t / 0.05);
  });
};

/** Heartbeat: 55 Hz sine + saturated 110–120 Hz layer + soft 2–4 kHz beater tick; “dub” when there is room. */
const heartbeat = (dub: boolean): Float32Array => {
  const bp = new SVF();
  const tick = render(0.03, (t) => bp.band(noise(), 3000, 1.1) * Math.exp(-t / 0.005));
  const one = (tt: number, f1: number, f2: number) => {
    if (tt < 0) return 0;
    const sub = Math.sin(TAU * (f1 * tt + 25 * 0.02 * (1 - Math.exp(-tt / 0.02)))) * (1 - Math.exp(-tt / 0.004)) * Math.exp(-tt / 0.11);
    const mid = (Math.tanh(3 * Math.sin(TAU * (f2 * tt + 30 * 0.015 * (1 - Math.exp(-tt / 0.015))))) / Math.tanh(3)) * Math.exp(-tt / 0.07) * (1 - Math.exp(-tt / 0.002));
    const tk = tt < 0.03 ? tick[Math.floor(tt * SR)] : 0;
    return 0.75 * sub + 0.6 * mid + 0.2 * tk;
  };
  return normPeak(render(dub ? 0.5 : 0.32, (t) => one(t, 55, 116) + (dub ? 0.62 * one(t - 0.16, 60, 124) : 0)));
};

/** Rita’s ringtone: old desk-bell trill, 1.1 + 1.62 kHz partials with 20 Hz AM (alternating gongs), 0.6 s. */
const trillCore = (() => {
  const parts = [
    {f: 1100, a: 1, bell: 0, tau: 0.32},
    {f: 1620, a: 0.85, bell: 1, tau: 0.26},
    {f: 2390, a: 0.2, bell: 0, tau: 0.12},
    {f: 3310, a: 0.15, bell: 1, tau: 0.09},
    {f: 4480, a: 0.07, bell: 0, tau: 0.05},
  ].map((p) => ({...p, ph: rand() * TAU}));
  const hp = new SVF();
  const len = TRILL_LEN + 0.3;
  return normPeak(
    render(len, (t) => {
      const k = Math.floor(t * 20);
      const local = t - k / 20;
      const ringing = t < TRILL_LEN;
      let v = 0;
      for (const p of parts) {
        // While the clapper runs: 20 Hz AM, alternate strikes favour one gong. After: a short damped ring-out.
        const env = ringing ? 0.25 + 0.75 * (k % 2 === p.bell ? 1 : 0.5) * Math.exp(-local / 0.014) : 0.27 * Math.exp(-(t - TRILL_LEN) / (p.tau * 0.3));
        v += p.a * env * Math.sin(TAU * p.f * t + p.ph);
      }
      v *= Math.min(1, t / 0.0015, (len - t) / 0.03);
      if (ringing && local < 0.002) v += hp.high(noise(), 2500) * 0.3 * (1 - local / 0.002);
      return v;
    }),
  );
})();
/** The cradle rattling under the trill: a 120 Hz plastic buzz with the same 20 Hz strikes. */
const cradleRattle = (() => {
  const b1 = new SVF();
  const b2 = new SVF();
  return normPeak(
    render(TRILL_LEN + 0.03, (t) => {
      const buzz = Math.tanh(4 * Math.sin(TAU * 120 * t)) * 0.7 + noise() * 0.3;
      const am = 0.35 + 0.65 * Math.exp(-(t % 0.05) / 0.012);
      const env = Math.min(1, t / 0.004, (TRILL_LEN + 0.03 - t) / 0.03);
      return (b1.band(buzz, 240, 1.2) * 0.7 + b2.band(buzz, 1100, 2) * 0.35) * am * env;
    }),
  );
})();
/** ONE trill buffer (trill + cradle rattle + 0.4 s small room), reused unchanged at every full-level cue. */
const trillFull = (() => {
  const x = new Float32Array(trillCore.length);
  x.set(trillCore);
  addInto(x, cradleRattle, 0, dB(-13));
  return normStereoPeak(withRoom(x, 0.4, 0.3, {size: 0.4, damp: 0.3}));
})();

/** Gus’s ringtone: a soft FM chime, D5 then A4 an 8th later (the motif’s first two notes). */
const fmChimeNote = (m: number, len: number) => {
  const f = mtof(m);
  let pc = rand() * TAU;
  let p1 = rand() * TAU;
  let p2 = rand() * TAU;
  return render(len, (t) => {
    pc += (TAU * f) / SR;
    p1 += (TAU * f) / SR;
    p2 += (TAU * f * 3.5) / SR;
    const v = Math.sin(pc + (1.0 * Math.exp(-t / 0.18) + 0.15) * Math.sin(p1) + 0.9 * Math.exp(-t / 0.04) * Math.sin(p2));
    return v * Math.min(1, t / 0.002) * Math.exp(-t / 0.55) * Math.min(1, (len - t) / 0.04);
  });
};
const GUS_CHIME_GAP = 0.25; // A4 starts an 8th after D5, so the 0:20 cut (125 ms in) falls between the notes
const gusChime = (() => {
  const x = new Float32Array(at(GUS_CHIME_GAP + 0.95));
  addInto(x, fmChimeNote(note('D5'), 0.95), 0);
  addInto(x, fmChimeNote(note('A4'), 0.95), at(GUS_CHIME_GAP), 0.9);
  return normPeak(glass(normPeak(x)));
})();

/** Modal bell (logo, copy tap). */
const bell = (m: number, len = 2.2) => {
  const f = mtof(m);
  return normPeak(modal([[f, 1, 0.9], [f * 2.0, 0.35, 0.5], [f * 2.76, 0.25, 0.32], [f * 5.4, 0.08, 0.12], [f * 0.5, 0.12, 1.2]], len, 0.15, 3000));
};

// ─── Sound design ───────────────────────────────────────────────────────────

/** Band-passed noise sweeping fc0→fc1 with a swell to `peak` (fraction of len), optional pan sweep. */
const sweep = (len: number, o: {f0: number; f1: number; q?: number; peak?: number; pow?: number; decay?: number; pan0?: number; pan1?: number; f2?: number}): Stereo => {
  const bp = new SVF();
  const bp2 = new SVF();
  const peak = o.peak ?? 0.7;
  const pow = o.pow ?? 2;
  const decay = o.decay ?? 0.06;
  const n = Math.round(len * SR);
  const out = stereo(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = t / len;
    const pu = u / peak;
    const env = u < peak ? Math.pow(pu, pow) : Math.exp(-(t - peak * len) / decay);
    const fc = u < peak || o.f2 === undefined ? o.f0 * Math.pow(o.f1 / o.f0, Math.min(1, pu)) : o.f1 * Math.pow(o.f2 / o.f1, clamp((u - peak) / (1 - peak)));
    const x = bp2.band(bp.band(noise(), fc, o.q ?? 1.2), fc * 1.3, 0.8) * env * (n - i < 200 ? (n - i) / 200 : 1);
    const [pl, pr] = panGains((o.pan0 ?? 0) + ((o.pan1 ?? 0) - (o.pan0 ?? 0)) * smooth(u));
    out.L[i] = x * pl;
    out.R[i] = x * pr;
  }
  return normStereoPeak(out);
};

/** A vehicle passing: engine harmonics + tyre roar with Doppler, 1/r level, air absorption, pan by bearing. dir 1 = L→R. */
const passBy = (len: number, tPass: number, o: {d: number; v: number; engine: number; tyre: number; wind: number; hz: number; dir: 1 | -1}): Stereo => {
  const n = Math.round(len * SR);
  const out = stereo(n);
  const t1 = new SVF();
  const t2 = new SVF();
  const air = new SVF();
  const w1 = new SVF();
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const x = o.v * (t - tPass);
    const r = Math.sqrt(x * x + o.d * o.d);
    const dop = 343 / (343 + (o.v * x) / r);
    ph += (TAU * o.hz * dop) / SR;
    let eng = 0;
    for (let k = 1; k <= 7; k++) eng += (Math.sin(k * ph) * (k === 2 ? 1 : 0.7)) / Math.pow(k, 0.7);
    const tyre = t1.band(noise(), 650 * dop, 0.9) + 0.5 * t2.band(noise(), 1900 * dop, 1.4);
    const wind = w1.low(noise(), 2500) * Math.pow(o.d / r, 3);
    const near = o.d / r;
    let s = (Math.tanh(eng * 0.6) * o.engine + tyre * o.tyre + wind * o.wind) * near;
    s = air.low(s, 1200 + 9000 * Math.sqrt(near));
    const env = Math.min(1, t / 0.08, (len - t) / 0.08);
    const [pl, pr] = panGains(o.dir * (x / r) * 0.9);
    out.L[i] = s * pl * env;
    out.R[i] = s * pr * env;
  }
  return normStereoPeak(out);
};

/** Stick-slip creak: a jittered impulse train ringing a few resonances (seat, leather strap, car roof). */
const creak = (len: number, res: Array<[number, number, number]>, rate: [number, number]): Float32Array => {
  const bank = res.map(() => new SVF());
  let next = 0;
  return normPeak(
    render(len, (t) => {
      let x = 0;
      if (t >= next) {
        x = 0.6 + 0.4 * rand();
        const r = (rate[0] + (rate[1] - rate[0]) * Math.sin(Math.PI * (t / len))) * (0.75 + 0.5 * rand());
        next = t + 1 / r;
      }
      let y = 0;
      for (let k = 0; k < res.length; k++) y += bank[k].band(x, res[k][0], res[k][1]) * res[k][2];
      return y * Math.pow(Math.sin(Math.PI * Math.min(1, t / len)), 0.6);
    }),
  );
};

/** Ballpoint on a steno pad: paper-grain noise modulated by the strokes. */
const scratch = (dur: number, strokesPerSec = 9): Float32Array => {
  const bp = new SVF();
  const hp = new SVF();
  let ph = rand();
  return normPeak(
    render(dur + 0.02, (t) => {
      ph += (strokesPerSec * (0.7 + 0.6 * rand())) / SR;
      const stroke = Math.pow(Math.abs(Math.sin(Math.PI * ph)), 0.6);
      const grit = rand() > 0.985 ? noise() * 3 : 0;
      const x = bp.band(noise() + grit, 2900 + 1300 * stroke, 1.3) + hp.high(noise(), 6500) * 0.12;
      const env = t < dur ? Math.min(1, t / 0.008, (dur - t) / 0.01) : 0;
      return x * (0.2 + 0.8 * stroke) * env;
    }),
  );
};
/** Felt marker / highlighter: a smoother, lower swipe. */
const felt = (dur: number, fc = 2000, squeak = 0): Float32Array => {
  const bp = new SVF();
  let ph = 0;
  return normPeak(
    render(dur + 0.02, (t) => {
      const u = clamp(t / dur);
      const env = t < dur ? Math.pow(Math.sin(Math.PI * u), 0.5) : 0;
      ph += (TAU * (2100 + 500 * Math.sin(TAU * 2.2 * t) + 120 * noise())) / SR;
      const sq = squeak * Math.sin(ph) * (0.6 + 0.4 * Math.sin(TAU * (35 + 20 * rand()) * t));
      return (bp.band(noise(), fc * (0.9 + 0.2 * u), 0.8) + sq) * env;
    }),
  );
};

/** Slurp: noise through a moving formant with bubbly AM. */
const slurp = (dur: number): Float32Array => {
  const f1 = new SVF();
  const f2 = new SVF();
  return normPeak(
    render(dur, (t) => {
      const u = t / dur;
      const fc = 650 + 900 * Math.sin(Math.PI * u);
      const am = 0.55 + 0.45 * Math.abs(Math.sin(TAU * (18 + 14 * rand()) * t));
      const env = Math.pow(Math.sin(Math.PI * u), 0.8);
      return (f1.band(noise(), fc, 3) + 0.4 * f2.band(noise(), fc * 2.3, 4)) * am * env;
    }),
  );
};

/** Sub impact / thump: a falling sine, a saturated 100–110 Hz layer for phone speakers, a short crack. */
const impact = (len: number, o: {f0: number; f1: number; tau: number; mid: number; crack: number}): Float32Array => {
  const lp = new SVF();
  return normPeak(
    render(len, (t) => {
      const sub = Math.sin(TAU * (o.f1 * t + (o.f0 - o.f1) * 0.05 * (1 - Math.exp(-t / 0.05)))) * Math.exp(-t / o.tau);
      const mid = Math.tanh(4 * Math.sin(TAU * 108 * t)) * Math.exp(-t / (o.tau * 0.35)) * o.mid;
      const crack = lp.low(noise(), 2500) * Math.exp(-t / 0.015) * o.crack;
      return (sub + mid + crack) * Math.min(1, t / 0.002) * Math.min(1, (len - t) / 0.05);
    }),
  );
};

// One-off effects by id (SFX in marks.ts). Each lands at its mark, sample-exact.
const sfxClip = {
  boom: () =>
    // Low D on 73/110/147 Hz, 1.2 s.
    normPeak(
      (() => {
        const lp = new SVF();
        return render(1.4, (t) => {
          const glide = 1 + 0.04 * Math.exp(-t / 0.06);
          let v = 0;
          for (const [f, a] of [
            [73.42, 1],
            [110.0, 0.6],
            [146.83, 0.45],
          ])
            v += a * Math.sin(TAU * f * glide * t);
          const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.42);
          return (Math.tanh(1.6 * v * env) + lp.low(noise(), 250) * Math.exp(-t / 0.05) * 0.4) * Math.min(1, (1.4 - t) / 0.1);
        });
      })(),
    ),
  tap: () => {
    const lp = new SVF();
    return normPeak(render(0.06, (t) => lp.low(noise(), 900) * Math.exp(-t / 0.005) + 0.5 * Math.sin(TAU * 320 * t) * Math.exp(-t / 0.008)));
  },
  callBlip: () => normPeak(render(0.06, (t) => Math.sin(TAU * 880 * t) * Math.min(1, t / 0.004, (0.06 - t) / 0.004))),
  clothRustle: () => {
    const bp = new SVF();
    let spike = 0;
    return normPeak(
      render(0.28, (t) => {
        if (rand() > 0.997) spike = 1;
        spike *= 0.995;
        return bp.band(noise(), 1700, 0.7) * (0.3 + spike) * Math.sin(Math.PI * (t / 0.28));
      }),
    );
  },
  strapClink: () => {
    const a = modal([[3150, 1, 0.04], [4720, 0.6, 0.03], [6930, 0.35, 0.02]], 0.2, 0.2, 5000);
    addInto(a, modal([[3260, 1, 0.03], [4880, 0.5, 0.02]], 0.12), at(0.028), 0.55);
    return normPeak(a);
  },
  pickupClick: () => {
    // Dry line pickup: a sharp transient and a small low “dunk”, band-limited like the line it opens.
    const hp = new SVF();
    const x = render(0.06, (t) => hp.high(noise(), 1000) * Math.exp(-t / 0.0007) * 1.2 + Math.sin(TAU * 180 * t) * Math.exp(-t / 0.01) * 0.6 + Math.sin(TAU * 1400 * t) * Math.exp(-t / 0.004) * 0.5);
    const h2 = new SVF();
    for (let i = 0; i < x.length; i++) x[i] = h2.high(x[i], 220);
    return normPeak(x);
  },
  hangupClick: () => {
    const x = modal([[1250, 1, 0.006], [2700, 0.5, 0.003], [430, 0.4, 0.008]], 0.05, 0.6, 2500);
    return normPeak(x);
  },
  penClick: () => {
    const x = modal([[3400, 1, 0.003], [5200, 0.5, 0.002], [1800, 0.3, 0.005]], 0.06, 0.3, 5000);
    addInto(x, modal([[2600, 1, 0.003], [4100, 0.4, 0.002]], 0.02, 0.2), at(0.035), 0.6);
    return normPeak(x);
  },
  uiTick: () => normPeak(modal([[2300, 1, 0.01], [4600, 0.3, 0.004]], 0.05)),
  checkTick: () => {
    const x = modal([[1900, 1, 0.008], [3800, 0.25, 0.004]], 0.08);
    addInto(x, modal([[2850, 1, 0.01], [5700, 0.25, 0.004]], 0.05), at(0.04), 0.8);
    return normPeak(x);
  },
  pinTick: () => normPeak(modal([[1700, 1, 0.012], [3900, 0.5, 0.004], [620, 0.3, 0.01]], 0.06, 0.4, 3000)),
  toastPop: () => normPeak(render(0.09, (t) => Math.sin(TAU * (420 * t + 560 * 0.03 * (1 - Math.exp(-t / 0.03)))) * Math.exp(-t / 0.035) * Math.min(1, t / 0.002))),
  springTock: () => {
    const x = modal([[760, 1, 0.03], [1900, 0.35, 0.012], [3100, 0.15, 0.006]], 0.3, 0.3, 2500);
    addInto(x, render(0.3, (t) => 0.22 * Math.sin(TAU * 240 * t * (1 + 0.06 * Math.sin(TAU * 18 * t))) * Math.exp(-t / 0.11)), at(0.008));
    return normPeak(x);
  },
  mugClink: () => normPeak(modal([[2240, 1, 0.22], [3720, 0.55, 0.14], [5310, 0.3, 0.08], [7650, 0.15, 0.05]], 0.7, 0.35, 3000)),
  softBell: () => bell(note('A5'), 2.0),
  logoBell: () => {
    const x = bell(note('D6'), 2.4);
    addInto(x, bell(note('A6'), 2.0), 0, 0.25);
    return normPeak(x);
  },
} as const;

// ─── Ambience ───────────────────────────────────────────────────────────────

/** Sound perspective per shot: cicada level and muffling (car glass), neon level, glass hum, birds. */
type Persp = {cic: number; lp: number; neon: number; glassHum?: boolean; birds?: number; birdLp?: number};
const OPEN: Persp = {cic: 1, lp: 11000, neon: 1};
const CAR: Persp = {cic: 0.5, lp: 2600, neon: 0.3};
const PERSPECTIVE: Record<string, Persp> = {
  S01: OPEN, // Rita’s lobby (the loop lands here, so it matches S27’s open air)
  S02: {cic: 0.8, lp: 9000, neon: 0.5},
  S03: {cic: 0.9, lp: 9000, neon: 0.4, glassHum: true},
  S04: CAR,
  S05: {cic: 1, lp: 12000, neon: 1},
  S06: CAR,
  S07: {cic: 0.6, lp: 3500, neon: 0.3},
  S08: {cic: 0.8, lp: 9000, neon: 0.4, glassHum: true},
  S09: {cic: 0.6, lp: 4000, neon: 0.3, glassHum: true},
  S10: CAR,
  S11: CAR,
  S12: CAR,
  S13: CAR,
  S14: {cic: 0.25, lp: 1800, neon: 0.1},
  S15: CAR,
  S16: CAR,
  S17: CAR,
  S18: OPEN,
  S19: OPEN,
  S20: {cic: 0.3, lp: 2000, neon: 0.15},
  S21: {cic: 0, lp: 3000, neon: 0.3, birds: 0.55, birdLp: 3200},
  S22: {cic: 0, lp: 3000, neon: 0, birds: 0.45, birdLp: 4500},
  S23: {cic: 0, lp: 3000, neon: 0, birds: 1, birdLp: 9000},
  S24: {cic: 0, lp: 3000, neon: 0, birds: 0.4, birdLp: 3500},
  S25: {cic: 0, lp: 3000, neon: 0, birds: 0.38, birdLp: 3500},
  S26: {cic: 0, lp: 3000, neon: 0},
  S27: {cic: 1, lp: 10000, neon: 0.6},
};
/** A per-sample automation curve from a per-shot value, smoothed over ~8 ms at the cuts. */
const perShot = (value: (p: Persp) => number): Float32Array => {
  const out = new Float32Array(N);
  for (const sh of SHOTS) {
    const v = value(PERSPECTIVE[sh.id] ?? OPEN);
    for (let i = at(sh.start); i < Math.min(N, at(sh.end)); i++) out[i] = v;
  }
  const a = 1 - Math.exp(-1 / (0.008 * SR));
  let y = out[0];
  for (let i = 0; i < N; i++) out[i] = y += (out[i] - y) * a;
  return out;
};
const inSpans = (spans: readonly Span[], t: number) => spans.some((s) => t >= s.start && t < s.end);

// Night: cicadas (band-passed tymbal pulses in phrases), far highway hum, 60 Hz neon buzz. From frame 0, no fade-in.
{
  const night = AMBIENCE.night;
  const cic = newBus();
  for (let v = 0; v < 6; v++) {
    const fc = 4300 + rand() * 2400;
    const rate = 42 + rand() * 60;
    const [pl, pr] = panGains((rand() * 2 - 1) * 0.7);
    const lvl = dB(-2 - rand() * 10);
    const b1 = new SVF();
    const b2 = new SVF();
    for (const sp of night) {
      const a = at(sp.start);
      const b = Math.min(N, at(sp.end));
      let on = rand() < 0.6;
      let segA = a - Math.round(rand() * 0.8 * SR); // may start mid-phrase: the bed is there on frame 0
      let segLen = Math.round((on ? 0.6 + rand() * 2.2 : 0.15 + rand() * 1.4) * SR);
      let peak = 0.5 + 0.5 * rand();
      let ph = rand();
      for (let i = a; i < b; i++) {
        if (i >= segA + segLen) {
          on = !on;
          segA = i;
          segLen = Math.round((on ? 0.4 + rand() * 2.2 : 0.15 + rand() * 1.4) * SR);
          peak = 0.5 + 0.5 * rand();
        }
        ph += rate / SR;
        if (ph >= 1) ph -= 1;
        const x = b2.band(b1.band(noise(), fc, 6), fc * 1.03, 4);
        if (!on) continue;
        const u = (i - segA) / segLen;
        const env = peak * Math.min(1, u / 0.12, (1 - u) / 0.2);
        const pulse = Math.pow(Math.max(0, Math.sin(TAU * ph)), 6);
        const s = x * pulse * env * lvl;
        cic.L[i] += s * pl;
        cic.R[i] += s * pr;
      }
    }
  }
  // A dense distant chorus under the individuals.
  {
    const bl = new SVF();
    const br = new SVF();
    for (const sp of night) {
      for (let i = at(sp.start); i < Math.min(N, at(sp.end)); i++) {
        const am = 0.55 + 0.45 * Math.sin((TAU * 65 * i) / SR);
        cic.L[i] += bl.band(noise(), 5200, 2.5) * am * 0.12;
        cic.R[i] += br.band(noise(), 5350, 2.5) * am * 0.12;
      }
    }
  }
  // Perspective: muffled through the car glass, open in the lot.
  const gain = perShot((p) => p.cic);
  const lpf = perShot((p) => p.lp);
  const fl = new SVF();
  const fr = new SVF();
  // Level: the band-passed pulse bed is normalized against its open-air RMS.
  let s = 0;
  let k = 0;
  for (let i = 0; i < at(3); i++) (s += cic.L[i] ** 2 + cic.R[i] ** 2), (k += 2);
  const norm = BOARD(-37) / Math.sqrt(s / k);
  for (let i = 0; i < N; i++) {
    const g = gain[i] * norm;
    amb.L[i] += fl.low(cic.L[i], lpf[i]) * g;
    amb.R[i] += fr.low(cic.R[i], lpf[i]) * g;
  }

  // Far highway hum: low-passed noise at 180 Hz with a faint tyre band, slowly swelling.
  const h1 = new SVF();
  const h2 = new SVF();
  const h3 = new SVF();
  const hum = render(LENGTH, (t) => {
    if (!inSpans(night, t)) return 0;
    return (h2.low(h1.low(noise(), 180), 180) + 0.12 * h3.band(noise(), 480, 1)) * (1 + 0.3 * Math.sin(TAU * 0.07 * t));
  });
  normRms(hum, BOARD(-40));
  const humGain = perShot((p) => (p.cic > 0 ? 0.6 + 0.4 * p.cic : 0));
  for (let i = 0; i < N; i++) {
    amb.L[i] += hum[i] * humGain[i];
    amb.R[i] += hum[(i + 24000) % N] * humGain[i];
  }

  // 60 Hz neon buzz at −38 dB (+ its rectified 120 Hz harmonics and arc crackle, so phones hear it).
  // It dips with each sign flicker, swells under the S05 crane, and in S21 the Starlite sign stutters off.
  const neonLvl = perShot((p) => p.neon);
  const crack = new SVF();
  const nhp = new SVF();
  const signOff = NEON_DIPS[3];
  const neonEnd = signOff.t + signOff.frames / FPS;
  const neon = render(LENGTH, (t) => {
    const lit = inSpans(night, t) || (t >= AMBIENCE.morning.start && t < neonEnd);
    if (!lit) return 0;
    let g = 1;
    for (const d of NEON_DIPS) {
      if (d === signOff) continue;
      if (t >= d.t && t < d.t + d.frames / FPS) g *= 0.3;
    }
    if (t >= signOff.t) g *= Math.floor((t - signOff.t) * FPS) % 2 === 0 ? 0 : 0.8; // 3-frame stutter, then off
    const sw = AMBIENCE.neonSwell;
    if (t >= sw.start && t < sw.end) g *= 1 + 1.0 * smooth((t - sw.start) / 0.5);
    const s = Math.sin(TAU * 60 * t);
    const r = Math.abs(s);
    const buzz = 0.35 * s + 0.65 * (Math.pow(r, 6) - 0.3125) + crack.band(noise(), 2800, 1.5) * Math.pow(r, 20) * 0.5;
    return nhp.high(buzz, 50) * g;
  });
  normRms(neon, BOARD(-38));
  for (let i = 0; i < N; i++) {
    const v = neon[i] * neonLvl[i];
    amb.L[i] += v * dB(1);
    amb.R[i] += v * dB(-1);
  }

  // Faint glass hum in the binocular shots (S03, S08, S09).
  const gh = perShot((p) => (p.glassHum ? 1 : 0));
  const ghp = new SVF();
  const glassHum = render(LENGTH, (t) => (Math.sin(TAU * 333 * t) + 0.6 * Math.sin(TAU * 333.7 * t) + 0.35 * Math.sin(TAU * 500.5 * t) + 0.3 * ghp.high(noise(), 7000)) * 0.4);
  normRms(glassHum, BOARD(-44));
  for (let i = 0; i < N; i++) {
    amb.L[i] += glassHum[i] * gh[i];
    amb.R[i] += glassHum[i] * gh[i];
  }
}

// Morning: room tone and synth birdsong, ending in the S25 → end-card crossfade.
{
  const sp = AMBIENCE.morning;
  const end = sp.end;
  const birds = newBus();
  const chirp = (b: Stereo, t0: number, f0: number, f1: number, dur: number, pan: number, gain: number, trill = 0) => {
    let ph = 0;
    const x = render(dur, (t) => {
      const u = t / dur;
      const f = f0 + (f1 - f0) * (0.5 - 0.5 * Math.cos(Math.PI * u)) + trill * Math.sin(TAU * 38 * t);
      ph += (TAU * f) / SR;
      return Math.sin(ph) * Math.pow(Math.sin(Math.PI * u), 1.5);
    });
    place(b, t0, x, {gain, pan, mute: false});
  };
  // Robin-like phrases, sparrow trills and a distant two-note whistle, placed by a seeded walk.
  for (let t = sp.start + 0.15; t < end - 0.3; t += 1.6 + rand() * 1.4) {
    const notes = 3 + Math.floor(rand() * 4);
    let tt = t;
    for (let k = 0; k < notes; k++) {
      const f0 = 2200 + rand() * 1600;
      const len = 0.06 + rand() * 0.07;
      chirp(birds, tt, f0, f0 * (0.75 + rand() * 0.6), len, -0.4, 0.9, rand() < 0.3 ? 120 : 0);
      tt += len + 0.02 + rand() * 0.05;
    }
  }
  for (let t = sp.start + 0.9; t < end - 0.5; t += 2.4 + rand() * 1.8) {
    const count = 6 + Math.floor(rand() * 6);
    for (let k = 0; k < count; k++) chirp(birds, t + k * 0.08, 6200, 4300, 0.03, 0.5, 0.45);
  }
  for (let t = sp.start + 1.6; t < end - 0.8; t += 3.2 + rand() * 1.5) {
    chirp(birds, t, 1850, 1780, 0.28, 0.1, 0.3);
    chirp(birds, t + 0.38, 1480, 1400, 0.34, 0.1, 0.28);
  }
  const room = new SVF();
  const room2 = new SVF();
  const bLvl = perShot((p) => p.birds ?? 0);
  const bLp = perShot((p) => p.birdLp ?? 3000);
  const fl = new SVF();
  const fr = new SVF();
  let s = 0;
  let k = 0;
  for (let i = at(sp.start); i < at(end); i++) (s += birds.L[i] ** 2 + birds.R[i] ** 2), (k += 2);
  const norm = BOARD(-34) / Math.sqrt(s / k);
  const roomTone = render(end - sp.start, () => room2.low(room.low(noise(), 1200), 1200));
  normRms(roomTone, BOARD(-48));
  const a = at(sp.start);
  for (let i = a; i < Math.min(N, at(end)); i++) {
    const t = i / SR;
    const fade = clamp((end - t) / 0.25) * clamp((t - sp.start) / 0.3);
    amb.L[i] += (fl.low(birds.L[i], bLp[i]) * bLvl[i] * norm + roomTone[i - a]) * fade;
    amb.R[i] += (fr.low(birds.R[i], bLp[i]) * bLvl[i] * norm + roomTone[i - a]) * fade;
  }
}

// ─── Score ──────────────────────────────────────────────────────────────────
// Each section has its own room and its own hard stop, so a cut kills the tail too.

type Section = {name: string; from: number; cut: number; fade: number; rt: number; wet: number; bus: Stereo};
const sections: Section[] = [];
const section = (name: string, from: number, cut: number, fade: number, rt: number, wet: number): Section => {
  const s = {name, from, cut, fade, rt, wet, bus: newBus()};
  sections.push(s);
  return s;
};
const pickupMute = MUTES[0];
const hangupMute = MUTES[1];
const SEC = {
  // S01: the D1 drone only, ending on the 3.0 cut.
  intro: section('intro', 0, 3.0, 0.004, 0, 0),
  // S03–S07: pizz hint, pizz pulse, cymbal swell, first motif over the pad, Shepard riser; HARD MUTE at 15.5.
  build: section('build', MUSIC.pizzHint - 0.05, pickupMute.start, pickupMute.fade, 1.5, 0.3),
  // S10–S16: pickup + heist ostinato; STOPS DEAD on the hang-up click.
  heist: section('heist', MUSIC.pickup - 0.02, hangupMute.start, Math.max(0.001, hangupMute.fade), 1.1, 0.22),
  // S17: one felt-piano D2 with a long tail, cut by the 38.5 smash cut.
  mirror: section('mirror', MUSIC.feltPiano, MUSIC.twistSilent.start, 0.006, 2.4, 0.45),
  // S20: the drone returns under the board, the Dm♭9 stab at 45.5.
  board: section('board', MUSIC.drone[1].start, MUSIC.drone[1].end, 0.05, 1.6, 0.2),
  // S21–S26: dawn motif, Asus4 held, resolve on the copy tap, end-card cadence; the iris cuts it at 59.75.
  dawn: section('dawn', MUSIC.asus4.start, MUSIC.irisCut, 0.015, 1.8, 0.32),
  // S27: the motif in minor on the muted celesta, decayed by 62.2.
  stinger: section('stinger', MUSIC.silence.end, S27.cicadasOnly - 0.06, 0.06, 1.2, 0.3),
};
const put = (s: Section, t: number, clip: Float32Array | Stereo, peakDb: number, pan = 0) => {
  const p = clip instanceof Float32Array ? peakAbs(clip) : Math.max(peakAbs(clip.L), peakAbs(clip.R));
  place(s.bus, t, clip, {gain: BOARD(peakDb) / (p || 1), pan, mute: false});
};

// S01 / S20: the D1 drone at −30 dB (S01 from frame 0 with no fade-in).
place(SEC.intro.bus, MUSIC.drone[0].start, drone(MUSIC.drone[0].end - MUSIC.drone[0].start + 0.1, 0.003), {gain: BOARD(-30), mute: false});
place(SEC.board.bus, MUSIC.drone[1].start, drone(MUSIC.drone[1].end - MUSIC.drone[1].start + 0.1, 0.3), {gain: BOARD(-30), mute: false});

// S03: a single KS pizz on D2 at −24 dB, foreshadowing the ostinato.
put(SEC.build, MUSIC.pizzHint, pizz(note('D2'), {stacc: 0.6, t60: 1.2}), -24);
// S04–S05: pizz pulse on D2 quarters at −28 dB, dropping out at 11.0.
for (const t of MUSIC.pizzPulse) put(SEC.build, t, pizz(note('D2'), {stacc: 0.3, bright: 0.4}), -28);
// S04: reversed-cymbal swell into the S05 boom.
{
  const {start, end} = MUSIC.cymbalSwell;
  const len = end - start;
  const hp = new SVF();
  const lp = new SVF();
  const metal = [3150, 4230, 5370, 6890, 8120, 9450].map((f) => ({f, ph: rand() * TAU}));
  const x = render(len, (t) => {
    const u = t / len;
    let m = 0;
    for (const p of metal) m += Math.sign(Math.sin(TAU * p.f * t + p.ph));
    const v = hp.high(noise() + m * 0.08, 3500);
    return lp.low(v, 2500 + 9000 * u) * Math.exp((t - len) / 0.17) * Math.min(1, (len - t) / 0.002);
  });
  put(SEC.build, start, x, -22, 0.15);
}
// S05: the FIRST FULL MOTIF on celesta (E5 held) over a D-minor pad; S06: the pad sustains.
const motifNotes = (mode: 'minor' | 'major') => MOTIF_PITCHES[mode].map(note);
for (const mo of MOTIFS) {
  const notes = motifNotes(mo.mode);
  mo.notes.forEach((t, k) => {
    const last = k === 3;
    if (mo.voice === 'celesta') put(mo.shot === 'S05' ? SEC.build : SEC.heist, t, celesta(notes[k], {len: last ? 2.6 : 1.6}), (mo.shot === 'S05' ? -20 : -21) - (last ? 2 : 0), -0.15 + 0.1 * k);
    else if (mo.voice === 'mutedCelesta') put(SEC.stinger, t, celesta(notes[k], {muted: true, len: 0.6}), -22, -0.1 + 0.07 * k);
    else {
      const soft = mo.shot === 'S23';
      const endCard = mo.voice === 'epiano+celesta';
      put(SEC.dawn, t, epiano(notes[k], last ? 1.4 : 0.45, soft ? 0.6 : 0.85), soft ? -23 : endCard ? -19 : -18, -0.1 + 0.07 * k);
      if (endCard) put(SEC.dawn, t, celesta(notes[k] + 12, {len: last ? 2.4 : 1.4}), -26, 0.25);
    }
  });
}
place(SEC.build.bus, MUSIC.pad.start, padRms(pad(['D3', 'F3', 'A3'].map(note), MUSIC.pad.end - MUSIC.pad.start, {attack: 0.5, release: 0.12, cutoff: 1000}), BOARD(-32)), {mute: false});
// S07: Shepard riser 12.5 → the click, crescendo; the 15.5 HARD MUTE takes it out.
{
  const {start, end} = MUSIC.riser;
  const x = shepard(end - start + 0.03);
  normRms(x);
  for (let i = 0; i < x.length; i++) x[i] *= dB(-38 + 12 * Math.pow(i / x.length, 1.4));
  place(SEC.build.bus, start, x, {gain: dB(-MASTER_EST), mute: false});
}

// S08–S10: one E6 sine, −34 dB from the click, −44 dB from AI01’s first word, gone by 20.0 (it ignores the score mute).
{
  const {start, duck, end} = MUSIC.e6;
  const f = mtof(note('E6'));
  const x = render(end - start, (t) => {
    const T = start + t;
    const lvl = T < duck ? -34 : -34 - 10 * smooth((T - duck) / 0.15);
    return Math.sin(TAU * f * t) * BOARD(lvl) * Math.min(1, t / 0.004) * clamp((end - T) / 0.9) * (1 + 0.05 * Math.sin(TAU * 0.9 * t));
  });
  place(musicFree, start, x, {mute: false});
}

// S10–S16: A3 pickup, then the pizzicato heist ostinato from the 20.5 downbeat.
put(SEC.heist, MUSIC.pickup, pizz(note('A3'), {stacc: 0.12, bright: 0.7}), -20, 0.1);
{
  const os = MUSIC.ostinato;
  const base = ['D3', 'D3', 'F3', 'D3', 'A3', 'D3', 'F3', 'E3'].map(note);
  const add9 = ['D3', 'E3', 'F3', 'D3', 'A3', 'E3', 'F3', 'E3'].map(note);
  const upper = ['D4', 'E4', 'F4', 'D4', 'A4', 'E4', 'F4', 'E4'].map(note);
  const woodTick = () => modal([[1850, 1, 0.012], [3150, 0.4, 0.006], [620, 0.3, 0.015]], 0.06, 0.25, 3000);
  for (let e = 0; os.start + e * 0.25 < os.stop; e++) {
    const t = os.start + e * 0.25;
    const p = e % 8;
    const accent = p === 0 ? 1 : p === 4 ? 0.95 : 0.8;
    const phase = t < os.thin ? 'base' : t < os.bright ? 'thin' : t < os.settle ? 'bright' : t < os.thinUnderAI04 ? 'settle' : 'thinner';
    if (phase === 'base' || phase === 'settle') put(SEC.heist, t, pizz(base[p], {stacc: 0.14, bright: 0.55}), -20 + toDb(accent), p % 2 ? 0.18 : -0.12);
    if (phase === 'bright') {
      put(SEC.heist, t, pizz(add9[p], {stacc: 0.14, bright: 0.7}), -20 + toDb(accent), -0.15);
      put(SEC.heist, t, pizz(upper[p], {stacc: 0.1, bright: 0.8}), -27 + toDb(accent), 0.25);
    }
    if (phase === 'thinner' && p % 2 === 0) put(SEC.heist, t, pizz(base[p], {stacc: 0.1, bright: 0.45}), -25, 0);
    if (p % 2 === 1) put(SEC.heist, t, woodTick(), phase === 'thin' ? -26 : -28, 0.3);
    if (p === 0 || p === 4) put(SEC.heist, t, pizz(p === 0 ? note('D2') : note('A1'), {stacc: 0.38, t60: 1.4, bright: 0.35}), -18, 0);
  }
}

// S17: one felt-piano D2 at 37.0 with a long tail.
put(SEC.mirror, MUSIC.feltPiano, feltPiano(note('D2'), MUSIC.twistSilent.start - MUSIC.feltPiano + 0.1), -14);

// S20: dissonant saw stab D–F–A–E♭ (Dm♭9): 7 detuned saws per note, fast-closing 24 dB low-pass, a plate.
{
  const notes = ['D2', 'D3', 'F3', 'A3', 'Eb4'].map(note);
  const len = 1.3;
  const n = Math.round(len * SR);
  const x = stereo(n);
  const oscs = notes.flatMap((m) => Array.from({length: 7}, (_, k) => ({o: saw(mtof(m) * Math.pow(2, ((k - 3) * 6) / 1200)), left: k % 2 === 0})));
  const f = [new SVF(), new SVF(), new SVF(), new SVF()];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let l = 0;
    let r = 0;
    for (const o of oscs) {
      const v = o.o();
      if (o.left) l += v;
      else r += v;
    }
    const fc = 260 + 7000 * Math.exp(-t / 0.08);
    l = f[1].low(f[0].low(l, fc, 0.5412), fc, 1.3066);
    r = f[3].low(f[2].low(r, fc, 0.5412), fc, 1.3066);
    const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.33) * Math.min(1, (len - t) / 0.05);
    x.L[i] = l * env;
    x.R[i] = r * env;
  }
  put(SEC.board, MUSIC.stab, withRoom(normStereoPeak(x), 1.5, 0.4, {size: 0.65, damp: 0.08, pre: 0.01}), -11);
}

// S21–S25: Asus4 pad (A–D–E) from the dawn, held UNRESOLVED; on the copy tap it resolves to Dadd9.
{
  const {start, resolve} = MUSIC.asus4;
  place(SEC.dawn.bus, start, padRms(pad(['A2', 'E3', 'A3', 'D4', 'E4'].map(note), resolve - start, {attack: 0.9, release: 0.12, cutoff: 1300}), BOARD(-30)), {mute: false});
  // e-piano fragments that never resolve (around, never on, the S23 motif).
  for (const [t, m, d] of [
    [48.5, 'A4', -25],
    [49.0, 'D5', -25],
    [49.5, 'E5', -26],
    [52.0, 'A4', -26],
  ] as const)
    put(SEC.dawn, t, epiano(note(m), 0.4, 0.5), d, 0.2);
  // 52.5: the resolve, struck on the e-piano, then light D-major comping swelling into the end card.
  place(SEC.dawn.bus, resolve, padRms(pad(['D2', 'A2', 'D3', 'F#3', 'A3', 'E4'].map(note), 56.0 - resolve, {attack: 0.06, release: 0.2, cutoff: 1500}), BOARD(-29)), {mute: false});
  epChord(SEC.dawn.bus, resolve, ['D3', 'A3', 'F#4', 'A4', 'E5'].map(note), 1.2, -15, 0.014, 0.85);
  const comp: Array<[number, string[], number]> = [
    [53.0, ['F#4', 'A4', 'D5'], -25],
    [53.5, ['D4', 'G4', 'B4'], -23],
    [54.0, ['E4', 'A4', 'D5'], -21],
    [54.5, ['D3', 'A3', 'D4', 'F#4'], -18],
  ];
  for (const [t, ns, d] of comp) epChord(SEC.dawn.bus, t, ns.map(note), 0.4, d, 0.01, 0.6);
}
// S26: A7sus (56.0) → A (56.5) → Dadd9 landing on the “I” of “I will”, rings out, light comping under Beat B.
{
  const {a7sus, a, dadd9} = MUSIC.cadence;
  place(SEC.dawn.bus, a7sus, padRms(pad(['A2', 'E3', 'G3', 'D4'].map(note), a - a7sus, {attack: 0.05, release: 0.12, cutoff: 1500}), BOARD(-31)), {mute: false});
  place(SEC.dawn.bus, a, padRms(pad(['A2', 'E3', 'A3', 'C#4'].map(note), dadd9 - a, {attack: 0.05, release: 0.12, cutoff: 1600}), BOARD(-31)), {mute: false});
  place(SEC.dawn.bus, dadd9, padRms(pad(['D2', 'A2', 'D3', 'F#3', 'A3', 'E4'].map(note), MUSIC.irisCut - dadd9 + 0.2, {attack: 0.04, release: 0.5, cutoff: 1800}), BOARD(-29)), {mute: false});
  epChord(SEC.dawn.bus, a7sus, ['A2', 'G3', 'D4', 'E4'].map(note), 0.45, -23, 0.01, 0.6);
  epChord(SEC.dawn.bus, a, ['A2', 'A3', 'C#4', 'E4'].map(note), 0.6, -22, 0.01, 0.65);
  epChord(SEC.dawn.bus, dadd9, ['D2', 'D3', 'A3', 'D4', 'F#4', 'A4', 'E5'].map(note), 2.5, -16, 0.012, 0.9);
  put(SEC.dawn, dadd9 + 0.02, celesta(note('D6'), {len: 2.4}), -21, 0.3);
  for (const [t, ns] of [
    [58.0, ['F#4', 'A4', 'E5']],
    [58.75, ['G4', 'B4', 'D5']],
    [59.25, ['F#4', 'A4', 'D5']],
  ] as const)
    epChord(SEC.dawn.bus, t, ns.map(note), 0.35, -25, 0.01, 0.5);
}

// Close each section: its room, then its hard stop (which also ends the tail).
for (const s of sections) {
  const a = Math.max(0, at(s.from) - 1);
  const iCut = at(s.cut);
  const nf = Math.max(1, at(s.fade));
  const b = Math.min(N, iCut + nf + 1);
  if (s.wet > 0) {
    const w = reverbWet(s.bus, {rt: s.rt, from: a, to: b, size: 0.85, damp: 0.35, pre: 0.012, hp: 140});
    for (let i = a; i < b; i++) {
      s.bus.L[i] += w.L[i] * s.wet;
      s.bus.R[i] += w.R[i] * s.wet;
    }
  }
  for (let i = iCut; i < N; i++) {
    const g = i < iCut + nf ? 1 - (i - iCut) / nf : 0;
    s.bus.L[i] *= g;
    s.bus.R[i] *= g;
  }
  for (let i = a; i < b; i++) {
    music.L[i] += s.bus.L[i];
    music.R[i] += s.bus.R[i];
  }
}

// ─── Sound effects ──────────────────────────────────────────────────────────

const putFx = (bus: Stereo, t: number, clip: Float32Array | Stereo, peakDb: number, o: PlaceOpts = {}) => {
  const p = clip instanceof Float32Array ? peakAbs(clip) : Math.max(peakAbs(clip.L), peakAbs(clip.R));
  place(bus, t, clip, {...o, gain: BOARD(peakDb) / (p || 1)});
};

// Rita’s trill: the same buffer at full level (frame 0, 38.5, 40.0, 41.5); at 1.5 ducked −9 dB with a −6 dB
// high shelf above 1 kHz under R01; at 61.0 through Gus’s glass at −14 dB, a further −6 dB under G02.
const TRILL_PEAK = -9;
for (const cueT of TRILL_CUES) {
  if (cueT.mix === 'full') putFx(sfxFree, cueT.t, trillFull, TRILL_PEAK, {mute: false});
  else if (cueT.mix === 'ducked') {
    const d = stereo(trillFull.L.length);
    const sl = new SVF();
    const sr = new SVF();
    for (let i = 0; i < d.L.length; i++) {
      d.L[i] = sl.shelf(trillFull.L[i], 1000, -6);
      d.R[i] = sr.shelf(trillFull.R[i], 1000, -6);
    }
    place(sfx, cueT.t, d, {gain: BOARD(TRILL_PEAK - 9), mute: false}); // and it rides the voice duck
  } else {
    const g = glass(trillCore);
    const underG02 = CUES.some((c) => c.role === 'gus' && cueT.t >= c.at && cueT.t < c.end) ? -6 : 0;
    putFx(sfxFree, cueT.t, withRoom(g, 0.8, 0.25, {size: 0.6}), TRILL_PEAK - 14 + underG02, {mute: false});
  }
}
// S17: the trill’s reverse-reverb pre-echo swelling 37.9 → 38.5 into the smash cut (non-diegetic).
{
  const {start, end} = TRILL_PRE_ECHO;
  const src = stereo(trillCore.length + at(2.6));
  src.L.set(trillCore);
  src.R.set(trillCore);
  const w = reverbWet(src, {rt: 2.4, size: 1, damp: 0.25});
  const len = at(end - start);
  const x = stereo(len);
  for (let i = 0; i < len; i++) {
    const j = len - 1 - i; // reversed: the tail first, the onset last
    const fadeIn = smooth(i / (len * 0.35));
    x.L[i] = w.L[j] * fadeIn;
    x.R[i] = w.R[j] * fadeIn;
  }
  putFx(sfxFree, start, x, TRILL_PEAK - 5, {mute: false});
}

// Gus’s chime through his office glass (−12 dB). At 0:20 in S02 his phone dies: every chime still sounding is
// cut at GUS_CHIME_CUT, the 4.875 one 125 ms in, between D5 and A4, with no tail.
for (const t of GUS_CHIMES) putFx(sfx, t, gusChime, TRILL_PEAK - 12, {cut: t < GUS_CHIME_CUT ? GUS_CHIME_CUT : undefined, fade: 0.002, pan: 0.1});

// Heartbeat on every counter jump (55 Hz + 110–120 Hz layer + beater); a “dub” when the next beat is far enough.
// S02’s stop at 5.0 (0:20) and the S18 skip at 40.0 are in HEARTBEAT itself.
HEARTBEAT.forEach((t, k) => {
  const next = HEARTBEAT[k + 1] ?? Infinity;
  const inS07 = t >= 12.5 && t < 15.5;
  const lvl = inS07 ? -17 + 4 * ((t - 12.5) / 2.9) : -15;
  putFx(sfx, t, heartbeat(next - t >= 0.45), lvl, {cut: t < S02.stop ? S02.stop : undefined, fade: 0.003});
});
// Dry clock tick on every S02 counter jump before 0:20 and every S27 jump.
const clockTick = () => normPeak(modal([[2450, 1, 0.006], [4100, 0.6, 0.003], [1200, 0.3, 0.01]], 0.05, 0.5, 5000));
for (const t of CLOCK_TICKS) putFx(sfx, t, clockTick(), -26, {cut: t < S02.stop ? S02.stop : undefined, pan: -0.05});

// S07: one US ringback burst (440 + 480 Hz) through the phone band in Rita’s ear, ducked −6 dB under her VO.
{
  const {start, end} = RINGBACK;
  const x = render(end - start, (t) => (Math.sin(TAU * 440 * t) + Math.sin(TAU * 480 * t)) * 0.5 * Math.min(1, t / 0.01, (end - start - t) / 0.01) * 0.6);
  putFx(phone, start, normPeak(phoneBand(x)), -30);
}

// S19: three-tone descending call-ended beep, from the lobby phone.
{
  const x = new Float32Array(at(0.5));
  for (const b of S19.beep) {
    const tone = render(b.dur, (t) => (Math.sin(TAU * b.hz * t) + 0.15 * Math.sin(TAU * 3 * b.hz * t)) * Math.min(1, t / 0.003, (b.dur - t) / 0.003));
    addInto(x, tone, at(b.t - S19.beep[0].t));
  }
  putFx(sfx, S19.beep[0].t, withRoom(x, 0.4, 0.22, {size: 0.4}), -20);
}

// The flat one-offs.
const playSfx = (e: Sfx) => {
  const t = e.t;
  switch (e.id) {
    case 'carPass': {
      // Distant, L→R: S03 −30 dB, S10 −32 dB under the light sweep.
      const s03 = e.shot === 'S03';
      return putFx(sfx, t - 0.6, passBy(1.5, 0.75, {d: s03 ? 30 : 22, v: 24, engine: 0.5, tyre: 1, wind: 0.2, hz: s03 ? 92 : 104, dir: 1}), s03 ? -30 : -32);
    }
    case 'truckDoppler': {
      // R→L, passing the camera at 13.0 (the headlight bar), pitch dropping.
      const tPass = 13.0;
      return putFx(sfx, (e.t ?? 12.8) - 0.2, passBy((e.end ?? 13.5) - e.t + 0.45, tPass - e.t + 0.2, {d: 4, v: 22, engine: 1, tyre: 0.9, wind: 0.9, hz: 68, dir: -1}), -13);
    }
    case 'seatCreak':
      return putFx(sfx, t, creak(0.35, [[320, 3, 1], [710, 4, 0.7], [1500, 5, 0.4]], [35, 90]), -27, {pan: -0.2});
    case 'strapCreak':
      return putFx(e.shot === 'S09' ? sfxFree : sfx, t, creak(e.shot === 'S09' ? 0.22 : 0.3, [[650, 4, 1], [1450, 5, 0.6], [2900, 6, 0.3]], [60, 140]), e.shot === 'S09' ? -31 : -29, {pan: 0.15, mute: false});
    case 'roofCreak':
      return putFx(sfx, t, creak(0.5, [[190, 8, 1], [440, 10, 0.6], [1150, 8, 0.3]], [20, 50]), -36);
    case 'penScribble':
      return putFx(sfx, t, scratch((e.end ?? t + 0.6) - t, 6), -27, {pan: 0.1});
    case 'penScratch':
      return putFx(sfx, t, scratch((e.end ?? t + 0.2) - t, 10), -27, {pan: 0.1});
    case 'penClick':
      return putFx(sfx, t, sfxClip.penClick(), -24, {pan: 0.1});
    case 'boom':
      return putFx(sfx, t, sfxClip.boom(), -14);
    case 'tap':
      return putFx(sfx, t, sfxClip.tap(), -22);
    case 'callBlip':
      return putFx(sfx, t, sfxClip.callBlip(), -26);
    case 'clothRustle':
      return putFx(sfx, t, sfxClip.clothRustle(), -27, {pan: -0.15});
    case 'strapClink':
      return putFx(sfx, t, sfxClip.strapClink(), -28, {pan: 0.2});
    case 'pickupClick':
      return putFx(sfxFree, t, sfxClip.pickupClick(), -9, {mute: false});
    case 'hangupClick':
      return putFx(sfxFree, t, sfxClip.hangupClick(), -9, {mute: false});
    case 'phoneThud': {
      // Onto the passenger seat: a muffled cushion thud, one small bounce, a vinyl seat squeak.
      const x = impact(0.45, {f0: 140, f1: 85, tau: 0.06, mid: 0.4, crack: 0.5});
      addInto(x, impact(0.3, {f0: 160, f1: 95, tau: 0.04, mid: 0.3, crack: 0.4}), at(0.12), 0.3);
      let ph = 0;
      addInto(x, render(0.13, (tt) => ((ph += (TAU * (900 + 400 * (tt / 0.13) + 60 * Math.sin(TAU * 40 * tt))) / SR), Math.sin(ph) * Math.sin(Math.PI * (tt / 0.13)) * 0.25)), at(0.02));
      const lp = new SVF();
      for (let i = 0; i < x.length; i++) x[i] = lp.low(x[i], 2500);
      return putFx(sfxFree, t, x, -16, {pan: 0.35, mute: false});
    }
    case 'particleWhoosh': {
      // Into the speaker grille: a rising band sweep plus particle grains thickening, peaking at the resolve.
      const len = (e.end ?? t + 0.4) - t;
      const sw = sweep(len + 0.25, {f0: 250, f1: 4500, q: 1, peak: len / (len + 0.25), pow: 2.5, decay: 0.07});
      const grains = new Float32Array(sw.L.length);
      for (let k = 0; k < 260; k++) {
        const u = Math.pow(rand(), 0.45);
        const f = 3000 + rand() * 6000;
        addInto(grains, render(0.004, (tt) => Math.sin(TAU * f * tt) * Math.sin((Math.PI * tt) / 0.004)), at(u * len), 0.25 * u);
      }
      addInto(grains, modal([[2630, 0.6, 0.15], [3940, 0.4, 0.1]], 0.3), at(len));
      for (let i = 0; i < grains.length; i++) (sw.L[i] += grains[i]), (sw.R[i] += grains[i]);
      return putFx(sfx, t, sw, -23);
    }
    case 'uiTick':
      return putFx(sfx, t, sfxClip.uiTick(), -27);
    case 'highlighterSwipe':
      return putFx(sfx, t, felt((e.end ?? t + 0.33) - t, 2200), -27);
    case 'springTock':
      return putFx(sfx, t, sfxClip.springTock(), -22, {pan: 0.3});
    case 'whipWhoosh': {
      const len = (e.end ?? t + 0.2) - t;
      return putFx(sfx, t, sweep(len + 0.3, {f0: 400, f1: 5000, f2: 900, q: 0.9, peak: 0.6 * (len / (len + 0.3)) + 0.2, pow: 2, decay: 0.09, pan0: -0.6, pan1: 0.6}), -17);
    }
    case 'thermosSip': {
      const x = new Float32Array(at(0.9));
      addInto(x, slurp(0.35), 0);
      addInto(x, modal([[2650, 1, 0.05], [4100, 0.6, 0.03], [6300, 0.3, 0.02]], 0.3, 0.2), at(0.48), 0.5);
      return putFx(sfx, t, x, -27, {pan: -0.1});
    }
    case 'panelWhoosh': {
      // Two panels: the top from above (falling sweep), the bottom from below (rising sweep).
      const len = 8 / FPS + 0.15;
      putFx(sfx, t - 0.08, sweep(len, {f0: 3200, f1: 700, q: 1, peak: 0.6, decay: 0.05, pan0: 0.2, pan1: 0.1}), -21);
      return putFx(sfx, t - 0.06, sweep(len, {f0: 500, f1: 2600, q: 1, peak: 0.62, decay: 0.05, pan0: -0.2, pan1: -0.1}), -21);
    }
    case 'markerSqueak':
      return putFx(sfx, t, felt(0.24, 1600, 0.8), -24, {pan: 0.1});
    case 'stringZip': {
      const len = (e.end ?? t + 0.5) - t;
      const bp = new SVF();
      let ph = 0;
      const x = render(len, (tt) => {
        const u = tt / len;
        ph += (40 + 110 * u) / SR;
        const teeth = Math.pow(Math.abs(Math.sin(Math.PI * ph)), 4);
        return bp.band(noise(), 900 * Math.pow(4, u), 2) * (0.3 + 0.7 * teeth) * Math.min(1, tt / 0.02, (len - tt) / 0.02);
      });
      return putFx(sfx, t, x, -25, {pan: (tt: number) => -0.4 + 0.8 * (tt / len)});
    }
    case 'pinTick':
      return putFx(sfx, t, sfxClip.pinTick(), -23);
    case 'subThump':
      return putFx(sfx, t, impact(0.6, {f0: 90, f1: 45, tau: 0.2, mid: 0.35, crack: 0.1}), -16);
    case 'subImpact':
      return putFx(sfx, t, impact(1.2, {f0: 100, f1: 38, tau: 0.35, mid: 0.5, crack: 0.4}), -9);
    case 'neonTickOff': {
      const x = modal([[900, 1, 0.01], [2300, 0.5, 0.004]], 0.05, 0.5, 2500);
      addInto(x, modal([[950, 0.6, 0.008]], 0.03), at(2 / FPS), 0.5);
      return putFx(sfx, t, x, -26, {pan: 0.3});
    }
    case 'pushWhoosh': {
      const len = (e.end ?? t + 0.5) - t;
      return putFx(sfx, t, sweep(len + 0.15, {f0: 300, f1: 1500, q: 0.7, peak: 0.75 * (len / (len + 0.15)), pow: 2, decay: 0.08}), -25);
    }
    case 'coffeeSip':
      return putFx(sfx, t, slurp(0.28), -28, {pan: -0.15});
    case 'snort': {
      // Short amused breath out of the nose, off-screen: nasal turbulence with a flutter, a hint of voice.
      const b1 = new SVF();
      const b2 = new SVF();
      const lp = new SVF();
      const vo = saw(105);
      const x = render(0.3, (tt) => {
        const env = Math.min(1, tt / 0.008) * Math.exp(-tt / 0.07);
        const flutter = 0.6 + 0.4 * Math.sin(TAU * 28 * tt);
        return (b1.band(noise(), 1000, 1.1) + 0.4 * b2.band(noise(), 2600, 2) + 0.25 * lp.low(vo(), 500)) * env * flutter;
      });
      return putFx(sfx, t, withRoom(x, 0.4, 0.15, {size: 0.42}), -24, {pan: -0.3});
    }
    case 'mugClink':
      return putFx(sfx, t, withRoom(sfxClip.mugClink(), 0.4, 0.2, {size: 0.42}), -19, {pan: 0.2});
    case 'checkTick':
      return putFx(sfx, t, sfxClip.checkTick(), -24);
    case 'rowSwish': {
      const len = (e.end ?? t + 0.25) - t;
      return putFx(sfx, t, sweep(len, {f0: 2500, f1: 900, q: 0.8, peak: 0.4, pow: 1.5, decay: 0.06, pan0: 0, pan1: -0.5}), -27);
    }
    case 'markerSwipe':
      return putFx(sfx, t, felt((e.end ?? t + 0.4) - t, 1800), -28);
    case 'softBell':
      return putFx(sfx, t, withRoom(sfxClip.softBell(), 1.2, 0.3, {size: 0.7}), -22, {pan: 0.1});
    case 'toastPop':
      return putFx(sfx, t, sfxClip.toastPop(), -24);
    case 'logoBell':
      return putFx(sfx, t, withRoom(sfxClip.logoBell(), 1.4, 0.3, {size: 0.7}), -19);
    default:
      throw new Error(`make-audio: no sound for SFX id “${e.id}” (${e.shot} at ${e.t})`);
  }
};
for (const e of SFX) playSfx(e);

// ─── Mix ────────────────────────────────────────────────────────────────────

const mix = newBus();
const duckGain = (depthDb: number, a: number) => 1 - (1 - dB(-depthDb)) * a;
const dcL = new SVF();
const dcR = new SVF();
for (let i = 0; i < N; i++) {
  const a = duckAmt[i];
  const gm = duckGain(DUCK_DB.music, a);
  const gs = duckGain(DUCK_DB.sfx, a);
  const gp = duckGain(DUCK_DB.phone, a);
  const ga = duckGain(DUCK_DB.amb, a);
  mix.L[i] = voice.L[i] + music.L[i] * gm + musicFree.L[i] + sfx.L[i] * gs + sfxFree.L[i] + phone.L[i] * gp + amb.L[i] * ga;
  mix.R[i] = voice.R[i] + music.R[i] * gm + musicFree.R[i] + sfx.R[i] * gs + sfxFree.R[i] + phone.R[i] * gp + amb.R[i] * ga;
  // DC / subsonic blocker (15 Hz).
  mix.L[i] = dcL.high(mix.L[i], 15);
  mix.R[i] = dcR.high(mix.R[i], 15);
}

// ─── Loudness, true peak, limiter ───────────────────────────────────────────

/** ITU-R BS.1770-4 integrated loudness (K-weighting, 400 ms blocks, 75% overlap, −70 LUFS and −10 LU gates). */
const loudness = (b: Stereo): {integrated: number; shortMax: number} => {
  const l = kWeight(b.L);
  const r = kWeight(b.R);
  const block = at(0.4);
  const hop = at(0.1);
  const z: number[] = [];
  for (let s = 0; s + block <= l.length; s += hop) {
    let acc = 0;
    for (let i = s; i < s + block; i++) acc += l[i] * l[i] + r[i] * r[i];
    z.push(acc / block);
  }
  const lk = (v: number) => -0.691 + 10 * Math.log10(v);
  const abs = z.filter((v) => lk(v) > -70);
  const rel = lk(abs.reduce((s, v) => s + v, 0) / abs.length) - 10;
  const gated = abs.filter((v) => lk(v) > rel);
  // Short-term (3 s) maximum.
  let shortMax = -Infinity;
  for (let k = 0; k + 30 <= z.length; k += 5) {
    let acc = 0;
    for (let j = k; j < k + 30; j += 4) acc += z[j];
    shortMax = Math.max(shortMax, lk(acc / Math.ceil(30 / 4)));
  }
  return {integrated: lk(gated.reduce((s, v) => s + v, 0) / gated.length), shortMax};
};

/** True-peak estimate per sample: 4× windowed-sinc interpolation (BS.1770 Annex 2 style). */
const TP_TAPS = 12;
const TP_COEF = [0.25, 0.5, 0.75].map((mu) => {
  const c = new Float64Array(2 * TP_TAPS);
  for (let k = -TP_TAPS + 1, j = 0; k <= TP_TAPS; k++, j++) {
    const x = mu - k;
    const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    c[j] = sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / TP_TAPS));
  }
  return c;
});
const truePeaks = (b: Stereo): Float32Array => {
  const n = b.L.length;
  const out = new Float32Array(n);
  for (const ch of [b.L, b.R]) {
    for (let i = 0; i < n; i++) {
      let p = Math.abs(ch[i]);
      if (i >= TP_TAPS && i + TP_TAPS < n) {
        for (const c of TP_COEF) {
          let s = 0;
          for (let k = -TP_TAPS + 1, j = 0; k <= TP_TAPS; k++, j++) s += ch[i + k] * c[j];
          if (Math.abs(s) > p) p = Math.abs(s);
        }
      }
      if (p > out[i]) out[i] = p;
    }
  }
  return out;
};
const maxOf = (x: Float32Array) => {
  let m = 0;
  for (let i = 0; i < x.length; i++) if (x[i] > m) m = x[i];
  return m;
};

const TARGET_LUFS = -14.5;
let limiterSpans: Array<[number, number, number]> = [];
let CEILING_DBTP = -1.5;
const seam = S27.fadeOut;
const master = (gainDb: number, ceilingDb: number) => {
  const out = stereo(N);
  const g = dB(gainDb);
  for (let i = 0; i < N; i++) {
    out.L[i] = mix.L[i] * g;
    out.R[i] = mix.R[i] * g;
  }
  const before = new Float32Array(N);
  for (let i = 0; i < N; i++) before[i] = Math.max(Math.abs(out.L[i]), Math.abs(out.R[i]));
  const gr = limiter(out, dB(ceilingDb), truePeaks(out), 0.005, 0.09);
  // Where the limiter works (> 1 dB), as merged spans.
  const spans: Array<[number, number, number]> = [];
  for (let i = 0; i < N; i += 240) {
    const after = Math.max(Math.abs(out.L[i]), Math.abs(out.R[i]));
    const red = before[i] > 1e-4 ? toDb(before[i] / Math.max(1e-9, after)) : 0;
    if (red > 1) {
      const last = spans[spans.length - 1];
      if (last && i / SR - last[1] < 0.1) (last[1] = i / SR), (last[2] = Math.max(last[2], red));
      else spans.push([i / SR, i / SR, red]);
    }
  }
  limiterSpans = spans;
  // The loop seam: the last 40 ms fade to nothing; frame 0 starts on the trill’s attack.
  const a = at(seam.start);
  for (let i = a; i < N; i++) {
    const k = (N - 1 - i) / Math.max(1, N - 1 - a);
    out.L[i] *= k;
    out.R[i] *= k;
  }
  return {out, gr};
};
const pre = loudness(mix);
let gainDb = TARGET_LUFS - pre.integrated;
let result = master(gainDb, CEILING_DBTP);
let lufs = loudness(result.out);
for (let pass = 0; pass < 4 && Math.abs(lufs.integrated - TARGET_LUFS) > 0.1; pass++) {
  gainDb += TARGET_LUFS - lufs.integrated;
  result = master(gainDb, CEILING_DBTP);
  lufs = loudness(result.out);
}
let tp = toDb(maxOf(truePeaks(result.out)));
for (let pass = 0; pass < 3 && tp > CEILING_DBTP + 0.05; pass++) {
  CEILING_DBTP -= tp - CEILING_DBTP + 0.05;
  result = master(gainDb, CEILING_DBTP);
  tp = toDb(maxOf(truePeaks(result.out)));
}
lufs = loudness(result.out);

// TPDF dither to 16 bit, then write.
const final = result.out;
for (let i = 0; i < N; i++) {
  final.L[i] += (rand() - rand()) / 32768;
  final.R[i] += (rand() - rand()) / 32768;
}
fs.mkdirSync(path.dirname(OUT), {recursive: true});
writeWav(OUT, final.L, final.R, SR);

// ─── Report ─────────────────────────────────────────────────────────────────

const g = dB(gainDb);
const rmsRange = (chs: Float32Array[], a: number, b: number, gain = 1) => {
  let s = 0;
  let k = 0;
  for (const ch of chs) for (let i = a; i < b; i++) (s += ch[i] * ch[i]), k++;
  return toDb(Math.sqrt(s / Math.max(1, k)) * gain);
};
// Ducked bus copies for reporting (what actually reaches the mix).
const ducked = (src: Stereo, depth: number): Stereo => {
  const o = stereo(N);
  for (let i = 0; i < N; i++) {
    const k = duckGain(depth, duckAmt[i]);
    o.L[i] = src.L[i] * k;
    o.R[i] = src.R[i] * k;
  }
  return o;
};
const busMusic = ducked(music, DUCK_DB.music);
const busSfx = ducked(sfx, DUCK_DB.sfx);
const busPhone = ducked(phone, DUCK_DB.phone);
const busAmb = ducked(amb, DUCK_DB.amb);
for (let i = 0; i < N; i++) {
  busMusic.L[i] += musicFree.L[i];
  busMusic.R[i] += musicFree.R[i];
  busSfx.L[i] += sfxFree.L[i] + busPhone.L[i];
  busSfx.R[i] += sfxFree.R[i] + busPhone.R[i];
}
const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '   -').padStart(7);
// MIX_STEMS=1: also write each bus (after ducking, at the master gain, before the limiter) to out/audio/stems/.
if (process.env.MIX_STEMS) {
  const dir = path.join(root, 'out', 'audio', 'stems');
  fs.mkdirSync(dir, {recursive: true});
  const stems: Array<[string, Stereo]> = [
    ['voice', voice],
    ['music', busMusic],
    ['sfx', busSfx],
    ['amb', busAmb],
  ];
  for (const [name, b] of stems) {
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    for (let i = 0; i < N; i++) (L[i] = b.L[i] * g), (R[i] = b.R[i] * g);
    writeWav(path.join(dir, `${name}.wav`), L, R, SR);
  }
}

/** Speech margin of a cue: voice vs everything else, on frames where the line is actually sounding. */
const margins = (c: Cue) => {
  const a = at(c.at);
  const b = Math.min(N, at(c.end));
  const hop = 480;
  const filt = (x: Float32Array[], from: number, to: number, band: boolean) => {
    const out = new Float64Array(to - from);
    const hp1 = new SVF();
    const hp2 = new SVF();
    const lp1 = new SVF();
    for (let i = Math.max(0, from - 2400); i < to; i++) {
      let v = 0;
      for (const ch of x) v += ch[i] * 0.5;
      if (band) v = lp1.low(hp2.high(hp1.high(v, 300), 300), 4000);
      if (i >= from) out[i - from] = v;
    }
    return out;
  };
  let level = 0;
  const res: Record<'full' | 'phone', {all: number; worst: number; worstAt: number; who: string}> = {
    full: {all: 0, worst: 0, worstAt: 0, who: ''},
    phone: {all: 0, worst: 0, worstAt: 0, who: ''},
  };
  for (const band of [false, true]) {
    // filt() sums channels ×0.5: the mono sum of the voice and of the bed (music + sfx + amb).
    const v = filt([voice.L, voice.R], a, b, band);
    const parts = [
      filt([busMusic.L, busMusic.R], a, b, band),
      filt([busSfx.L, busSfx.R], a, b, band),
      filt([busAmb.L, busAmb.R], a, b, band),
    ];
    // Frame energies: [voice, bed, music, sfx, amb] (the bed is the sum signal, not the sum of energies).
    const frames: number[][] = [];
    for (let s = 0; s + hop <= v.length; s += hop) {
      const e = [0, 0, 0, 0, 0];
      for (let i = s; i < s + hop; i++) {
        const bed = parts[0][i] + parts[1][i] + parts[2][i];
        e[0] += v[i] * v[i];
        e[1] += bed * bed;
        e[2] += parts[0][i] ** 2;
        e[3] += parts[1][i] ** 2;
        e[4] += parts[2][i] ** 2;
      }
      frames.push(e);
    }
    // Speech frames: within 20 dB of the line’s 95th-percentile frame (word tails and pauses don’t count).
    const sorted = frames.map((x) => x[0]).sort((p, q) => p - q);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const isActive = (x: number[]) => x[0] > p95 * dB(-20) ** 2;
    const sum = (fr: number[][], k: number) => fr.reduce((s, x) => s + x[k], 0);
    const active = frames.filter(isActive);
    // Worst 300 ms window of active speech, and which bus fills it.
    let worst = Infinity;
    let worstAt = 0;
    let who = '';
    for (let k = 0; k + 30 <= frames.length; k += 3) {
      const w = frames.slice(k, k + 30).filter(isActive);
      if (w.length < 15) continue;
      const m = 10 * Math.log10(sum(w, 0) / Math.max(1e-20, sum(w, 1)));
      if (m < worst) {
        worst = m;
        worstAt = c.at + (k * hop) / SR;
        const shares = [2, 3, 4].map((j) => sum(w, j));
        who = ['music', 'sfx', 'amb'][shares.indexOf(Math.max(...shares))];
      }
    }
    res[band ? 'phone' : 'full'] = {all: 10 * Math.log10(sum(active, 0) / Math.max(1e-20, sum(active, 1))), worst, worstAt, who};
    // Speech loudness of the line itself (mono sum, speechLufs, at the master gain).
    if (!band) level = speechLufs(v) + toDb(g);
  }
  return {...res, level};
};
if (REPORT) {
  console.log(`\nper-shot RMS dBFS after ducking, scaled by the master gain (${gainDb.toFixed(1)} dB), before the limiter`);
  console.log(`shot  start   end    voice  music    sfx    amb    bed  (bed = music+sfx+amb)`);
  for (const sh of SHOTS) {
    const a = at(sh.start);
    const b = Math.min(N, at(sh.end));
    const bedL = new Float32Array(b - a);
    const bedR = new Float32Array(b - a);
    for (let i = a; i < b; i++) {
      bedL[i - a] = busMusic.L[i] + busSfx.L[i] + busAmb.L[i];
      bedR[i - a] = busMusic.R[i] + busSfx.R[i] + busAmb.R[i];
    }
    console.log(
      `${sh.id}  ${sh.start.toFixed(2).padStart(5)} ${sh.end.toFixed(2).padStart(5)} ${fmt(rmsRange([voice.L, voice.R], a, b, g))}${fmt(rmsRange([busMusic.L, busMusic.R], a, b, g))}${fmt(rmsRange([busSfx.L, busSfx.R], a, b, g))}${fmt(rmsRange([busAmb.L, busAmb.R], a, b, g))}${fmt(rmsRange([bedL, bedR], 0, b - a, g))}`,
    );
  }
  console.log(`\nspeech margin (voice over bed on active speech frames, dB): whole line / worst 300 ms; full band and phone band (300 Hz–4 kHz)`);
  console.log(`line    at     end    LUFS    full  worst   phone  worst   worst phone window   (LUFS: the line alone, mono)`);
}
let worstMargin = Infinity;
let worstLine = '';
for (const c of CUES) {
  const m = margins(c);
  const w = Math.min(m.full.all, m.phone.all);
  if (w < worstMargin) (worstMargin = w), (worstLine = c.id);
  if (REPORT)
    console.log(
      `${c.id.padEnd(5)} ${c.at.toFixed(2).padStart(6)} ${c.end.toFixed(2).padStart(6)} ${fmt(m.level)} ${fmt(m.full.all)}${fmt(m.full.worst)} ${fmt(m.phone.all)}${fmt(m.phone.worst)}   ${m.phone.worstAt.toFixed(2)}+0.3 ${m.phone.who} (full: ${m.full.worstAt.toFixed(2)} ${m.full.who})`,
    );
}
if (REPORT) {
  console.log(`\nvoice pre-limiter: max gain reduction ${voiceGr.toFixed(1)} dB, ${((100 * voiceHot) / N).toFixed(3)}% of samples needed > 3 dB; section stops: ${sections.map((s) => `${s.name} ${s.cut.toFixed(3)}`).join(', ')}`);
  console.log(`master limiter > 1 dB: ${limiterSpans.map(([a, b, r]) => `${a.toFixed(2)}–${b.toFixed(2)} (${r.toFixed(1)} dB)`).join(', ') || 'never'}`);
  console.log(`mute windows: ${MUTES.map((m) => `${m.id} ${m.start}–${m.end}`).join(', ')}; iris ${IRIS.start}; band sweep ${BAND_SWEEP.start}–${BAND_SWEEP.end}`);
}

let clipped = 0;
for (let i = 0; i < N; i++) if (Math.abs(final.L[i]) >= 1 || Math.abs(final.R[i]) >= 1) clipped++;
console.log(`wrote ${path.relative(root, OUT)}: ${(N / SR).toFixed(3)} s (${N} samples), ${SR} Hz 16-bit stereo`);
console.log(`master gain ${gainDb.toFixed(2)} dB (board levels assume ${MASTER_EST}), limiter max ${result.gr.toFixed(1)} dB, ceiling ${CEILING_DBTP.toFixed(2)} dBTP`);
console.log(`loudness ${lufs.integrated.toFixed(2)} LUFS integrated, short-term max ${lufs.shortMax.toFixed(1)} LUFS, true peak ${tp.toFixed(2)} dBTP, clipped samples ${clipped}`);
console.log(`worst speech margin ${worstMargin.toFixed(1)} dB (${worstLine})`);

// Cross-check with ffmpeg’s EBU R128 meter when it is installed.
const probe = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', OUT, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {encoding: 'utf8'});
if (probe.status === 0) {
  const summary = probe.stderr.slice(probe.stderr.lastIndexOf('Summary:'));
  const I = summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1];
  const P = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
  console.log(`ffmpeg ebur128: integrated ${I} LUFS, true peak ${P} dBTP`);
}
