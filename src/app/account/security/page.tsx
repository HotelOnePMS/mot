'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Copy, KeyRound, LogOut, MailCheck, ShieldCheck, ShieldAlert } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { GuestShell } from '@/app/properties/_components/guest-shell';

interface Status {
  email: string;
  enabled: boolean;
  recoveryCodesLeft: number;
  required: boolean;
  hasPassword: boolean;
  emailVerified: boolean;
  sso: boolean;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t py-8 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[220px_1fr] md:gap-10">
      <div>
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Recovery codes copied');
    } catch {
      toast.error('Couldn’t copy. Select the codes and copy them yourself.');
    }
  }
  return (
    <div className="space-y-4">
      <Callout tone="warning">
        Save these recovery codes somewhere safe, like a password manager. Each one signs you in once if you lose your phone. You won’t see them again.
      </Callout>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border bg-surface-sunken p-4 font-mono text-sm sm:max-w-sm" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={copy}>
          <Copy aria-hidden /> Copy codes
        </Button>
        <Button onClick={onDone}>I’ve saved them — sign in again</Button>
      </div>
    </div>
  );
}

/** Password + current code, for turning two-step sign-in off or making new recovery codes. */
function ConfirmFactors({ hasPassword, busy, label, onSubmit }: { hasPassword: boolean; busy: boolean; label: string; onSubmit: (v: { password: string; code: string }) => void }) {
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const id = React.useId();
  return (
    <form
      className="mt-4 grid gap-3 rounded-xl border p-4 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ password, code });
      }}
    >
      {hasPassword && (
        <Field label="Current password" htmlFor={`${id}-pw`}>
          <Input id={`${id}-pw`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      <Field label="Code from your authenticator app" htmlFor={`${id}-code`}>
        <Input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button type="submit" loading={busy} className="justify-self-start">
        {label}
      </Button>
    </form>
  );
}

function SecurityPage() {
  const params = useSearchParams();
  const { data, error, mutate } = useSWR<Status>('/api/account/security', fetcher);
  const [setup, setSetup] = React.useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<'disable' | 'codes' | null>(null);
  const [pw, setPw] = React.useState({ current: '', next: '' });

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast.error((e as Error).message);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const signInAgain = () => void signOut({ callbackUrl: '/login' });

  if (error) {
    return (
      <Callout tone="danger">
        {(error as Error).message}{' '}
        <Link href="/login?callbackUrl=/account/security" className="underline">
          Sign in
        </Link>
      </Callout>
    );
  }
  if (!data) return <Skeleton className="h-64 w-full" />;

  const mustSetUp = (params.get('required') === '1' || data.required) && !data.enabled && !data.sso;

  return (
    <Card className="p-5 sm:p-8">
      {mustSetUp && (
        <Callout tone="warning" className="mb-6">
          Your organization requires two-step sign-in. Set it up below to keep using the console.
        </Callout>
      )}

      <Section title="Email" description="Where we send booking confirmations and password reset links.">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{data.email}</span>
          {data.emailVerified ? (
            <Badge variant="success" icon={MailCheck}>
              Verified
            </Badge>
          ) : (
            <>
              <Badge variant="warning">Not verified</Badge>
              <Button
                size="sm"
                variant="outline"
                loading={busy === 'verify'}
                onClick={() =>
                  run('verify', async () => {
                    const r = await api<{ message: string }>('/api/account/verify-email/resend', { method: 'POST' });
                    toast.success(r.message);
                  })
                }
              >
                Send verification link
              </Button>
            </>
          )}
        </div>
      </Section>

      <Section
        title="Two-step sign-in"
        description={data.sso ? 'You sign in through your organization’s identity provider, which handles two-step sign-in.' : 'A 6-digit code from an authenticator app, asked for after your password.'}
      >
        {codes ? (
          <RecoveryCodes codes={codes} onDone={signInAgain} />
        ) : data.enabled ? (
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="success" icon={ShieldCheck}>
                On
              </Badge>
              <span className="text-sm text-muted-foreground">
                {data.recoveryCodesLeft} recovery code{data.recoveryCodesLeft === 1 ? '' : 's'} left
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirming(confirming === 'codes' ? null : 'codes')}>
                <KeyRound aria-hidden /> New recovery codes
              </Button>
              {!data.required && (
                <Button variant="outline" size="sm" onClick={() => setConfirming(confirming === 'disable' ? null : 'disable')}>
                  Turn off
                </Button>
              )}
            </div>
            {confirming && (
              <ConfirmFactors
                hasPassword={data.hasPassword}
                busy={busy === confirming}
                label={confirming === 'disable' ? 'Turn off two-step sign-in' : 'Make new recovery codes'}
                onSubmit={(v) =>
                  run(confirming, async () => {
                    if (confirming === 'disable') {
                      await api('/api/account/mfa/disable', { method: 'POST', json: v });
                      toast.success('Two-step sign-in is off. Sign in again.');
                      signInAgain();
                    } else {
                      const r = await api<{ recoveryCodes: string[] }>('/api/account/mfa/recovery-codes', { method: 'POST', json: v });
                      setConfirming(null);
                      setCodes(r.recoveryCodes);
                      void mutate();
                    }
                  })
                }
              />
            )}
          </div>
        ) : data.sso ? (
          <p className="text-sm text-muted-foreground">Nothing to set up here.</p>
        ) : setup ? (
          <div className="space-y-4">
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Open an authenticator app: Google Authenticator, Microsoft Authenticator, 1Password or similar.</li>
              <li>Scan this code, or type the key below.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-wrap items-start gap-6">
              {/* Generated on our server from our own otpauth URI. */}
              <div className="size-44 rounded-xl border bg-white p-2 [&_svg]:size-full" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
              <div className="min-w-0 space-y-2 text-sm">
                <p className="text-muted-foreground">Key</p>
                <p className="break-all font-mono">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
              </div>
            </div>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run('confirm', async () => {
                  const r = await api<{ recoveryCodes: string[] }>('/api/account/mfa/confirm', { method: 'POST', json: { code } });
                  setCodes(r.recoveryCodes);
                });
              }}
            >
              <Field label="Code from the app" htmlFor="mfa-code" className="w-40">
                <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Button type="submit" loading={busy === 'confirm'} disabled={code.trim().length !== 6}>
                Turn on
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={mustSetUp ? 'warning' : 'neutral'} icon={ShieldAlert}>
              Off
            </Badge>
            <Button
              loading={busy === 'setup'}
              onClick={() =>
                run('setup', async () => {
                  setSetup(await api<{ secret: string; qrSvg: string }>('/api/account/mfa/setup', { method: 'POST' }));
                })
              }
            >
              Set up two-step sign-in
            </Button>
          </div>
        )}
      </Section>

      {data.hasPassword && (
        <Section title="Password" description="At least 10 characters. Changing it signs you out everywhere.">
          <form
            className="grid gap-3 sm:max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              void run('password', async () => {
                await api('/api/account/password', { method: 'POST', json: pw });
                toast.success('Password changed. Sign in with the new one.');
                void signOut({ callbackUrl: '/login?reset=1' });
              });
            }}
          >
            <Field label="Current password" htmlFor="sec-current">
              <Input id="sec-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="sec-new">
              <Input id="sec-new" type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Button type="submit" variant="outline" className="justify-self-start" loading={busy === 'password'} disabled={!pw.next}>
              Change password
            </Button>
          </form>
        </Section>
      )}

      <Section title="Sessions" description="Lost a device, or signed in on a shared computer?">
        <Button
          variant="outline"
          loading={busy === 'everywhere'}
          onClick={() =>
            run('everywhere', async () => {
              await api('/api/account/sign-out-everywhere', { method: 'POST' });
              void signOut({ callbackUrl: '/login' });
            })
          }
        >
          <LogOut aria-hidden /> Sign out everywhere
        </Button>
      </Section>
    </Card>
  );
}

export default function AccountSecurityPage() {
  return (
    <GuestShell>
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <h1 className="mb-6 font-display text-3xl font-medium tracking-tight">Account security</h1>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <SecurityPage />
        </Suspense>
      </div>
    </GuestShell>
  );
}
