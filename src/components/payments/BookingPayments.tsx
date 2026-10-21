'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { CreditCard, RotateCcw, ShieldAlert } from 'lucide-react';
import { CARD_NUMBER_REFUSED, RECORDED_METHODS, containsCardNumber, type PaymentMethod } from '@/lib/desk-payments';
import type { BookingSummary } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { formatMoney } from '@/lib/format';
import { RISK_FLAG_INFO } from '@/lib/risk';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout } from '@/components/ui/primitives';
import { PaymentBadge, RiskFlagBadge } from '@/components/hotel/badges';
import { useConsole } from '@/components/console/ConsoleProvider';

interface PaymentRecord {
  id: string;
  method: string;
  kind: string;
  status: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  cardholderName: string | null;
  billingEmail: string | null;
  billingCountry: string | null;
  cardCountry: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  threeDSecure: string | null;
  riskLevel: string | null;
  failureMessage: string | null;
  paidAt: string | null;
}

interface PaymentInfo {
  paymentStatus: string;
  payments: PaymentRecord[];
  disputes: { id: string; status: string; reason: string | null; amount: number; evidenceDueBy: string | null; evidenceSubmittedAt: string | null }[];
  /** Set when one payment covers every room type of a reservation booked together. */
  reservation: { code: string; roomTypes: number } | null;
}

interface RefundInfo {
  payments: { id: string; amount: number; refunded: number; refundable: number; cardLast4: string | null; cardBrand: string | null }[];
  totalRefundable: number;
  suggested: number;
  deadlinePassed: boolean;
  deadlineLabel: string;
  canRefund: boolean;
  reservation: { code: string; roomTypes: number } | null;
}

interface ChecklistState {
  required: { cardShown: boolean } | null;
  items: { item: 'idMatched' | 'cardShown' | 'registrationSigned'; label: string; required: boolean; done: boolean; at: string | null; by: string | null; via: string | null }[];
  open: string[];
}

const formatDateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const THREE_DS: Record<string, string> = {
  authenticated: '3D Secure completed',
  attempt_acknowledged: '3D Secure attempted',
  exempted: '3D Secure exempted',
  not_supported: '3D Secure not supported by the card',
  failed: '3D Secure failed',
  processing_error: '3D Secure error',
  not_attempted: '3D Secure not attempted',
};

const RISK: Record<string, string> = { normal: 'Normal', elevated: 'Elevated', highest: 'Highest', not_assessed: 'Not assessed', unknown: 'Unknown' };

