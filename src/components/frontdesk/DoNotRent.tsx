'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Ban } from 'lucide-react';
import type { BookingSummary, DoNotRentEntry, DoNotRentMatch } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { emailKey, phoneKey } from '@/lib/doNotRent';
import { fmtDay } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout } from '@/components/ui/primitives';
import { Textarea } from '@/components/ui/textarea';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

export function DoNotRentBadge({ match, size = 'sm' }: { match: DoNotRentMatch | null | undefined; size?: 'sm' | 'default' }) {
  if (!match) return null;
  return (
    <Badge variant="danger" size={size} icon={Ban} title={`Do Not Rent: ${match.reason}`}>
      Do Not Rent
    </Badge>
  );
}

/** The warning shown wherever a Do Not Rent guest is being booked or checked in. */
export function DoNotRentCallout({ match, className }: { match: DoNotRentMatch | null | undefined; className?: string }) {
  if (!match) return null;
  return (
    <Callout tone="danger" icon={Ban} className={className} role="alert">
      <p className="font-semibold">{match.guestName} is on your Do Not Rent list</p>
      <p className="mt-0.5 whitespace-pre-line">{match.reason}</p>
      <p className="mt-1 text-xs opacity-80">
        Added by {match.createdBy.name} on {fmtDay(match.createdAt.slice(0, 10))}. Check with a manager before you go ahead.
      </p>
    </Callout>
  );
}

/** Looks the guest up as staff type their email or phone into a booking form. */
export function useDoNotRentCheck(guest: { email?: string; phone?: string }, enabled = true): DoNotRentMatch | null {
  const { can } = useConsole();
  const email = emailKey(guest.email) ?? undefined;
  const phone = phoneKey(guest.phone) ? guest.phone : undefined;
  const [debounced, setDebounced] = React.useState({ email, phone });
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced({ email, phone }), 400);
    return () => clearTimeout(t);
  }, [email, phone]);
  const url = usePropertyUrl('/api/admin/do-not-rent/check', debounced);
  const active = enabled && can('dnr.view') && (!!debounced.email || !!debounced.phone);
  const { data } = useSWR<{ match: DoNotRentMatch | null }>(active ? url : null, fetcher);
  return active ? (data?.match ?? null) : null;
}

/** Add a guest to the list with a note. Prefilled from a booking when there is one. */
export function AddDoNotRentDialog({
  open,
  onOpenChange,
  booking,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  booking?: BookingSummary | null;
  onAdded?: (e: DoNotRentEntry) => void;
}) {
  const { propertyId, refresh } = useConsole();
  const [form, setForm] = React.useState({ guestName: '', email: '', phone: '', reason: '' });
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  React.useEffect(() => {
    if (open) {
      setForm({
        guestName: booking?.guest.name ?? '',
        // Placeholder addresses for guests booked without an email aren't worth matching on.
        email: booking && !booking.guest.email.endsWith('.invalid') ? booking.guest.email : '',
        phone: booking?.guest.phone ?? '',
        reason: '',
      });
    }
  }, [open, booking]);
  const canSave = !!form.guestName.trim() && !!form.reason.trim() && (!!emailKey(form.email) || !!phoneKey(form.phone));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    try {
      const entry = await api<DoNotRentEntry>('/api/admin/do-not-rent', {
        method: 'POST',
        json: { propertyId: booking?.propertyId ?? propertyId, ...form, bookingId: booking?.id ?? null },
      });
      toast.success(`${entry.guestName} is on the Do Not Rent list`);
      refresh();
      onAdded?.(entry);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to Do Not Rent</DialogTitle>
          <DialogDescription>
            The front desk is warned whenever this guest books or checks in at this hotel, matched on email or phone. Your name is saved with the note.
          </DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Guest name" htmlFor={`${formId}-name`}>
            <Input id={`${formId}-name`} autoComplete="off" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" htmlFor={`${formId}-email`} optional>
              <Input id={`${formId}-email`} type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor={`${formId}-phone`} optional>
              <Input id={`${formId}-phone`} type="tel" autoComplete="off" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
          </div>
          {!emailKey(form.email) && !phoneKey(form.phone) && <p className="-mt-1 text-xs text-muted-foreground">Add an email or a phone number so we can recognise them.</p>}
          <Field label="Note" htmlFor={`${formId}-reason`} hint={`${form.reason.length}/1000 characters`}>
            <Textarea
              id={`${formId}-reason`}
              rows={3}
              maxLength={1000}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="What happened, e.g. Smoked in room 204 and damaged the furniture"
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="destructive" loading={busy} loadingText="Adding…" disabled={!canSave}>
            <Ban aria-hidden /> Add to Do Not Rent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
