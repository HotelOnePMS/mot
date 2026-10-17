'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useConsole } from '@/components/console/ConsoleProvider';

/** /admin → the right home for this person's role and chosen mode. */
export default function ConsoleHome() {
  const { ctx, property, preferredMode, homeHref } = useConsole();
  const router = useRouter();
  useEffect(() => {
    if (!ctx || !property) return;
    router.replace(property?.setupPath === 'FULL' && preferredMode === 'AGENTIC' ? '/admin/agent' : homeHref);
  }, [ctx, property, preferredMode, homeHref, router]);
  return (
    <p className="sr-only" role="status">
      Opening your console…
    </p>
  );
}
