'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CircleAlert } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/fetcher';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    setError('');
    try {
      await api('/api/account/password/reset', { method: 'POST', json: { token, password } });
      router.replace('/login?reset=1');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <p className="text-sm text-muted-foreground">
        This page needs the link from your email.{' '}
        <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
          Ask for a new link
        </Link>
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="New password" htmlFor="rp-new" hint="At least 10 characters. Every device signed in to your account will be signed out.">
        <Input id="rp-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
      </Field>
      <Field label="Repeat the new password" htmlFor="rp-confirm">
        <Input id="rp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" />
      </Field>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {error}{' '}
            {/expired|used/.test(error) && (
              <Link href="/forgot-password" className="font-medium underline underline-offset-4">
                Get a new link
              </Link>
            )}
          </span>
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Change password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <h1 className="mb-8 font-display text-3xl font-medium tracking-tight">Choose a new password</h1>
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </AuthLayout>
  );
}
