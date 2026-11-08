'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { CARD_NUMBER_REFUSED, METHOD_LABEL, containsCardNumber, type PaymentMethod } from '@/lib/desk-payments';
import { api } from '@/lib/fetcher';
import { RECORDED_PAYMENT_METHODS, type FolioEdit, type FolioEditTarget, type FolioView } from '@/lib/folio';
import { formatMoney } from '@/lib/format';
import { UNIT_LABEL, describeSavedCharge, savedChargeTotal, type SavedChargeView } from '@/lib/saved-charges';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, inputBase } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout } from '@/components/ui/primitives';
import { Textarea } from '@/components/ui/textarea';

/** What the dialog edits: a line or deposit of the folio, or a new extra charge. */
export type FolioEditing = FolioEditTarget | { type: 'addCharge' };

const fmt = (n: number, c: string) => formatMoney(n, c, { cents: true });
/** A typed amount: a decimal comma reads as a point, anything else that isn't a digit is dropped. */
const toNumber = (s: string) => Number(s.replace(/,/g, '.').replace(/[^\d.]/g, ''));
const amountText = (n: number) => String(n);
/** An ISO timestamp as a datetime-local value in the browser's time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TITLE: Record<FolioEditing['type'], string> = {
  room: 'Edit the room line',
  charge: 'Edit a charge',
  addCharge: 'Add a charge',
  allowance: 'Edit an allowance',
  payment: 'Edit a payment',
};

/**
 * Change one thing on the folio (folio.edit: the owner, or a role the owner allowed). Every change is logged in the
 * activity log with what it was before; the reason is optional and goes with it.
 */
