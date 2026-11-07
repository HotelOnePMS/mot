'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Nfc, Plus, Trash2 } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { formatMoney } from '@/lib/format';
import { SECURITY_DEPOSIT_MODE_LABEL, type SecurityDepositMode } from '@/lib/desk-payments';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout } from '@/components/ui/primitives';
import { useConsole } from '@/components/console/ConsoleProvider';

interface Settings {
  securityDepositMode: SecurityDepositMode;
  securityDepositAmount: number;
  maxSecurityDeposit: number;
  currency: string;
  cardAvailable: boolean;
  readers: { id: string; label: string; deviceType: string; status: string | null; simulated: boolean }[];
  testMode: boolean;
}

const MODES: { value: SecurityDepositMode; text: string }[] = [
  { value: 'NONE', text: 'No deposit at check-in.' },
  { value: 'HOLD', text: 'Authorize the card at check-in and charge only what’s owed at check-out. Nothing leaves the guest’s account unless you keep some. Needs a card.' },
  { value: 'CHARGE', text: 'Charge the deposit at check-in (card or cash) and refund it at check-out.' },
];

/** Settings → Front desk payments: the security deposit and the hotel's card readers. */
export function DeskSettings({ propertyId }: { propertyId: string }) {
  const { can } = useConsole();
  const key = `/api/admin/properties/${propertyId}/payments/desk`;
  const { data, mutate, error } = useSWR<Settings>(key, fetcher);
  const [mode, setMode] = React.useState<SecurityDepositMode | null>(null);
  const [amount, setAmount] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const manage = can('payments.manage');

  if (error) return <Callout tone="danger">{(error as Error).message}</Callout>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const chosen = mode ?? data.securityDepositMode;
  const amountValue = amount ?? (data.securityDepositAmount ? String(data.securityDepositAmount) : '');
  const amountNumber = Number(amountValue);
  const amountOk = chosen === 'NONE' || (amountNumber > 0 && amountNumber <= data.maxSecurityDeposit);
  const changed = chosen !== data.securityDepositMode || (chosen !== 'NONE' && amountNumber !== data.securityDepositAmount);

  async function run(what: string, fn: () => Promise<Settings>, done: string) {
    setBusy(what);
    try {
      await mutate(await fn(), { revalidate: false });
      toast.success(done);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run('save', () => api<Settings>(key, { method: 'PUT', json: { mode: chosen, amount: chosen === 'NONE' ? 0 : amountNumber } }), 'Security deposit saved').then((ok) => {
      if (ok) {
        setMode(null);
        setAmount(null);
      }
    });

  const addReader = (registrationCode: string, readerLabel: string) =>
    run('reader', () => api<Settings>(key, { method: 'POST', json: { registrationCode, label: readerLabel } }), `${readerLabel} added`).then((ok) => {
      if (ok) {
        setCode('');
        setLabel('');
      }
    });

  return (
    <div className="space-y-5">
      <fieldset disabled={!manage}>
        <legend className="text-sm font-medium">Security deposit at check-in</legend>
        <div className="mt-2 grid gap-3">
          {MODES.map((o) => {
            const disabled = o.value === 'HOLD' && !data.cardAvailable;
            return (
              <label
                key={o.value}
                className={cn(
                  'flex items-start gap-3 rounded-xl border border-input p-4 transition-colors has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent/60'
                )}
              >
                <input type="radio" name="deposit-mode" className="mt-0.5 size-5 shrink-0 accent-primary" checked={chosen === o.value} disabled={disabled} onChange={() => setMode(o.value)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{SECURITY_DEPOSIT_MODE_LABEL[o.value]}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{o.text}</span>
                </span>
              </label>
            );
          })}
        </div>
        {chosen !== 'NONE' && (
          <div className="mt-3 max-w-xs">
            <Field label={`Deposit per stay (${data.currency})`} htmlFor="security-deposit">
              <Input id="security-deposit" inputMode="decimal" value={amountValue} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
        )}
        {changed && (
          <div className="mt-3 flex gap-2">
            <Button loading={busy === 'save'} disabled={!amountOk} onClick={save}>
              Save deposit
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setMode(null);
                setAmount(null);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
        {!changed && chosen !== 'NONE' && <p className="mt-2 text-sm text-muted-foreground">The desk asks for {formatMoney(data.securityDepositAmount, data.currency, { cents: true })} at check-in.</p>}
      </fieldset>

      <div>
        <p className="text-sm font-medium">Card readers</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Stripe Terminal smart readers (WisePOS E or S700) on the front desk’s Wi-Fi. The desk sends the amount and the guest taps, inserts or swipes. Cards can also be typed in, and cash is always available.
        </p>
        {!data.cardAvailable ? (
          <Callout tone="info" className="mt-3">
            Connect Stripe above to take cards at the desk.
          </Callout>
        ) : (
          <>
            {data.readers.length > 0 && (
              <ul className="mt-3 space-y-2">
                {data.readers.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm">
                    <Nfc className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                    {r.simulated && (
                      <Badge variant="neutral" size="sm">
                        Simulated
                      </Badge>
                    )}
                    <Badge variant={r.status === 'online' ? 'success' : 'neutral'} size="sm">
                      {r.status ?? 'unknown'}
                    </Badge>
                    {manage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${r.label}`}
                        loading={busy === r.id}
                        onClick={() => {
                          if (window.confirm(`Remove ${r.label} from this hotel?`)) void run(r.id, () => api<Settings>(`${key}?readerId=${encodeURIComponent(r.id)}`, { method: 'DELETE' }), `${r.label} removed`);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {manage && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Pairing code" htmlFor="reader-code" hint="On the reader: Settings → Generate pairing code.">
                  <Input id="reader-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="sepia-cerulean-aqua" />
                </Field>
                <Field label="Name" htmlFor="reader-label">
                  <Input id="reader-label" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} placeholder="Front desk" />
                </Field>
                <Button className="sm:mb-[1.375rem]" disabled={code.trim().length < 3 || !label.trim()} loading={busy === 'reader'} onClick={() => addReader(code.trim(), label.trim())}>
                  <Plus aria-hidden /> Add reader
                </Button>
              </div>
            )}
            {manage && data.testMode && (
              <Button size="sm" variant="outline" className="mt-3" loading={busy === 'reader'} onClick={() => addReader('simulated-wpe', 'Simulated reader')}>
                <Nfc aria-hidden /> Add a simulated reader (test mode)
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
