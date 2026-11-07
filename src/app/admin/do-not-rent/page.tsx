'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Ban, Mail, Phone, Plus, Search, Trash2 } from 'lucide-react';
import type { DoNotRentEntry } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { fmtDay, formatPhone } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { PageShell } from '@/components/console/PageShell';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { AddDoNotRentDialog } from '@/components/frontdesk/DoNotRent';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

/** The hotel's Do Not Rent list: who's on it, why, and who added them. */
export default function DoNotRentPage() {
  const { can, refresh } = useConsole();
  const url = usePropertyUrl('/api/admin/do-not-rent');
  const { data, error, isLoading } = useSWR<DoNotRentEntry[]>(url, fetcher);
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<DoNotRentEntry | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const canManage = can('dnr.manage');

  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const rows = (data ?? []).filter(
    (e) =>
      !q ||
      e.guestName.toLowerCase().includes(q) ||
      (e.email ?? '').includes(q) ||
      e.reason.toLowerCase().includes(q) ||
      (digits.length >= 3 && (e.phone ?? '').replace(/\D/g, '').includes(digits)),
  );

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/api/admin/do-not-rent/${removing.id}`, { method: 'DELETE' });
      toast.success(`${removing.guestName} is off the Do Not Rent list`);
      refresh();
      setRemoving(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      size="narrow"
      title="Do Not Rent"
      description="Guests this hotel won’t rent to again. The front desk is warned when one of them books or checks in, matched on email or phone."
      actions={
        canManage ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add guest
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <Callout tone="danger">{(error as Error).message}</Callout>
      ) : isLoading || !data ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Ban}
            title="No one is on the list"
            description="Add a guest from their reservation, or here, with a note saying what happened."
            action={
              canManage ? (
                <Button variant="outline" onClick={() => setAdding(true)}>
                  <Plus aria-hidden /> Add guest
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-9" placeholder="Search name, email, phone or note" aria-label="Search the list" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ul className="space-y-3">
            {rows.map((e) => (
              <li key={e.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                  <div className="min-w-0 space-y-1.5">
                    <p className="font-semibold">{e.guestName}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {e.email && (
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <Mail className="size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{e.email}</span>
                        </span>
                      )}
                      {e.phone && (
                        <span className="inline-flex items-center gap-1.5 tabular">
                          <Phone className="size-3.5 shrink-0" aria-hidden />
                          {formatPhone(e.phone)}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-line text-sm">{e.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Added by {e.createdBy.name} on {fmtDay(e.createdAt.slice(0, 10))}
                    </p>
                  </div>
                  {canManage && (
                    <Button variant="ghost" size="sm" className="self-start" onClick={() => setRemoving(e)}>
                      <Trash2 aria-hidden /> Remove
                    </Button>
                  )}
                </Card>
              </li>
            ))}
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No one on the list matches “{query}”.</p>}
          </ul>
        </>
      )}

      <AddDoNotRentDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Take ${removing?.guestName ?? 'this guest'} off the list?`}
        description="The front desk stops being warned when they book or check in. The activity log keeps who added and removed them."
        confirmLabel="Remove from list"
        loading={busy}
        onConfirm={remove}
      />
    </PageShell>
  );
}
