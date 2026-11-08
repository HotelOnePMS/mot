'use client';

import * as React from 'react';
import { fmtDay, formatMoney } from '@/lib/format';
import type { ReportCell, ReportColumn } from '@/lib/reports';
import { formatNumber } from '@/lib/status';
import { cn } from '@/lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A report cell as people read it: money in the hotel's currency, dates as days, "2026-11" as "Nov 2026". */
export function formatReportCell(v: ReportCell, col: ReportColumn, currency: string): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (col.format) {
    case 'money':
      return formatMoney(Number(v), currency, { cents: true });
    case 'number':
      return formatNumber(Number(v));
    case 'percent':
      return `${Number(v).toFixed(1)}%`;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDay(String(v), 'weekday') : String(v);
    case 'datetime':
      return new Date(String(v)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    default: {
      const m = /^(\d{4})-(\d{2})$/.exec(String(v));
      return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(v);
    }
  }
}

const numeric = (c: ReportColumn) => c.format === 'number' || c.format === 'money' || c.format === 'percent';

/** A report's rows and total row: numbers right-aligned, the header sticky while it scrolls sideways. */
export function ReportTable({
  columns,
  rows,
  totals,
  currency,
  dense = false,
  caption,
}: {
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, ReportCell> | null;
  currency: string;
  dense?: boolean;
  caption?: string;
}) {
  const pad = dense ? 'px-3 py-1.5' : 'px-4 py-2.5';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('whitespace-nowrap font-medium', pad, numeric(c) && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-accent/40">
              {columns.map((c) => (
                <td key={c.key} className={cn('align-top', pad, numeric(c) ? 'whitespace-nowrap text-right tabular' : c.key === 'notes' || c.key === 'note' ? 'max-w-xs' : 'whitespace-nowrap')}>
                  {formatReportCell(r[c.key] ?? null, c, currency)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot className="border-t-2 bg-surface-sunken font-medium">
            <tr>
              {columns.map((c, i) => {
                const v = totals[c.key] ?? null;
                return (
                  <td key={c.key} className={cn('whitespace-nowrap', pad, numeric(c) && 'text-right tabular')}>
                    {v === null ? (i === 0 ? 'Total' : '') : typeof v === 'string' && !numeric(c) ? v : formatReportCell(v, c, currency)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
