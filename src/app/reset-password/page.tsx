'use client';

import { Suspense, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CircleAlert, CircleCheck, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/fetcher';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  if (done) {
    return (
      <div role="status" aria-live="polite">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-success-soft text-success-soft-foreground">
          <CircleCheck className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mt-5 font-display text-3xl font-medium tracking-tight sm:text-[2rem]">Password updated</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">You can sign in with your new password now.</p>
        <Button asChild size="lg" className="mt-8 w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  if (!token) {
    return (
      <>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-[2rem]">This link isn’t valid</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">The reset link is missing or incomplete. Request a new one and use the link from the latest email.</p>
        <Button asChild size="lg" className="mt-8 w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const found: typeof errors = {};
    if (password.length < 8) found.password = 'Use at least 8 characters.';
    else if (confirm !== password) found.confirm = 'The two passwords don’t match.';
    setErrors(found);
    if (found.password) return passwordRef.current?.focus();
    if (found.confirm) return confirmRef.current?.focus();
    setLoading(true);
    setError('');
    try {
      await api('/api/auth/reset-password', { method: 'POST', json: { token, password } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message || 'We couldn’t update your password. Please try again.');
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="font-display text-3xl font-medium tracking-tight sm:text-[2rem]">Choose a new password</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Pick something you don’t use anywhere else.</p>

      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="New password" htmlFor="rp-pass" error={errors.password} hint="At least 8 characters.">
          <div className="relative">
            <Input
              ref={passwordRef}
              id="rp-pass"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
              }}
              className={cn('h-11 pr-12 text-base md:text-sm')}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0.5 right-0.5 flex w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={show ? 'Hide password' : 'Show password'}
              aria-pressed={show}
              aria-controls="rp-pass rp-confirm"
            >
              {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </Field>
        <Field label="Confirm new password" htmlFor="rp-confirm" error={errors.confirm}>
          <Input
            ref={confirmRef}
            id="rp-confirm"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (errors.confirm) setErrors((x) => ({ ...x, confirm: undefined }));
            }}
            className="h-11 text-base md:text-sm"
          />
        </Field>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft px-3.5 py-3 text-sm text-destructive-soft-foreground">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              {error}{' '}
              <Link href="/forgot-password" className="font-medium underline underline-offset-4">
                Request a new link
              </Link>
            </p>
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? 'Saving…' : 'Update password'}
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<div aria-hidden className="skeleton h-40 w-full" />}>
        <ResetForm />
      </Suspense>
    </AuthLayout>
  );
}
