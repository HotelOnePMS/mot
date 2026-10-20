'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Camera, CheckCircle2, Eye, IdCard, ShieldCheck, Trash2, TriangleAlert, Upload } from 'lucide-react';
import type { BookingSummary } from '@/lib/dto';
import { ageOn, namesMatch, parseAamva } from '@/lib/aamva';
import { api, fetcher } from '@/lib/fetcher';
import { fmtDay, localToday } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, inputBase } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';

type IdType = 'DRIVERS_LICENSE' | 'PASSPORT' | 'NATIONAL_ID' | 'OTHER';
type IdSide = 'FRONT' | 'BACK';

export interface GuestIdDoc {
  id: string;
  type: IdType;
  typeLabel: string;
  side: IdSide;
  nameOnId: string | null;
  numberLast4: string | null;
  expiresOn: string | null;
  sizeBytes: number;
  createdAt: string;
  capturedBy: string | null;
}

export interface GuestIdState {
  documents: GuestIdDoc[];
  required: boolean;
  retentionDays: number;
  deletesOn: string | null;
  available: boolean;
  canCapture: boolean;
  canDelete: boolean;
}

const TYPES: { value: IdType; label: string }[] = [
  { value: 'DRIVERS_LICENSE', label: 'Driver’s licence' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'NATIONAL_ID', label: 'National ID card' },
  { value: 'OTHER', label: 'Other ID' },
];

const MAX_SIDE = 1600;
const formatDateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export const guestIdKey = (bookingId: string) => `/api/admin/bookings/${bookingId}/guest-ids`;

export function useGuestIds(bookingId: string | null | undefined, enabled = true) {
  return useSWR<GuestIdState>(bookingId && enabled ? guestIdKey(bookingId) : null, fetcher);
}

// --- Image helpers (browser only) -------------------------------------------

