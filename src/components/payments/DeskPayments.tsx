'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { Banknote, CreditCard, ExternalLink, KeyRound, Landmark, Loader2, Nfc, Receipt, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import type { BookingSummary } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { formatMoney } from '@/lib/format';
import { CARD_BRANDS, cardBrandLabel } from '@/lib/card-authorization';
import { CARD_NUMBER_REFUSED, cashChangeCents, containsCardNumber, RECORDED_METHODS, type DeskKind, type DeskMethod, type PaymentMethod } from '@/lib/desk-payments';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { useConsole } from '@/components/console/ConsoleProvider';

interface DeskPaymentRow {
  id: string;
  method: string;
  methodLabel: string;
  kind: string;
  kindLabel: string;
  status: string;
  amount: number;
  amountAuthorized: number | null;
  amountRefunded: number;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
  cashTendered: number | null;
  captureBefore: string | null;
  settledAt: string | null;
  failureMessage: string | null;
  note: string | null;
  recordedBy: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface DeskState {
  bookingId: string;
  code: string;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  reservation: { code: string; roomTypes: number } | null;
  deposit: { mode: 'NONE' | 'HOLD' | 'CHARGE'; amount: number; held: number; due: number };
  payments: DeskPaymentRow[];
  card: { available: boolean; reason: string | null };
  readers: { id: string; label: string; deviceType: string; status: string | null; simulated: boolean }[];
  otaCard: {
    type: 'VIRTUAL' | 'GUEST';
    brand: string | null;
    last4: string | null;
    expiry: string | null;
    holderName: string | null;
    chargeableFrom: string | null;
    chargeableUntil: string | null;
    balance: number | null;
    currency: string | null;
    channel: string;
    chargeable: boolean;
    reason: string | null;
  } | null;
  testMode: boolean;
  canRefund: boolean;
}

const key = (bookingId: string) => `/api/admin/bookings/${bookingId}/desk-payments`;
/** Everything that shows the reservation's money, refreshed after a change: the desk, the booking, its payment, the folio and the guided check-in. */
const moneyKeys = (bookingId: string) => [key(bookingId), `/api/admin/bookings/${bookingId}`, `/api/admin/bookings/${bookingId}/payment`, `/api/admin/bookings/${bookingId}/folio`, `/api/admin/bookings/${bookingId}/check-in`];

/** Everything the desk needs to collect money for a reservation. Null for staff who can't take payments. */
export function useDeskPayments(bookingId: string | null | undefined) {
  const { can } = useConsole();
  return useSWR<DeskState>(bookingId && can('payments.collect') ? key(bookingId) : null, fetcher);
}

const READER_LAST = 'hotelone.desk.reader';
const fmt = (n: number, c: string) => formatMoney(n, c, { cents: true });
const toNumber = (s: string) => Number(s.replace(/,/g, '.').replace(/[^\d.]/g, ''));

const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Waiting',
  AUTHORIZED: 'Held on card',
  SUCCEEDED: 'Paid',
  FAILED: 'Declined',
  CANCELED: 'Released',
  PARTIALLY_REFUNDED: 'Partly returned',
  REFUNDED: 'Returned',
};

function MethodIcon({ method, className }: { method: string; className?: string }) {
  const Icon = method === 'CASH' ? Banknote : method === 'TERMINAL' ? Nfc : method === 'VIRTUAL_CARD' ? Landmark : method === 'OTHER' ? Receipt : CreditCard;
  return <Icon className={cn('size-4 text-muted-foreground', className)} aria-hidden />;
}

/** What the desk just collected, for a screen that moves on once the guest has paid (the guided check-in). */
export interface CollectedPayment {
  id: string;
  kind: string;
  method: string;
  status: string;
  amount: number;
}

const collected = (p: DeskPaymentRow): CollectedPayment => ({ id: p.id, kind: p.kind, method: p.method, status: p.status, amount: p.amount });
const isRecorded = (method: string) => RECORDED_METHODS.includes(method as PaymentMethod);

/** Quick amounts for a security deposit, in the hotel's currency; the hotel's own amount joins them. */
const DEPOSIT_PRESETS = [50, 100];

/**
 * Take a payment or the security deposit: on the card reader, typed into
 * Stripe's page (the guest's card or the OTA's virtual card), in cash, or
 * recorded when it was taken another way (the hotel's own terminal, a bank
 * transfer). Card payments show live progress until the guest has paid; a
 * card deposit is held on the card or charged, as the desk chooses.
 */
