'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { SAVED_CHARGE_UNITS, UNIT_LABEL, describeSavedCharge, type SavedChargeUnit, type SavedChargeView } from '@/lib/saved-charges';
import { cn } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/button';
import { Input, inputBase } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { useConsole } from '@/components/console/ConsoleProvider';

interface Draft {
  id?: string;
  name: string;
  amount: string;
  unit: SavedChargeUnit;
  note: string;
}

const toDraft = (c: SavedChargeView): Draft => ({ id: c.id, name: c.name, amount: String(c.amount), unit: c.unit, note: c.note ?? '' });
const toNumber = (s: string) => Number(s.replace(/,/g, '.').replace(/[^\d.]/g, ''));
const EMPTY: Draft = { name: '', amount: '', unit: 'STAY', note: '' };

/**
 * The hotel's usual extra charges ("Pet fee", $50 per stay): offered when someone adds a charge to a folio, and used by
 * the assistant when asked for one by name. Saying "pet fee is always $50" to the assistant saves one too.
 */
export function SavedChargeSettings({ propertyId }: { propertyId: string }) {
  const { currency } = useConsole();
  const url = `/api/admin/saved-charges?propertyId=${encodeURIComponent(propertyId)}`;
  const { data, error, mutate } = useSWR<{ charges: SavedChargeView[]; canManage: boolean }>(url, fetcher);
  const [adding, setAdding] = React.useState<Draft | null>(null);

  if (error) return <Callout tone="danger">Couldn’t load the usual charges: {(error as Error).message}</Callout>;
  if (!data) return <Skeleton className="h-24 rounded-xl" />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Picked from when adding a charge to a folio. The assistant uses them too: “add a pet fee to Patel” adds yours at its usual price, and “pet fee is always $50” saves or changes one here.
      </p>
      {data.charges.length === 0 && !adding && <p className="text-sm text-muted-foreground">No usual charges yet.</p>}
      <ul className="space-y-3">
        {data.charges.map((c) => (
          <ChargeRow key={c.id} initial={toDraft(c)} saved={c} currency={currency} propertyId={propertyId} canManage={data.canManage} onChanged={() => void mutate()} />
        ))}
        {adding && (
          <ChargeRow
            initial={adding}
            currency={currency}
            propertyId={propertyId}
            canManage={data.canManage}
            onChanged={() => {
              setAdding(null);
              void mutate();
            }}
            onCancel={() => setAdding(null)}
          />
        )}
      </ul>
      {data.canManage && !adding && data.charges.length < 100 && (
        <Button variant="outline" size="sm" onClick={() => setAdding({ ...EMPTY })}>
          <Plus aria-hidden /> Add a usual charge
        </Button>
      )}
    </div>
  );
}

function ChargeRow({
  initial,
  saved,
  currency,
  propertyId,
  canManage,
  onChanged,
  onCancel,
}: {
  initial: Draft;
  saved?: SavedChargeView;
  currency: string;
  propertyId: string;
  canManage: boolean;
  onChanged: () => void;
  onCancel?: () => void;
}) {
  const id = React.useId();
  const [draft, setDraft] = React.useState(initial);
  const [busy, setBusy] = React.useState<'save' | 'remove' | null>(null);
  React.useEffect(() => setDraft(initial), [initial.id, initial.name, initial.amount, initial.unit, initial.note]); // eslint-disable-line react-hooks/exhaustive-deps

  const amount = toNumber(draft.amount);
  const invalid = !draft.name.trim() || !(amount > 0);
  const dirty = !saved || draft.name !== initial.name || draft.amount !== initial.amount || draft.unit !== initial.unit || draft.note !== initial.note;

  async function save() {
    setBusy('save');
    try {
      await api('/api/admin/saved-charges', {
        method: 'POST',
        json: { propertyId, ...(draft.id ? { id: draft.id } : {}), name: draft.name.trim(), amount: Math.round(amount * 1000) / 1000, unit: draft.unit, note: draft.note.trim() || null },
      });
      toast.success(`Saved “${draft.name.trim()}”`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!saved) return onCancel?.();
    if (!window.confirm(`Remove “${saved.name}” (${describeSavedCharge(saved, currency)}) from the usual charges? Folios that already have it keep it.`)) return;
    setBusy('remove');
    try {
      await api(`/api/admin/saved-charges?propertyId=${encodeURIComponent(propertyId)}&id=${encodeURIComponent(saved.id)}`, { method: 'DELETE' });
      toast.success(`Removed “${saved.name}”`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_8.5rem_auto] sm:items-end">
      <Field label="Charge">
        <Input id={`${id}-n`} value={draft.name} maxLength={80} placeholder="Pet fee" disabled={!canManage} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </Field>
      <Field label={`Price (${currency})`}>
        <Input id={`${id}-a`} inputMode="decimal" value={draft.amount} placeholder="50" disabled={!canManage} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
      </Field>
      <Field label="Charged">
        <select id={`${id}-u`} className={cn(inputBase, 'h-10 py-2')} value={draft.unit} disabled={!canManage} onChange={(e) => setDraft({ ...draft, unit: e.target.value as SavedChargeUnit })}>
          {SAVED_CHARGE_UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
      </Field>
      {canManage && (
        // Under the note on a phone; beside the price on wider screens.
        <div className="order-last flex h-10 items-center gap-1 sm:order-none">
          {dirty && (
            <Button size="sm" disabled={invalid || !!busy} loading={busy === 'save'} onClick={() => void save()}>
              Save
            </Button>
          )}
          <IconButton label={saved ? `Remove ${saved.name}` : 'Cancel'} variant="ghost" disabled={!!busy} onClick={() => void remove()}>
            <Trash2 aria-hidden />
          </IconButton>
        </div>
      )}
      <Field label="Note (optional)" className="sm:col-span-3">
        <Input id={`${id}-o`} value={draft.note} maxLength={200} placeholder="Anything staff should know, like “per pet, cleaning included”" disabled={!canManage} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
      </Field>
    </li>
  );
}
