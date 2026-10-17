'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Zap } from 'lucide-react';
import { fetcher } from '@/lib/fetcher';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

interface ShortcutHint {
  key: string;
  title: string;
  example: string;
  command: string;
  needsInput: boolean;
  steps: number;
  uses: number;
}

/**
 * The hotel's most used shortcuts as one-tap starters (a shortcut that needs
 * a guest asks who for). With none saved yet, a one-line tip on making one.
 */
export function ShortcutStarters({ send, compact = false }: { send: (cmd: string) => void; compact?: boolean }) {
  const { can } = useConsole();
  const url = usePropertyUrl('/api/agent/shortcuts');
  const { data } = useSWR<{ shortcuts: ShortcutHint[] }>(url, fetcher, { revalidateOnFocus: false });
  if (!data) return null;
  const items = data.shortcuts;
  if (!items.length) {
    return (
      <p className={compact ? 'mt-4 text-xs text-muted-foreground' : 'mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground'}>
        {!compact && <Zap className="mt-px size-4 shrink-0 text-agent-soft-foreground" aria-hidden />}
        <span>Tip: after any command, say “save that as a shortcut called …” — next time just say its name.</span>
      </p>
    );
  }
  return (
    <section className={compact ? 'mt-5' : 'mt-6'} aria-labelledby="agent-shortcuts-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="agent-shortcuts-heading" className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your shortcuts
        </h2>
        {can('skills.view') && !compact && (
          <Link href="/admin/skills#learned" className="text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Manage
          </Link>
        )}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-2">
        {items.map((s) => (
          <li key={s.key} className="min-w-0 max-w-full">
            <button
              type="button"
              onClick={() => send(s.command)}
              title={`Say “${s.example}”`}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border bg-card px-3.5 text-left text-sm shadow-xs transition-[border-color,background-color,color] hover:border-agent/40 hover:bg-agent-soft hover:text-agent-soft-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-10"
            >
              <Zap className="size-3.5 shrink-0 text-agent-soft-foreground" aria-hidden />
              <span className="truncate font-medium">{s.title}</span>
              {s.needsInput && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">· asks who</span>}
              <span className="sr-only">{s.needsInput ? ` — I’ll ask who it’s for. Or say “${s.example}”.` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
