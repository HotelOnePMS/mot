'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';

/** Last step of single sign-on: trade the callback's one-time ticket for a session. */
function SsoFinish() {
  const params = useSearchParams();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ticket = params.get('ticket') ?? '';
    const raw = params.get('callbackUrl') ?? '/admin';
    const callbackUrl = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/admin';
    void signIn('sso', { ticket, redirect: false }).then((res) => {
      if (!res || res.error) {
        setFailed(true);
        return;
      }
      router.replace(callbackUrl);
      router.refresh();
    });
  }, [params, router]);

  if (failed) {
    return (
      <div role="alert" className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft px-3.5 py-3 text-sm text-destructive-soft-foreground">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>That sign-in link has expired or was already used.</p>
        </div>
        <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing you in…
    </p>
  );
}

export default function SsoPage() {
  return (
    <AuthLayout>
      <h1 className="mb-6 font-display text-3xl font-medium tracking-tight">Single sign-on</h1>
      <Suspense fallback={null}>
        <SsoFinish />
      </Suspense>
    </AuthLayout>
  );
}
