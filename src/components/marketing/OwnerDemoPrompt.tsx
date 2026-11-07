'use client';

import Link from 'next/link';
import { ArrowRight, AudioLines } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVoiceDock } from '@/components/voice/VoiceDock';
import { cn } from '@/lib/utils';
import { TOUR_PATH } from '@/config/tour';

/**
 * The home page's way into the owner demo: talk to the voice guide ("give me
 * the owner demo") and it opens a sample hotel's console and walks through it.
 * Without voice, the same tour plays on its own page.
 */
export function OwnerDemoPrompt({ className }: { className?: string }) {
  const dock = useVoiceDock();
  const voice = !!dock?.available;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-surface px-4 py-3 shadow-xs', className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-agent-soft text-agent-soft-foreground" aria-hidden>
        <AudioLines className="size-[18px]" />
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">See it for yourself.</span>{' '}
        <span className="text-muted-foreground">{voice ? 'Ask the voice guide “what is this?” or “give me the owner demo”.' : 'A guided tour of a sample hotel’s console.'}</span>
      </p>
      {voice ? (
        <Button type="button" variant="agent" size="sm" className="h-10" onClick={dock.start} onPointerEnter={dock.prepare} onTouchStart={dock.prepare} onFocus={dock.prepare}>
          <AudioLines aria-hidden /> Talk to the guide
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm" className="h-10">
          <Link href={TOUR_PATH}>
            Take the tour <ArrowRight aria-hidden />
          </Link>
        </Button>
      )}
    </div>
  );
}
