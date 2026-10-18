// Generates the noise tiles the film-wide overlays use (src/fx/Dither.tsx and
// src/fx/Grain.tsx). Run once: `node scripts/make-fx-tiles.ts`. Output:
//   public/fx/dither.png        512×512 RGB, independent uniform noise per channel, mean 128 (static dither)
//   public/fx/grain-0..5.png    512×512 grey, soft film grain (periodic Gaussian blur, so every tile is seamless)
// The tiles are pre-generated so the browser never computes noise per frame: an
// overlay just shows a cached PNG, and Grain picks a tile + offset every 6 frames.
// Deterministic (seeded PRNG), no dependencies (zlib + a tiny PNG writer).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public', 'fx');
fs.mkdirSync(outDir, {recursive: true});

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ─── PNG writer ─────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** channels: 1 = grey, 3 = RGB. `px` holds width*height*channels bytes. */
const writePng = (file: string, width: number, height: number, channels: 1 | 3, px: Uint8Array) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : 2;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(px.buffer, px.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path.join(outDir, file), png);
  console.log(`${path.relative(root, path.join(outDir, file))}  ${width}×${height}  ${(png.length / 1024).toFixed(0)} KB`);
};

// ─── Dither: uniform noise per channel, mean 128 ────────────────────────────
{
  const N = 512;
  const rnd = mulberry32(0x0d17);
  const px = new Uint8Array(N * N * 3);
  for (let i = 0; i < px.length; i++) px[i] = Math.floor(rnd() * 256);
  writePng('dither.png', N, N, 3, px);
}

// ─── Grain: Gaussian noise, periodic blur, normalised ───────────────────────
const gauss = (rnd: () => number) => {
  // Box–Muller
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const blurPeriodic = (src: Float32Array, n: number, sigma: number) => {
  const r = Math.ceil(sigma * 3);
  const k = Array.from({length: 2 * r + 1}, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += src[y * n + ((x + i + n) % n)] * k[i + r];
      tmp[y * n + x] = s / ks;
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += tmp[((y + i + n) % n) * n + x] * k[i + r];
      out[y * n + x] = s / ks;
    }
  return out;
};
{
  const N = 512;
  const TILES = 6;
  for (let t = 0; t < TILES; t++) {
    const rnd = mulberry32(0x6a1 + t * 7919);
    const white = new Float32Array(N * N).map(() => gauss(rnd));
    // Two scales: a fine grain plus a little clumping, like film.
    const fine = blurPeriodic(white, N, 0.7);
    const clump = blurPeriodic(white, N, 1.8);
    const mixd = fine.map((v, i) => v + 0.6 * clump[i]);
    let mean = 0;
    for (const v of mixd) mean += v;
    mean /= mixd.length;
    let varc = 0;
    for (const v of mixd) varc += (v - mean) ** 2;
    const sd = Math.sqrt(varc / mixd.length);
    const px = new Uint8Array(N * N);
    // std 42 levels around 128 (±3σ fits in 0..255).
    for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, Math.round(128 + ((mixd[i] - mean) / sd) * 42)));
    writePng(`grain-${t}.png`, N, N, 1, px);
  }
}
