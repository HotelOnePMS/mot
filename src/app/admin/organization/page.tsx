'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Building2, KeyRound, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { roleLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, inputBase } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { CopyButton } from '@/components/setup/CopyButton';
import { useConsole } from '@/components/console/ConsoleProvider';

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  hotels: number;
  members: number;
}

interface Org {
  id: string;
  name: string;
  slug: string;
  billingEmail: string | null;
  requireMfa: boolean;
  defaultRole: 'OWNER' | 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPER';
  hotels: { id: string; name: string; city: string; state: string }[];
  members: { userId: string; name: string; email: string; role: string; orgRole: 'ADMIN' | 'MEMBER'; mfaEnabled: boolean; isActive: boolean; sso: boolean }[];
  sso: { enabled: boolean; enforced: boolean; issuer: string | null; clientId: string | null; hasSecret: boolean; domains: string[] };
  scim: { enabled: boolean; tokenPrefix: string | null };
  addableHotels: { id: string; name: string }[];
}

function Section({ title, description, icon: Icon, children }: { title: string; description?: string; icon: typeof Building2; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t py-8 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[240px_1fr] md:gap-10">
      <div>
        <h2 id={id} className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Start a hotel group from hotels you run. */
function CreateOrganization({ onCreated }: { onCreated: (id: string) => void }) {
  const { ctx } = useConsole();
  const [name, setName] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const hotels = (ctx?.properties ?? []).filter((p) => !p.organization);
  return (
    <Card className="max-w-2xl p-5 sm:p-8">
      <h2 className="text-lg font-semibold">Start an organization</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Group your hotels so administrators see all of them, and set one sign-in policy for your team: two-step sign-in, single sign-on and SCIM provisioning.
      </p>
      <form
        className="mt-6 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await api<{ id: string }>('/api/admin/organizations', { method: 'POST', json: { name, propertyIds: picked } });
            toast.success(`${name} created`);
            onCreated(r.id);
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Organization name" htmlFor="org-name">
          <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Harbor Hotels Group" />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">Hotels</legend>
          {hotels.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">All your hotels already belong to an organization.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {hotels.map((h) => (
                <li key={h.id}>
                  <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary))]"
                      checked={picked.includes(h.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, h.id] : picked.filter((x) => x !== h.id))}
                    />
                    {h.name} <span className="text-muted-foreground">· {h.city}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <Button type="submit" loading={busy} disabled={name.trim().length < 2}>
          Create organization
        </Button>
      </form>
    </Card>
  );
}

