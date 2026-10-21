'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { HandCoins } from 'lucide-react';
import type { BookingSummary } from '@/lib/dto';
import { CARD_NUMBER_REFUSED, containsCardNumber } from '@/lib/desk-payments';
import { api, fetcher } from '@/lib/fetcher';
import type { FolioAllowance, FolioDeposit, FolioLine, FolioView } from '@/lib/folio';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { Textarea } from '@/components/ui/textarea';
import { useConsole } from '@/components/console/ConsoleProvider';
import { QuickReasons } from './dialogs';

const key = (bookingId: string) => `/api/admin/bookings/${bookingId}/folio`;
/** Everything else that shows the stay's money, refreshed after an allowance changes: the booking, its payment, the desk and the guided check-in. */
const moneyKeys = (bookingId: string) => [
  `/api/admin/bookings/${bookingId}`,
  `/api/admin/bookings/${bookingId}/payment`,
  `/api/admin/bookings/${bookingId}/desk-payments`,
  `/api/admin/bookings/${bookingId}/check-in`,
];
const fmt = (n: number, c: string) => formatMoney(n, c, { cents: true });
/** Payments and allowances read as negative, with a real minus sign. */
const signed = (n: number, c: string) => (n < 0 ? `−${fmt(-n, c)}` : fmt(n, c));
const formatDateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
/** A typed amount: a decimal comma reads as a point, anything else that isn't a digit is dropped. */
const toNumber = (s: string) => Number(s.replace(/,/g, '.').replace(/[^\d.]/g, ''));
const ALLOWANCE_REASONS = ['Service recovery', 'Left early: unused nights', 'Rate correction'];

/** A booking's folio. Null for staff who can't see it (folio.view). */
export function useFolio(bookingId: string | null | undefined) {
  const { can } = useConsole();
  return useSWR<FolioView>(bookingId && can('folio.view') ? key(bookingId) : null, fetcher);
}

const HEADING = 'text-2xs font-semibold uppercase tracking-wider text-muted-foreground';

