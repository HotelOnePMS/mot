'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Camera,
  CheckCircle2,
  CreditCard,
  FileSignature,
  IdCard,
  MessageSquareText,
  ReceiptText,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { RoomOption } from '@/lib/agent/blocks';
import { COUNTRY_CODES, ID_TYPES, ID_TYPE_LABEL, countryName, typedSignatureMatches, type IdType } from '@/lib/card-authorization';
import type { BookingSummary } from '@/lib/dto';
import { ApiError, api, fetcher } from '@/lib/fetcher';
import { fmtRange, formatMoney } from '@/lib/format';
import { idLast4Of, idWarnings } from '@/lib/guest-id';
import { parseIdScan, type ScannedId } from '@/lib/id-scan';
import { RISK_FLAG_INFO } from '@/lib/risk';
import { shrinkImage } from '@/lib/shrink-image';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, inputBase } from '@/components/ui/input';
import { useFieldControl } from '@/components/ui/field-context';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useConsole } from '@/components/console/ConsoleProvider';
import { CollectPaymentDialog } from '@/components/payments/DeskPayments';
import { SignaturePad } from '@/components/payments/SignaturePad';
import { FolioSummary, useFolio } from './FolioCard';
import { RoomPicker } from './RoomPicker';

/** What GET /check-in returns (server/services/checkin.ts), as far as this screen uses it. */
interface CheckInContext {
  booking: BookingSummary;
  mode: 'CHECK_IN' | 'RECORD';
  blocked: string | null;
  recorded: { id: { last4: string } | null; registration: { signedAt: string } | null };
  idPhotos: boolean;
  deposit: { mode: 'NONE' | 'HOLD' | 'CHARGE'; amount: number; held: number; due: number };
  checkOutTime: string;
  guestAddress: string | null;
  today: string;
  can: { viewId: boolean; collect: boolean };
}

type StepKey = 'id' | 'room' | 'folio' | 'deposit' | 'sign';

const STEP_INFO: Record<StepKey, { label: string; icon: typeof IdCard }> = {
  id: { label: 'Photo ID', icon: IdCard },
  room: { label: 'Room', icon: BedDouble },
  folio: { label: 'Folio', icon: ReceiptText },
  deposit: { label: 'Deposit', icon: ShieldCheck },
  sign: { label: 'Sign', icon: FileSignature },
};

const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));

type Address = { line1: string; city: string; region: string; postalCode: string; country: string | null };

interface IdForm {
  source: 'SCAN_AAMVA' | 'SCAN_MRZ' | 'MANUAL';
  idType: IdType;
  country: string;
  region: string;
  nameOnId: string;
  documentNumber: string;
  expiresOn: string;
  dateOfBirth: string;
  address: Address | null;
  sex: 'M' | 'F' | 'X' | null;
  nationality: string | null;
  photo: string | null;
  confirmed: boolean;
  overrideReason: string;
}

const EMPTY_ID: IdForm = {
  source: 'MANUAL',
  idType: 'DRIVERS_LICENSE',
  country: '',
  region: '',
  nameOnId: '',
  documentNumber: '',
  expiresOn: '',
  dateOfBirth: '',
  address: null,
  sex: null,
  nationality: null,
  photo: null,
  confirmed: false,
  overrideReason: '',
};

const addressLine = (a: Address | null) => (a ? [a.line1, [a.city, a.region, a.postalCode].filter(Boolean).join(' '), a.country && a.country !== 'US' ? countryName(a.country) : null].filter(Boolean).join(', ') : '');

const fmt = (n: number, c: string) => formatMoney(n, c, { cents: true });

/** Browsers that can read a PDF417 barcode (the back of a North American licence) from a photo. */
type Detector = { detect: (image: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };
function barcodeDetector(): DetectorCtor | null {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector : null;
}

function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const a11y = useFieldControl(props);
  return (
    <select className={cn(inputBase, 'h-10 py-2 pr-8', className)} {...props} {...a11y}>
      {children}
    </select>
  );
}