function RefundDialog({ booking, open, onOpenChange }: { booking: BookingSummary; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { mutate } = useSWRConfig();
  const { can } = useConsole();
  const { data: info } = useSWR<RefundInfo>(open ? `/api/admin/bookings/${booking.id}/refund` : null, fetcher);
  const [paymentId, setPaymentId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [allowance, setAllowance] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open || !info) return;
    const first = info.payments[0];
    setPaymentId((id) => id || first?.id || '');
    setAmount((a) => a || (info.suggested > 0 ? String(Math.min(info.suggested, first?.refundable ?? info.suggested)) : ''));
  }, [open, info]);
  React.useEffect(() => {
    if (open) {
      setPaymentId('');
      setAmount('');
      setReason('');
      setAllowance(false);
      setError('');
    }
  }, [open]);

  const payment = info?.payments.find((p) => p.id === paymentId);
  const value = Number(amount);
  // Managers can also take the refund off what the stay costs (an allowance), so it isn't owed again: not on a closed stay.
  const canAllow = can('folio.adjust') && booking.status !== 'CANCELLED' && booking.status !== 'NO_SHOW';
  const allowing = canAllow && allowance;
  // As the server checks before any money moves: at most the stay's charges less the allowances already given.
  const allowanceLeft = Math.max(0, Math.round((booking.totalPrice - booking.allowances) * 100) / 100);
  const overAllowance = allowing && Number.isFinite(value) && value > allowanceLeft + 0.004;
  // The allowance's reason is the refund's: required with it, and never a card number.
  const why = reason.replace(/\s+/g, ' ').trim();
  const cardNumber = allowing && containsCardNumber(why);
  const valid =
    !!payment && Number.isFinite(value) && value > 0 && value <= payment.refundable + 0.004 && (!allowing || (why.length >= 3 && !cardNumber && !overAllowance));

  async function refund() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/bookings/${booking.id}/refund`, {
        method: 'POST',
        json: { paymentId, amount: Math.round(value * 100) / 100, reason: why || undefined, allowance: allowing || undefined },
      });
      toast.success(
        allowing
          ? `Refunded ${formatMoney(value, booking.currency, { cents: true })} to the guest’s card and took it off the stay`
          : `Refunded ${formatMoney(value, booking.currency, { cents: true })} to the guest’s card`
      );
      // The folio and the desk show the refund (and the allowance) too.
      await Promise.all(
        ['', '/payment', '/refund', '/folio', '/desk-payments'].map((path) => mutate(`/api/admin/bookings/${booking.id}${path}`))
      );
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund {booking.guest.name}’s payment</DialogTitle>
          <DialogDescription>The money goes back to the card that paid. Card issuers can take several business days to show it.</DialogDescription>
        </DialogHeader>
        {!info ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            {(booking.status === 'CHECKED_IN' || booking.status === 'CONFIRMED') && !allowing && (
              // Check-out needs the balance at zero, and a refund toward the stay brings the balance back (unless the stay
              // also costs that much less: an allowance).
              <Callout tone="warning">
                {booking.guest.name} hasn’t checked out. A refund on its own is owed again before they can check out.{' '}
                {canAllow
                  ? 'To refund unused nights or as a goodwill gesture, also take the amount off what the stay costs (below).'
                  : 'To refund unused nights or as a goodwill gesture, check them out first, then refund.'}
              </Callout>
            )}
            <Callout tone={info.deadlinePassed ? 'warning' : 'info'}>
              {info.deadlinePassed
                ? `Free cancellation ended at ${info.deadlineLabel}. The policy doesn’t require a refund now; you can still refund any amount.`
                : `Cancelled or cancelling before the free-cancellation deadline (${info.deadlineLabel}): the policy suggests refunding ${formatMoney(info.suggested, booking.currency, { cents: true })}.`}
            </Callout>
            {info.reservation && (
              <p className="text-sm text-muted-foreground">
                This payment covers all {info.reservation.roomTypes} room types in reservation {info.reservation.code}. When only some of them are cancelled, the suggestion is what was charged for those.
              </p>
            )}
            {info.payments.length > 1 && (
              <Field label="Payment" htmlFor="refund-payment">
                <select id="refund-payment" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm">
                  {info.payments.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatMoney(p.amount, booking.currency, { cents: true })} · {p.cardBrand ?? 'Card'} {p.cardLast4 ? `ending ${p.cardLast4}` : ''} · {formatMoney(p.refundable, booking.currency, { cents: true })} left
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={`Amount to refund (${booking.currency})`} htmlFor="refund-amount" hint={payment ? `Up to ${formatMoney(payment.refundable, booking.currency, { cents: true })} on this payment.` : undefined}>
              <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            {canAllow && (
              <div className="space-y-1">
                <label htmlFor="refund-allowance" className="flex min-h-10 cursor-pointer items-start gap-3 text-sm">
                  <input
                    id="refund-allowance"
                    type="checkbox"
                    checked={allowance}
                    onChange={(e) => setAllowance(e.target.checked)}
                    aria-describedby="refund-allowance-hint"
                    className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm border-input accent-[hsl(var(--primary))]"
                  />
                  <span>Also take this amount off what the stay costs (goodwill or unused nights)</span>
                </label>
                <p id="refund-allowance-hint" className="pl-7 text-xs text-muted-foreground">
                  The folio shows it as an allowance with the reason, so the refund isn’t owed again. At most {formatMoney(allowanceLeft, booking.currency, { cents: true })}.
                </p>
                {overAllowance && (
                  <p role="alert" className="pl-7 text-xs font-medium text-destructive">
                    An allowance can take off at most {formatMoney(allowanceLeft, booking.currency, { cents: true })}. Refund that much, or untick the box.
                  </p>
                )}
              </div>
            )}
            <Field
              label="Reason"
              optional={!allowing}
              required={allowing}
              htmlFor="refund-reason"
              hint={allowing ? 'Shown on the folio with the allowance, for example “left a night early” (at least 3 characters).' : 'For your records.'}
              error={cardNumber ? CARD_NUMBER_REFUSED : undefined}
            >
              <Input id="refund-reason" required={allowing} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {error && (
              <Callout tone="danger" role="alert">
                {error}
              </Callout>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button disabled={!valid} loading={busy} loadingText="Refunding…" onClick={refund}>
            <RotateCcw aria-hidden /> Refund {valid ? formatMoney(value, booking.currency, { cents: true }) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Checklist({ booking }: { booking: BookingSummary }) {
  const { can } = useConsole();
  const { mutate } = useSWRConfig();
  const key = `/api/admin/bookings/${booking.id}/checklist`;
  const { data } = useSWR<ChecklistState>(booking.riskFlags.length ? key : null, fetcher);
  const [pending, setPending] = React.useState<string | null>(null);
  if (!data?.required) return null;
  const editable = can('booking.checkin');

  async function toggle(item: string, done: boolean) {
    setPending(item);
    try {
      await api(key, { method: 'POST', json: { item, done } });
      await Promise.all([mutate(key), mutate(`/api/admin/bookings/${booking.id}`)]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border p-3">
      <p className="text-sm font-semibold">Check-in checklist</p>
      <p className="text-xs text-muted-foreground">{data.open.length ? `${data.open.length} to do before handing over the key.` : 'All done.'}</p>
      <ul className="mt-2 space-y-1">
        {data.items.map((i) => (
          <li key={i.item}>
            <label className={cn('flex min-h-10 items-start gap-2.5 rounded-lg px-1 py-1.5 text-sm', editable && 'cursor-pointer hover:bg-accent/60')}>
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={i.done}
                disabled={!editable || pending === i.item || !!i.via}
                onChange={(e) => void toggle(i.item, e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block">{i.label}</span>
                {i.via && <span className="block text-xs text-success-soft-foreground">{i.via}</span>}
                {i.done && i.at && (
                  <span className="block text-xs text-muted-foreground">
                    {i.via ? 'Verified by ' : ''}
                    {i.by ?? 'Staff'} · {formatDateTime(i.at)}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The reservation's money: what was collected and how, risk flags with the check-in checklist, refunds and disputes. */
export function BookingPayments({ booking: b }: { booking: BookingSummary }) {
  const { can } = useConsole();
  const { data } = useSWR<PaymentInfo>(can('booking.payment.view') ? `/api/admin/bookings/${b.id}/payment` : null, fetcher);
  const [refundOpen, setRefundOpen] = React.useState(false);
  const closed = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
  const balance = Math.max(0, b.balance);
  const nightly = b.nights ? b.totalPrice / b.nights / Math.max(1, b.rooms) : b.totalPrice;
  // Online payments are listed here; money taken at the desk is in the desk card (DeskPayments).
  const paid = (data?.payments ?? []).filter((p) => p.method === 'ONLINE' && p.status !== 'FAILED' && p.status !== 'PENDING');
  // Card payments through Stripe; cash and payments recorded at the desk are handed back from the desk card.
  const refundable = (data?.payments ?? []).filter((p) => !RECORDED_METHODS.includes(p.method as PaymentMethod) && p.kind !== 'SECURITY_DEPOSIT' && (p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED'));
  const canRefund = can('payments.refund') && refundable.length > 0;

  return (
    <>
      <Card className="p-5 sm:p-6">
        <div className="flex min-h-9 items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Payment</h2>
          <PaymentBadge status={b.paymentStatus} />
        </div>
        <p className="mt-3 text-3xl font-semibold tracking-tight tabular">{formatMoney(b.totalPrice, b.currency, { cents: true })}</p>
        <p className="text-xs text-muted-foreground">
          {formatMoney(nightly, b.currency, { cents: true })} average a night · {b.nights} night{b.nights === 1 ? '' : 's'}
          {b.rooms > 1 ? ` × ${b.rooms} rooms` : ''}
        </p>

        {b.amountPaid > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-muted px-3 py-2">
              <dt className="text-xs text-muted-foreground">Paid so far</dt>
              <dd className="font-medium tabular">{formatMoney(b.amountPaid, b.currency, { cents: true })}</dd>
            </div>
            <div className="rounded-xl bg-muted px-3 py-2">
              <dt className="text-xs text-muted-foreground">Balance due</dt>
              <dd className="font-medium tabular">{formatMoney(balance, b.currency, { cents: true })}</dd>
            </div>
          </dl>
        )}

        {data?.reservation && paid.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            One card payment for all {data.reservation.roomTypes} room types in reservation {data.reservation.code}. Paid so far is this room type’s share.
          </p>
        )}

        {paid.map((p) => (
          <div key={p.id} className="mt-4 space-y-1 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CreditCard className="size-4 text-muted-foreground" aria-hidden />
              {p.cardLast4 ? `${p.cardBrand ?? 'Card'} ending ${p.cardLast4}` : 'Paid online by card'} · {formatMoney(p.amount, p.currency.toUpperCase(), { cents: true })}
              {p.kind === 'DEPOSIT' ? ' deposit' : ''}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <dt>Cardholder</dt>
              <dd className="text-foreground">{p.cardholderName ?? 'Not provided'}</dd>
              {p.billingEmail && (
                <>
                  <dt>Billing email</dt>
                  <dd className="truncate text-foreground">{p.billingEmail}</dd>
                </>
              )}
              <dt>Country</dt>
              <dd className="text-foreground">
                Billing {p.billingCountry ?? '—'} · card issued {p.cardCountry ?? '—'}
              </dd>
              <dt>Bank check</dt>
              <dd className="text-foreground">{THREE_DS[p.threeDSecure ?? 'not_attempted'] ?? p.threeDSecure}</dd>
              <dt>Fraud screening</dt>
              <dd className="text-foreground">{RISK[p.riskLevel ?? 'unknown'] ?? p.riskLevel}</dd>
              {p.amountRefunded > 0 && (
                <>
                  <dt>Refunded</dt>
                  <dd className="text-foreground">{formatMoney(p.amountRefunded, p.currency.toUpperCase(), { cents: true })}</dd>
                </>
              )}
            </dl>
          </div>
        ))}

        {b.paymentStatus !== 'PAID' && !closed && balance > 0 && b.amountPaid === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            {b.paymentStatus === 'AWAITING_PAYMENT' ? 'Waiting for the guest’s card payment. The rooms are held until it completes or expires.' : 'The balance is collected at the property, on arrival.'}
          </p>
        )}

        {canRefund && (
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setRefundOpen(true)}>
            <RotateCcw aria-hidden /> Refund a card…
          </Button>
        )}

        {data && data.disputes.length > 0 && (
          <Callout tone="danger" icon={ShieldAlert} className="mt-4">
            <p className="font-semibold">Card dispute {data.disputes[0].status.replace(/_/g, ' ')}</p>
            <p>
              {formatMoney(data.disputes[0].amount, b.currency, { cents: true })} disputed{data.disputes[0].reason ? ` (${data.disputes[0].reason.replace(/_/g, ' ')})` : ''}.{' '}
              {can('disputes.view') && (
                <Link href={`/admin/disputes?dispute=${data.disputes[0].id}`} className="font-medium underline underline-offset-2">
                  Review the evidence
                </Link>
              )}
            </p>
          </Callout>
        )}
      </Card>

      {b.riskFlags.length > 0 && (
        <Card className="p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <ShieldAlert className="size-4 text-warning" aria-hidden /> Worth a second look
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Flags are reasons to check, not accusations. People often pay for family, colleagues and clients.</p>
          <ul className="mt-3 space-y-2">
            {b.riskFlags.map((f) => (
              <li key={f} className="flex flex-col items-start gap-1">
                <RiskFlagBadge flag={f} />
                <span className="text-xs text-muted-foreground">{RISK_FLAG_INFO[f]?.description}</span>
              </li>
            ))}
          </ul>
          <Checklist booking={b} />
        </Card>
      )}

      <RefundDialog booking={b} open={refundOpen} onOpenChange={setRefundOpen} />
    </>
  );
}
