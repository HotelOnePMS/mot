import * as React from 'react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/primitives';

/**
 * The one page frame for console screens: the same left edge, padding and
 * vertical rhythm everywhere, so the title never jumps sideways between pages.
 *
 * - size="wide" (default): boards, calendars, tables — up to 80rem.
 * - size="narrow": forms, settings, detail pages — the content stops at 56rem
 *   but starts at the same left edge as a wide page.
 *
 * Pass `title` to render the page's single <h1> (with optional eyebrow,
 * description and an actions slot); leave it out when the page draws its own
 * header.
 */
export function PageShell({
  title,
  description,
  eyebrow,
  actions,
  size = 'wide',
  className,
  headerClassName,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'wide' | 'narrow';
  className?: string;
  headerClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <div className={cn('space-y-6', size === 'narrow' && 'max-w-4xl', className)}>
        {title !== undefined && (
          <PageHeader title={title} description={description} eyebrow={eyebrow} actions={actions} className={headerClassName} />
        )}
        {children}
      </div>
    </div>
  );
}

/** A section heading inside a page or card (h2), with an optional action on the right. */
export function SectionHeader({
  title,
  description,
  action,
  id,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
  className?: string;
}) {
  // The action stays top-right at every width (a long description wraps beside it instead of pushing it below).
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-base font-semibold leading-6 tracking-tight">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="-mt-1.5 flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
