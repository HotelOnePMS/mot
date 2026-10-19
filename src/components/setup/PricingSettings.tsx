'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { COMMON_CURRENCIES } from '@/lib/currency';
import { api, fetcher } from '@/lib/fetcher';
import { money } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/button';
import { Input, inputBase } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { SaveBar } from './SaveBar';

type ChargeKind = 'PERCENT' | 'PER_ROOM_NIGHT' | 'PER_GUEST_NIGHT' | 'PER_STAY';

interface Charge {
  name: string;
  kind: ChargeKind;
  amount: number | '';
  isActive: boolean;
}

interface Settings {
  timezone: string | null;
  platformTimezone: string;
  currency: string;
  charges: Charge[];
  upcomingBookings: number;
}

const KINDS: { value: ChargeKind; label: string }[] = [
  { value: 'PERCENT', label: '% of the room price' },
  { value: 'PER_ROOM_NIGHT', label: 'per room, per night' },
  { value: 'PER_GUEST_NIGHT', label: 'per guest, per night' },
  { value: 'PER_STAY', label: 'per room, per stay' },
];

const zones = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

const currencies = (() => {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('currency');
  } catch {
    /* older browsers: the common list only */
  }
  const common = [...COMMON_CURRENCIES] as string[];
  return [...common, ...all.filter((c) => !common.includes(c))];
})();

const currencyLabel = (code: string) => {
  try {
    return `${code} · ${new Intl.DisplayNames(['en'], { type: 'currency' }).of(code)}`;
  } catch {
    return code;
  }
};

/** The time a zone shows right now, e.g. "3:42 PM". */
const clockIn = (tz: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date());
  } catch {
    return '';
  }
};

/**
 * Settings → Prices and time: the hotel's clock (its "today", check-in day and
 * free-cancellation cut-off), the currency it prices in, and the taxes and
 * fees added to every stay. Quotes, checkout, Stripe and the agent all use them.
 */
export function PricingSettings({ propertyId, onSaved }: { propertyId: string; onSaved?: () => void }) {
  const url = `/api/admin/properties/${propertyId}/pricing`;
  const { data, error, mutate } = useSWR<Settings>(url, fetcher);
  const [draft, setDraft] = React.useState<Settings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const formId = React.useId();

  React.useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  if (error) return <Callout tone="danger">{(error as Error).message}</Callout>;
  if (!draft || !data) {
    return (
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const invalid = draft.charges.some((c) => !c.name.trim() || c.amount === '' || Number(c.amount) <= 0);
  const setCharge = (i: number, patch: Partial<Charge>) =>
    setDraft({ ...draft, charges: draft.charges.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api<Settings>(url, {
        method: 'PUT',
        json: { timezone: draft.timezone, currency: draft.currency, charges: draft.charges.map((c) => ({ ...c, amount: Number(c.amount) })) },
      });
      await mutate(saved, { revalidate: false });
      setDraft(saved);
      onSaved?.();
      toast.success('Prices and time saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const zone = draft.timezone ?? draft.platformTimezone;
  const currencyChanged = draft.currency !== data.currency;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Time zone" hint={`It’s ${clockIn(zone)} there now. Sets the hotel’s “today” and the 3 PM cancellation cut-off.`}>
          <select
            id={`${formId}-tz`}
            className={cn(inputBase, 'h-10 py-2')}
            value={draft.timezone ?? ''}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value || null })}
          >
            <option value="">Platform default ({draft.platformTimezone})</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency" hint="Room prices and rates are read in this currency.">
          <select
            id={`${formId}-cur`}
            className={cn(inputBase, 'h-10 py-2')}
            value={draft.currency}
            onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {currencyChanged && (
        <Callout tone="warning">
          Prices aren’t converted: a base price of 120 becomes {money(120, { currency: draft.currency })}. Review your room prices and rates after saving.
          {data.upcomingBookings > 0 && ` The ${data.upcomingBookings} upcoming reservation${data.upcomingBookings === 1 ? '' : 's'} keep the currency they were booked in.`}
        </Callout>
      )}

      <div>
        <h3 className="text-sm font-semibold">Taxes and fees</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Added to every new quote and booking and shown to guests line by line before they pay. Existing reservations don’t change.
        </p>
        <ul className="mt-4 space-y-3">
          {draft.charges.map((c, i) => (
            <li key={i} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1.7fr)_auto_auto] sm:items-end">
              <Field label="Name">
                <Input id={`${formId}-n${i}`} value={c.name} maxLength={60} placeholder="City tax" onChange={(e) => setCharge(i, { name: e.target.value })} />
              </Field>
              <Field label={c.kind === 'PERCENT' ? 'Rate (%)' : `Amount (${draft.currency})`}>
                <Input
                  id={`${formId}-a${i}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={c.amount}
                  onChange={(e) => setCharge(i, { amount: e.target.value === '' ? '' : Number(e.target.value) })}
                />
              </Field>
              <Field label="Charged">
                <select id={`${formId}-k${i}`} className={cn(inputBase, 'h-10 py-2')} value={c.kind} onChange={(e) => setCharge(i, { kind: e.target.value as ChargeKind })}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex h-10 items-center gap-2">
                <Switch checked={c.isActive} onCheckedChange={(v) => setCharge(i, { isActive: v })} aria-label={`Charge ${c.name || 'this'}`} />
                <span className="text-sm text-muted-foreground">{c.isActive ? 'On' : 'Off'}</span>
              </div>
              <IconButton
                label={`Remove ${c.name || 'this charge'}`}
                variant="ghost"
                onClick={() => setDraft({ ...draft, charges: draft.charges.filter((_, j) => j !== i) })}
              >
                <Trash2 aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
        {draft.charges.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No taxes or fees: guests pay the room price only.</p>}
        {draft.charges.length < 12 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setDraft({ ...draft, charges: [...draft.charges, { name: '', kind: 'PERCENT', amount: '', isActive: true }] })}
          >
            <Plus aria-hidden /> Add a tax or fee
          </Button>
        )}
      </div>

      <SaveBar dirty={dirty} saving={saving} disabled={invalid} onSave={save} onDiscard={() => setDraft(data)} message={invalid ? 'Give every tax and fee a name and an amount' : undefined} />
    </div>
  );
}
