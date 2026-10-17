'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/primitives';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { AgentPanel } from '@/components/agent/AgentPanel';
import { ShortcutStarters } from '@/components/agent/ShortcutStarters';
import { AgentOrb } from '@/components/agent/Timeline';
import { useConsole } from './ConsoleProvider';
import { navFor } from './nav';

const QUICK = ['Brief me', 'Who’s arriving today?', 'Which rooms need cleaning?', 'Forecast the next 3 weekends'];

/**
 * Classic mode's bridge to the agent: ⌘K / Ctrl+K opens the same agent in a
 * side panel over whatever screen you're on, so you can ask without leaving
 * it. Before the first question it also offers quick jumps to other screens.
 */
export function CommandSheet() {
  const { commandOpen, setCommandOpen, setMode, can, role, property } = useConsole();
  const pathname = usePathname();
  if (!can('agent.use')) return null;
  const pages = navFor(role, { agentEnabled: true, setupPath: property?.setupPath })
    .flatMap((g) => g.items)
    .filter((i) => !i.agent && i.href !== pathname)
    .slice(0, 8);
  return (
    <Sheet open={commandOpen} onOpenChange={setCommandOpen}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[560px]" closeLabel="Close the agent">
        <div className="flex items-center gap-3 border-b py-3 pl-4 pr-14">
          <AgentOrb />
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-sm">Ask the agent</SheetTitle>
            <SheetDescription className="text-xs">
              Ask without leaving this screen · <Kbd>Esc</Kbd> to close
            </SheetDescription>
          </div>
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link
              href="/admin/agent"
              onClick={() => {
                setMode('AGENTIC', { navigate: false });
                setCommandOpen(false);
              }}
            >
              <Maximize2 aria-hidden /> <span className="hidden sm:inline">Full workspace</span>
              <span className="sr-only sm:hidden">Open the full agent workspace</span>
            </Link>
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <AgentPanel
            compact
            empty={(send) => (
              <div className="py-8 text-center">
                <AgentOrb className="mx-auto h-10 w-10" />
                <p className="mt-4 text-base font-semibold tracking-tight">What do you need?</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">I’ll show live data and ask before changing anything.</p>
                <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
                  {QUICK.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => send(q)}
                        className="inline-flex h-9 items-center rounded-full border border-border bg-surface px-3.5 text-sm text-foreground shadow-xs transition-colors hover:border-agent/40 hover:bg-agent-soft hover:text-agent-soft-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mx-auto max-w-md text-left">
                  <ShortcutStarters send={send} compact />
                </div>
                {pages.length > 0 && (
                  <nav aria-label="Go to" className="mx-auto mt-8 max-w-md border-t pt-5 text-left">
                    <p className="px-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Go to</p>
                    <ul className="mt-2 grid grid-cols-2 gap-1">
                      {pages.map((p) => (
                        <li key={p.href}>
                          <Link
                            href={p.href}
                            onClick={() => setCommandOpen(false)}
                            className="flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <p.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate">{p.label}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}
              </div>
            )}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
