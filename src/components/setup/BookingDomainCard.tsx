'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Pencil, RefreshCw, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';

type DnsRecord = { type: 'CNAME' | 'A' | 'TXT'; name: string; value: string; note?: string };

type DnsCheck = {
  pointsToApp: boolean;
  cnames: string[];
  ips: string[];
  hasIpv6: boolean;
  hostingVerified: boolean | null;
};

type DomainStatus = {
  subdomain: string | null;
  defaultDomain: string | null;
  domain: string | null;
  verified: boolean;
  verifiedAt: string | null;
  dnsRecords: DnsRecord[];
  hostingManaged: boolean;
  check?: DnsCheck;
};

type Busy = 'renaming' | 'saving' | 'checking' | 'removing' | null;

/**
 * Where guests find the property's booking page: its default address on the
 * platform domain, and optionally the owner's own domain. Saves through
 * /api/admin/properties/{id}/domain, not with the property form's Save.
 */
export function BookingDomainCard({ propertyId, editable }: { propertyId: string; editable: boolean }) {
  const endpoint = `/api/admin/properties/${propertyId}/domain`;
  const { data: status, error: loadError, mutate } = useSWR<DomainStatus>(endpoint, fetcher);
  const [domainInput, setDomainInput] = React.useState('');
  const [subdomainInput, setSubdomainInput] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [error, setError] = React.useState('');
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [origin, setOrigin] = React.useState('');

  React.useEffect(() => setOrigin(window.location.origin), []);

  async function call(action: Exclude<Busy, null>, method: 'PATCH' | 'PUT' | 'POST' | 'DELETE', body?: unknown): Promise<boolean> {
    setBusy(action);
    setError('');
    try {
      const next = await api<DomainStatus>(endpoint, { method, json: body });
      await mutate(next, { revalidate: false });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveSubdomain() {
    if (await call('renaming', 'PATCH', { subdomain: subdomainInput })) {
      setSubdomainInput(null);
      toast.success('Default address changed');
    }
  }

  async function connectDomain() {
    if (await call('saving', 'PUT', { domain: domainInput })) setDomainInput('');
  }

  async function removeDomain() {
    if (await call('removing', 'DELETE')) toast.success('Domain disconnected');
    setConfirmRemove(false);
  }

  const bookingPageUrl = `${origin}/properties/${propertyId}`;

  return (
    <Card className="p-5 sm:p-8">
      <h2 className="text-base font-semibold tracking-tight">Booking page address</h2>
      <p className="mb-4 mt-0.5 text-sm text-muted-foreground">Where guests find this property’s booking page.</p>

      {!status ? (
        loadError ? (
          <Callout tone="danger">Couldn’t load the booking page address. Refresh to try again.</Callout>
        ) : (
          <Skeleton className="h-24 rounded-xl" />
        )
      ) : (
        <div className="space-y-6">
          {status.defaultDomain && status.subdomain ? (
            subdomainInput !== null ? (
              <Field label="Default address" hint="Letters, numbers and hyphens.">
                <div className="flex flex-wrap gap-2">
                  <div className="flex min-w-[16rem] flex-1">
                    <Input
                      value={subdomainInput}
                      onChange={(e) => setSubdomainInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && busy === null) void saveSubdomain();
                        if (e.key === 'Escape') setSubdomainInput(null);
                      }}
                      className="rounded-r-none"
                      autoFocus
                    />
                    <span className="flex h-10 items-center rounded-r-lg border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                      {status.defaultDomain.slice(status.subdomain.length)}
                    </span>
                  </div>
                  <Button onClick={() => void saveSubdomain()} disabled={!subdomainInput.trim() || busy !== null} loading={busy === 'renaming'}>
                    Save
                  </Button>
                  <Button variant="outline" onClick={() => setSubdomainInput(null)} disabled={busy !== null}>
                    Cancel
                  </Button>
                </div>
              </Field>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Default address</p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`https://${status.defaultDomain}`} target="_blank" rel="noopener" className="break-all text-sm font-medium text-primary underline-offset-4 hover:underline">
                    {status.defaultDomain}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  {editable && (
                    <Button variant="ghost" size="sm" onClick={() => setSubdomainInput(status.subdomain)}>
                      <Pencil aria-hidden /> Change
                    </Button>
                  )}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {status.verified && status.domain
                    ? `Guests who visit it are sent to ${status.domain}.`
                    : 'Every property gets this address. Connect your own domain below to use that instead.'}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Booking page</p>
              <a href={bookingPageUrl} target="_blank" rel="noopener" className="break-all text-sm font-medium text-primary underline-offset-4 hover:underline">
                {bookingPageUrl}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          )}

          {error && <Callout tone="danger">{error}</Callout>}

          {!status.domain ? (
            editable && (
              <Field
                label="Your own domain"
                optional
                hint="Guests who visit it land on this booking page. A subdomain like book.yourmotel.com keeps your existing website working."
              >
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && domainInput.trim() && busy === null) void connectDomain();
                    }}
                    placeholder="book.yourmotel.com"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="min-w-[12rem] flex-1"
                  />
                  <Button onClick={() => void connectDomain()} disabled={!domainInput.trim() || busy !== null} loading={busy === 'saving'}>
                    Connect
                  </Button>
                </div>
              </Field>
            )
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Your own domain</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-all font-medium">{status.domain}</span>
                    {status.verified ? (
                      <Badge variant="success" icon={CheckCircle2}>
                        Live
                      </Badge>
                    ) : (
                      <Badge variant="warning" icon={Clock}>
                        Waiting for DNS
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {status.verified && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={`https://${status.domain}`} target="_blank" rel="noopener">
                          Visit <SquareArrowOutUpRight aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      </Button>
                    )}
                    {editable && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => void call('checking', 'POST')} disabled={busy !== null} loading={busy === 'checking'}>
                          <RefreshCw aria-hidden /> {status.verified ? 'Check again' : 'Check DNS'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} disabled={busy !== null}>
                          <Trash2 aria-hidden /> Remove
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {status.check && <DnsCheckResult check={status.check} verified={status.verified} />}

              {!status.verified && status.dnsRecords.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Add {status.dnsRecords.length === 1 ? 'this record' : 'these records'} where you manage your domain’s DNS (your registrar, or a DNS provider like Cloudflare), then press Check DNS.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-left text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">Type</th>
                          <th scope="col" className="px-3 py-2 font-medium">Name</th>
                          <th scope="col" className="px-3 py-2 font-medium">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.dnsRecords.map((record) => (
                          <tr key={`${record.type}-${record.name}-${record.value}`} className="border-t border-border">
                            <td className="px-3 py-2 font-mono">{record.type}</td>
                            <td className="break-all px-3 py-2 font-mono">{record.name}</td>
                            <td className="px-3 py-2">
                              <span className="break-all font-mono">{record.value}</span>
                              {record.note && <div className="text-xs text-muted-foreground">{record.note}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Delete any other A or AAAA records with the same name. On Cloudflare, set the record to “DNS only” (grey cloud). DNS changes usually show up within minutes but can take up to 48 hours.
                  </p>
                </div>
              )}

              {!status.hostingManaged && !status.verified && (
                <Callout tone="info">
                  The domain also has to be added to the project in Vercel (Settings → Domains) before it can serve this page.
                </Callout>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Disconnect ${status?.domain ?? 'this domain'}?`}
        description="Guests who visit it will no longer see this booking page."
        confirmLabel="Disconnect"
        destructive
        loading={busy === 'removing'}
        onConfirm={() => void removeDomain()}
      />
    </Card>
  );
}

function DnsCheckResult({ check, verified }: { check: DnsCheck; verified: boolean }) {
  if (verified) {
    return <Callout tone="success">Your domain is connected. Guests who visit it see this booking page.</Callout>;
  }

  const found = [...check.cnames.map((cname) => `CNAME ${cname}`), ...check.ips.map((ip) => `A ${ip}`)];
  return (
    <Callout tone="warning">
      {check.pointsToApp ? (
        <p>DNS looks right. The hosting provider is still verifying the domain and issuing its security certificate. Check again in a few minutes.</p>
      ) : (
        <p>The domain doesn’t point here yet. {found.length > 0 ? `It currently points to: ${found.join(', ')}.` : 'No DNS records were found for it.'}</p>
      )}
      {check.hasIpv6 && <p className="mt-1">Remove the AAAA (IPv6) records for this domain. They can send guests somewhere else.</p>}
    </Callout>
  );
}
