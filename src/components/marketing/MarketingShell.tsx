import Navigation from '@/components/Navigation';
import { SiteFooter } from '@/components/guest/SiteFooter';
import { cn } from '@/lib/utils';

/**
 * Page chrome for the product site (for hotels): the marketing header,
 * <main id="main"> (the skip link's target) and the platform footer. Product
 * pages use this instead of picking a header and footer themselves.
 */
export function MarketingShell({ children, className, mainClassName }: { children: React.ReactNode; className?: string; mainClassName?: string }) {
  return (
    <div className={cn('flex min-h-dvh flex-col bg-background', className)}>
      <Navigation variant="marketing" />
      <main id="main" className={cn('flex-1', mainClassName)}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
