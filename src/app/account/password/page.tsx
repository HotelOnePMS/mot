'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { CircleAlert } from 'lucide-react';
import { api } from '@/lib/fetcher';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

/** First sign-in with a password someone else chose: replace it before using the console. */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setLoading(true);
    setError('');
    try {
      const res = await api<{ email: string }>('/api/auth/change-password', { method: 'POST', json: { currentPassword: current, password } });
      // Changing the password ends the old session; sign straight back in with the new one.
      const again = await signIn('credentials', { email: res.email, password, redirect: false });
      if (!again || again.error) {
        router.replace('/login');
        return;
      }
      router.replace('/admin');
      router.refresh();
    } catch (err) {
      setError((err as Error).message || 'We couldn’t update your password. Please try again.');
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="font-display text-3xl font-medium tracking-tight sm:text-[2rem]">Choose your own password</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Someone else set your temporary password. Replace it with one only you know.</p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="Temporary password" htmlFor="cp-current">
          <Input id="cp-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="h-11 text-base md:text-sm" />
        </Field>
        <Field label="New password" htmlFor="cp-new" hint="At least 8 characters.">
          <Input id="cp-new" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 text-base md:text-sm" />
        </Field>
        <Field label="Confirm new password" htmlFor="cp-confirm">
          <Input id="cp-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11 text-base md:text-sm" />
        </Field>
        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft px-3.5 py-3 text-sm text-destructive-soft-foreground">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? 'Saving…' : 'Save and continue'}
        </Button>
      </form>
    </AuthLayout>
  );
}
