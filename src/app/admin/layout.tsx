import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ConsoleProvider } from '@/components/console/ConsoleProvider';
import { ConsoleShell } from '@/components/console/ConsoleShell';
import { canAccessConsolePath, homeForRole, isStaffRole } from '@/lib/routes';
import { getActor } from '@/server/authz';

// Staff-only screens: titled "Console · HotelOne" unless a page sets its own, and never indexed.
export const metadata: Metadata = { title: 'Console', robots: { index: false, follow: false } };

/**
 * One console for every staff role; navigation and pages adapt to the role.
 *
 * The middleware only sees the role stored in the session cookie (it can't query the database),
 * so this is the authoritative page-level check: the account must still be active, its session
 * must not have been ended (role, password or status changed), and the role read from the
 * database right now decides which screens open.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? '/admin';
  const actor = await getActor();
  if (!actor) redirect(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
  if (!isStaffRole(actor.role)) redirect('/dashboard');
  if (actor.mustChangePassword) redirect('/account/password');
  if (pathname !== '/admin' && !canAccessConsolePath(actor.role, pathname)) redirect(homeForRole(actor.role));
  return (
    <ConsoleProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleProvider>
  );
}