/** Downscale to at most 1600px on the long side and re-encode as JPEG: small enough to send, sharp enough to read. */
function toJpeg(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function fileToJpeg(file: File): Promise<{ dataUrl: string; bitmap: ImageBitmap | null }> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo of the ID (JPEG, PNG, HEIC or WebP).');
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { dataUrl: toJpeg(bitmap, bitmap.width, bitmap.height), bitmap };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { dataUrl: toJpeg(img, img.naturalWidth, img.naturalHeight), bitmap: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface DetectedBarcode {
  rawValue: string;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => { detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]> };

/** The licence barcode (PDF417), where the browser can read one (Chrome on Android and Mac, Edge, Safari 17+ on some devices). */
async function readLicenceBarcode(source: ImageBitmapSource | null): Promise<string | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!Ctor || !source) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ['pdf417'];
    if (!formats.includes('pdf417')) return null;
    const found = await new Ctor({ formats: ['pdf417'] }).detect(source);
    return found[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

// --- Camera -----------------------------------------------------------------

function CameraDialog({ open, onOpenChange, onCapture }: { open: boolean; onOpenChange: (o: boolean) => void; onCapture: (dataUrl: string, frame: HTMLCanvasElement) => void }) {
  const video = React.useRef<HTMLVideoElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError(null);
    setReady(false);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().then(() => setReady(true));
        }
      })
      .catch((e: Error) => setError(e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in the browser, or upload a photo instead.' : 'No camera was found. Upload a photo instead.'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const frame = document.createElement('canvas');
    frame.width = v.videoWidth;
    frame.height = v.videoHeight;
    frame.getContext('2d')!.drawImage(v, 0, 0);
    onCapture(toJpeg(frame, frame.width, frame.height), frame);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Photograph the ID</DialogTitle>
          <DialogDescription>Lay the card flat in good light and fill the frame. For a US or Canadian licence, a photo of the back reads the barcode.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Callout tone="warning">{error}</Callout>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={video} playsInline muted className="aspect-video w-full object-contain" />
            <div className="pointer-events-none absolute inset-[12%] rounded-xl border-2 border-dashed border-white/70" aria-hidden />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || !!error} onClick={capture}>
            <Camera aria-hidden /> Take photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewDialog({ doc, onOpenChange }: { doc: GuestIdDoc | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={!!doc} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {doc?.typeLabel} · {doc?.side === 'BACK' ? 'back' : 'front'}
          </DialogTitle>
          <DialogDescription>Viewing is recorded in the activity log.</DialogDescription>
        </DialogHeader>
        {doc && (
          // eslint-disable-next-line @next/next/no-img-element -- private, decrypted per request; next/image would cache it
          <img src={`/api/admin/guest-ids/${doc.id}`} alt={`${doc.typeLabel} (${doc.side.toLowerCase()})`} className="max-h-[70vh] w-full rounded-xl bg-muted object-contain" />
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Panel ------------------------------------------------------------------

interface Draft {
  image: string;
  type: IdType;
  side: IdSide;
  nameOnId: string;
  numberLast4: string;
  expiresOn: string;
  scanned: boolean;
  dateOfBirth: string | null;
}

/**
 * Take or upload a photo of the guest's ID and keep it with the reservation.
 * Used in the check-in dialog (compact) and on the reservation page.
 */
export function GuestIdPanel({ booking, compact = false, bare = false }: { booking: BookingSummary; compact?: boolean; bare?: boolean }) {
  const key = guestIdKey(booking.id);
  const { mutate } = useSWRConfig();
  const { data, isLoading, error } = useGuestIds(booking.id);
  const [camera, setCamera] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [viewing, setViewing] = React.useState<GuestIdDoc | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const formId = React.useId();
  const today = localToday();
  const open = !['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'].includes(booking.status);

  async function startDraft(image: string, source: ImageBitmapSource | null) {
    const raw = await readLicenceBarcode(source);
    const lic = raw ? parseAamva(raw) : null;
    const hasFront = data?.documents.some((d) => d.side === 'FRONT');
    setDraft({
      image,
      type: lic ? 'DRIVERS_LICENSE' : (data?.documents.at(-1)?.type ?? 'DRIVERS_LICENSE'),
      side: lic ? 'BACK' : hasFront ? 'BACK' : 'FRONT',
      nameOnId: lic?.fullName ?? '',
      numberLast4: lic?.numberLast4 ?? '',
      expiresOn: lic?.expiresOn ?? '',
      scanned: !!lic,
      dateOfBirth: lic?.dateOfBirth ?? null,
    });
    if (lic) toast.success('Read the licence barcode. Check the details, then save.');
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { dataUrl, bitmap } = await fileToJpeg(file);
      await startDraft(dataUrl, bitmap);
    } catch (err) {
      toast.error((err as Error).message || 'Couldn’t read that photo.');
    }
  }

  function takePhoto() {
    // No camera API (older browsers, insecure origin): the file picker with capture opens the camera on phones and tablets.
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      fileInput.current?.setAttribute('capture', 'environment');
      fileInput.current?.click();
      return;
    }
    setCamera(true);
  }

  function upload() {
    fileInput.current?.removeAttribute('capture');
    fileInput.current?.click();
  }

  async function save() {
    if (!draft) return;
    setBusy('save');
    try {
      const next = await api<GuestIdState>(key, {
        method: 'POST',
        json: {
          image: draft.image,
          type: draft.type,
          side: draft.side,
          nameOnId: draft.nameOnId || null,
          numberLast4: draft.numberLast4 || null,
          expiresOn: draft.expiresOn || null,
        },
      });
      await mutate(key, next, { revalidate: false });
      setDraft(null);
      toast.success('ID saved to the reservation');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(doc: GuestIdDoc) {
    if (!window.confirm(`Delete this ${doc.typeLabel.toLowerCase()} photo? This can’t be undone.`)) return;
    setBusy(doc.id);
    try {
      const next = await api<GuestIdState>(`/api/admin/guest-ids/${doc.id}`, { method: 'DELETE' });
      await mutate(key, next, { revalidate: false });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return null;
  if (isLoading || !data) return <Skeleton className="h-16 w-full rounded-xl" />;

  const docs = data.documents;
  const capture = data.canCapture && data.available && open;
  const draftMatch = draft?.nameOnId ? namesMatch(draft.nameOnId, booking.guest.name) : null;

  return (
    <div className={cn(!bare && 'rounded-xl border', !bare && (compact ? 'p-3' : 'p-4'))}>
      <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={onFile} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <IdCard className="size-4 text-muted-foreground" aria-hidden />
          Guest ID
          {data.required && !docs.length && (
            <Badge variant="warning" size="sm">
              Required
            </Badge>
          )}
          {docs.length > 0 && (
            <Badge variant="success" size="sm">
              {docs.length} on file
            </Badge>
          )}
        </p>
        {capture && !draft && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={takePhoto}>
              <Camera aria-hidden /> Take photo
            </Button>
            <Button size="sm" variant="ghost" onClick={upload}>
              <Upload aria-hidden /> Upload
            </Button>
          </div>
        )}
      </div>

      {!data.available && data.canCapture && (
        <Callout tone="warning" className="mt-3">
          ID photos are turned off on this deployment until its encryption key (HOTELONE_VAULT_KEY) is set.
        </Callout>
      )}

      {docs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {docs.map((d) => {
            const match = d.nameOnId ? namesMatch(d.nameOnId, booking.guest.name) : null;
            const expired = !!d.expiresOn && d.expiresOn < today;
            return (
              <li key={d.id} className="flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {d.typeLabel} · {d.side === 'BACK' ? 'back' : 'front'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[d.nameOnId, d.numberLast4 ? `ends ${d.numberLast4}` : null, d.expiresOn ? `expires ${fmtDay(d.expiresOn, 'numeric')}` : null].filter(Boolean).join(' · ') || 'No details recorded'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.capturedBy ?? 'Staff'} · {formatDateTime(d.createdAt)}
                  </p>
                  {(match === false || expired) && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-warning-soft-foreground">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      {[match === false ? `Name differs from ${booking.guest.name}` : null, expired ? 'Expired' : null].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <IconButton label="View photo" size="icon-sm" onClick={() => setViewing(d)}>
                  <Eye aria-hidden />
                </IconButton>
                {data.canDelete && (
                  <IconButton label="Delete photo" size="icon-sm" loading={busy === d.id} onClick={() => void remove(d)}>
                    <Trash2 aria-hidden />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!docs.length && !draft && (
        <p className="mt-2 text-sm text-muted-foreground">
          {capture ? 'Photograph or upload the guest’s driver’s licence, passport or ID card.' : 'No ID on file.'}
          {data.required && capture ? ' This hotel needs one before check-in.' : ''}
        </p>
      )}

      {draft && (
        <div className={cn('mt-3 grid gap-3', compact && 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]')}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL preview */}
          <img src={draft.image} alt="ID photo preview" className="max-h-48 w-full rounded-lg bg-muted object-contain" />
          <div className="space-y-2">
            {draft.scanned && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                <CheckCircle2 className="size-3.5" aria-hidden /> Read from the barcode
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Type" htmlFor={`${formId}-type`}>
                <select id={`${formId}-type`} className={cn(inputBase, 'h-10 py-2')} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as IdType })}>
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Side" htmlFor={`${formId}-side`}>
                <select id={`${formId}-side`} className={cn(inputBase, 'h-10 py-2')} value={draft.side} onChange={(e) => setDraft({ ...draft, side: e.target.value as IdSide })}>
                  <option value="FRONT">Front</option>
                  <option value="BACK">Back</option>
                </select>
              </Field>
            </div>
            <Field label="Name on ID" error={draftMatch === false ? `Doesn’t match the booking (${booking.guest.name})` : undefined}>
              <Input value={draft.nameOnId} maxLength={120} onChange={(e) => setDraft({ ...draft, nameOnId: e.target.value })} autoComplete="off" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Last 4 digits">
                <Input value={draft.numberLast4} maxLength={4} onChange={(e) => setDraft({ ...draft, numberLast4: e.target.value.slice(-4) })} autoComplete="off" />
              </Field>
              <Field label="Expiry">
                <Input type="date" value={draft.expiresOn} onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })} />
              </Field>
            </div>
            {draft.expiresOn && draft.expiresOn < today && <Callout tone="warning">This ID has expired.</Callout>}
            {draft.dateOfBirth && (
              <p className="text-xs text-muted-foreground">
                Guest is {ageOn(draft.dateOfBirth, today)} (date of birth isn’t stored).
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Discard
              </Button>
              <Button size="sm" loading={busy === 'save'} loadingText="Saving…" onClick={() => void save()}>
                <ShieldCheck aria-hidden /> Save ID
              </Button>
            </div>
          </div>
        </div>
      )}

      {!compact && (
        <p className="mt-3 text-xs text-muted-foreground">
          Encrypted and visible only to this hotel’s front desk, managers and owners; every view is logged.{' '}
          {data.deletesOn ? `Deleted automatically on ${fmtDay(data.deletesOn, 'long')}.` : `Deleted automatically ${data.retentionDays === 0 ? 'the day after check-out' : `${data.retentionDays} days after check-out`}.`}
        </p>
      )}

      <CameraDialog open={camera} onOpenChange={setCamera} onCapture={(img, frame) => void startDraft(img, frame)} />
      <ViewDialog doc={viewing} onOpenChange={(o) => !o && setViewing(null)} />
    </div>
  );
}

/** The reservation page's Guest ID card. */
export function GuestIdCard({ booking }: { booking: BookingSummary }) {
  return (
    <Card className="p-5 sm:p-6">
      <GuestIdPanel booking={booking} bare />
    </Card>
  );
}
