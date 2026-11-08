'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Download, Printer, Send } from 'lucide-react';
import type { AgentBlock } from '@/lib/agent/blocks';
import { fmtDay, fmtRange, formatMoney, timeAgo } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/primitives';
import { useAgentUI } from '../AgentUI';
import { BlockCard, BlockHeader } from './core';

type DisputeBlockData = Extract<AgentBlock, { type: 'dispute' }>;

const STATUS: Record<string, { label: string; variant: 'danger' | 'warning' | 'info' | 'success' | 'neutral' }> = {
  reported: { label: 'Reported to you', variant: 'warning' },
  needs_response: { label: 'Needs your response', variant: 'danger' },
  warning_needs_response: { label: 'Early warning', variant: 'warning' },
  under_review: { label: 'Under review', variant: 'info' },
  warning_under_review: { label: 'Early warning, under review', variant: 'info' },
  won: { label: 'Won', variant: 'success' },
  lost: { label: 'Lost', variant: 'neutral' },
};

/**
 * A card dispute or chargeback in the conversation: the summary the document gives the bank, what's missing from the
 * records (for the hotel only), and the evidence document to download or print. A Stripe dispute that still waits for
 * evidence can be submitted from here too, through the usual confirmation.
 */
export function DisputeBlock({ block }: { block: DisputeBlockData }) {
  const id = React.useId();
  const { send, busy } = useAgentUI();
  const st = STATUS[block.status] ?? { label: block.status.replace(/_/g, ' '), variant: 'neutral' as const };
  const amount = formatMoney(block.amount, block.currency, { cents: true });
  const reported = !block.disputeId;
  // "Fraudulent: the cardholder says…" reads as "Fraudulent" here; the document has the whole label.
  const reason = block.reason ? block.reasonLabel.split(':')[0] : 'Reason not given';
  return (
    <BlockCard aria-labelledby={id}>
      <BlockHeader
        id={id}
        title={`${reported ? 'Chargeback' : 'Dispute'} · ${block.guestName}`}
        description={`#${block.code} · ${fmtRange(block.checkIn, block.checkOut)} · ${amount} · ${reason}`}
        meta={
          <Badge variant={st.variant} size="sm">
            {st.label}
          </Badge>
        }
      />
      <div className="space-y-4 px-4 py-3">
        {(block.respondBy || block.submittedAt) && (
          <p className="text-sm">
            {block.submittedAt ? (
              <>Evidence sent {timeAgo(block.submittedAt)}. The bank decides the outcome.</>
            ) : (
              <>
                Respond by <span className="font-medium">{fmtDay(block.respondBy as string, 'long')}</span>.
              </>
            )}
          </p>
        )}
        {block.points.length > 0 && (
          <section aria-label="Summary for the bank">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary for the bank</h3>
            <ul className="mt-1.5 space-y-1 text-sm leading-relaxed">
              {block.points.map((p) => (
                <li key={p} className="flex gap-2.5">
                  <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                  <span className="min-w-0 break-words">{p}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {block.gaps.length > 0 && (
          <Callout tone="warning" title="Missing or weak">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {block.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs opacity-80">Only you see this; it isn’t in the document.</p>
          </Callout>
        )}
        {reported && (
          <p className="text-xs text-muted-foreground">
            Stripe didn’t report this one, so send the document to your card processor or the guest’s bank yourself, before their deadline.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <Button asChild size="sm" variant="outline">
          <a href={block.downloadHref} download>
            <Download aria-hidden /> Download evidence
          </a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={block.printHref} target="_blank" rel="noopener">
            <Printer aria-hidden /> Printable version
          </a>
        </Button>
        {block.canSubmit && (
          <Button size="sm" disabled={busy} onClick={() => send(`Submit the dispute evidence for reservation ${block.code} to Stripe`)}>
            <Send aria-hidden /> Submit to Stripe…
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link href={block.openHref}>
            {reported ? 'Open reservation' : 'Open in Disputes'} <ArrowUpRight aria-hidden />
          </Link>
        </Button>
      </div>
    </BlockCard>
  );
}
