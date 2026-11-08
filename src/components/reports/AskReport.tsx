'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/fetcher';
import type { QueryResult } from '@/lib/report-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/primitives';

const EXAMPLES = ['Pet fees by month this year', 'Occupancy and ADR by weekday last month', 'Top 10 guests by spend this year', 'Cash taken in the last 7 days'];

interface Asked {
  q: string | null;
  note: string | null;
  result: QueryResult | null;
}

/**
 * "Describe any report": plain words in, a report out (built by the assistant, run on the hotel's live data). A
 * request too vague to build comes back as a question under the box.
 */
export function AskReport({ propertyId, onReport }: { propertyId: string; onReport: (r: { q: string; note: string | null; result: QueryResult }) => void }) {
  const id = React.useId();
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [reply, setReply] = React.useState<{ tone: 'info' | 'danger'; text: string } | null>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setReply(null);
    try {
      const r = await api<Asked>('/api/admin/reports/ask', { method: 'POST', json: { propertyId, question: q } });
      if (r.q && r.result) onReport({ q: r.q, note: r.note, result: r.result });
      else setReply({ tone: 'info', text: r.note ?? 'Say a little more about the report you need.' });
    } catch (e) {
      setReply({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void ask(text);
      }}
    >
      <label htmlFor={`${id}-q`} className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles aria-hidden className="h-4 w-4 text-agent" /> Describe any report
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${id}-q`}
          value={text}
          maxLength={1000}
          placeholder="e.g. pet fees by month this year, or no-shows by booking source"
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1"
          aria-describedby={reply ? `${id}-reply` : undefined}
        />
        <Button type="submit" loading={busy} disabled={text.trim().length < 3}>
          Build report
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Example reports">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={busy}
            onClick={() => {
              setText(ex);
              void ask(ex);
            }}
            className="h-8 rounded-full border border-border bg-surface px-3 text-[13px] text-foreground transition-colors hover:border-agent/40 hover:bg-agent-soft hover:text-agent-soft-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
      {reply && (
        <Callout id={`${id}-reply`} tone={reply.tone} role="status">
          {reply.text}
        </Callout>
      )}
    </form>
  );
}
