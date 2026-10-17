'use client';

import { Suspense, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { ArrowRight, CircleAlert, Eye, EyeOff, MapPinned, ReceiptText, RefreshCcw } from 'lucide-react';
import { api } from '@/lib/fetcher';
import { isDemoEmail } from '@/config/product';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { PublicDemoNote } from '@/components/guest/PublicDemoNote';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeCallback(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/admin')) return '/dashboard';
  return raw;
}

type FormState = { firstName: string; lastName: string; email: string; phone: string; password: string };
type Errors = Partial<Record<keyof FormState, string>>;
const ORDER: (keyof FormState)[] = ['firstName', 'lastName', 'email', 'phone', 'password'];

function validate(form: FormState): Errors {
  const e: Errors = {};
  if (!form.firstName.trim()) e.firstName = 'Enter your first name.';
  if (!form.lastName.trim()) e.lastName = 'Enter your last name.';
  if (!form.email.trim()) e.email = 'Enter your email address.';
  else if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter an email address like name@example.com.';
  else if (isDemoEmail(form.email)) e.email = 'That address belongs to the public demo — use your own email.';
  if (form.password.length < 8) e.password = 'Use at least 8 characters.';
  return e;
}

const inputClass = 'h-11 text-base md:text-sm';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callback = safeCallback(params.get('callbackUrl'));
  const [form, setForm] = useState<FormState>({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refs = useRef<Partial<Record<keyof FormState, HTMLInputElement | null>>>({});

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const found = validate(form);
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) {
      refs.current[first]?.focus();
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api('/api/auth/register', { method: 'POST', json: { ...form, email: form.email.trim() } });
      const res = await signIn('credentials', { email: form.email.trim(), password: form.password, redirect: false });
      if (!res || res.error) {
        router.push(`/login?callbackUrl=${encodeURIComponent(callback)}`);
        return;
      }
      router.replace(callback);
      router.refresh();
    } catch (err) {
      setError((err as Error).message || 'We couldn’t create your account. Please try again.');
      setLoading(false);
    }
  }

  const bind = (k: keyof FormState) => ({
    ref: (el: HTMLInputElement | null) => {
      refs.current[k] = el;
    },
    value: form[k],
    onChange: set(k),
    className: inputClass,
  });

  return (
    <>
      <h1 className="font-display text-3xl font-medium tracking-tight sm:text-[2rem]">Create your account</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Manage bookings, change dates and check in faster next time.</p>
      <PublicDemoNote className="mt-4" />

      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="r-first" error={errors.firstName}>
            <Input id="r-first" required autoComplete="given-name" {...bind('firstName')} />
          </Field>
          <Field label="Last name" htmlFor="r-last" error={errors.lastName}>
            <Input id="r-last" required autoComplete="family-name" {...bind('lastName')} />
          </Field>
        </div>
        <Field label="Email" htmlFor="r-email" error={errors.email}>
          <Input id="r-email" type="email" inputMode="email" required autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" {...bind('email')} />
        </Field>
        <Field label="Phone (optional)" htmlFor="r-phone" hint="Only used by the hotel about your stay.">
          <Input id="r-phone" type="tel" inputMode="tel" autoComplete="tel" {...bind('phone')} />
        </Field>
        <Field label="Password" htmlFor="r-pass" error={errors.password} hint="At least 8 characters.">
          <div className="relative">
            <Input id="r-pass" type={show ? 'text' : 'password'} required minLength={8} autoComplete="new-password" {...bind('password')} className={cn(inputClass, 'pr-12')} />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0.5 right-0.5 flex w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={show ? 'Hide password' : 'Show password'}
              aria-pressed={show}
              aria-controls="r-pass"
            >
              {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </Field>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft px-3.5 py-3 text-sm text-destructive-soft-foreground">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? 'Creating your account…' : 'Create account'}
          {!loading && <ArrowRight className="h-4 w-4" aria-hidden />}
        </Button>
        <p className="sr-only" role="status" aria-live="polite">
          {loading ? 'Creating your account…' : ''}
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href={`/login?callbackUrl=${encodeURIComponent(callback)}`} className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Running a hotel?{' '}
        <Link href="/onboarding" className="font-medium text-primary underline-offset-4 hover:underline">
          Set up your property instead
        </Link>
      </p>
    </>
  );
}

function RegisterAside() {
  return (
    <div className="max-w-md">
      <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-highlight">For travellers</p>
      <p className="mt-4 font-display text-4xl leading-[1.15] tracking-tight">Book direct with the hotel. Keep every stay in one place.</p>
      <p className="mt-4 text-base leading-relaxed text-inverse-foreground/75">One free account for every {PRODUCT_NAME} hotel you stay with.</p>
      <ul className="mt-10 grid gap-4 text-sm text-inverse-foreground/85">
        {[
          { icon: ReceiptText, text: 'Confirmations and receipts, always to hand' },
          { icon: RefreshCcw, text: 'Change dates or cancel without calling' },
          { icon: MapPinned, text: 'Directions and the hotel’s details before you arrive' },
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

function RegisterFallback() {
  return (
    <div aria-hidden className="space-y-5">
      <div className="skeleton h-9 w-56" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton mt-8 h-11 w-full" />
      <div className="skeleton h-11 w-full" />
      <div className="skeleton h-11 w-full" />
      <div className="skeleton h-12 w-full" />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <AuthLayout aside={<RegisterAside />}>
      <Suspense fallback={<RegisterFallback />}>
        <RegisterForm />
      </Suspense>
    </AuthLayout>
  );
}
