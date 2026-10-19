import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LABELS } from '@/config/copy';
import { PRODUCT_NAME } from '@/config/product';

const bannerLink =
  'inline-flex min-h-8 items-center gap-1 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Slim bar above a demo hotel's booking site, so someone exploring the
 * product knows what they're looking at and has a way back.
 */
export function DemoBanner({ className }: { className?: string }) {
  return (
    <div role="note" className={cn('border-b bg-inverse text-inverse-foreground', className)}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-xs sm:px-6 sm:text-sm">
        <p>
          <span className="font-semibold">Demo hotel</span>
          <span className="text-inverse-foreground/75"> — this is the booking site your guests see.</span>
        </p>
        <p className="flex items-center gap-4">
          <Link href="/demo" className={bannerLink}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {PRODUCT_NAME} {LABELS.demo.toLowerCase()}
          </Link>
          <Link href="/onboarding" className={cn(bannerLink, 'text-highlight')}>
            {LABELS.hotelSignup}
          </Link>
        </p>
      </div>
    </div>
  );
}