export function FolioEditDialog({
  bookingId,
  folio,
  editing,
  onClose,
  onSaved,
}: {
  bookingId: string;
  folio: FolioView;
  editing: FolioEditing | null;
  onClose: () => void;
  onSaved: (next: FolioView) => Promise<void>;
}) {
  const { currency } = folio;
  const [label, setLabel] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [refunded, setRefunded] = React.useState('');
  const [date, setDate] = React.useState('');
  const [method, setMethod] = React.useState('');
  const [note, setNote] = React.useState('');
  const [why, setWhy] = React.useState('');
  const [busy, setBusy] = React.useState<'save' | 'remove' | null>(null);
  const [error, setError] = React.useState('');
  // Adding a charge: the usual charge it was picked from, and whether to keep this price as the usual one.
  const [picked, setPicked] = React.useState<SavedChargeView | null>(null);
  const [remember, setRemember] = React.useState(false);
  // The values as the dialog opened, so a refresh behind it doesn't change what's being edited.
  const [base, setBase] = React.useState<FolioEditing | null>(editing);

  React.useEffect(() => {
    if (!editing) return;
    setBase(editing);
    setError('');
    setWhy('');
    setRefunded('');
    setMethod('');
    setNote('');
    setDate('');
    setPicked(null);
    setRemember(false);
    switch (editing.type) {
      case 'room':
        setLabel(editing.label);
        setAmount(amountText(editing.amount));
        break;
      case 'charge':
        setLabel(editing.name);
        setAmount(amountText(editing.amount));
        setDate(editing.date ?? '');
        break;
      case 'addCharge':
        setLabel('');
        setAmount('');
        setDate(new Date().toISOString().slice(0, 10));
        break;
      case 'allowance':
        setLabel(editing.reason);
        setAmount(amountText(editing.amount));
        break;
      case 'payment':
        setAmount(amountText(editing.amount));
        setRefunded(amountText(editing.amountRefunded));
        setMethod(editing.method);
        setDate(toLocalInput(editing.paidAt));
        setNote(editing.note ?? '');
        break;
    }
  }, [editing]);

  const t = base;
  const value = toNumber(amount);
  const refundValue = toNumber(refunded);
  const cardNumber = [label, note, why].some((s) => containsCardNumber(s));
  const amountError =
    t && t.type !== 'payment' && amount.trim() !== ''
      ? !(value >= 0) || (t.type !== 'room' && !(value > 0))
        ? 'Enter an amount above zero.'
        : t.type === 'allowance' && value > t.max + 0.004
          ? `At most ${fmt(t.max, currency)}: what’s left of the stay’s charges.`
          : undefined
      : t?.type === 'payment' && t.recorded && !(value > 0)
        ? 'Enter the amount paid.'
        : undefined;
  const refundError = t?.type === 'payment' && t.recorded && refundValue > value + 0.004 ? 'Can’t be more than what was paid.' : undefined;
  const labelMissing = t && (t.type === 'charge' || t.type === 'addCharge') && !label.trim();
  const reasonShort = t?.type === 'allowance' && label.replace(/\s+/g, ' ').trim().length < 3;
  const valid = !!t && amount.trim() !== '' && !amountError && !refundError && !labelMissing && !reasonShort && !cardNumber;

  // A new charge with a name and price the hotel hasn't saved (or saved at another price): offer to keep it.
  const sameName = t?.type === 'addCharge' ? folio.savedCharges.find((c) => c.name.toLowerCase() === label.replace(/\s+/g, ' ').trim().toLowerCase()) : undefined;
  const offerRemember =
    t?.type === 'addCharge' && folio.canSaveCharges && !!label.trim() && value > 0 && !amountError && (!sameName || (sameName.unit === 'STAY' && Math.abs(sameName.amount - value) > 0.004));

  function pick(c: SavedChargeView) {
    setPicked(c);
    setLabel(c.name);
    setAmount(amountText(savedChargeTotal(c, { nights: folio.nights }, 1, currency)));
  }

  function body(): FolioEdit | null {
    if (!t) return null;
    const reason = why.trim() || undefined;
    const rounded = Math.round(value * 1000) / 1000;
    switch (t.type) {
      case 'room':
        return { target: 'room', label: label.trim() || null, amount: rounded, expected: { label: t.label, amount: t.amount }, reason };
      case 'charge':
        return { target: 'charge', index: t.index, name: label, amount: rounded, ...(t.extra ? { date: date || null } : {}), expected: { name: t.name, amount: t.amount }, reason };
      case 'addCharge':
        return { target: 'addCharge', name: label, amount: rounded, date: date || null, reason };
      case 'allowance':
        return { target: 'allowance', id: t.id, amount: rounded, allowanceReason: label, reason };
      case 'payment':
        return t.recorded
          ? { target: 'payment', id: t.id, amount: rounded, amountRefunded: Math.round(refundValue * 1000) / 1000, method, paidAt: date ? new Date(date).toISOString() : undefined, note: note.trim() || null, reason }
          : { target: 'payment', id: t.id, note: note.trim() || null, reason };
    }
  }

  async function send(edit: FolioEdit, kind: 'save' | 'remove', done: string) {
    setBusy(kind);
    setError('');
    try {
      const next = await api<FolioView>(`/api/admin/bookings/${bookingId}/folio`, { method: 'PATCH', json: edit });
      toast.success(done);
      if (edit.target === 'addCharge' && remember && offerRemember) {
        try {
          await api('/api/admin/saved-charges', { method: 'POST', json: { propertyId: folio.propertyId, name: edit.name.replace(/\s+/g, ' ').trim(), amount: edit.amount, unit: 'STAY' } });
          toast.success(`“${edit.name.trim()}” is saved at ${fmt(edit.amount, currency)} for next time`);
        } catch (e) {
          toast.error(`The charge was added, but its usual price wasn’t saved: ${(e as Error).message}`);
        }
      }
      onClose();
      void onSaved(next).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function remove() {
    if (!t) return;
    const reason = why.trim() || undefined;
    if (t.type === 'charge') {
      if (!window.confirm(`Remove “${t.name}” (${fmt(t.amount, currency)}) from the folio? The change is logged.`)) return;
      void send({ target: 'removeCharge', index: t.index, expected: { name: t.name, amount: t.amount }, reason }, 'remove', `Removed “${t.name}”`);
    } else if (t.type === 'payment') {
      if (!window.confirm(`Remove this ${fmt(t.amount, currency)} payment? It stays on record as removed, and the balance goes up by what it paid.`)) return;
      void send({ target: 'removePayment', id: t.id, reason }, 'remove', 'Removed the payment');
    }
  }

  const payment = t?.type === 'payment' ? t : null;
  const canRemove = t?.type === 'charge' || (payment?.recorded ?? false);

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t ? TITLE[t.type] : ''}</DialogTitle>
          <DialogDescription>Changes the guest’s folio and balance right away. The activity log keeps what it was before, who changed it and when.</DialogDescription>
        </DialogHeader>
        {t && (
          <div className="space-y-4">
            {t.type === 'addCharge' && folio.savedCharges.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Usual charges</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Usual charges">
                  {folio.savedCharges.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={picked?.id === c.id && label.trim() === c.name}
                      onClick={() => pick(c)}
                      title={c.note ?? undefined}
                      className={cn(
                        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        picked?.id === c.id && label.trim() === c.name ? 'border-primary/50 bg-primary-soft text-primary-soft-foreground' : 'border-border-strong/50 bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground'
                      )}
                    >
                      {c.name}
                      <span className="font-normal tabular">{describeSavedCharge(c, currency)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(t.type === 'room' || t.type === 'charge' || t.type === 'addCharge') && (
              <Field label="Description" htmlFor="folio-label" hint={t.type === 'room' ? `Leave empty for the room type’s name (${t.defaultLabel}).` : undefined} error={labelMissing ? 'Say what the charge is for.' : undefined}>
                <Input id="folio-label" autoComplete="off" maxLength={t.type === 'room' ? 120 : 80} value={label} placeholder={t.type === 'room' ? t.defaultLabel : 'e.g. Minibar, Parking, Late check-out'} onChange={(e) => setLabel(e.target.value)} />
              </Field>
            )}
            {t.type === 'allowance' && (
              <Field label="Reason" required htmlFor="folio-label" error={reasonShort ? 'At least 3 characters.' : undefined}>
                <Textarea id="folio-label" maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} />
              </Field>
            )}
            {(!payment || payment.recorded) && (
              <Field
                label={`${t.type === 'allowance' ? 'Amount taken off' : payment ? 'Amount paid' : 'Amount'} (${currency})`}
                htmlFor="folio-amount"
                hint={
                  t.type === 'room'
                    ? 'The room’s price for the whole stay, before taxes and fees.'
                    : t.type === 'allowance'
                      ? `At most ${fmt(t.max, currency)}.`
                      : t.type === 'addCharge' && picked && picked.unit === 'NIGHT' && label.trim() === picked.name
                        ? `${fmt(picked.amount, currency)} ${UNIT_LABEL.NIGHT} × ${folio.nights} night${folio.nights === 1 ? '' : 's'}.`
                        : undefined
                }
                error={amountError}
              >
                <Input id="folio-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            )}
            {payment?.recorded && (
              <>
                <Field label={`Handed back (${currency})`} htmlFor="folio-refunded" error={refundError}>
                  <Input id="folio-refunded" inputMode="decimal" autoComplete="off" value={refunded} onChange={(e) => setRefunded(e.target.value)} />
                </Field>
                <Field label="How it was paid" htmlFor="folio-method">
                  <select id="folio-method" className={cn(inputBase, 'h-10 py-2 pr-8')} value={method} onChange={(e) => setMethod(e.target.value)}>
                    {RECORDED_PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {METHOD_LABEL[m as PaymentMethod]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Paid on" htmlFor="folio-date">
                  <Input id="folio-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              </>
            )}
            {payment && !payment.recorded && (
              <Callout tone="info">A card payment’s amount and date are what Stripe charged. To give money back, use Refund on the payments card. You can change its note here.</Callout>
            )}
            {payment && (
              <Field label="Note" htmlFor="folio-note">
                <Input id="folio-note" autoComplete="off" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
            {((t.type === 'charge' && t.extra) || t.type === 'addCharge') && (
              <Field label="Date" htmlFor="folio-day">
                <Input id="folio-day" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            )}
            {offerRemember && (
              <label htmlFor="folio-remember" className="flex min-h-10 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
                <input
                  id="folio-remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm border-input accent-[hsl(var(--primary))]"
                />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {sameName ? `Make ${fmt(value, currency)} the usual price for “${sameName.name}”` : `Remember “${label.trim()}” at ${fmt(value, currency)} per stay`}
                  </span>
                  <span className="block text-xs text-muted-foreground">It shows here next time, and the assistant uses it when someone asks for it by name. Change it any time in Settings.</span>
                </span>
              </label>
            )}
            <Field label="Why (optional)" htmlFor="folio-why" hint="Kept with the change in the activity log." error={cardNumber ? CARD_NUMBER_REFUSED : undefined}>
              <Input id="folio-why" autoComplete="off" maxLength={200} value={why} onChange={(e) => setWhy(e.target.value)} />
            </Field>
            {error && (
              <Callout tone="danger" role="alert">
                {error}
              </Callout>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          {canRemove && (
            <Button variant="ghost" className="mr-auto text-destructive" loading={busy === 'remove'} disabled={!!busy} onClick={remove}>
              <Trash2 aria-hidden /> Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || !!busy}
            loading={busy === 'save'}
            loadingText="Saving…"
            onClick={() => {
              const edit = body();
              if (edit) void send(edit, 'save', t?.type === 'addCharge' ? `Added “${label.trim()}”` : 'Folio updated');
            }}
          >
            {t?.type === 'addCharge' ? 'Add charge' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