function LineTable({
  title,
  lines,
  currency,
  empty,
  action,
}: {
  title: string;
  lines: FolioLine[];
  currency: string;
  empty: string;
  /** Shown under a line's amount (removing an allowance). */
  action?: (line: FolioLine) => React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className={HEADING}>
        {title}
      </h3>
      {lines.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="mt-1 w-full text-sm" aria-labelledby={id}>
          <thead className="sr-only">
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => {
              const detail = [l.detail, l.at ? formatDateTime(l.at) : null].filter(Boolean).join(' · ');
              const extra = action?.(l);
              return (
                <tr key={l.key} className="align-top">
                  <th scope="row" className="min-w-0 py-2 pr-3 text-left font-normal">
                    <span className="block break-words">{l.label}</span>
                    {detail && <span className="block break-words text-xs text-muted-foreground">{detail}</span>}
                  </th>
                  <td className="whitespace-nowrap py-2 text-right tabular">
                    {signed(l.amount, currency)}
                    {extra && <span className="mt-1 block">{extra}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function depositState(d: FolioDeposit, currency: string): { label: string; tone: 'info' | 'neutral' } {
  if (d.state === 'HELD') return { label: d.hold ? 'Held on card' : 'Held', tone: 'info' };
  if (d.state === 'RELEASED') return { label: 'Released', tone: 'neutral' };
  return { label: d.kept > 0 ? `Kept ${fmt(d.kept, currency)}` : 'Returned', tone: 'neutral' };
}

function Deposits({ folio }: { folio: FolioView }) {
  const id = React.useId();
  const { currency } = folio;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className={HEADING}>
        Security deposit
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Held against incidentals, not part of the balance{folio.depositHeld > 0 ? ` · ${fmt(folio.depositHeld, currency)} still held` : ''}.
      </p>
      <table className="mt-1 w-full text-sm" aria-labelledby={id}>
        <thead className="sr-only">
          <tr>
            <th scope="col">Deposit</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {folio.deposits.map((d) => {
            const state = depositState(d, currency);
            const when = d.settledAt ? `settled ${formatDateTime(d.settledAt)}` : formatDateTime(d.at);
            return (
              <tr key={d.id} className="align-top">
                <th scope="row" className="min-w-0 py-2 pr-3 text-left font-normal">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {d.methodLabel}
                    <Badge variant={state.tone} size="sm">
                      {state.label}
                    </Badge>
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">{[d.card, when].filter(Boolean).join(' · ')}</span>
                </th>
                <td className="whitespace-nowrap py-2 text-right tabular">{fmt(d.amount, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Take an amount off what the stay costs (managers), with the reason on record. */
function AllowanceDialog({
  bookingId,
  folio,
  open,
  onOpenChange,
  onSaved,
}: {
  bookingId: string;
  folio: FolioView;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (next: FolioView) => Promise<void>;
}) {
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setAmount('');
      setReason('');
      setError('');
    }
  }, [open]);

  const { currency, maxAllowance } = folio;
  const value = toNumber(amount);
  const typed = amount.trim() !== '';
  // As the server checks: more than zero, and at most the stay's charges less the allowances already given.
  const amountError = !typed
    ? undefined
    : !(value > 0)
      ? 'Enter the amount to take off.'
      : value > maxAllowance + 0.004
        ? `At most ${fmt(maxAllowance, currency)} can be taken off: what’s left of the stay’s charges.`
        : undefined;
  const why = reason.replace(/\s+/g, ' ').trim();
  const cardNumber = containsCardNumber(why);
  const valid = typed && !amountError && why.length >= 3 && !cardNumber;
  // The folio's balance with this allowance; below zero, the guest has paid more than the stay now costs.
  const after = typed && !amountError ? Math.round((folio.totals.balance - value) * 100) / 100 : null;

  async function save() {
    setBusy(true);
    setError('');
    try {
      const next = await api<FolioView>(`${key(bookingId)}/allowances`, { method: 'POST', json: { amount: Math.round(value * 100) / 100, reason: why } });
      toast.success(`Took ${fmt(value, currency)} off the stay`);
      await onSaved(next).catch(() => undefined);
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
          <DialogTitle>Add an allowance</DialogTitle>
          <DialogDescription>Takes an amount off what the stay costs: service recovery, unused nights, a rate correction. The folio shows it with your name and the reason.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={`Amount to take off (${currency})`} htmlFor="allowance-amount" hint={`At most ${fmt(maxAllowance, currency)}.`} error={amountError}>
            <Input id="allowance-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Reason" required htmlFor="allowance-reason" hint="What happened, for the record (at least 3 characters)." error={cardNumber ? CARD_NUMBER_REFUSED : undefined}>
            <QuickReasons label="Common reasons" options={ALLOWANCE_REASONS} value={reason} onPick={setReason} />
            <Textarea
              id="allowance-reason"
              required
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Air conditioning broken the first night"
            />
          </Field>
          {folio.reservation && <p className="text-xs text-muted-foreground">Comes off this room type’s charges in reservation {folio.reservation.code}.</p>}
          <div aria-live="polite" className="text-sm">
            {after !== null && (
              <p>
                Balance after: <span className="font-semibold tabular">{signed(after, currency)}</span>
                {after < -0.004 ? ' · the guest has paid more than the stay now costs, so refund them the difference.' : after <= 0.004 ? ' · settled' : ''}
              </p>
            )}
          </div>
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
          <Button disabled={!valid} loading={busy} loadingText="Saving…" onClick={save}>
            <HandCoins aria-hidden /> Add allowance{valid ? ` of ${fmt(value, currency)}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The folio without its card: the room and taxes with any allowances, payments
 * and refunds, the totals with the balance, and security deposits apart (they
 * never count toward the balance). Used on the reservation page (editable:
 * managers add and remove allowances there) and, read-only, in the check-in wizard.
 */
export function FolioSummary({
  bookingId,
  editable = false,
}: {
  bookingId: string;
  /** Allowances can be added and removed (staff with folio.adjust, on a stay that isn't cancelled or a no-show). */
  editable?: boolean;
}) {
  const { can, refresh } = useConsole();
  const { mutate: revalidate } = useSWRConfig();
  const { data, error, mutate } = useFolio(bookingId);
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);

  // The folio as the server sent it back, then everything else that shows the stay's money.
  const changed = React.useCallback(
    async (next: FolioView) => {
      await mutate(next, { revalidate: false });
      await Promise.all(moneyKeys(bookingId).map((path) => revalidate(path)));
      refresh();
    },
    [bookingId, mutate, revalidate, refresh]
  );

  if (!can('folio.view')) return null;

  if (error && !data) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn’t load the folio.{' '}
        <Button variant="link" className="text-sm" onClick={() => void mutate()}>
          Try again
        </Button>
      </p>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-20 rounded-xl" />
        <span className="sr-only" role="status">
          Loading the folio…
        </span>
      </div>
    );
  }

  const { currency, totals: t } = data;
  const charges = data.lines.filter((l) => l.section === 'CHARGES');
  const payments = data.lines.filter((l) => l.section === 'PAYMENTS');
  const due = t.balance > 0.004;
  const credit = t.balance < -0.004;
  // A cancelled stay or a no-show doesn't change what it costs (the server asks to reinstate it first).
  const adjust = editable && can('folio.adjust') && data.status !== 'CANCELLED' && data.status !== 'NO_SHOW';
  // Allowance lines are keyed by their allowance (server/services/folio.ts).
  const allowanceOf = (l: FolioLine) => (l.kind === 'ALLOWANCE' ? data.allowances.find((a) => l.key === `allow-${a.id}`) : undefined);

  async function remove(a: FolioAllowance) {
    if (!window.confirm(`Remove the allowance of ${fmt(a.amount, currency)} (“${a.reason}”)? The stay costs that much more again. It stays on record as removed.`)) return;
    setRemoving(a.id);
    try {
      const next = await api<FolioView>(`${key(bookingId)}/allowances/${a.id}`, { method: 'DELETE' });
      toast.success(`Removed the allowance of ${fmt(a.amount, currency)}`);
      await changed(next).catch(() => undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-4">
      <LineTable
        title="Charges"
        lines={charges}
        currency={currency}
        empty="No charges."
        action={
          adjust
            ? (l) => {
                const a = allowanceOf(l);
                if (!a) return null;
                return (
                  <Button
                    variant="link"
                    className="text-xs"
                    loading={removing === a.id}
                    disabled={!!removing}
                    aria-label={`Remove the allowance of ${fmt(a.amount, currency)}`}
                    onClick={() => void remove(a)}
                  >
                    Remove
                  </Button>
                );
              }
            : undefined
        }
      />
      <LineTable title="Payments" lines={payments} currency={currency} empty="Nothing paid yet." />

      <dl className="space-y-1 rounded-xl bg-muted px-3 py-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Charges</dt>
          <dd className="tabular">{fmt(t.charges, currency)}</dd>
        </div>
        {t.allowances > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Allowances</dt>
            <dd className="tabular">{signed(-t.allowances, currency)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="tabular">{signed(-t.paid, currency)}</dd>
        </div>
        {t.refunded > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Refunded</dt>
            <dd className="tabular">{fmt(t.refunded, currency)}</dd>
          </div>
        )}
        <div className="flex items-start justify-between gap-3 border-t pt-2 font-semibold">
          <dt>
            {due ? 'Balance due' : credit ? 'Credit' : 'Settled'}
            {credit && <span className="block text-xs font-normal text-muted-foreground">Owed back to the guest</span>}
          </dt>
          <dd className={cn('tabular', due && 'text-warning-soft-foreground')}>{fmt(Math.abs(t.balance), currency)}</dd>
        </div>
      </dl>

      {adjust && data.maxAllowance > 0.004 && (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <HandCoins aria-hidden /> Add allowance…
        </Button>
      )}

      {data.deposits.length > 0 && <Deposits folio={data} />}

      {data.reservation && (
        <p className="text-xs text-muted-foreground">
          Shows this room type’s share of reservation {data.reservation.code} ({data.reservation.roomTypes} room types paid together).
          {Math.abs(data.checkOutDue - Math.max(0, t.balance)) > 0.004 &&
            (data.checkOutDue > 0.004
              ? ` The reservation still owes ${fmt(data.checkOutDue, currency)}: the guest can check out once that’s paid.`
              : ' The reservation is paid, so nothing is left to collect before check-out.')}
        </p>
      )}

      {adjust && <AllowanceDialog bookingId={bookingId} folio={data} open={adding} onOpenChange={setAdding} onSaved={changed} />}
    </div>
  );
}

/** The reservation page's folio card. Nothing for staff who can't see the folio. */
export function FolioCard({ booking }: { booking: BookingSummary }) {
  const { can } = useConsole();
  const { data, mutate } = useFolio(booking.id);

  // Payments taken elsewhere on the page refresh the booking: follow its balance and status so the folio keeps up.
  const seen = React.useRef(`${booking.balance}|${booking.status}`);
  React.useEffect(() => {
    const now = `${booking.balance}|${booking.status}`;
    if (seen.current === now) return;
    seen.current = now;
    void mutate();
  }, [booking.balance, booking.status, mutate]);

  if (!can('folio.view')) return null;
  // A cancelled stay or a no-show isn't collected through the folio, so no "due" badge for those.
  const open = booking.status !== 'CANCELLED' && booking.status !== 'NO_SHOW';
  // A manager checked the guest out with money still owed, saying why; the balance stays collectable.
  const override = data?.checkoutOverride;
  const owing = data ? data.checkOutDue > 0.004 : false;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Folio</h2>
        {data &&
          (!data.settled ? (
            open && (
              <Badge variant="warning" dot className="tabular">
                {fmt(data.checkOutDue, data.currency)} due
              </Badge>
            )
          ) : data.totals.balance < -0.004 ? (
            // Overpaid, or the stay got shorter after it was paid: the hotel owes the guest.
            <Badge variant="info" dot className="tabular">
              Credit {fmt(-data.totals.balance, data.currency)}
            </Badge>
          ) : (
            <Badge variant="success" dot>
              Settled
            </Badge>
          ))}
      </div>
      {data && override && (
        <Callout tone={owing ? 'warning' : 'info'} className="mt-3" title={`Checked out with ${fmt(override.amount, data.currency)} owing`}>
          <p className="break-words">
            “{override.reason}” · by {override.by ?? 'a manager'} on {formatDate(override.at)}
          </p>
          <p>{owing ? `${fmt(data.checkOutDue, data.currency)} still to collect.` : 'It’s been settled since.'}</p>
        </Callout>
      )}
      <div className="mt-3">
        <FolioSummary bookingId={booking.id} editable />
      </div>
    </Card>
  );
}
