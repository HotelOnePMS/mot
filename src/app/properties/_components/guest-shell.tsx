'use client';

import * as React from 'react';
import Navigation from '@/components/Navigation';
import { SiteFooter } from '@/components/guest/SiteFooter';
import { brandScope } from '@/components/guest/brand';
import { cn } from '@/lib/utils';

/**
 * Page chrome for the guest journey: header, <main id="main"> (the skip
 * link's target) and the slim traveller footer, all re-skinned with the
 * hotel's colour when there is one.
 */
export function GuestShell({
  brandColor,
  brand,
  children,
  className,
  mainClassName,
  footer = true,
  after,
}: {
  /** The hotel's colour (hex); the platform colours are used without one. */
  brandColor?: string | null;
  /** White-label header: the hotel's name instead of the platform logo. */
  brand?: { name: string; href: string };
  children: React.ReactNode;
  className?: string;
  mainClassName?: string;
  footer?: boolean;
  /** Rendered after the footer (fixed bars, floating widgets). */
  after?: React.ReactNode;
}) {
  const scope = brandScope(brandColor);
  return (
    <div style={scope.style} className={cn('flex min-h-dvh flex-col bg-background', scope.className, className)}>
      <Navigation variant="guest" brand={brand} />
      <main id="main" className={cn('flex-1', mainClassName)}>
        {children}
      </main>
      {footer && <SiteFooter variant="guest" />}
      {after}
    </div>
  );
}
