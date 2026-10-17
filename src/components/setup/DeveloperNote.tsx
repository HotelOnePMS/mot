import * as React from 'react';
import { ChevronDown, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Technical setup details (environment variables, server settings) kept out
 * of the owner's way: a collapsed, clearly labelled "For your developer"
 * note. Pass `open` for platform admins, who are usually the developer.
 */
export function DeveloperNote({
  children,
  open,
  title = 'For your developer',
  className,
}: {
  children: React.ReactNode;
  open?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <details className={cn('group rounded-lg border border-dashed border-border-strong/50 bg-surface/70 text-sm text-foreground', className)} open={open}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">{title}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-2 px-3 pb-3 leading-relaxed text-muted-foreground [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground">
        {children}
      </div>
    </details>
  );
}
