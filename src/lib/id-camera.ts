/**
 * Reading a guest's ID from camera frames and photos, on the device.
 *
 * - Barcodes (the PDF417 on the back of a North American licence): the
 *   browser's own BarcodeDetector where it reads PDF417 (Chrome on Android
 *   and macOS), otherwise ZXing compiled to WebAssembly (Safari and iOS,
 *   Firefox, Chrome on Windows).
 * - The MRZ (the lines of <<< on passports, EADs, green cards and ID cards):
 *   Tesseract OCR in a web worker, limited to the MRZ's characters. The text
 *   it reads goes through readMrzOcr, which only accepts a read whose check
 *   digits all pass.
 *
 * Both decoders load on first use, so check-in doesn't download them unless
 * staff open the camera or pick a photo. The WebAssembly and the OCR model
 * are served from this site (scripts/copy-id-scan-assets.mjs copies them out
 * of node_modules on install), never a CDN. No image leaves the device.
 */

const ASSETS = '/vendor/id-scan';

type Detector = { detect: (image: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

let native: Promise<Detector | null> | null = null;

/** The browser's own barcode reader, when it reads PDF417. */
function nativeDetector(): Promise<Detector | null> {
  native ??= (async () => {
    const Ctor = typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector : null;
    if (!Ctor) return null;
    try {
      const formats = (await Ctor.getSupportedFormats?.()) ?? [];
      return formats.includes('pdf417') ? new Ctor({ formats: ['pdf417'] }) : null;
    } catch {
      return null;
    }
  })();
  return native;
}

/** Can this browser show a live camera at all? Needs HTTPS and getUserMedia. */
export function cameraSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

/** The text of every PDF417 barcode in a picture. `still` is a photo: try ZXing too when the native reader finds nothing. */
export async function readBarcodes(canvas: HTMLCanvasElement, { still = false }: { still?: boolean } = {}): Promise<string[]> {
  const detector = await nativeDetector();
  if (detector) {
    try {
      const found = await detector.detect(canvas);
      if (found.length) return found.map((f) => f.rawValue);
    } catch {
      // Fall through to ZXing.
    }
    // On a live camera the next frame comes along soon: ZXing on every frame as well would only slow the native reader down.
    if (!still) return [];
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  const { readBarcodes: zxing } = await zxingReader();
  const results = await zxing(ctx.getImageData(0, 0, canvas.width, canvas.height), { formats: ['PDF417'], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1, // Plain keeps the line feeds and record separators AAMVA needs; the default spells them out as <LF>.
    textMode: 'Plain' });
  return results.filter((r) => r.isValid && r.text).map((r) => r.text);
}

let zxingModule: Promise<typeof import('zxing-wasm/reader')> | null = null;
function zxingReader() {
  zxingModule ??= import('zxing-wasm/reader').then((m) => {
    m.prepareZXingModule({ overrides: { locateFile: (file: string, prefix: string) => (file.endsWith('.wasm') ? `${ASSETS}/${file}` : prefix + file) } });
    return m;
  });
  zxingModule.catch(() => {
    zxingModule = null;
  });
  return zxingModule;
}

type OcrWorker = { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };
let ocr: Promise<OcrWorker> | null = null;

function ocrWorker(): Promise<OcrWorker> {
  ocr ??= (async () => {
    // A CommonJS package: bundlers put its exports on default, or on the module itself.
    const mod = await import('tesseract.js');
    const T = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
    // No dictionary: an MRZ isn't words, and the dictionary "fixes" names and numbers into ones it knows.
    const worker = await T.createWorker(
      'eng',
      T.OEM.LSTM_ONLY,
      { workerPath: `${ASSETS}/worker.min.js`, corePath: ASSETS, langPath: ASSETS, workerBlobURL: false },
      { load_system_dawg: '0', load_freq_dawg: '0' },
    );
    await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: T.PSM.SINGLE_BLOCK });
    return worker as unknown as OcrWorker;
  })();
  ocr.catch(() => {
    ocr = null;
  });
  return ocr;
}

/** Start loading the OCR model ahead of the first frame. */
export function warmUpMrz(): void {
  void ocrWorker().catch(() => undefined);
}

/** The text OCR reads in a picture of an MRZ, as is: readMrzOcr makes sense of it. */
export async function readMrzText(canvas: HTMLCanvasElement): Promise<string> {
  const worker = await ocrWorker();
  const { data } = await worker.recognize(canvas);
  return data.text;
}

/** Free the OCR worker (its model takes a few MB of memory) once the camera closes. */
export function releaseMrz(): void {
  const w = ocr;
  ocr = null;
  void w?.then((worker) => worker.terminate()).catch(() => undefined);
}

/**
 * Grey and contrast-stretched, the way OCR reads printed text best. MRZ
 * text is dark on a light, often patterned, background: stretching the range
 * makes the characters stand out without a hard threshold that would eat
 * thin strokes in poor light.
 */
export function prepareForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) * 255) / range;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Draw part of a frame or photo into a canvas, scaled so its width is at most maxWidth. */
export function crop(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, maxWidth: number, into?: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / sw);
  const canvas = into ?? document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx?.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}
