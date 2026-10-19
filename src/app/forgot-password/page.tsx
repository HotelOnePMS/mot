'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CircleAlert, MailCheck } from 'lucide-react';
import { api } from '@/lib/fetcher';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const value = email.trim();
    if (!value) return fail('Enter your email address.');
    if (!EMAIL_RE.test(value)) return fail('Enter an email address like name@example.com.');
    setFieldError('');
    setError('');
    setLoading(true);
    try {
      await api('/api/auth/forgot-password', { method: 'POST', json: { email: value } });
      setSentTo(value);
    } catch (err) {
      setError((err as Error).message || 'We couldn’t send the link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function fail(message: string) {
    setFieldError(message);
    emailRef.current?.focus();
  }

  return (
    <AuthLayout>
      {sentTo ? (
        <div role="status" aria-live="polite">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <MailCheck className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-5 font-display text-3xl font-medium tracking-tight sm:text-[2rem]">Check your email</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, we’ve sent a link to choose a new password. It works once and expires in an hour. Nothing
            arrived? Check your spam folder, or try again in a few minutes.
          </p>
          <Button asChild variant="outline" size="lg" className="mt-8 w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <>
          <h1 className="font-display text-3xl font-medium tracking-tight sm:text-[2rem]">Forgot your password?</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Enter the email you signed up with and we’ll send you a link to choose a new one.</p>

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <Field label="Email" htmlFor="fp-email" error={fieldError}>
              <Input
                ref={emailRef}
                id="fp-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldError) setFieldError('');
                }}
                placeholder="you@example.com"
                className="h-11 text-base md:text-sm"
              />
            </Field>

            {error && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft px-3.5 py-3 text-sm text-destructive-soft-foreground">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>{error}</p>
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link href="/login" className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to sign in
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