export function CollectPaymentDialog({
  booking,
  kind,
  open,
  onOpenChange,
  onCollected,
}: {
  booking: Pick<BookingSummary, 'id' | 'guest'>;
  kind: DeskKind;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Called once the money is in (paid, held, or recorded), after the screens have refreshed. */
  onCollected?: (payment: CollectedPayment) => void;
}) {
  const { mutate } = useSWRConfig();
  const { refresh } = useConsole();
  const { data } = useDeskPayments(open ? booking.id : null);
  const [method, setMethod] = React.useState<DeskMethod>('TERMINAL');
  const [amount, setAmount] = React.useState('');
  const [hold, setHold] = React.useState<'HOLD' | 'CHARGE'>('HOLD');
  const [tendered, setTendered] = React.useState('');
  const [note, setNote] = React.useState('');
  const [cardBrand, setCardBrand] = React.useState('');
  const [cardLast4, setCardLast4] = React.useState('');
  const [approval, setApproval] = React.useState('');
  const [paidHow, setPaidHow] = React.useState('');
  const [readerId, setReaderId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [active, setActive] = React.useState<DeskPaymentRow | null>(null);
  const [pageUrl, setPageUrl] = React.useState<string | null>(null);
  const [qr, setQr] = React.useState<string | null>(null);
  const amountRef = React.useRef<HTMLInputElement>(null);
  // The amount is filled in once per opening, so "Custom" can leave it empty while the data refreshes.
  const filled = React.useRef(false);
  // The payment onCollected was called for: once per payment, whichever way it finished.
  const reported = React.useRef<string | null>(null);
  const deposit = kind === 'SECURITY_DEPOSIT';

  // Fresh form each time it opens, with the amount due and the usual method.
  React.useEffect(() => {
    if (!open) return;
    filled.current = false;
    setActive(null);
    setPageUrl(null);
    setError('');
    setNote('');
    setTendered('');
    setCardBrand('');
    setCardLast4('');
    setApproval('');
    setPaidHow('');
    setAmount('');
  }, [open]);
  React.useEffect(() => {
    if (!open || !data) return;
    if (!filled.current) {
      filled.current = true;
      const due = deposit ? data.deposit.due || data.deposit.amount || 100 : data.balance;
      setAmount(due > 0 ? due.toFixed(2) : '');
      // As the server does when the desk doesn't say: hold, unless the hotel charges deposits.
      setHold(data.deposit.mode === 'CHARGE' ? 'CHARGE' : 'HOLD');
    }
    const remembered = (() => {
      try {
        return window.localStorage.getItem(READER_LAST);
      } catch {
        return null;
      }
    })();
    setReaderId((r) => r || data.readers.find((x) => x.id === remembered)?.id || data.readers[0]?.id || '');
    setMethod((m) => {
      if (isRecorded(m)) return m;
      if (!data.card.available) return 'CASH';
      if (m === 'TERMINAL' && !data.readers.length) return !deposit && data.otaCard?.type === 'VIRTUAL' && data.otaCard.chargeable ? 'VIRTUAL_CARD' : 'CARD_ENTRY';
      return m;
    });
  }, [open, data, deposit]);

  const finished = active && ['SUCCEEDED', 'AUTHORIZED'].includes(active.status);
  const waiting = active && active.status === 'PENDING';

  // While the guest pays, poll the payment (it is also updated by Stripe's webhook).
  React.useEffect(() => {
    if (!active || !waiting) return;
    let stop = false;
    const id = window.setInterval(async () => {
      try {
        const row = await api<DeskPaymentRow>(`/api/admin/desk-payments/${active.id}`);
        if (!stop) setActive(row);
      } catch {
        // Keep polling; a blip shouldn't end the payment.
      }
    }, 2000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [active, waiting]);

  // Stripe's page as a QR code, so the guest can type their card on their own phone.
  const qrUrl = active?.method === 'CARD_ENTRY' && waiting ? pageUrl : null;
  React.useEffect(() => {
    setQr(null);
    if (!qrUrl) return;
    let stop = false;
    QRCode.toDataURL(qrUrl, { margin: 2, width: 352, errorCorrectionLevel: 'L' })
      .then((src) => {
        if (!stop) setQr(src);
      })
      .catch(() => {
        // The link still works.
      });
    return () => {
      stop = true;
    };
  }, [qrUrl]);

  const done = React.useCallback(async () => {
    await Promise.all(moneyKeys(booking.id).map((path) => mutate(path)));
    refresh();
  }, [booking.id, mutate, refresh]);

  React.useEffect(() => {
    if (!active || reported.current === active.id) return;
    if (active.status === 'SUCCEEDED' || active.status === 'AUTHORIZED') {
      reported.current = active.id;
      toast.success(`${active.status === 'AUTHORIZED' ? 'Held' : 'Collected'} ${fmt(active.amount, active.currency)} from ${booking.guest.name}`);
      const row = active;
      void done()
        .catch(() => undefined)
        .then(() => onCollected?.(collected(row)));
    }
  }, [active?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const currency = data?.currency ?? 'USD';
  const value = toNumber(amount);
  const change = method === 'CASH' && tendered ? cashChangeCents(Math.round(toNumber(tendered) * 100), Math.round(value * 100)) : null;
  const vcc = data?.otaCard;
  const overBalance = !deposit && data ? value > data.balance + 0.004 : false;
  const recorded = isRecorded(method);
  // A card deposit is held or charged as the desk chooses; the OTA's virtual card follows the hotel's setting.
  // Card numbers are never stored: a full one typed into a note or the approval code is refused here and on the server.
  const cardNumberTyped = containsCardNumber(approval) || containsCardNumber(paidHow) || containsCardNumber(note);
  const holdChoice = deposit && (method === 'TERMINAL' || method === 'CARD_ENTRY');
  const holding = holdChoice ? hold === 'HOLD' : method === 'VIRTUAL_CARD' && data?.deposit.mode !== 'CHARGE';
  const valid =
    value > 0 &&
    !overBalance &&
    (method !== 'TERMINAL' || !!readerId) &&
    (method !== 'CASH' || !tendered || change !== null) &&
    (method !== 'VIRTUAL_CARD' || !!vcc?.chargeable) &&
    (method !== 'EXTERNAL_CARD' || (/^\d{4}$/.test(cardLast4) && /^[A-Za-z0-9-]*$/.test(approval.trim()))) &&
    (method !== 'OTHER' || paidHow.trim().length >= 3) &&
    !cardNumberTyped;
  const presets = data ? [...DEPOSIT_PRESETS, ...(data.deposit.amount > 0 && !DEPOSIT_PRESETS.includes(data.deposit.amount) ? [data.deposit.amount] : [])].sort((a, b) => a - b) : [];
  const preset = presets.find((p) => Math.abs(p - value) < 0.004);

  async function collect() {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = { method, kind, amount: Math.round(value * 100) / 100 };
      if (holdChoice) body.hold = hold === 'HOLD';
      if (method === 'TERMINAL') {
        body.readerId = readerId;
        try {
          window.localStorage.setItem(READER_LAST, readerId);
        } catch {
          // Remembering the reader is a convenience.
        }
      }
      if (method === 'CASH') {
        if (tendered) body.tendered = Math.round(toNumber(tendered) * 100) / 100;
        if (note.trim()) body.note = note.trim();
      }
      if (method === 'EXTERNAL_CARD') {
        body.cardLast4 = cardLast4;
        if (cardBrand) body.cardBrand = cardBrand;
        if (approval.trim()) body.reference = approval.trim();
      }
      if (method === 'OTHER') body.note = paidHow.trim();
      const row = await api<DeskPaymentRow & { url?: string }>(key(booking.id), { method: 'POST', json: body });
      if (row.url) {
        setPageUrl(row.url);
        window.open(row.url, '_blank', 'noopener');
      }
      if (recorded) {
        toast.success(
          method === 'CASH'
            ? `Recorded ${fmt(row.amount, currency)} cash from ${booking.guest.name}${change ? ` · change ${fmt(change / 100, currency)}` : ''}`
            : method === 'EXTERNAL_CARD'
              ? `Recorded ${fmt(row.amount, currency)} from ${booking.guest.name} on the hotel’s terminal`
              : `Recorded ${fmt(row.amount, currency)} from ${booking.guest.name} · ${paidHow.trim()}`
        );
        await done();
        onCollected?.(collected(row));
        onOpenChange(false);
        return;
      }
      setActive(row);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'cancel' | 'simulate', extra: Record<string, unknown> = {}) {
    if (!active) return;
    setBusy(true);
    try {
      const row = await api<DeskPaymentRow>(`/api/admin/desk-payments/${active.id}`, { method: 'POST', json: { action, ...extra } });
      setActive(row);
      // The guest may have finished paying a moment before the cancel: then keep showing the payment.
      if (action === 'cancel' && row.status !== 'SUCCEEDED' && row.status !== 'AUTHORIZED') {
        await done();
        setActive(null);
        setPageUrl(null);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The ways to pay don't fit one row on a phone: a grid keeps them all in view instead of scrolling sideways.
  const methods = [
    { value: 'TERMINAL' as const, label: 'Card reader', icon: <Nfc className="size-4" aria-hidden />, disabled: !data?.card.available || !data?.readers.length },
    { value: 'CARD_ENTRY' as const, label: 'Type card', icon: <KeyRound className="size-4" aria-hidden />, disabled: !data?.card.available },
    ...(vcc ? [{ value: 'VIRTUAL_CARD' as const, label: vcc.type === 'VIRTUAL' ? 'Virtual card' : 'OTA card', icon: <Landmark className="size-4" aria-hidden />, disabled: !data?.card.available }] : []),
    { value: 'CASH' as const, label: 'Cash', icon: <Banknote className="size-4" aria-hidden /> },
    { value: 'EXTERNAL_CARD' as const, label: 'Other terminal', icon: <CreditCard className="size-4" aria-hidden /> },
    { value: 'OTHER' as const, label: 'Other', icon: <Receipt className="size-4" aria-hidden /> },
  ];
  const holdText = recorded
    ? 'Taken now and given back at check-out.'
    : holding
      ? 'The card is authorized now and the hold is released at check-out; only what you keep for incidentals is charged.'
      : 'Charged now and refunded at check-out.';

  return (
    <Dialog open={open} onOpenChange={(o) => (!waiting || !o ? onOpenChange(o) : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{deposit ? `Security deposit for ${booking.guest.name}` : `Take payment from ${booking.guest.name}`}</DialogTitle>
          <DialogDescription>
            {!data
              ? 'Loading…'
              : deposit
                ? `${data.deposit.mode === 'NONE' ? 'This hotel doesn’t ask for a deposit, but you can take one. ' : ''}${holdText}${data.deposit.held > 0 ? ` ${fmt(data.deposit.held, currency)} is already held.` : ''}`
                : `Balance ${fmt(data.balance, currency)} of ${fmt(data.total, currency)}${data.reservation ? ` for all ${data.reservation.roomTypes} room types in reservation ${data.reservation.code}` : ''}.`}
          </DialogDescription>
        </DialogHeader>

        {active ? (
          <div className="space-y-4" aria-live="polite">
            {finished ? (
              <Callout tone="success" icon={ShieldCheck}>
                <p className="font-semibold">
                  {active.status === 'AUTHORIZED' ? 'Held' : 'Paid'} {fmt(active.amount, active.currency)}
                  {active.cardLast4 ? ` · ${active.cardBrand ?? 'card'} ending ${active.cardLast4}` : ''}
                </p>
                {active.captureBefore && <p>The hold lasts until {new Date(active.captureBefore).toLocaleDateString([], { dateStyle: 'medium' })}. Settle it at check-out.</p>}
              </Callout>
            ) : active.status === 'FAILED' ? (
              <Callout tone="danger" icon={XCircle}>
                <p className="font-semibold">Declined</p>
                <p>{active.failureMessage ?? 'The card was declined.'} Ask for another card, or cancel and choose another way to pay.</p>
              </Callout>
            ) : active.status === 'CANCELED' ? (
              <Callout tone="info">Cancelled. Nothing was charged.</Callout>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                <div className="min-w-0 space-y-1">
                  {active.method === 'TERMINAL' ? (
                    <p>
                      <span className="font-medium">{fmt(active.amount, active.currency)}</span> is on the card reader. Ask the guest to tap, insert or swipe their card.
                    </p>
                  ) : (
                    <>
                      <p>
                        Enter the {active.method === 'VIRTUAL_CARD' ? `${vcc?.channel ?? 'OTA'} card` : 'card'} on Stripe’s page. This updates on its own once the payment goes through.
                      </p>
                      {active.method === 'VIRTUAL_CARD' && vcc && (
                        <p className="text-muted-foreground">
                          Copy the full number, expiry and code from the {vcc.channel} extranet ({vcc.brand ?? 'card'}{vcc.last4 ? ` ending ${vcc.last4}` : ''}). HotelOne never stores card numbers.
                        </p>
                      )}
                      {pageUrl && (
                        <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                          Open Stripe’s payment page <ExternalLink className="size-3.5" aria-hidden />
                        </a>
                      )}
                      {qrUrl && qr && (
                        <figure className="space-y-1.5 pt-2">
                          {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing for next/image to optimize */}
                          <img src={qr} alt="QR code of Stripe’s payment page" width={176} height={176} className="size-44 rounded-lg border bg-white" />
                          <figcaption className="text-muted-foreground">Or let the guest scan this to pay on their phone</figcaption>
                        </figure>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {data?.testMode && active.method === 'TERMINAL' && (active.status === 'PENDING' || active.status === 'FAILED') && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act('simulate')}>
                  Simulate tap (test)
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('simulate', { decline: true })}>
                  Simulate declined card
                </Button>
              </div>
            )}
            {data?.testMode && active.method !== 'TERMINAL' && active.status === 'PENDING' && (
              <p className="text-xs text-muted-foreground">Test mode: use card 4242 4242 4242 4242, any future expiry and any code.</p>
            )}
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <SegmentedControl layoutId="desk-method" aria-label="How the guest pays" value={method} onChange={setMethod} options={methods} size="sm" className="grid w-full grid-cols-2 sm:grid-cols-3" />
            {!data.card.available && method === 'CASH' && data.card.reason && <p className="text-xs text-muted-foreground">{data.card.reason}</p>}

            {holdChoice && (
              <SegmentedControl
                layoutId="desk-hold"
                aria-label="Hold or charge the deposit"
                value={hold}
                onChange={setHold}
                options={[
                  { value: 'HOLD', label: 'Hold on the card' },
                  { value: 'CHARGE', label: 'Charge now' },
                ]}
                size="sm"
              />
            )}

            <Field label={`Amount (${currency})`} htmlFor="desk-amount" hint={!deposit && overBalance ? `More than the balance of ${fmt(data.balance, currency)}.` : undefined}>
              {deposit && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Deposit amount">
                  {presets.map((p) => (
                    <AmountChip key={p} pressed={preset === p} onClick={() => setAmount(p.toFixed(2))}>
                      {formatMoney(p, currency)}
                    </AmountChip>
                  ))}
                  <AmountChip
                    pressed={preset === undefined}
                    onClick={() => {
                      setAmount('');
                      amountRef.current?.focus();
                    }}
                  >
                    Custom
                  </AmountChip>
                </div>
              )}
              <Input id="desk-amount" ref={amountRef} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>

            {method === 'TERMINAL' &&
              (data.readers.length ? (
                <Field label="Card reader" htmlFor="desk-reader">
                  <select id="desk-reader" value={readerId} onChange={(e) => setReaderId(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm">
                    {data.readers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                        {r.simulated ? ' (simulated)' : ''}
                        {r.status === 'offline' ? ' · offline' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Callout tone="info">No card reader yet. An owner can add one in Settings → Online payments.</Callout>
              ))}

            {method === 'CARD_ENTRY' && <p className="text-sm text-muted-foreground">Opens Stripe’s secure page in a new tab. Type the card the guest gives you, or let them scan a code and pay on their phone; it goes straight to Stripe.</p>}

            {method === 'VIRTUAL_CARD' && vcc && (
              <div className="space-y-2 rounded-xl border p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <Landmark className="size-4 text-muted-foreground" aria-hidden />
                  {vcc.channel} {vcc.type === 'VIRTUAL' ? 'virtual card' : 'guest card'} · {vcc.brand ?? 'Card'}{vcc.last4 ? ` ending ${vcc.last4}` : ''}
                  {vcc.expiry ? ` · exp ${vcc.expiry}` : ''}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {vcc.balance !== null && (
                    <>
                      <dt>Balance</dt>
                      <dd className="text-foreground">{fmt(vcc.balance, vcc.currency ?? currency)}</dd>
                    </>
                  )}
                  {(vcc.chargeableFrom || vcc.chargeableUntil) && (
                    <>
                      <dt>Chargeable</dt>
                      <dd className="text-foreground">
                        {vcc.chargeableFrom ? `from ${vcc.chargeableFrom}` : ''} {vcc.chargeableUntil ? `until ${vcc.chargeableUntil}` : ''}
                      </dd>
                    </>
                  )}
                </dl>
                {!vcc.chargeable && <Callout tone="warning">{vcc.reason}</Callout>}
                <p className="text-xs text-muted-foreground">Opens Stripe’s page. Copy the full card number, expiry and code from the {vcc.channel} extranet.</p>
              </div>
            )}

            {method === 'CASH' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cash received" optional htmlFor="desk-tendered" hint={change !== null && change > 0 ? `Give back ${fmt(change / 100, currency)} in change.` : tendered && change === null ? 'Less than the amount.' : undefined}>
                  <Input id="desk-tendered" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={amount} />
                </Field>
                <Field label="Note" optional htmlFor="desk-note" error={containsCardNumber(note) ? CARD_NUMBER_REFUSED : undefined}>
                  <Input id="desk-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
            )}

            {method === 'EXTERNAL_CARD' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">For a card charged on the hotel’s own terminal. Enter what the terminal’s receipt shows; HotelOne records it and no money moves through Stripe.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Last four digits" required htmlFor="desk-card-last4">
                    <Input id="desk-card-last4" required inputMode="numeric" autoComplete="off" maxLength={4} value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                  </Field>
                  <Field label="Card" optional htmlFor="desk-card-brand">
                    <select id="desk-card-brand" value={cardBrand} onChange={(e) => setCardBrand(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm">
                      <option value="">Choose</option>
                      {CARD_BRANDS.map((b) => (
                        <option key={b} value={b}>
                          {cardBrandLabel(b)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Approval code" optional htmlFor="desk-approval" error={containsCardNumber(approval) ? CARD_NUMBER_REFUSED : undefined}>
                    <Input id="desk-approval" autoComplete="off" maxLength={20} value={approval} onChange={(e) => setApproval(e.target.value)} />
                  </Field>
                </div>
              </div>
            )}

            {method === 'OTHER' && (
              <Field
                label="What it was"
                required
                htmlFor="desk-paid-how"
                hint="For example a bank transfer or a voucher. HotelOne records it; no money moves through Stripe."
                error={containsCardNumber(paidHow) ? CARD_NUMBER_REFUSED : undefined}
              >
                <Input id="desk-paid-how" required value={paidHow} maxLength={200} placeholder="Bank transfer" onChange={(e) => setPaidHow(e.target.value)} />
              </Field>
            )}

            {error && (
              <Callout tone="danger" role="alert">
                {error}
              </Callout>
            )}
          </div>
        )}

        <DialogFooter>
          {active ? (
            finished || active.status === 'CANCELED' ? (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" disabled={busy} onClick={() => act('cancel')}>
                  Cancel payment
                </Button>
                {active.status === 'FAILED' && active.method === 'TERMINAL' && (
                  <Button
                    disabled={busy}
                    onClick={async () => {
                      // Close the declined attempt on the reader before sending a fresh one.
                      await api(`/api/admin/desk-payments/${active.id}`, { method: 'POST', json: { action: 'cancel' } }).catch(() => undefined);
                      setActive(null);
                      void collect();
                    }}
                  >
                    Try again
                  </Button>
                )}
              </>
            )
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Not now
              </Button>
              <Button disabled={!valid || !data} loading={busy} loadingText={recorded ? 'Saving…' : 'Starting…'} onClick={collect}>
                <CollectIcon method={method} />
                {COLLECT_LABEL[method]} {value > 0 ? fmt(value, currency) : ''}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const COLLECT_LABEL: Record<DeskMethod, string> = {
  TERMINAL: 'Send to reader',
  CARD_ENTRY: 'Open payment page',
  VIRTUAL_CARD: 'Open payment page',
  CASH: 'Record cash',
  EXTERNAL_CARD: 'Record card payment',
  OTHER: 'Record payment',
};

function CollectIcon({ method }: { method: DeskMethod }) {
  const Icon = method === 'CASH' ? Banknote : method === 'TERMINAL' ? Nfc : method === 'EXTERNAL_CARD' ? CreditCard : method === 'OTHER' ? Receipt : ExternalLink;
  return <Icon aria-hidden />;
}

/** A quick amount for the deposit; pressed when it is the amount in the box. */
function AmountChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium tabular transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        pressed ? 'border-primary/50 bg-primary-soft text-primary-soft-foreground' : 'border-border-strong/50 bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

/** Settle a security deposit at check-out: keep part of it for incidentals and return the rest. */
function SettleDepositDialog({ bookingId, payment, open, onOpenChange }: { bookingId: string; payment: DeskPaymentRow | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { mutate } = useSWRConfig();
  const [keep, setKeep] = React.useState('0');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setKeep('0');
      setNote('');
      setError('');
    }
  }, [open]);
  if (!payment) return null;
  const held = payment.status === 'AUTHORIZED' ? (payment.amountAuthorized ?? payment.amount) : payment.amount - payment.amountRefunded;
  const k = toNumber(keep);
  const valid = Number.isFinite(k) && k >= 0 && k <= held + 0.004 && (k === 0 || note.trim().length > 0);
  const back = Math.max(0, held - k);

  async function settle() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/desk-payments/${payment!.id}`, { method: 'POST', json: { action: 'settle', keep: Math.round(k * 100) / 100, note: note.trim() || undefined } });
      toast.success(k > 0 ? `Kept ${fmt(k, payment!.currency)}, returned ${fmt(back, payment!.currency)}` : `Deposit of ${fmt(held, payment!.currency)} returned`);
      await Promise.all(moneyKeys(bookingId).map((path) => mutate(path)));
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const how =
    payment.method === 'CASH'
      ? 'Hand the cash back to the guest.'
      : payment.method === 'EXTERNAL_CARD'
        ? 'Refund the rest on the hotel’s terminal; HotelOne records it.'
        : payment.method === 'OTHER'
          ? 'Give the rest back the way it was paid; HotelOne records it.'
          : payment.status === 'AUTHORIZED'
            ? 'The hold is released; only what you keep is charged.'
            : 'The rest is refunded to the card.';
  const where =
    payment.status === 'AUTHORIZED' ? 'held on the card' : payment.method === 'CASH' ? 'in cash' : payment.method === 'EXTERNAL_CARD' ? 'charged on the hotel’s terminal' : payment.method === 'OTHER' ? 'paid another way' : 'charged to the card';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return the security deposit</DialogTitle>
          <DialogDescription>
            {fmt(held, payment.currency)} {where}. {how}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={`Keep for incidentals (${payment.currency})`} htmlFor="settle-keep" hint={`Returning ${fmt(back, payment.currency)}.`}>
            <Input id="settle-keep" inputMode="decimal" value={keep} onChange={(e) => setKeep(e.target.value)} />
          </Field>
          <Field label="What it’s for" optional={k === 0} htmlFor="settle-note" hint={k > 0 ? 'Required when keeping part of the deposit (minibar, damage…).' : undefined}>
            <Input id="settle-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button disabled={!valid} loading={busy} loadingText="Settling…" onClick={settle}>
            <Undo2 aria-hidden /> {k > 0 ? `Keep ${fmt(k, payment.currency)}, return the rest` : 'Return all of it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One line of the desk ledger. */
function LedgerRow({ p, onSettle, onRefundCash, canRefund }: { p: DeskPaymentRow; onSettle: () => void; onRefundCash: () => void; canRefund: boolean }) {
  const openDeposit = p.kind === 'SECURITY_DEPOSIT' && !p.settledAt && ['AUTHORIZED', 'SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(p.status);
  // Cash and payments recorded at the desk are handed back at the desk too; cards are refunded from the Payment card.
  const handBack = canRefund && isRecorded(p.method) && p.kind === 'PAYMENT' && ['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(p.status);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          <MethodIcon method={p.method} />
          {p.kindLabel} · {fmt(p.status === 'AUTHORIZED' ? (p.amountAuthorized ?? p.amount) : p.amount, p.currency)}
        </p>
        <p className="text-xs text-muted-foreground">
          {STATUS_TEXT[p.status] ?? p.status} · {p.methodLabel}
          {p.cardLast4 ? ` · ${p.cardBrand ?? 'card'} ending ${p.cardLast4}` : ''}
          {p.amountRefunded > 0 ? ` · ${fmt(p.amountRefunded, p.currency)} returned` : ''}
          {p.cashTendered && p.cashTendered > p.amount ? ` · ${fmt(p.cashTendered, p.currency)} handed over` : ''}
          {p.recordedBy ? ` · ${p.recordedBy}` : ''} · {new Date(p.paidAt ?? p.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
        {p.status === 'FAILED' && p.failureMessage && <p className="text-xs text-danger">{p.failureMessage}</p>}
        {p.note && <p className="text-xs text-muted-foreground">{p.note}</p>}
        {p.kind === 'SECURITY_DEPOSIT' && p.status === 'AUTHORIZED' && p.captureBefore && (
          <p className="text-xs text-muted-foreground">Hold expires {new Date(p.captureBefore).toLocaleDateString([], { dateStyle: 'medium' })}</p>
        )}
      </div>
      {openDeposit && (
        <Button size="sm" variant="outline" onClick={onSettle}>
          <Undo2 aria-hidden /> Return deposit…
        </Button>
      )}
      {handBack && (
        <Button size="sm" variant="ghost" onClick={onRefundCash}>
          {p.method === 'CASH' ? 'Hand back cash' : 'Record money given back'}
        </Button>
      )}
    </li>
  );
}

/** Short summary for the check-in dialog: what's due now, with buttons to collect it. */
export function CheckInCollect({ booking }: { booking: Pick<BookingSummary, 'id' | 'guest'> }) {
  const { data } = useDeskPayments(booking.id);
  const [collect, setCollect] = React.useState<DeskKind | null>(null);
  if (!data) return null;
  const nothing = data.balance <= 0.004 && data.deposit.due <= 0.004;
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          <span className="font-medium">{data.balance > 0.004 ? `${fmt(data.balance, data.currency)} to pay` : 'Paid in full'}</span>
          {data.deposit.due > 0.004 && <span className="text-muted-foreground"> · deposit {fmt(data.deposit.due, data.currency)} {data.deposit.mode === 'HOLD' ? 'to hold' : 'to take'}</span>}
          {data.deposit.held > 0.004 && <span className="text-muted-foreground"> · deposit {fmt(data.deposit.held, data.currency)} held</span>}
        </p>
        {!nothing && (
          <div className="flex gap-2">
            {data.balance > 0.004 && (
              <Button size="sm" variant="outline" onClick={() => setCollect('PAYMENT')}>
                <CreditCard aria-hidden /> Take payment
              </Button>
            )}
            {data.deposit.due > 0.004 && (
              <Button size="sm" variant="outline" onClick={() => setCollect('SECURITY_DEPOSIT')}>
                <ShieldCheck aria-hidden /> Take deposit
              </Button>
            )}
          </div>
        )}
      </div>
      {data.otaCard?.type === 'VIRTUAL' && data.balance > 0.004 && (
        <p className="text-xs text-muted-foreground">
          {data.otaCard.channel} sent a virtual card ({data.otaCard.brand ?? 'card'}{data.otaCard.last4 ? ` ending ${data.otaCard.last4}` : ''}){data.otaCard.chargeable ? '. Charge it under Take payment → Virtual card.' : `. ${data.otaCard.reason}`}
        </p>
      )}
      <CollectPaymentDialog booking={booking} kind={collect ?? 'PAYMENT'} open={collect !== null} onOpenChange={(o) => !o && setCollect(null)} />
    </div>
  );
}

/** The booking page's "At the desk" card: balance, security deposit, the desk ledger and the actions. */
export function DeskPayments({ booking }: { booking: BookingSummary }) {
  const { mutate } = useSWRConfig();
  const { data } = useDeskPayments(booking.id);
  const [collect, setCollect] = React.useState<DeskKind | null>(null);
  const [settling, setSettling] = React.useState<DeskPaymentRow | null>(null);
  if (!data) return null;
  const closed = booking.status === 'CANCELLED' || booking.status === 'NO_SHOW';
  const desk = data.payments.filter((p) => p.method !== 'ONLINE');

  async function refundCash(p: DeskPaymentRow) {
    const left = p.amount - p.amountRefunded;
    const cash = p.method === 'CASH';
    if (!window.confirm(cash ? `Hand back ${fmt(left, p.currency)} in cash to ${booking.guest.name}?` : `Record ${fmt(left, p.currency)} given back to ${booking.guest.name} outside HotelOne (${p.methodLabel.toLowerCase()})?`)) return;
    try {
      await api(`/api/admin/desk-payments/${p.id}`, { method: 'POST', json: { action: 'refund_cash' } });
      toast.success(cash ? `Recorded ${fmt(left, p.currency)} cash handed back` : `Recorded ${fmt(left, p.currency)} given back`);
      await Promise.all(moneyKeys(booking.id).map((path) => mutate(path)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">At the desk</h2>
        {data.testMode && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">Stripe test mode</span>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-muted px-3 py-2">
          <dt className="text-xs text-muted-foreground">Balance due</dt>
          <dd className="font-medium tabular">{fmt(data.balance, data.currency)}</dd>
        </div>
        <div className="rounded-xl bg-muted px-3 py-2">
          <dt className="text-xs text-muted-foreground">Security deposit</dt>
          <dd className="font-medium tabular">
            {data.deposit.held > 0.004 ? `${fmt(data.deposit.held, data.currency)} held` : data.deposit.due > 0.004 ? `${fmt(data.deposit.due, data.currency)} due` : data.deposit.mode === 'NONE' ? 'Not required' : 'Settled'}
          </dd>
        </div>
      </dl>
      {data.reservation && <p className="mt-2 text-xs text-muted-foreground">For all {data.reservation.roomTypes} room types in reservation {data.reservation.code}.</p>}

      {!closed && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" disabled={data.balance <= 0.004} onClick={() => setCollect('PAYMENT')}>
            <CreditCard aria-hidden /> Take payment
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCollect('SECURITY_DEPOSIT')}>
            <ShieldCheck aria-hidden /> Take deposit
          </Button>
        </div>
      )}

      {data.otaCard && (
        <p className="mt-3 text-xs text-muted-foreground">
          {data.otaCard.channel} {data.otaCard.type === 'VIRTUAL' ? 'virtual card' : 'guest card'} on file: {data.otaCard.brand ?? 'card'}{data.otaCard.last4 ? ` ending ${data.otaCard.last4}` : ''}
          {data.otaCard.balance !== null ? `, balance ${fmt(data.otaCard.balance, data.otaCard.currency ?? data.currency)}` : ''}
          {data.otaCard.chargeable ? '' : `. ${data.otaCard.reason}`}
        </p>
      )}

      {desk.length > 0 && (
        <ul className="mt-4 space-y-2">
          {desk.map((p) => (
            <LedgerRow key={p.id} p={p} canRefund={data.canRefund} onSettle={() => setSettling(p)} onRefundCash={() => void refundCash(p)} />
          ))}
        </ul>
      )}

      <CollectPaymentDialog booking={booking} kind={collect ?? 'PAYMENT'} open={collect !== null} onOpenChange={(o) => !o && setCollect(null)} />
      <SettleDepositDialog bookingId={booking.id} payment={settling} open={!!settling} onOpenChange={(o) => !o && setSettling(null)} />
    </Card>
  );
}
