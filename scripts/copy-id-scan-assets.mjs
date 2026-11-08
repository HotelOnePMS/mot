#!/usr/bin/env node
/**
 * Copies the camera ID scanner's decoders from node_modules into
 * public/vendor/id-scan, so the browser loads them from this site and not a
 * CDN (hotel networks and content filters often block CDNs, and the versions
 * then always match the installed packages). Runs after every npm install.
 *
 * - zxing_reader.wasm: the PDF417 reader for browsers without a native one.
 * - worker.min.js and tesseract-core-*-lstm.wasm.js: Tesseract OCR for MRZ lines.
 * - eng.traineddata.gz: Tesseract's English model (best_int), which reads MRZ characters.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public/vendor/id-scan');
const mod = (p) => path.join(root, 'node_modules', p);

const files = [
  [mod('zxing-wasm/dist/reader/zxing_reader.wasm'), 'zxing_reader.wasm'],
  [mod('tesseract.js/dist/worker.min.js'), 'worker.min.js'],
  [mod('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];
const core = mod('tesseract.js-core');
if (existsSync(core)) for (const f of readdirSync(core)) if (/^tesseract-core.*-?lstm\.wasm\.js$/.test(f)) files.push([path.join(core, f), f]);

mkdirSync(out, { recursive: true });
let missing = 0;
for (const [from, name] of files) {
  if (!existsSync(from)) {
    console.warn(`[id-scan] missing ${path.relative(root, from)}: the camera scanner will not work until it is installed`);
    missing++;
    continue;
  }
  copyFileSync(from, path.join(out, name));
}
console.log(`[id-scan] copied ${files.length - missing} decoder files to public/vendor/id-scan`);
