import type { Metadata } from 'next';
import { LABELS } from '@/config/copy';
import { PRODUCT_NAME } from '@/config/product';
import { ConsoleProvider } from '@/components/console/ConsoleProvider';
import { ConsoleShell } from '@/components/console/ConsoleShell';

// Staff-only screens: titled "Hotel console · HotelOne" unless a page sets its own ("Team · HotelOne"),
// and never indexed. The template is repeated here because a plain title would drop the root one.
export const metadata: Metadata = {
  title: { default: LABELS.console, template: `%s · ${PRODUCT_NAME}` },
  robots: { index: false, follow: false },
};

/** One console for every staff role; navigation and pages adapt to the role. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleProvider>
  );
}
