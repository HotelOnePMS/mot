'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import { BedDouble, Building2, ChartLine, CircleAlert, ConciergeBell, Loader2, Luggage, type LucideIcon } from 'lucide-react';
import { destinationFor } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { demoEmail } from '@/config/product';
import { DEMO_ENABLED, DEMO_PASSWORD } from '@/config/demo';

const DEMO_ACCOUNTS: { label: string; email: string; hint: string; icon: LucideIcon }[] = [
  { label: 'Owner', email: demoEmail('owner'), hint: 'Everything, incl. rates and team', icon: Building2 },
  { label: 'Manager', email: demoEmail('manager'), hint: 'Bookings, rates and reports', icon: ChartLine },
  { label: 'Front desk', email: demoEmail('frontdesk'), hint: 'Arrivals, check-in, the agent', icon: ConciergeBell },
  { label: 'Housekeeping', email: demoEmail('housekeeping'), hint: 'Room list on a phone', icon: BedDouble },
  { label: 'Guest', email: demoEmail('guest'), hint: 'Trips and the booking flow', icon: Luggage },
];

/** The role picker for the shared demo accounts. Renders nothing when demo mode is off. */
export function DemoLogins({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!DEMO_ENABLED) return null;

  async function login(email: string) {
    setPending(email);
    setError('');
    const res = await signIn('credentials', { email, password: DEMO_PASSWORD, redirect: false });
    if (!res || res.error) {
      setError('The demo login didn’t work just now. Try again in a moment.');
      setPending(null);
      return;
    }
    const session = await getSession();
    router.replace(destinationFor(session?.user?.role, null));
    router.refresh();
  }

  return (
    <section className={cn('rounded-2xl border bg-surface-sunken p-4 sm:p-5', className)} aria-labelledby="demo-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="demo-heading" className="text-sm font-semibold">
          Sign in to the demo
        </h2>
        <span className="text-xs text-muted-foreground">One click, no typing</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Pick a role to explore. Every demo login uses the password <span className="font-mono text-foreground">{DEMO_PASSWORD}</span>.
      </p>
      <ul className="mt-4 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        {DEMO_ACCOUNTS.map((a) => {
          const busy = pending === a.email;
          const Icon = busy ? Loader2 : a.icon;
          return (
            <li key={a.email} className={cn(a.label === 'Guest' && 'min-[400px]:col-span-2')}>
              <button
                type="button"
                disabled={pending !== null}
                aria-busy={busy || undefined}
                aria-label={`Sign in as the demo ${a.label.toLowerCase()}: ${a.hint}`}
                onClick={() => login(a.email)}
                className="group flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-primary/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken disabled:pointer-events-none disabled:opacity-60 motion-reduce:hover:translate-y-0"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                  <Icon className={cn('h-[18px] w-[18px]', busy && 'animate-spin')} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{a.label}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{a.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {pending ? 'Signing you in…' : ''}
      </p>
    </section>
  );
}
