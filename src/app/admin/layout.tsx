import type { Metadata } from 'next';
import { ConsoleProvider } from '@/components/console/ConsoleProvider';
import { ConsoleShell } from '@/components/console/ConsoleShell';

// Staff-only screens: titled "Console · HotelOne" unless a page sets its own, and never indexed.
export const metadata: Metadata = { title: 'Console', robots: { index: false, follow: false } };

/** One console for every staff role; navigation and pages adapt to the role. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleProvider>
  );
}
