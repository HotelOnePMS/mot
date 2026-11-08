'use client';

import * as React from 'react';
import { Flashlight, X } from 'lucide-react';
import { parseIdScan, type ScannedId } from '@/lib/id-scan';
import { crop, prepareForOcr, readBarcodes, readMrzText, releaseMrz, warmUpMrz } from '@/lib/id-camera';
import { readMrzOcr } from '@/lib/mrz-ocr';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented';

export type CameraMode = 'barcode' | 'mrz';

// The guide box, as a share of the preview's width and its height over its width.
const GUIDE = { barcode: { width: 0.9, aspect: 0.42 }, mrz: { width: 0.94, aspect: 0.26 } } as const;

const HINT: Record<CameraMode, string> = {
  barcode: 'Hold the back of the driver’s license or state ID flat, with the wide barcode inside the box. It reads on its own.',
  mrz: 'Fit the lines of <<< inside the box: the bottom of a passport’s photo page, or the back of an EAD, green card or ID card.',
};

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is blocked. Allow the camera for this site in the browser’s settings, or use the desk scanner or a photo.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found on this device. Use the desk scanner or a photo.';
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
  return 'Couldn’t start the camera. Use the desk scanner or a photo.';
}

/**
 * The live camera scanner: a preview with a guide box, read a few times a
 * second until a licence barcode or an MRZ comes through clean. A barcode is
 * used on the first read (PDF417 carries its own error correction); an MRZ
 * needs every check digit to pass, and two reads in a row that agree, since
 * the name has no check digit of its own.
 */
export function IdCameraScanner({ initialMode = 'barcode', onScan, onClose }: { initialMode?: CameraMode; onScan: (scan: ScannedId) => void; onClose: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [mode, setMode] = React.useState<CameraMode>(initialMode);
  const modeRef = React.useRef(mode);
  modeRef.current = mode;
  const [error, setError] = React.useState('');
  const [ready, setReady] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [torch, setTorch] = React.useState<{ on: boolean } | null>(null);
  const trackRef = React.useRef<MediaStreamTrack | null>(null);
  const onScanRef = React.useRef(onScan);
  onScanRef.current = onScan;

  React.useEffect(() => {
    if (mode === 'mrz') warmUpMrz();
  }, [mode]);

  React.useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    const frame = document.createElement('canvas');
    let lastMrz = '';
    let failures = 0;

    // Where the guide box falls in the video's own pixels: the preview covers its box, so part of the frame is cropped off.
    function guideRect(video: HTMLVideoElement) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = video.clientWidth || vw;
      const ch = video.clientHeight || vh;
      const scale = Math.max(cw / vw, ch / vh);
      const g = GUIDE[modeRef.current];
      const gw = cw * g.width;
      const gh = Math.min(ch * 0.9, gw * g.aspect);
      // A margin around the box: hands aren't steady, and the decoders find the code inside a larger picture.
      const mw = (gw * 1.08) / scale;
      const mh = (gh * 1.3) / scale;
      return { sx: Math.max(0, (vw - mw) / 2), sy: Math.max(0, (vh - mh) / 2), sw: Math.min(vw, mw), sh: Math.min(vh, mh) };
    }

    async function tick() {
      const video = videoRef.current;
      if (stopped || !video) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const r = guideRect(video);
        try {
          if (modeRef.current === 'barcode') {
            crop(video, r.sx, r.sy, r.sw, r.sh, 1600, frame);
            const scan = (await readBarcodes(frame)).map((t) => parseIdScan(t)).find((s) => s?.format === 'AAMVA');
            if (scan && !stopped) return finish(scan);
          } else {
            crop(video, r.sx, r.sy, r.sw, r.sh, 1400, frame);
            const read = readMrzOcr(await readMrzText(prepareForOcr(frame)));
            if (stopped) return;
            if (read && read.text === lastMrz) return finish(read.scan);
            if (read) setStatus('Got it, holding for one more read…');
            lastMrz = read?.text ?? '';
          }
          failures = 0;
        } catch {
          // The decoder didn't load (offline, or the CDN is blocked): try again a little later, then say so.
          if (++failures >= 4 && !stopped) return setError('Couldn’t load the ID reader. Check the connection, or use the desk scanner or type the details.');
          if (!stopped) timer = window.setTimeout(tick, 1500);
          return;
        }
      }
      if (!stopped) timer = window.setTimeout(tick, modeRef.current === 'barcode' ? 80 : 30);
    }

    function finish(scan: ScannedId) {
      stopped = true;
      navigator.vibrate?.(60);
      onScanRef.current(scan);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
        if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        if (caps.torch) setTorch({ on: false });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setReady(true);
        tick();
      } catch (e) {
        if (!stopped) setError(cameraError(e));
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      releaseMrz();
    };
  }, []);

  React.useEffect(() => setStatus(''), [mode]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track || !torch) return;
    const on = !torch.on;
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined);
    setTorch({ on });
  }

  const g = GUIDE[mode];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          size="sm"
          layoutId="ci-camera-mode"
          aria-label="What to scan"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'barcode', label: 'License barcode' },
            { value: 'mrz', label: 'Passport / EAD lines' },
          ]}
        />
        <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label="Close the camera">
          <X aria-hidden />
        </Button>
      </div>
      {error ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      ) : (
        <div className="relative aspect-[4/3] max-h-[50vh] w-full overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} className="size-full object-cover" playsInline muted autoPlay aria-label="Camera preview" />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{ width: `${g.width * 100}%`, aspectRatio: `${1 / g.aspect}`, maxHeight: '90%' }}
          />
          {!ready && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting the camera…</p>}
          {torch && (
            <Button type="button" size="sm" variant="secondary" className="absolute bottom-2 right-2" onClick={() => void toggleTorch()} aria-pressed={torch.on}>
              <Flashlight aria-hidden /> {torch.on ? 'Light off' : 'Light'}
            </Button>
          )}
        </div>
      )}
      {!error && (
        <p className="text-xs text-muted-foreground" role="status">
          {status || HINT[mode]}
        </p>
      )}
    </div>
  );
}