function OrganizationDetail({ id }: { id: string }) {
  const { ctx, refresh } = useConsole();
  const { data: org, error, mutate } = useSWR<Org>(`/api/admin/organizations/${id}`, fetcher);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [memberEmail, setMemberEmail] = React.useState('');
  const [sso, setSso] = React.useState<{ enabled: boolean; enforced: boolean; issuer: string; clientId: string; clientSecret: string; domains: string } | null>(null);
  const [scimToken, setScimToken] = React.useState<string | null>(null);
  const [origin, setOrigin] = React.useState('');
  React.useEffect(() => setOrigin(window.location.origin), []);
  React.useEffect(() => {
    if (org) setSso({ enabled: org.sso.enabled, enforced: org.sso.enforced, issuer: org.sso.issuer ?? '', clientId: org.sso.clientId ?? '', clientSecret: '', domains: org.sso.domains.join(', ') });
  }, [org]);

  async function run(key: string, fn: () => Promise<Org | void>, success?: string) {
    setBusy(key);
    try {
      const next = await fn();
      if (next) await mutate(next, { revalidate: false });
      if (success) toast.success(success);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Callout tone="danger">{(error as Error).message}</Callout>;
  if (!org || !sso) return <Skeleton className="h-96 w-full" />;
  const url = `/api/admin/organizations/${org.id}`;
  const admins = org.members.filter((m) => m.orgRole === 'ADMIN').length;

  return (
    <Card className="p-5 sm:p-8">
      <Section title="Hotels" icon={Building2} description="Organization administrators see and manage every hotel here.">
        <ul className="divide-y rounded-xl border">
          {org.hotels.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{h.name}</span> <span className="text-muted-foreground">· {h.city}, {h.state}</span>
              </span>
              <IconButton
                label={`Remove ${h.name} from ${org.name}`}
                variant="ghost"
                size="icon-sm"
                onClick={() => run('hotels', () => api<Org>(`${url}/hotels`, { method: 'PUT', json: { propertyIds: org.hotels.filter((x) => x.id !== h.id).map((x) => x.id) } }), `${h.name} removed`)}
              >
                <Trash2 aria-hidden />
              </IconButton>
            </li>
          ))}
          {org.hotels.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No hotels yet.</li>}
        </ul>
        {org.addableHotels.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              id="add-hotel"
              aria-label="Add a hotel"
              className={cn(inputBase, 'h-9 w-auto py-1.5')}
              defaultValue=""
              onChange={(e) => {
                const pid = e.target.value;
                if (!pid) return;
                e.target.value = '';
                void run('hotels', () => api<Org>(`${url}/hotels`, { method: 'PUT', json: { propertyIds: [...org.hotels.map((x) => x.id), pid] } }), 'Hotel added');
              }}
            >
              <option value="">Add a hotel…</option>
              {org.addableHotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </Section>

      <Section title="People" icon={Users} description="Administrators manage this organization and every hotel in it. Members follow its sign-in policy.">
        <ul className="divide-y rounded-xl border">
          {org.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{m.name}</span> <span className="text-muted-foreground">· {m.email} · {roleLabel(m.role)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {m.sso ? <Badge variant="info">SSO</Badge> : m.mfaEnabled ? <Badge variant="success">Two-step on</Badge> : <Badge variant={org.requireMfa ? 'warning' : 'neutral'}>Two-step off</Badge>}
                {!m.isActive && <Badge variant="neutral">Turned off</Badge>}
                <select
                  aria-label={`${m.name}’s organization role`}
                  className={cn(inputBase, 'h-8 w-auto py-1 text-sm')}
                  value={m.orgRole}
                  onChange={(e) => run('member', () => api<Org>(`${url}/members`, { method: 'POST', json: { email: m.email, role: e.target.value } }), 'Role updated')}
                >
                  <option value="ADMIN">Administrator</option>
                  <option value="MEMBER">Member</option>
                </select>
                <IconButton
                  label={`Remove ${m.name} from ${org.name}`}
                  variant="ghost"
                  size="icon-sm"
                  disabled={m.orgRole === 'ADMIN' && admins <= 1 && ctx?.user.role !== 'ADMIN'}
                  onClick={() => run('member', () => api<Org>(`${url}/members?userId=${encodeURIComponent(m.userId)}`, { method: 'DELETE' }), `${m.name} removed`)}
                >
                  <Trash2 aria-hidden />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run('member', async () => {
              const next = await api<Org>(`${url}/members`, { method: 'POST', json: { email: memberEmail, role: 'MEMBER' } });
              setMemberEmail('');
              return next;
            }, 'Added');
          }}
        >
          <Field label="Add a team member by email" htmlFor="member-email" className="min-w-0 flex-1 sm:max-w-sm">
            <Input id="member-email" type="email" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="name@yourhotel.com" />
          </Field>
          <Button type="submit" variant="outline" loading={busy === 'member'} disabled={!memberEmail.trim()}>
            Add
          </Button>
        </form>
      </Section>

      <Section title="Sign-in policy" icon={ShieldCheck} description="Applies to staff who sign in with a password. SSO sign-ins use your identity provider’s own checks.">
        <div className="space-y-4">
          <label className="flex items-start gap-3">
            <Switch
              checked={org.requireMfa}
              onCheckedChange={(v) => run('mfa', () => api<Org>(url, { method: 'PATCH', json: { requireMfa: v } }), v ? 'Two-step sign-in is now required' : 'Two-step sign-in is optional')}
              aria-label="Require two-step sign-in"
            />
            <span className="text-sm">
              <span className="font-medium">Require two-step sign-in</span>
              <span className="block text-muted-foreground">Staff without it are asked to set it up before they can use the console.</span>
            </span>
          </label>
          <Field label="Role for people added by SSO or SCIM" htmlFor="default-role" className="sm:max-w-xs">
            <select
              id="default-role"
              className={cn(inputBase, 'h-10 py-2')}
              value={org.defaultRole}
              onChange={(e) => run('role', () => api<Org>(url, { method: 'PATCH', json: { defaultRole: e.target.value } }), 'Default role saved')}
            >
              {(['FRONT_DESK', 'HOUSEKEEPER', 'MANAGER', 'OWNER'] as const).map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Single sign-on" icon={KeyRound} description="OpenID Connect: Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak. SAML-only providers can connect through a broker that speaks OIDC.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              'sso',
              () =>
                api<Org>(`${url}/sso`, {
                  method: 'PUT',
                  json: {
                    enabled: sso.enabled,
                    enforced: sso.enforced,
                    issuer: sso.issuer || null,
                    clientId: sso.clientId || null,
                    ...(sso.clientSecret ? { clientSecret: sso.clientSecret } : {}),
                    domains: sso.domains.split(/[\s,]+/).filter(Boolean),
                  },
                }),
              'Single sign-on saved',
            );
          }}
        >
          <Callout tone="info">
            In your identity provider, create an OpenID Connect web app with the redirect URI <code className="break-all font-mono text-xs">{origin}/api/sso/callback</code> and the scopes openid, email and profile.
          </Callout>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Issuer URL" htmlFor="sso-issuer" hint="For example https://yourcompany.okta.com">
              <Input id="sso-issuer" value={sso.issuer} onChange={(e) => setSso({ ...sso, issuer: e.target.value })} />
            </Field>
            <Field label="Email domains" htmlFor="sso-domains" hint="Separate with commas: hotelgroup.com, hotelgroup.co.uk">
              <Input id="sso-domains" value={sso.domains} onChange={(e) => setSso({ ...sso, domains: e.target.value })} />
            </Field>
            <Field label="Client ID" htmlFor="sso-client">
              <Input id="sso-client" value={sso.clientId} onChange={(e) => setSso({ ...sso, clientId: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Client secret" htmlFor="sso-secret" hint={org.sso.hasSecret ? 'Saved. Leave empty to keep it.' : 'Stored encrypted; never shown again.'}>
              <Input id="sso-secret" type="password" value={sso.clientSecret} onChange={(e) => setSso({ ...sso, clientSecret: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={sso.enabled} onCheckedChange={(v) => setSso({ ...sso, enabled: v })} aria-label="Turn on single sign-on" />
              Turn on single sign-on
            </label>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={sso.enforced} disabled={!sso.enabled} onCheckedChange={(v) => setSso({ ...sso, enforced: v })} aria-label="Require single sign-on" />
              Require it (no passwords for these domains)
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy === 'sso'}>
              Save single sign-on
            </Button>
            <Button
              type="button"
              variant="outline"
              loading={busy === 'sso-test'}
              disabled={!sso.issuer}
              onClick={() =>
                run('sso-test', async () => {
                  const r = await api<{ issuer: string }>(`${url}/sso`, { method: 'POST', json: { issuer: sso.issuer } });
                  toast.success(`Found ${r.issuer}`);
                })
              }
            >
              Test the issuer
            </Button>
          </div>
        </form>
      </Section>

      <Section title="SCIM provisioning" icon={Users} description="Let your identity provider add, update and turn off staff accounts automatically.">
        <div className="space-y-4 text-sm">
          <p>
            SCIM base URL: <code className="break-all font-mono text-xs">{origin}/api/scim/v2</code>
            <span className="ml-2 inline-block align-middle">
              <CopyButton value={`${origin}/api/scim/v2`} label="Copy URL" size="sm" />
            </span>
          </p>
          {scimToken ? (
            <Callout tone="warning">
              Copy this token into your identity provider now. You won’t see it again.
              <code className="mt-2 block break-all rounded-md bg-surface px-2 py-1.5 font-mono text-xs">{scimToken}</code>
              <span className="mt-2 inline-block">
                <CopyButton value={scimToken} label="Copy token" size="sm" />
              </span>
            </Callout>
          ) : (
            <p className="text-muted-foreground">{org.scim.enabled ? `Token ${org.scim.tokenPrefix}… is active.` : 'No token yet: SCIM is off.'}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              loading={busy === 'scim'}
              onClick={() =>
                run('scim', async () => {
                  const r = await api<{ token: string }>(`${url}/scim-token`, { method: 'POST' });
                  setScimToken(r.token);
                  await mutate();
                })
              }
            >
              {org.scim.enabled ? 'Replace token' : 'Create token'}
            </Button>
            {org.scim.enabled && (
              <Button
                variant="ghost"
                loading={busy === 'scim-off'}
                onClick={() =>
                  run('scim-off', async () => {
                    await api(`${url}/scim-token`, { method: 'DELETE' });
                    setScimToken(null);
                    await mutate();
                  }, 'SCIM is off')
                }
              >
                Turn off SCIM
              </Button>
            )}
          </div>
        </div>
      </Section>
    </Card>
  );
}

export default function OrganizationPage() {
  const { data, error, mutate } = useSWR<OrgSummary[]>('/api/admin/organizations', fetcher);
  const [selected, setSelected] = React.useState<string | null>(null);
  const current = selected ?? data?.[0]?.id ?? null;

  return (
    <div className={FRAME}>
      <div className="max-w-5xl space-y-6">
        <PageHeader
          title="Organization"
          description="Your hotel group: its hotels, administrators and sign-in policy."
          actions={
            data && data.length > 1 ? (
              <select aria-label="Organization" className={cn(inputBase, 'h-9 w-auto py-1.5')} value={current ?? ''} onChange={(e) => setSelected(e.target.value)}>
                {data.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : undefined
          }
        />
        {error ? (
          <Callout tone="danger">{(error as Error).message}</Callout>
        ) : !data ? (
          <Skeleton className="h-96 w-full" />
        ) : current ? (
          <OrganizationDetail key={current} id={current} />
        ) : (
          <>
            <EmptyState icon={Building2} title="No organization yet" description="Independent hotels don’t need one. Hotel groups use it to share administrators and a sign-in policy." />
            <CreateOrganization
              onCreated={async (id) => {
                await mutate();
                setSelected(id);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