function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-h-10 cursor-pointer items-start gap-3 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm border-input accent-[hsl(var(--primary))]" />
      <span>{children}</span>
    </label>
  );
}

/**
 * Guided check-in: the guest's photo ID (scanned with the desk scanner or a
 * photo of the barcode, or typed), the room, the folio, the security deposit
 * (card reader, the guest's card online as a hold, or cash, through the desk
 * payments dialog), then the registration card the guest reads and signs on
 * this device. Nothing is saved until the last step, and then all of it is
 * saved with the check-in. For a guest who is already checked in it records
 * the ID and registration card only.
 */
export function CheckInWizard({ booking, open, onOpenChange }: { booking: BookingSummary | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { mutate } = useSWRConfig();
  const { refresh } = useConsole();
  const key = booking && open ? `/api/admin/bookings/${booking.id}/check-in` : null;
  const { data: ctx, error: ctxError } = useSWR<CheckInContext>(key, fetcher, { revalidateOnFocus: false });
  const { data: folio } = useFolio(open ? booking?.id : null);

  const [step, setStep] = React.useState<StepKey>('id');
  const [id, setId] = React.useState<IdForm>(EMPTY_ID);
  const [scanText, setScanText] = React.useState('');
  const [scanNote, setScanNote] = React.useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [guestAddress, setGuestAddress] = React.useState('');
  const [roomId, setRoomId] = React.useState<string | null>(null);
  const [option, setOption] = React.useState<RoomOption | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const [noDeposit, setNoDeposit] = React.useState(false);
  const [noDepositReason, setNoDepositReason] = React.useState('');
  const [collect, setCollect] = React.useState<'PAYMENT' | 'SECURITY_DEPOSIT' | null>(null);
  const [preview, setPreview] = React.useState<{ text: string; textHash: string } | null>(null);
  const [previewError, setPreviewError] = React.useState('');
  const [sigMethod, setSigMethod] = React.useState<'DRAWN' | 'TYPED'>('DRAWN');
  const [sigImage, setSigImage] = React.useState<string | null>(null);
  const [sigText, setSigText] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [tried, setTried] = React.useState(false);
  const barcodeInput = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // A fresh form every time it opens.
  React.useEffect(() => {
    if (!open) return;
    setStep('id');
    setId(EMPTY_ID);
    setScanText('');
    setScanNote(null);
    setGuestAddress('');
    setRoomId(booking?.room?.id ?? null);
    setOption(null);
    setShowAll(false);
    setNoDeposit(false);
    setNoDepositReason('');
    setPreview(null);
    setPreviewError('');
    setSigMethod('DRAWN');
    setSigImage(null);
    setSigText('');
    setConsent(false);
    setError('');
    setTried(false);
  }, [open, booking?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill the address from the guest's profile once it arrives.
  React.useEffect(() => {
    if (ctx?.guestAddress) setGuestAddress((a) => a || ctx.guestAddress!);
  }, [ctx?.guestAddress]);

  const mode = ctx?.mode ?? (booking?.status === 'CHECKED_IN' ? 'RECORD' : 'CHECK_IN');
  const steps: StepKey[] = mode === 'RECORD' ? ['id', 'folio', 'deposit', 'sign'] : ['id', 'room', 'folio', 'deposit', 'sign'];
  const index = steps.indexOf(step);
  const currency = booking?.currency ?? 'USD';
  const guestName = booking?.guest.name ?? '';

  const last4 = idLast4Of(id.documentNumber);
  const warnings = idWarnings({ nameOnId: id.nameOnId, guestName, expiresOn: id.expiresOn || null, dateOfBirth: id.dateOfBirth || null, today: ctx?.today ?? new Date().toISOString().slice(0, 10) });
  const held = (ctx?.deposit.held ?? 0) > 0.004;
  const due = ctx?.deposit.due ?? 0;
  const deposit = held ? ({ kind: 'HELD' } as const) : noDeposit ? ({ kind: 'NONE', reason: noDepositReason.trim() || null } as const) : null;
  const dirty = option ? !option.ready : false;

  const idProblems: Partial<Record<keyof IdForm | 'documentNumber', string>> = {};
  if (id.nameOnId.trim().length < 2) idProblems.nameOnId = 'Enter the name as it appears on the ID.';
  if (last4.length < 4 || id.documentNumber.replace(/\s+/g, '').length > 30) idProblems.documentNumber = 'Enter the ID number.';
  if (!id.country) idProblems.country = 'Choose the country that issued the ID.';
  if (ctx?.idPhotos && !id.photo) idProblems.photo = 'Take a photo of the front of the ID.';
  if (warnings.needsReason && id.overrideReason.trim().length < 3) idProblems.overrideReason = 'Say why you’re accepting this ID.';
  if (!id.confirmed) idProblems.confirmed = 'Confirm you’ve checked the ID against the guest.';

  const stepValid: Record<StepKey, boolean> = {
    id: Object.keys(idProblems).length === 0,
    room: !!roomId,
    folio: true,
    deposit: !!deposit && (deposit.kind === 'HELD' || due <= 0.004 || noDepositReason.trim().length >= 3),
    sign: !!preview && consent && (sigMethod === 'DRAWN' ? !!sigImage : typedSignatureMatches(sigText, guestName) || typedSignatureMatches(sigText, id.nameOnId)),
  };

  // The registration card the guest signs: rebuilt by the server from what was entered, and hashed.
  const draft = React.useMemo(
    () =>
      deposit && last4.length === 4
        ? { roomId: mode === 'CHECK_IN' ? roomId : null, guestAddress: guestAddress.replace(/\s+/g, ' ').trim() || null, id: { idType: id.idType, country: id.country || null, last4 }, deposit }
        : null,
    [deposit?.kind, deposit?.kind === 'NONE' ? deposit.reason : null, last4, mode, roomId, guestAddress, id.idType, id.country] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const draftKey = draft ? JSON.stringify(draft) : '';
  const loadPreview = React.useCallback(async () => {
    if (!booking || !draft) return;
    setPreviewError('');
    try {
      setPreview(await api<{ text: string; textHash: string }>(`/api/admin/bookings/${booking.id}/check-in/registration`, { method: 'POST', json: draft }));
    } catch (e) {
      setPreview(null);
      setPreviewError((e as Error).message);
    }
  }, [booking, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (open && step === 'sign') {
      setPreview(null);
      setConsent(false);
      void loadPreview();
    }
  }, [open, step, loadPreview, folio?.totals.balance]);

  if (!booking) return null;

  function applyScan(scan: ScannedId) {
    setId((v) => ({
      ...v,
      source: scan.format === 'AAMVA' ? 'SCAN_AAMVA' : 'SCAN_MRZ',
      idType: scan.idType,
      country: scan.country ?? v.country,
      region: scan.region ?? '',
      nameOnId: scan.fullName || v.nameOnId,
      documentNumber: scan.documentNumber || v.documentNumber,
      expiresOn: scan.expiry ?? '',
      dateOfBirth: scan.dateOfBirth ?? '',
      address: scan.address,
      sex: scan.sex,
      nationality: scan.nationality,
    }));
    if (scan.address) setGuestAddress(addressLine(scan.address));
    setScanNote(
      scan.problems.length
        ? { tone: 'warning', text: `Read the ${scan.format === 'AAMVA' ? 'licence barcode' : 'passport lines'}, but check it: ${scan.problems.join(' ')}` }
        : { tone: 'success', text: `Read the ${scan.format === 'AAMVA' ? 'licence barcode' : 'passport lines'}. Check the details against the ID.` }
    );
  }

  function onScanInput(text: string) {
    setScanText(text);
    if (text.trim().length < 20) return;
    const scan = parseIdScan(text);
    if (scan) applyScan(scan);
  }

  async function readBarcodePhoto(file: File) {
    const Ctor = barcodeDetector();
    if (!Ctor) return;
    setPhotoBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const found = await new Ctor({ formats: ['pdf417', 'qr_code'] }).detect(bitmap);
      const scan = found.map((f) => parseIdScan(f.rawValue)).find(Boolean);
      if (scan) applyScan(scan);
      else setScanNote({ tone: 'warning', text: 'Couldn’t read a barcode in that photo. Try again closer and in good light, or type the details.' });
    } catch {
      setScanNote({ tone: 'warning', text: 'Couldn’t read that photo. Type the details instead.' });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function takePhoto(file: File) {
    setPhotoBusy(true);
    try {
      const photo = await shrinkImage(file);
      setId((v) => ({ ...v, photo }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  function go(to: StepKey) {
    setStep(to);
    setTried(false);
    setError('');
    bodyRef.current?.scrollTo({ top: 0 });
  }

  function next() {
    if (!stepValid[step]) {
      setTried(true);
      return;
    }
    go(steps[index + 1]);
  }

  async function finish() {
    if (!booking || !deposit || !preview) return;
    if (!stepValid.sign) {
      setTried(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ booking: BookingSummary }>(`/api/admin/bookings/${booking.id}/check-in`, {
        method: 'POST',
        json: {
          id: {
            source: id.source,
            idType: id.idType,
            nameOnId: id.nameOnId.trim(),
            documentNumber: id.documentNumber.trim(),
            country: id.country,
            region: id.region.trim() || null,
            expiresOn: id.expiresOn || null,
            dateOfBirth: id.dateOfBirth || null,
            address: id.address,
            sex: id.sex,
            nationality: id.nationality,
            photo: id.photo,
            confirmed: id.confirmed,
            overrideReason: id.overrideReason.trim() || null,
          },
          ...(mode === 'CHECK_IN' ? { roomId, allowDirtyRoom: dirty } : {}),
          deposit,
          guestAddress: guestAddress.replace(/\s+/g, ' ').trim() || null,
          registration: { textHash: preview.textHash, signature: sigMethod === 'DRAWN' ? { method: 'DRAWN', image: sigImage } : { method: 'TYPED', text: sigText.trim() }, consent: true },
        },
      });
      toast.success(mode === 'CHECK_IN' ? `${booking.guest.name} checked in${r.booking.room ? ` · Room ${r.booking.room.number}` : ''}` : `ID and registration card saved for ${booking.guest.name}`);
      const base = `/api/admin/bookings/${booking.id}`;
      await Promise.all([mutate(base), mutate(`${base}/guest-id`), mutate(`${base}/folio`), mutate(`${base}/desk-payments`), mutate(`${base}/check-in`)]);
      refresh();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Something on the card changed (a payment, the room, the deposit): show the new card and sign again.
        setConsent(false);
        void loadPreview();
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof typeof idProblems) => (tried ? idProblems[k] : undefined);
  const alreadyDone = mode === 'RECORD' && !!ctx?.recorded.registration;
  const latestNote = booking.notes?.split('\n').slice(-1)[0]?.replace(/^\[[^\]]+\]\s*/, '');

  return (
    <Sheet open={open} onOpenChange={(o) => (!busy || o ? onOpenChange(o) : undefined)}>
      <SheetContent className="sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>{mode === 'RECORD' ? `Photo ID and registration card for ${booking.guest.name}` : `Check in ${booking.guest.name}`}</SheetTitle>
          <SheetDescription>
            {booking.roomType.name} · {fmtRange(booking.checkIn, booking.checkOut)} · {booking.nights} night{booking.nights === 1 ? '' : 's'} · {booking.guests} guest{booking.guests === 1 ? '' : 's'}
            {booking.room ? ` · Room ${booking.room.number}` : ''}
          </SheetDescription>
          {ctx && !ctx.blocked && !alreadyDone && (
            <ol className="mt-3 flex gap-1 overflow-x-auto" aria-label="Check-in steps">
              {steps.map((s, i) => {
                const Icon = STEP_INFO[s].icon;
                const done = i < index;
                const current = s === step;
                return (
                  <li key={s} className="min-w-0 flex-1">
                    <button
                      type="button"
                      disabled={i > index}
                      onClick={() => go(s)}
                      aria-current={current ? 'step' : undefined}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-lg border-b-2 px-1.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                        current ? 'border-primary text-foreground' : done ? 'border-primary/40 text-muted-foreground hover:text-foreground' : 'border-border text-muted-foreground/70'
                      )}
                    >
                      {done ? <CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden /> : <Icon className="size-3.5 shrink-0" aria-hidden />}
                      <span className="truncate">{STEP_INFO[s].label}</span>
                      {done && <span className="sr-only">(done)</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </SheetHeader>

        <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {ctxError ? (
            <Callout tone="danger">{(ctxError as Error).message}</Callout>
          ) : !ctx ? (
            <div className="space-y-3" role="status">
              <span className="sr-only">Loading…</span>
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          ) : ctx.blocked ? (
            <Callout tone="warning">{ctx.blocked}</Callout>
          ) : alreadyDone ? (
            <Callout tone="success" icon={CheckCircle2}>
              The photo ID and registration card for this stay are already recorded. See them on the reservation page.
            </Callout>
          ) : (
            <>
              {step === 'id' && (
                <div className="space-y-4">
                  {latestNote && (
                    <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                      <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span>
                        <span className="sr-only">Latest note: </span>
                        {latestNote}
                      </span>
                    </p>
                  )}
                  {booking.riskFlags.length > 0 && (
                    <Callout tone="warning" icon={ShieldAlert}>
                      <p className="font-semibold">Flagged booking: {booking.riskFlags.map((f) => RISK_FLAG_INFO[f]?.label ?? f).join(', ')}</p>
                      <p>Check the ID and the card carefully.</p>
                    </Callout>
                  )}

                  <section className="space-y-2 rounded-xl border p-3" aria-labelledby="ci-scan-title">
                    <h3 id="ci-scan-title" className="flex items-center gap-2 text-sm font-semibold">
                      <ScanLine className="size-4 text-muted-foreground" aria-hidden /> Scan the ID
                    </h3>
                    <Field label="Scanner input" htmlFor="ci-scan" hint="Click here, then scan the barcode on the back of a driver’s licence or the lines at the bottom of a passport with the desk scanner.">
                      <Textarea
                        id="ci-scan"
                        value={scanText}
                        onChange={(e) => onScanInput(e.target.value)}
                        rows={2}
                        spellCheck={false}
                        autoComplete="off"
                        className="min-h-[64px] font-mono text-xs"
                        placeholder="Waiting for the scanner…"
                      />
                    </Field>
                    {barcodeDetector() && (
                      <>
                        <input ref={barcodeInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.[0] && void readBarcodePhoto(e.target.files[0])} />
                        <Button type="button" size="sm" variant="outline" loading={photoBusy} onClick={() => barcodeInput.current?.click()}>
                          <Camera aria-hidden /> Photograph the barcode
                        </Button>
                      </>
                    )}
                    {scanNote && (
                      <Callout tone={scanNote.tone} role="status">
                        {scanNote.text}
                      </Callout>
                    )}
                  </section>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Type of ID" htmlFor="ci-type">
                      <NativeSelect id="ci-type" value={id.idType} onChange={(e) => setId((v) => ({ ...v, idType: e.target.value as IdType }))}>
                        {ID_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {ID_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Issued by" htmlFor="ci-country" error={err('country')}>
                      <NativeSelect id="ci-country" value={id.country} onChange={(e) => setId((v) => ({ ...v, country: e.target.value }))}>
                        <option value="">Choose a country…</option>
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Name on the ID" htmlFor="ci-name" error={err('nameOnId')}>
                      <Input id="ci-name" value={id.nameOnId} autoComplete="off" onChange={(e) => setId((v) => ({ ...v, nameOnId: e.target.value }))} />
                    </Field>
                    <Field label="ID number" htmlFor="ci-number" error={err('documentNumber')} hint="Kept encrypted; only the last four are shown.">
                      <Input id="ci-number" value={id.documentNumber} autoComplete="off" spellCheck={false} maxLength={30} onChange={(e) => setId((v) => ({ ...v, documentNumber: e.target.value }))} />
                    </Field>
                    <Field label="Expires" optional htmlFor="ci-expiry">
                      <Input id="ci-expiry" type="date" value={id.expiresOn} onChange={(e) => setId((v) => ({ ...v, expiresOn: e.target.value }))} />
                    </Field>
                    <Field label="Date of birth" optional htmlFor="ci-dob">
                      <Input id="ci-dob" type="date" value={id.dateOfBirth} onChange={(e) => setId((v) => ({ ...v, dateOfBirth: e.target.value }))} />
                    </Field>
                    {id.idType === 'DRIVERS_LICENSE' && (
                      <Field label="State or province" optional htmlFor="ci-region">
                        <Input id="ci-region" value={id.region} maxLength={10} onChange={(e) => setId((v) => ({ ...v, region: e.target.value.toUpperCase() }))} />
                      </Field>
                    )}
                  </div>

                  <Field label="Home address" optional htmlFor="ci-address" hint="Printed on the registration card.">
                    <Input id="ci-address" value={guestAddress} maxLength={300} autoComplete="off" onChange={(e) => setGuestAddress(e.target.value)} />
                  </Field>

                  {ctx.idPhotos ? (
                    <section className="space-y-2" aria-labelledby="ci-photo-title">
                      <h3 id="ci-photo-title" className="text-sm font-medium">
                        Photo of the front of the ID
                      </h3>
                      <div className="flex flex-wrap items-center gap-3">
                        {id.photo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={id.photo} alt="Front of the ID" className="h-24 w-auto rounded-lg border object-contain" />
                        )}
                        <label className={cn('inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring', photoBusy && 'opacity-60')}>
                          <Camera className="size-4" aria-hidden />
                          {id.photo ? 'Retake photo' : 'Take photo'}
                          <input type="file" accept="image/*" capture="environment" className="sr-only" aria-describedby={err('photo') ? 'ci-photo-error' : undefined} onChange={(e) => e.target.files?.[0] && void takePhoto(e.target.files[0])} />
                        </label>
                      </div>
                      {err('photo') && (
                        <p id="ci-photo-error" role="alert" className="text-xs font-medium text-destructive">
                          {err('photo')}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">Stored encrypted and deleted automatically some months after check-out.</p>
                    </section>
                  ) : (
                    <Callout tone="info">ID photos are off until the encryption key is set up, so only the ID’s type, country and last four are kept.</Callout>
                  )}

                  {warnings.messages.length > 0 && (
                    <Callout tone="warning" role="status">
                      {warnings.messages.map((m) => (
                        <p key={m}>{m}</p>
                      ))}
                    </Callout>
                  )}
                  {warnings.needsReason && (
                    <Field label="Why you’re accepting it" htmlFor="ci-override" error={err('overrideReason')}>
                      <Input id="ci-override" value={id.overrideReason} maxLength={300} onChange={(e) => setId((v) => ({ ...v, overrideReason: e.target.value }))} placeholder="e.g. Renewal receipt shown, staying with a parent" />
                    </Field>
                  )}

                  <div>
                    <Check id="ci-confirmed" checked={id.confirmed} onChange={(c) => setId((v) => ({ ...v, confirmed: c }))}>
                      I’ve looked at the ID and the photo matches the guest in front of me.
                    </Check>
                    {err('confirmed') && (
                      <p role="alert" className="text-xs font-medium text-destructive">
                        {err('confirmed')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {step === 'room' && (
                <div className="space-y-3">
                  <RoomPicker
                    booking={booking}
                    value={roomId}
                    onChange={(rid, o) => {
                      setRoomId(rid);
                      setOption(o);
                    }}
                    readyOnly={!showAll}
                  />
                  <Check id="ci-show-all" checked={showAll} onChange={setShowAll}>
                    <span className="text-muted-foreground">Show rooms that still need cleaning</span>
                  </Check>
                  {dirty && (
                    <Callout tone="warning" role="status">
                      Room {option?.room.number} hasn’t been cleaned yet. The guest will be checked into it anyway.
                    </Callout>
                  )}
                  {tried && !roomId && (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      Choose a room.
                    </p>
                  )}
                </div>
              )}

              {step === 'folio' && (
                <div className="space-y-4">
                  <FolioSummary bookingId={booking.id} />
                  {folio && folio.totals.balance > 0.004 && (
                    <Callout
                      tone="info"
                      action={
                        ctx.can.collect ? (
                          <Button size="sm" variant="outline" onClick={() => setCollect('PAYMENT')}>
                            <CreditCard aria-hidden /> Take payment
                          </Button>
                        ) : undefined
                      }
                    >
                      {fmt(folio.totals.balance, folio.currency)} still to pay. Take it now or any time before check-out; the guest can’t check out until it’s paid.
                    </Callout>
                  )}
                </div>
              )}

              {step === 'deposit' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {ctx.deposit.mode === 'NONE'
                      ? 'This hotel doesn’t require a security deposit, but you can take one.'
                      : `This hotel takes a security deposit of ${fmt(ctx.deposit.amount, currency)} ${ctx.deposit.mode === 'HOLD' ? 'as a hold on the guest’s card' : 'charged and refunded at check-out'}.`}
                  </p>
                  {held ? (
                    <Callout tone="success" icon={ShieldCheck}>
                      {fmt(ctx.deposit.held, currency)} security deposit held. It’s on the registration card.
                    </Callout>
                  ) : (
                    <>
                      {ctx.can.collect ? (
                        <div className="space-y-2 rounded-xl border p-3">
                          <p className="text-sm font-medium">Take the deposit</p>
                          <p className="text-xs text-muted-foreground">On the card reader, as a hold on the guest’s card online (they can scan a code to pay on their phone), or in cash.</p>
                          <Button size="sm" disabled={noDeposit} onClick={() => setCollect('SECURITY_DEPOSIT')}>
                            <ShieldCheck aria-hidden /> Take deposit{due > 0.004 ? ` · ${fmt(due, currency)}` : ''}
                          </Button>
                        </div>
                      ) : (
                        <Callout tone="info">Your role can’t take payments. Ask someone who can to take the deposit, or check in without one.</Callout>
                      )}
                      <Check id="ci-no-deposit" checked={noDeposit} onChange={setNoDeposit}>
                        Check in without a security deposit
                      </Check>
                      {noDeposit && (
                        <Field label="Why" optional={due <= 0.004} htmlFor="ci-no-deposit-reason" error={tried && due > 0.004 && noDepositReason.trim().length < 3 ? 'Say why this guest checks in without the deposit.' : undefined}>
                          <Input id="ci-no-deposit-reason" value={noDepositReason} maxLength={200} onChange={(e) => setNoDepositReason(e.target.value)} placeholder="e.g. Corporate account, regular guest" />
                        </Field>
                      )}
                      {tried && !deposit && (
                        <p role="alert" className="text-xs font-medium text-destructive">
                          Take the deposit, or choose to check in without one.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 'sign' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">Turn the screen to the guest. They read the card, agree and sign.</p>
                  {previewError ? (
                    <Callout tone="danger" role="alert" action={<Button size="sm" variant="outline" onClick={() => void loadPreview()}>Try again</Button>}>
                      {previewError}
                    </Callout>
                  ) : !preview ? (
                    <Skeleton className="h-48 rounded-xl" />
                  ) : (
                    <article aria-label="Registration card" className="max-h-72 space-y-3 overflow-y-auto rounded-xl border bg-surface-sunken/60 p-4 text-sm leading-relaxed">
                      {preview.text.split('\n\n').map((p, i) => (
                        <p key={i} className={cn('whitespace-pre-line', i === 0 && 'font-semibold')}>
                          {p}
                        </p>
                      ))}
                    </article>
                  )}
                  <Check id="ci-consent" checked={consent} onChange={setConsent}>
                    I’ve read the registration card. The information is correct and I agree to its terms.
                  </Check>
                  {tried && !consent && (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      The guest needs to agree before signing.
                    </p>
                  )}
                  <SegmentedControl
                    layoutId="ci-sig"
                    aria-label="How the guest signs"
                    value={sigMethod}
                    onChange={setSigMethod}
                    size="sm"
                    options={[
                      { value: 'DRAWN', label: 'Draw signature' },
                      { value: 'TYPED', label: 'Type name' },
                    ]}
                  />
                  {sigMethod === 'DRAWN' ? (
                    <div className="space-y-1">
                      <SignaturePad label="Guest signature" onChange={setSigImage} />
                      {tried && !sigImage && (
                        <p role="alert" className="text-xs font-medium text-destructive">
                          The guest signs in the box.
                        </p>
                      )}
                    </div>
                  ) : (
                    <Field
                      label="Guest types their full name"
                      htmlFor="ci-sig-text"
                      error={tried && !stepValid.sign && sigText.trim() && !(typedSignatureMatches(sigText, guestName) || typedSignatureMatches(sigText, id.nameOnId)) ? `Type the full name as on the reservation (${guestName}) or the ID.` : tried && !sigText.trim() ? 'The guest types their full name.' : undefined}
                    >
                      <Input id="ci-sig-text" value={sigText} autoComplete="off" onChange={(e) => setSigText(e.target.value)} className="font-serif text-lg italic" />
                    </Field>
                  )}
                </div>
              )}

              {error && (
                <Callout tone="danger" role="alert">
                  {error}
                </Callout>
              )}
            </>
          )}
        </div>

        <SheetFooter>
          {!ctx || ctx.blocked || alreadyDone ? (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              {index > 0 ? (
                <Button variant="ghost" disabled={busy} onClick={() => go(steps[index - 1])}>
                  <ArrowLeft aria-hidden /> Back
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              )}
              {step === 'sign' ? (
                <Button disabled={!preview} loading={busy} loadingText={mode === 'CHECK_IN' ? 'Checking in…' : 'Saving…'} onClick={finish}>
                  <CheckCircle2 aria-hidden /> {mode === 'CHECK_IN' ? `Check in${option ? ` to room ${option.room.number}` : booking.room ? ` to room ${booking.room.number}` : ''}` : 'Save'}
                </Button>
              ) : (
                <Button onClick={next}>
                  {step === 'deposit' ? 'Registration card' : 'Next'} <ArrowRight aria-hidden />
                </Button>
              )}
            </>
          )}
        </SheetFooter>

        <CollectPaymentDialog
          booking={booking}
          kind={collect ?? 'PAYMENT'}
          open={collect !== null}
          onOpenChange={(o) => !o && setCollect(null)}
          onCollected={() => {
            void mutate(`/api/admin/bookings/${booking.id}/check-in`);
            void mutate(`/api/admin/bookings/${booking.id}/folio`);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
