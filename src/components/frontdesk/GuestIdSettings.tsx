'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { api, fetcher } from '@/lib/fetcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';

interface Settings {
  requireGuestId: boolean;
  guestIdRetentionDays: number;
}

/** Whether check-in needs a photo of the guest's ID, and how long photos are kept after the stay. */
export function GuestIdSettings({ propertyId }: { propertyId: string }) {
  const key = `/api/admin/properties/${propertyId}/guest-ids`;
  const { data, mutate } = useSWR<Settings>(key, fetcher);
  const [draft, setDraft] = React.useState<{ requireGuestId: boolean; days: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (data) setDraft({ requireGuestId: data.requireGuestId, days: String(data.guestIdRetentionDays) });
  }, [data]);
  if (!data || !draft) return <Skeleton className="h-24 w-full rounded-xl" />;

  const days = Number(draft.days);
  const valid = draft.days.trim() !== '' && Number.isInteger(days) && days >= 0 && days <= 365;
  const dirty = draft.requireGuestId !== data.requireGuestId || days !== data.guestIdRetentionDays;

  async function save() {
    setSaving(true);
    try {
      const next = await api<Settings>(key, { method: 'PUT', json: { requireGuestId: draft!.requireGuestId, guestIdRetentionDays: days } });
      await mutate(next, { revalidate: false });
      toast.success('Guest ID settings saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
        <div className="text-sm">
          <p className="font-medium">Require an ID photo at check-in</p>
          <p className="mt-0.5 text-muted-foreground">The front desk can’t check a guest in until a photo of their ID is on the reservation.</p>
        </div>
        <Switch checked={draft.requireGuestId} onCheckedChange={(v) => setDraft({ ...draft, requireGuestId: v })} aria-label="Require an ID photo at check-in" />
      </div>
      <Field
        label="Keep ID photos for"
        hint="Days after check-out (0 deletes them the next day). Photos are encrypted, only staff of this hotel can see them, and every view is logged."
        error={valid ? undefined : 'Enter 0 to 365 days.'}
      >
        <div className="flex items-center gap-2">
          <Input type="number" inputMode="numeric" min={0} max={365} className="w-28" value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
      </Field>
      <Button disabled={!dirty || !valid} loading={saving} loadingText="Saving…" onClick={() => void save()}>
        Save
      </Button>
    </div>
  );
}
