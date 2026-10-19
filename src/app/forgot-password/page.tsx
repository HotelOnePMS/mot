'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CircleAlert, MailCheck } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/fetcher';

function ForgotForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter the email address you sign in with.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/api/account/password/forgot', { method: 'POST', json: { email: email.trim() } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm text-success-soft-foreground">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            If <strong>{email.trim()}</strong> has an account with a password, a reset link is on its way. It works once, for the next hour. Check your spam folder if it
            doesn’t arrive in a few minutes.
          </p>
        </div>
        <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Email" htmlFor="fp-email">
        <Input id="fp-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
      </Field>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Email me a reset link
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Hotel team using single sign-on? Your password is managed by your organization.{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <h1 className="font-display text-3xl font-medium tracking-tight">Forgot your password?</h1>
      <p className="mb-8 mt-2 text-sm text-muted-foreground">Enter your email and we’ll send you a link to choose a new one.</p>
      <Suspense fallback={null}>
        <ForgotForm />
      </Suspense>
    </AuthLayout>
  );
}
