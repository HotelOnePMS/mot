'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Download, ShieldAlert, Send } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { formatMoney, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

interface Dispute {
  id: string;
  stripeDisputeId: string;
  status: string;
  reason: string | null;
  amount: number;
  currency: string;
  evidenceDueBy: string | null;
  evidenceSubmittedAt: string | null;
  canSubmit: boolean;
  createdAt: string;
  booking: { id: string; code: string | null; guestName: string } | null;
}

interface Detail {
  dispute: Dispute;
  evidence: { generatedAt: string; sections: { title: string; lines: string[] }[] } | null;
}

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

const STATUS: Record<string, { label: string; variant: 'danger' | 'warning' | 'info' | 'success' | 'neutral' }> = {
  needs_response: { label: 'Needs your response', variant: 'danger' },
  warning_needs_response: { label: 'Early warning', variant: 'warning' },
  under_review: { label: 'Under review', variant: 'info' },
  won: { label: 'Won', variant: 'success' },
  lost: { label: 'Lost', variant: 'neutral' },
  warning_under_review: { label: 'Early warning, under review', variant: 'info' },
  warning_closed: { label: 'Early warning closed', variant: 'neutral' },
};

const statusOf = (s: string) => STATUS[s] ?? { label: s.replace(/_/g, ' '), variant: 'neutral' as const };

function DisputeDetail({ id }: { id: string }) {
  const { can } = useConsole();
  const { mutate } = useSWRConfig();
  const key = `/api/admin/disputes/${id}`;
  const { data, error } = useSWR<Detail>(key, fetcher);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (error) return <Callout tone="danger">{(error as Error).message}</Callout>;
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const d = data.dispute;
  const st = statusOf(d.status);

  async function submit() {
    setBusy(true);
    try {
      await api(`${key}/submit`, { method: 'POST' });
      toast.success('Evidence submitted to Stripe');
      setConfirm(false);
      await Promise.all([mutate(key), mutate((k) => typeof k === 'string' && k.startsWith('/api/admin/disputes?'))]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {formatMoney(d.amount, d.currency.toUpperCase(), { cents: true })} disputed{d.booking ? ` · ${d.booking.guestName}` : ''}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {d.reason ? `Reason: ${d.reason.replace(/_/g, ' ')}. ` : ''}
            {d.evidenceDueBy && !d.evidenceSubmittedAt ? `Respond by ${new Date(d.evidenceDueBy).toLocaleDateString([], { dateStyle: 'long' })}. ` : ''}
            {d.evidenceSubmittedAt ? `Evidence submitted ${timeAgo(d.evidenceSubmittedAt)}.` : ''}
          </p>
        </div>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>

      <Callout tone="info" className="mt-4">
        This evidence was assembled from your booking records. Check it before you send it: nothing goes to Stripe or the guest’s bank until you press “Submit evidence”. Submitting can’t be undone, and the bank decides the outcome.
      </Callout>

      {data.evidence ? (
        <div className="mt-5 space-y-5">
          {data.evidence.sections.map((s) => (
            <section key={s.title}>
              <h3 className="text-sm font-semibold">{s.title}</h3>
              <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
                {s.lines.map((l, i) => (
                  <li key={i} className="whitespace-pre-wrap break-words">
                    {l}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">No evidence could be assembled because this dispute isn’t linked to a booking. Use your Stripe dashboard to respond.</p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {data.evidence && (
          <Button asChild variant="outline">
            <a href={`${key}/evidence`}>
              <Download aria-hidden /> Download evidence
            </a>
          </Button>
        )}
        {d.canSubmit && can('disputes.manage') && (
          <Button onClick={() => setConfirm(true)}>
            <Send aria-hidden /> Submit evidence
          </Button>
        )}
        {d.canSubmit && !can('disputes.manage') && <p className="self-center text-sm text-muted-foreground">An owner needs to submit the evidence.</p>}
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit this evidence to Stripe?"
        description="Stripe sends it to the guest’s bank. You can only submit once per dispute."
        confirmLabel="Submit evidence"
        cancelLabel="Not yet"
        loading={busy}
        onConfirm={submit}
      />
    </Card>
  );
}

export default function DisputesPage() {
  const url = usePropertyUrl('/api/admin/disputes');
  const { data, error, isLoading } = useSWR<Dispute[]>(url, fetcher);
  const [selected, setSelected] = React.useState<string | null>(null);

  // Deep link from the owner's email: /admin/disputes?dispute=<id>
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('dispute');
    if (id) setSelected(id);
  }, []);
  const current = selected ?? data?.[0]?.id ?? null;

  return (
    <div className={cn(FRAME, 'space-y-6')}>
      <PageHeader title="Disputes" description="Card payments a guest’s bank has questioned. We put the evidence together; you review and submit it." />
      {error ? (
        <Callout tone="danger">{(error as Error).message}</Callout>
      ) : isLoading || !data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldAlert} title="No disputes" description="If a guest’s bank ever questions a card payment, it will show up here and we’ll email the owner." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="space-y-2" aria-label="Disputes">
            {data.map((d) => {
              const st = statusOf(d.status);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(d.id)}
                    aria-current={current === d.id}
                    className={cn(
                      'w-full rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      current === d.id && 'border-primary/60 ring-2 ring-primary/20'
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium tabular">{formatMoney(d.amount, d.currency.toUpperCase(), { cents: true })}</span>
                      <Badge variant={st.variant} size="sm">
                        {st.label}
                      </Badge>
                    </span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">
                      {d.booking ? `${d.booking.guestName} · ${d.booking.code ?? ''}` : d.stripeDisputeId}
                    </span>
                    <span className="block text-xs text-muted-foreground">{timeAgo(d.createdAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {current && <DisputeDetail key={current} id={current} />}
        </div>
      )}
    </div>
  );
}
