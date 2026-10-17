'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { CalendarCheck2, KeyRound, RefreshCw, Search, UserRound } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { roleLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Avatar, Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { GuestShell } from '@/app/properties/_components/guest-shell';

interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  role: string;
  createdAt: string;
}

type Draft = Record<'firstName' | 'lastName' | 'phone' | 'address' | 'city' | 'state' | 'zipCode' | 'country', string>;

const toDraft = (p: Profile): Draft => ({
  firstName: p.firstName,
  lastName: p.lastName,
  phone: p.phone ?? '',
  address: p.address ?? '',
  city: p.city ?? '',
  state: p.state ?? '',
  zipCode: p.zipCode ?? '',
  country: p.country ?? '',
});

const memberSince = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

function Card({ id, icon: Icon, title, description, children, onSubmit }: { id: string; icon: typeof UserRound; title: string; description: string; children: React.ReactNode; onSubmit: (e: React.FormEvent) => void }) {
  return (
    <form onSubmit={onSubmit} aria-labelledby={id} className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <h2 id={id} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden /> {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </form>
  );
}

export default function ProfilePage() {
  const { data, error, mutate } = useSWR<Profile>('/api/profile', fetcher);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  // Set when "Save changes" is pressed with nothing changed (the button stays enabled: a
  // greyed-out main button reads as broken).
  const [nothingToSave, setNothingToSave] = React.useState(false);
  const [pw, setPw] = React.useState({ currentPassword: '', newPassword: '' });
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwError, setPwError] = React.useState('');

  React.useEffect(() => {
    if (data && !draft) setDraft(toDraft(data));
  }, [data, draft]);

  const dirty = !!(data && draft && JSON.stringify(draft) !== JSON.stringify(toDraft(data)));
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setNothingToSave(false);
    if (draft) setDraft({ ...draft, [k]: e.target.value });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!dirty) {
      setNothingToSave(true);
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const fresh = await api<Profile>('/api/profile', { method: 'PUT', json: draft });
      await mutate(fresh, { revalidate: false });
      setDraft(toDraft(fresh));
      toast.success('Profile saved');
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwError('');
    try {
      await api('/api/profile', { method: 'PUT', json: pw });
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Password changed');
    } catch (err) {
      setPwError((err as Error).message);
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <GuestShell>
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        {error && !data ? (
          <>
            <h1 className="sr-only">Your profile</h1>
            <div className="mx-auto max-w-xl rounded-2xl border bg-card">
              <EmptyState
                icon={RefreshCw}
                title="We couldn’t load your profile"
                description="Check your connection and try again."
                action={
                  <Button variant="outline" onClick={() => void mutate()}>
                    Try again
                  </Button>
                }
              />
            </div>
          </>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-12">
            {/* Who you are */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              {!data || !draft ? (
                <div className="space-y-3" role="status" aria-label="Loading your profile">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-4 w-56" />
                </div>
              ) : (
                <>
                  <Avatar name={`${data.firstName} ${data.lastName}`} size="lg" />
                  <h1 className="mt-4 break-words font-display text-3xl leading-tight tracking-tight">
                    {data.firstName} {data.lastName}
                  </h1>
                  <p className="mt-1 break-all text-sm text-muted-foreground">{data.email}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {data.role !== 'CUSTOMER' ? `${roleLabel(data.role)} · ` : ''}Member since {memberSince(data.createdAt)}
                  </p>
                </>
              )}
              <nav aria-label="Your account" className="mt-6 flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
                <Button asChild variant="outline" className="lg:justify-start">
                  <Link href="/dashboard">
                    <CalendarCheck2 aria-hidden /> My trips
                  </Link>
                </Button>
                <Button asChild variant="ghost" className="lg:justify-start">
                  <Link href="/properties">
                    <Search aria-hidden /> Find a stay
                  </Link>
                </Button>
              </nav>
            </aside>

            <div className="min-w-0 max-w-3xl space-y-6">
              {!data || !draft ? (
                <>
                  <Skeleton className="h-[34rem] rounded-2xl sm:h-[27rem]" />
                  <Skeleton className="h-64 rounded-2xl sm:h-56" />
                </>
              ) : (
                <>
                  <Card id="details-title" icon={UserRound} title="Your details" description="Hotels see these on your reservations." onSubmit={save}>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <Field label="First name" htmlFor="pf-first">
                        <Input id="pf-first" required value={draft.firstName} onChange={set('firstName')} autoComplete="given-name" />
                      </Field>
                      <Field label="Last name" htmlFor="pf-last">
                        <Input id="pf-last" required value={draft.lastName} onChange={set('lastName')} autoComplete="family-name" />
                      </Field>
                      <Field label="Phone" optional htmlFor="pf-phone">
                        <Input id="pf-phone" type="tel" inputMode="tel" value={draft.phone} onChange={set('phone')} autoComplete="tel" />
                      </Field>
                      <Field label="Email" htmlFor="pf-email" hint="To change it, contact the hotel or our support team.">
                        <Input id="pf-email" type="email" value={data.email} readOnly className="bg-muted text-muted-foreground" />
                      </Field>
                      <Field label="Street address" optional htmlFor="pf-addr" className="sm:col-span-2">
                        <Input id="pf-addr" value={draft.address} onChange={set('address')} autoComplete="street-address" />
                      </Field>
                      <Field label="City" optional htmlFor="pf-city">
                        <Input id="pf-city" value={draft.city} onChange={set('city')} autoComplete="address-level2" />
                      </Field>
                      <Field label="State or region" optional htmlFor="pf-state">
                        <Input id="pf-state" value={draft.state} onChange={set('state')} autoComplete="address-level1" />
                      </Field>
                      <Field label="Postal code" optional htmlFor="pf-zip">
                        <Input id="pf-zip" value={draft.zipCode} onChange={set('zipCode')} autoComplete="postal-code" />
                      </Field>
                      <Field label="Country" optional htmlFor="pf-country">
                        <Input id="pf-country" value={draft.country} onChange={set('country')} autoComplete="country-name" />
                      </Field>
                    </div>
                    {saveError && (
                      <Callout tone="danger" className="mt-5" role="alert">
                        {saveError}
                      </Callout>
                    )}
                    <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t pt-5">
                      <p className={cn('mr-auto text-sm', dirty ? 'font-medium text-foreground' : 'text-muted-foreground')} role="status">
                        {dirty ? 'You have unsaved changes' : nothingToSave ? 'Nothing to save yet — edit a field first.' : 'All changes saved'}
                      </p>
                      {dirty && (
                        <Button type="button" variant="ghost" onClick={() => setDraft(toDraft(data))}>
                          Discard
                        </Button>
                      )}
                      <Button type="submit" loading={saving} loadingText="Saving…">
                        Save changes
                      </Button>
                    </div>
                  </Card>

                  <Card id="password-title" icon={KeyRound} title="Password" description="Choose a password you don’t use anywhere else." onSubmit={changePassword}>
                    <input type="text" name="username" autoComplete="username" value={data.email} readOnly hidden />
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <Field label="Current password" htmlFor="pf-cur">
                        <Input
                          id="pf-cur"
                          type="password"
                          required
                          autoComplete="current-password"
                          value={pw.currentPassword}
                          onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                        />
                      </Field>
                      <Field label="New password" htmlFor="pf-new" hint="At least 8 characters.">
                        <Input id="pf-new" type="password" required minLength={8} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
                      </Field>
                    </div>
                    {pwError && (
                      <Callout tone="danger" className="mt-5" role="alert">
                        {pwError}
                      </Callout>
                    )}
                    <div className="mt-6 flex justify-end border-t pt-5">
                      <Button type="submit" variant="outline" loading={pwBusy} loadingText="Changing your password…">
                        Change password
                      </Button>
                    </div>
                  </Card>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </GuestShell>
  );
}
