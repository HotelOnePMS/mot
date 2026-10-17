'use client';

import { Suspense, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import { ArrowRight, BedDouble, Building2, CalendarCheck2, ChartLine, CircleAlert, ConciergeBell, Eye, EyeOff, Loader2, Luggage, PhoneCall, type LucideIcon } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { canAccessConsolePath, homeForRole, isStaffRole } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL, demoEmail } from '@/config/product';

const DEMO_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'true' || (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEMO_MODE !== 'false');
const DEMO_PASSWORD = 'demo1234';

const DEMO_ACCOUNTS: { label: string; email: string; hint: string; icon: LucideIcon }[] = [
  { label: 'Owner', email: demoEmail('owner'), hint: 'Everything, incl. rates and team', icon: Building2 },
  { label: 'Manager', email: demoEmail('manager'), hint: 'Bookings, rates and reports', icon: ChartLine },
  { label: 'Front desk', email: demoEmail('frontdesk'), hint: 'Arrivals, check-in, the agent', icon: ConciergeBell },
  { label: 'Housekeeping', email: demoEmail('housekeeping'), hint: 'Room list on a phone', icon: BedDouble },
  { label: 'Guest', email: demoEmail('guest'), hint: 'Trips and the booking flow', icon: Luggage },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only same-site relative paths are accepted as a post-login destination. */
function safeCallback(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (raw.startsWith('/login') || raw.startsWith('/register')) return null;
  return raw;
}

function destinationFor(role: string | undefined, callback: string | null): string {
  if (callback) {
    const isConsole = callback.startsWith('/admin');
    if (!isConsole) return callback;
    if (isStaffRole(role) && (callback === '/admin' || canAccessConsolePath(role, callback))) return callback;
  }
  // Staff land on /admin, which opens their preferred surface (Classic or Agentic).
  return isStaffRole(role) ? '/admin' : homeForRole(role);
}

type FieldErrors = { email?: string; password?: string };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callback = safeCallback(params.get('callbackUrl'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // 'form' or a demo email
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const loading = pending !== null;

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter an email address like name@example.com.';
    if (!password) next.password = 'Enter your password.';
    setFieldErrors(next);
    if (next.email) emailRef.current?.focus();
    else if (next.password) passwordRef.current?.focus();
    return !next.email && !next.password;
  }

  async function login(creds: { email: string; password: string }, key: string) {
    setPending(key);
    setError('');
    const res = await signIn('credentials', { email: creds.email, password: creds.password, redirect: false });
    if (!res || res.error) {
      setError('That email and password don’t match an account. Check them and try again.');
      setPending(null);
      return;
    }
    const session = await getSession();
    router.replace(destinationFor(session?.user?.role, callback));
    router.refresh();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !validate()) return;
    void login({ email: email.trim(), password }, 'form');
  }

  return (
    <>
      <h1 className="font-display text-3xl font-medium tracking-tight sm:text-[2rem]">Welcome back</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Guests and hotel teams sign in here — we’ll take you to the right place.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate aria-describedby={error ? 'login-error' : undefined}>
        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <Input
            ref={emailRef}
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
            }}
            placeholder="you@example.com"
            className="h-11 text-base md:text-sm"
          />
        </Field>

        <div className="relative">
          <Field label="Password" htmlFor="password" error={fieldErrors.password}>
            <div className="relative">
              <Input
                ref={passwordRef}
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
                }}
                className="h-11 pr-12 text-base md:text-sm"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0.5 right-0.5 flex w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
                aria-controls="password"
              >
                {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </Field>
          {/* Outside the <label>, top-right of the field. */}
          <a
            href={`mailto:${PRODUCT_SUPPORT_EMAIL}?subject=${encodeURIComponent(`${PRODUCT_NAME} password reset`)}`}
            className="absolute right-0 top-0 rounded-sm text-xs font-medium leading-5 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Forgot password?
          </a>
        </div>

        {error && (
          <div
            id="login-error"
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft px-3.5 py-3 text-sm text-destructive-soft-foreground"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" loading={pending === 'form'} disabled={loading}>
          {pending === 'form' ? 'Signing in…' : 'Sign in'}
          {pending !== 'form' && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link href={`/register${callback ? `?callbackUrl=${encodeURIComponent(callback)}` : ''}`} className="font-medium text-primary underline-offset-4 hover:underline">
          Create a guest account
        </Link>{' '}
        or{' '}
        <Link href="/onboarding" className="font-medium text-primary underline-offset-4 hover:underline">
          set up your hotel
        </Link>
      </p>

      {DEMO_ENABLED && (
        <section className="mt-10 rounded-2xl border bg-surface-sunken p-4 sm:p-5" aria-labelledby="demo-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="demo-heading" className="text-sm font-semibold">
              Try the live demo
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
                    disabled={loading}
                    aria-busy={busy || undefined}
                    aria-label={`Sign in as the demo ${a.label.toLowerCase()}: ${a.hint}`}
                    onClick={() => login({ email: a.email, password: DEMO_PASSWORD }, a.email)}
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
        </section>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {loading ? 'Signing you in…' : ''}
      </p>
    </>
  );
}

function LoginAside() {
  return (
    <div className="max-w-md">
      <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-highlight">{PRODUCT_NAME}</p>
      <p className="mt-4 font-display text-4xl leading-[1.15] tracking-tight">Every booking direct. Every call answered.</p>
      <p className="mt-4 text-base leading-relaxed text-inverse-foreground/75">
        Guests manage their stays here. Hotel teams run the front desk, rates and the phone agent — from the same sign-in.
      </p>
      <ul className="mt-10 grid gap-4 text-sm text-inverse-foreground/85">
        {[
          { icon: CalendarCheck2, text: 'Bookings on your own website, with no commission' },
          { icon: PhoneCall, text: 'An AI front desk that picks up day and night' },
          { icon: ConciergeBell, text: 'Arrivals, rooms and rates in one console' },
        ].map((f) => (
          <li key={f.text} className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-inverse-foreground/10 text-highlight">
              <f.icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            {f.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoginFallback() {
  // Matches the form's footprint so nothing jumps when it mounts.
  return (
    <div aria-hidden className="space-y-5">
      <div className="skeleton h-9 w-48" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton mt-8 h-11 w-full" />
      <div className="skeleton h-11 w-full" />
      <div className="skeleton h-12 w-full" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout aside={<LoginAside />}>
      <Suspense fallback={<LoginFallback />}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
