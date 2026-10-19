'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { api } from '@/lib/fetcher';

function Verify() {
  const params = useSearchParams();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api('/api/account/verify-email', { method: 'POST', json: { token: params.get('token') ?? '' } })
      .then(() => setState('done'))
      .catch((e: Error) => {
        setMessage(e.message);
        setState('failed');
      });
  }, [params]);

  if (state === 'working') {
    return (
      <p role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your link…
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div
        role={state === 'done' ? 'status' : 'alert'}
        className={
          state === 'done'
            ? 'flex items-start gap-3 rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm text-success-soft-foreground'
            : 'flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-foreground'
        }
      >
        {state === 'done' ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
        <p>{state === 'done' ? 'Your email address is verified. Thank you!' : message}</p>
      </div>
      <Link href={state === 'done' ? '/dashboard' : '/account/security'} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        {state === 'done' ? 'Go to your trips' : 'Send a new link'}
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthLayout>
      <h1 className="mb-6 font-display text-3xl font-medium tracking-tight">Verify your email</h1>
      <Suspense fallback={null}>
        <Verify />
      </Suspense>
    </AuthLayout>
  );
}
