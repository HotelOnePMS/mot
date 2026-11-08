'use client';

import * as React from 'react';
import Link from 'next/link';
import { Download, FileSpreadsheet } from 'lucide-react';
import type { AgentBlock } from '@/lib/agent/blocks';
import { fmtDay } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ReportTable } from '@/components/reports/ReportTable';
import { BlockCard, BlockHeader, CountPill } from './core';

type ReportBlockData = Extract<AgentBlock, { type: 'report' }>;

/** A custom report the agent built: its first rows and totals, with the whole report as CSV or on the Reports page. */
export function ReportBlock({ block }: { block: ReportBlockData }) {
  const id = React.useId();
  const range = block.from === block.to ? fmtDay(block.from, 'long') : `${fmtDay(block.from, 'weekday')} – ${fmtDay(block.to, 'weekday')}`;
  const more = block.totalRows - block.rows.length;
  return (
    <BlockCard aria-labelledby={id}>
      <BlockHeader id={id} title={block.title} description={range} meta={<CountPill n={block.totalRows} label="rows" />} />
      {block.totalRows === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nothing matches this report. Try wider dates or fewer filters.</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <ReportTable columns={block.columns} rows={block.rows} totals={block.totals} currency={block.currency} dense caption={block.title} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <Button asChild size="sm" variant="outline">
          <a href={block.csvHref} download>
            <Download aria-hidden /> Download CSV
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={block.openHref}>
            <FileSpreadsheet aria-hidden /> Open in Reports
          </Link>
        </Button>
        {(more > 0 || block.truncated) && (
          <span className="text-xs text-muted-foreground">
            {more > 0 ? `Showing ${block.rows.length} of ${block.totalRows} rows; the CSV has them all.` : ''}
            {block.truncated ? ' Very large: narrow the dates for exact totals.' : ''}
          </span>
        )}
      </div>
    </BlockCard>
  );
}
