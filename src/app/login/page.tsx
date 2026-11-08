'use client';

import { Suspense, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSession, signIn, signOut, useSession } from 'next-auth/react';
import { ArrowRight, CalendarCheck2, CircleAlert, CircleCheck, ConciergeBell, Eye, EyeOff, KeyRound, LogOut, Luggage, UserRound } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { DEMO_ENABLED } from '@/config/demo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout } from '@/components/ui/primitives';
import { destinationFor, isConsolePath, isTravellerPath, safeCallback } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { LABELS, TERMS } from '@/config/copy';
import { PRODUCT_NAME } from '@/config/product';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const textLink = 'rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Who is signing in, from where they'll go next. One page; only the words change. */
type Audience = 'console' | 'traveller' | 'everyone';

function audienceFor(callback: string | null): Audience {
  if (!callback) return 'everyone';
  if (isConsolePath(callback.split(/[?#]/)[0])) return 'console';
  return isTravellerPath(callback) ? 'traveller' : 'everyone';
}

const HEADINGS: Record<Audience, { title: string; subtitle: string }> = {
  console: { title: 'Sign in to your hotel console', subtitle: 'For hotel owners and their teams.' },
  traveller: { title: 'Sign in to manage your trips', subtitle: 'Your bookings, receipts and directions in one place.' },
  // Not "Welcome back": first-time staff, invited by their owner, land here too.
  everyone: { title: 'Sign in', subtitle: 'Guests and hotel teams use the same sign-in. We’ll take you to the right place.' },
};

type FieldErrors = { email?: string; password?: string; otp?: string };

/** What the sign-in error codes from src/server/auth/signin.ts mean for the person. */
const SIGN_IN_ERRORS: Record<string, string> = {
  rate_limited: 'Too many attempts. Wait 15 minutes, or reset your password.',
  mfa_invalid: 'That code didn’t work. Enter the 6-digit code your authenticator app shows now, or one of your recovery codes.',
  sso_required: 'Your organization signs in with single sign-on. Continue with SSO below.',
};

/** Messages carried back to this page in the URL (SSO, Google, password reset). */
function notice(params: URLSearchParams): { tone: 'error' | 'success'; text: string } | null {
  const error = params.get('error');
  if (error === 'SSO') return { tone: 'error', text: params.get('message')?.slice(0, 300) || 'Single sign-on didn’t work. Please try again.' };
  if (error === 'GoogleStaff') return { tone: 'error', text: 'Hotel staff sign in with their password and two-step code, or with their organization’s single sign-on.' };
  if (error) return { tone: 'error', text: 'Sign-in didn’t work. Please try again.' };
  if (params.get('reset') === '1') return { tone: 'success', text: 'Your password is changed and you’ve been signed out everywhere. Sign in with the new one.' };
  if (params.get('verified') === '1') return { tone: 'success', text: 'Your email address is verified.' };
  return null;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session, status } = useSession();
  const callback = safeCallback(params.get('callbackUrl'));
  const audience = audienceFor(callback);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState<'form' | 'sso' | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Two-step sign-in: after the password is accepted, ask for the authenticator code.
  const [otp, setOtp] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [ssoSuggested, setSsoSuggested] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Already signed in: offer the way on, never redirect on our own (deactivated staff would loop, and nobody could switch accounts).
  const signedInAs = status === 'authenticated' && session?.user ? session.user : null;
  const onboarded = !signedInAs && params.get('onboarded') === '1';
  const signedOut = !signedInAs && !onboarded && (params.get('signedOut') === '1' || switched);
  const registerHref = `/register${callback ? `?callbackUrl=${encodeURIComponent(callback)}` : ''}`;
  const otpRef = useRef<HTMLInputElement>(null);
  const loading = pending !== null;
  const urlNotice = notice(params);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter an email address like name@example.com.';
    if (!password) next.password = 'Enter your password.';
    if (needsCode && !otp.trim()) next.otp = 'Enter the code from your authenticator app.';
    setFieldErrors(next);
    if (next.email) emailRef.current?.focus();
    else if (next.password) passwordRef.current?.focus();
    else if (next.otp) otpRef.current?.focus();
    return !next.email && !next.password && !next.otp;
  }

  async function login(creds: { email: string; password: string; otp?: string }, key: 'form') {
    setPending(key);
    setError('');
    const res = await signIn('credentials', { email: creds.email, password: creds.password, otp: creds.otp ?? '', redirect: false });
    if (!res || res.error) {
      const code = (res as { code?: string } | undefined)?.code;
      if (code === 'mfa_required') {
        setNeedsCode(true);
        setPending(null);
        setTimeout(() => otpRef.current?.focus(), 0);
        return;
      }
      if (code === 'sso_required') setSsoSuggested(true);
      setError((code && SIGN_IN_ERRORS[code]) || 'That email and password don’t match an account. Check them and try again.');
      setPending(null);
      return;
    }
    const next = await getSession();
    router.replace(destinationFor(next?.user?.role, callback));
    router.refresh();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !validate()) return;
    void login({ email: email.trim(), password, otp: needsCode ? otp.trim() : undefined }, 'form');
  }

  async function switchAccount() {
    setSwitching(true);
    try {
      await signOut({ redirect: false });
      setSwitched(true);
      // The card (and the focused button) goes away, so put focus on the form.
      requestAnimationFrame(() => emailRef.current?.focus());
    } finally {
      setSwitching(false);
    }
  }

  function startSso() {
    if (!EMAIL_RE.test(email.trim())) {
      setFieldErrors({ email: 'Enter your work email address, then continue with SSO.' });
      emailRef.current?.focus();
      return;
    }
    setPending('sso');
    const q = new URLSearchParams({ email: email.trim(), ...(callback ? { callbackUrl: callback } : {}) });
    window.location.assign(`/api/sso/start?${q}`);
  }

  return (
    <>
      <h1 className="font-display text-3xl font-medium tracking-tight sm:text-[2rem]">{HEADINGS[audience].title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{HEADINGS[audience].subtitle}</p>

      {onboarded && (
        <Callout tone="info" role="status" className="mt-6">
          Your hotel is ready. Sign in to open your console.
        </Callout>
      )}
      {signedOut && (
        <Callout tone="neutral" icon={LogOut} role="status" className="mt-6">
          You’re signed out.
        </Callout>
      )}

      {signedInAs && (
        <div className="mt-6 rounded-2xl border bg-surface-sunken p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
              <UserRound className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <p className="min-w-0 break-words text-sm">
              You’re signed in as <span className="font-medium">{signedInAs.name || signedInAs.email}</span>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button asChild className="min-w-[8rem] flex-1">
              <Link href={destinationFor(signedInAs.role, callback)}>
                Continue <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button type="button" variant="ghost" loading={switching} onClick={switchAccount}>
              Use a different account
            </Button>
          </div>
        </div>
      )}

      {urlNotice && (
        <div
          role={urlNotice.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'mt-6 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm',
            urlNotice.tone === 'error' ? 'border-destructive/25 bg-destructive-soft text-destructive-soft-foreground' : 'border-success/25 bg-success-soft text-success-soft-foreground'
          )}
        >
          {urlNotice.tone === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <p>{urlNotice.text}</p>
        </div>
      )}

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
          <Link
            href={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}
            className="absolute right-0 top-0 rounded-sm text-xs font-medium leading-5 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Forgot password?
          </Link>
        </div>

        {needsCode && (
          <Field label="Authenticator code" htmlFor="otp" error={fieldErrors.otp} hint="Open your authenticator app, or use one of your recovery codes.">
            <Input
              ref={otpRef}
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={12}
              value={otp}
              onChange={(e) => {
                setOtp(e.target.value);
                if (fieldErrors.otp) setFieldErrors((f) => ({ ...f, otp: undefined }));
              }}
              placeholder="123 456"
              className="h-11 text-base tracking-widest md:text-sm"
            />
          </Field>
        )}

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

        {/* While signed in, Continue is the main action; this one switches accounts. */}
        <Button type="submit" size="lg" variant={signedInAs ? 'outline' : 'default'} className="w-full" loading={pending === 'form'} disabled={loading}>
          {pending === 'form' ? 'Signing in…' : needsCode ? 'Verify and sign in' : LABELS.signIn}
          {pending !== 'form' && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>

        <Button type="button" variant={ssoSuggested ? 'default' : 'outline'} size="lg" className="w-full" loading={pending === 'sso'} disabled={loading} onClick={startSso}>
          <KeyRound className="h-4 w-4" aria-hidden />
          Continue with single sign-on
        </Button>
      </form>

      <div className="mt-6 space-y-1.5 text-center text-sm text-muted-foreground">
        {audience === 'console' && (
          <>
            <p>
              New to {PRODUCT_NAME}?{' '}
              <Link href="/onboarding" className={textLink}>
                {LABELS.hotelSignup}
              </Link>
            </p>
            <p>Joining a team? Ask your hotel’s owner to add you.</p>
          </>
        )}
        {audience === 'traveller' && (
          <p>
            New here?{' '}
            <Link href={registerHref} className={textLink}>
              {LABELS.travellerSignup}
            </Link>
          </p>
        )}
        {audience === 'everyone' && (
          <>
            <p>
              Booking a stay?{' '}
              <Link href={registerHref} className={textLink}>
                {LABELS.travellerSignup}
              </Link>
            </p>
            <p>
              Running a hotel?{' '}
              <Link href="/onboarding" className={textLink}>
                {LABELS.hotelSignup}
              </Link>
            </p>
          </>
        )}
      </div>

      {DEMO_ENABLED && !callback && (
        <p className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">
          Exploring {PRODUCT_NAME}?{' '}
          <Link href="/demo" className={textLink}>
            Try the live demo <ArrowRight className="inline h-3.5 w-3.5 align-[-0.125em]" aria-hidden />
          </Link>
        </p>
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
        Travellers manage their stays here. Hotel teams run the front desk, rates and the {TERMS.agent}, from the same sign-in.
      </p>
      <ul className="mt-10 grid gap-4 text-sm text-inverse-foreground/85">
        {[
          { icon: Luggage, text: 'Travellers: every trip, receipt and direction in one place' },
          { icon: ConciergeBell, text: `Hotel teams: arrivals, rooms, rates and the ${TERMS.agent}` },
          { icon: CalendarCheck2, text: 'Every booking direct with the hotel, with no commission' },
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
