'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Bot, CalendarCheck2, CheckCircle2, ChevronDown, ExternalLink, Inbox, KeyRound, Link2, MessageSquareText, Plus, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Callout, IconTile, Skeleton } from '@/components/ui/primitives';
import { PageShell, SectionHeader } from '@/components/console/PageShell';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { CopyButton } from '@/components/setup/CopyButton';
import { DeveloperNote } from '@/components/setup/DeveloperNote';

interface AgentKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  propertyId: string | null;
  allHotels: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
}

interface KeysResponse {
  keys: AgentKey[];
  canManage: boolean;
  locked: string | null;
  canCreateAllHotels: boolean;
  /** False while the hotel is hidden from guests. */
  listed: boolean;
}

const code = 'rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground';
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** This site's origin, once we're in the browser (the links are absolute so guests can paste them anywhere). */
function useOrigin(): string {
  const [origin, setOrigin] = React.useState('');
  React.useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** A value people copy: shown in full (wrapping), with a copy button. `prose` for sentences, else a link or code. */
function CopyField({ label, value, copyLabel, copiedLabel, prose = false }: { label: string; value: string; copyLabel: string; copiedLabel: string; prose?: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-2 rounded-xl border bg-surface-sunken/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        {!value ? (
          <Skeleton className="h-5 w-72 max-w-full" />
        ) : prose ? (
          <p className="min-w-0 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{value}</p>
        ) : (
          <code className="min-w-0 break-all font-mono text-sm text-foreground">{value}</code>
        )}
        <CopyButton value={value} label={copyLabel} copiedLabel={copiedLabel} className="shrink-0 self-start bg-surface sm:self-center" />
      </div>
    </div>
  );
}

/** The hotel's own MCP link, a message for guests, and what assistants can do with it. */
function HotelLink({ origin, hotelId, hotelName, listed }: { origin: string; hotelId: string; hotelName: string; listed?: boolean }) {
  const url = origin ? `${origin}/api/mcp/hotels/${hotelId}` : '';
  const message = origin
    ? `Book ${hotelName} with your AI assistant: add ${url} as a connector in ChatGPT, Claude, Grok or Le Chat, then just ask for a room. How to add it: ${origin}/assistants`
    : '';
  const can = [
    { icon: CalendarCheck2, text: 'Check live availability and prices for any dates.' },
    { icon: MessageSquareText, text: 'Answer questions from your saved answers — FAQs, amenities, policies and rooms.' },
    { icon: Link2, text: 'Hand the guest your own checkout with everything filled in. They confirm in one tap.' },
    { icon: Inbox, text: 'No screen? Send you a booking request in Messages for your team to confirm.' },
  ];
  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-1 opacity-80" aria-hidden />
      <div className="flex items-start gap-4">
        <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-agent-soft text-agent-soft-foreground sm:flex" aria-hidden>
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-5">
          <SectionHeader
            title="Your hotel’s assistant link"
            description="Guests add this link to their AI assistant once. After that they can ask about your hotel and book — just by asking."
          />
          {listed === false && (
            <Callout
              tone="warning"
              title="Your hotel is hidden from guests"
              action={
                <Button asChild size="sm" variant="outline" className="bg-surface">
                  <Link href="/admin/properties">Properties</Link>
                </Button>
              }
            >
              Assistants can’t find or book {hotelName} until you show it to guests again.
            </Callout>
          )}
          <CopyField label="Assistant link (MCP)" value={url} copyLabel="Copy link" copiedLabel="Link copied" />
          <CopyField label="Message for guests — paste it in emails, on your website or in WhatsApp" value={message} copyLabel="Copy message" copiedLabel="Message copied" prose />
          <div>
            <h3 className="text-sm font-medium">What assistants can do with it</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {can.map((c) => (
                <li key={c.text} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <c.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>Nothing is booked until the guest confirms on your checkout, or your team confirms a request.</span>
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Answers come from your{' '}
            <Link href="/admin/voice#settings" className="font-medium text-primary underline-offset-4 hover:underline">
              voice settings
            </Link>{' '}
            and hotel details — add an FAQ there and assistants can use it right away. Requests land in{' '}
            <Link href="/admin/voice#messages" className="font-medium text-primary underline-offset-4 hover:underline">
              Messages
            </Link>
            .
          </p>
        </div>
      </div>
    </Card>
  );
}

/** The one-time view of a new key. */
function NewKeyDialog({ created, hotelName, origin, onClose }: { created: { key: string; record: AgentKey } | null; hotelName: string; origin: string; onClose: () => void }) {
  const canBook = !!created?.record.scopes.includes('book');
  return (
    <Dialog open={!!created} onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideClose onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Copy your new key now</DialogTitle>
          <DialogDescription>
            This is the only time you’ll see “{created?.record.name}”. Give it to the developer or partner it’s for, and keep it somewhere safe.
          </DialogDescription>
        </DialogHeader>
        {created && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 rounded-xl border bg-surface-sunken/60 p-3">
              <code className="break-all font-mono text-sm text-foreground" aria-label="API key">
                {created.key}
              </code>
              <CopyButton value={created.key} label="Copy key" copiedLabel="Key copied" className="self-start bg-surface" />
            </div>
            <Callout tone="warning" title="Treat it like a password">
              {canBook
                ? `Anyone with this key can make confirmed bookings at ${created.record.allHotels ? 'every hotel' : hotelName}. If it leaks, revoke it and make a new one.`
                : 'Anyone with this key can use your hotel’s assistant tools under your name. If it leaks, revoke it and make a new one.'}
            </Callout>
            <p className="text-sm text-muted-foreground">
              It’s sent as <code className={code}>Authorization: Bearer …</code> to <code className={cn(code, 'break-all')}>{origin}/api/mcp</code> or the REST API.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose} className="h-11 sm:h-10">
            I’ve saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeyRow({ k, canManage, onRevoke }: { k: AgentKey; canManage: boolean; onRevoke: (k: AgentKey) => void }) {
  const revoked = !!k.revokedAt;
  return (
    <li className={cn('flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5', revoked && 'bg-surface-sunken/40')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn('truncate text-sm font-medium', revoked && 'text-muted-foreground')}>{k.name}</p>
          {revoked ? (
            <Badge variant="neutral" size="sm">
              Revoked
            </Badge>
          ) : (
            <Badge variant="success" size="sm" icon={CheckCircle2}>
              Active
            </Badge>
          )}
          <Badge variant={!revoked && k.scopes.includes('book') ? 'info' : 'neutral'} size="sm">
            {k.scopes.includes('book') ? 'Can book' : 'Search only'}
          </Badge>
          {k.allHotels && (
            <Badge variant="highlight" size="sm">
              All hotels
            </Badge>
          )}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <code className="font-mono text-foreground/80">{k.prefix}…</code>
          <span>
            Created {dateFmt.format(new Date(k.createdAt))}
            {k.createdBy ? ` by ${k.createdBy}` : ''}
          </span>
          <span>{revoked ? `Revoked ${dateFmt.format(new Date(k.revokedAt!))}` : k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : 'Not used yet'}</span>
        </p>
      </div>
      {canManage && !revoked && (
        <Button variant="outline" size="sm" className="self-start sm:self-center" onClick={() => onRevoke(k)}>
          Revoke<span className="sr-only"> {k.name}</span>
        </Button>
      )}
    </li>
  );
}

/** API keys for partners' own agents: create (shown once), list, revoke. */
function ApiKeys({ propertyId, hotelName, origin }: { propertyId: string; hotelName: string; origin: string }) {
  const url = usePropertyUrl('/api/admin/agent-keys');
  const { data, error, mutate } = useSWR<KeysResponse>(url, fetcher, { revalidateOnFocus: false });
  const [name, setName] = React.useState('');
  const [canBook, setCanBook] = React.useState(true);
  const [allHotels, setAllHotels] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [created, setCreated] = React.useState<{ key: string; record: AgentKey } | null>(null);
  const [revoking, setRevoking] = React.useState<AgentKey | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [showRevoked, setShowRevoked] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Give the key a name, like the assistant or partner it’s for.');
      nameRef.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const res = await api<{ key: string; record: AgentKey }>('/api/admin/agent-keys', { method: 'POST', json: { propertyId, name: name.trim(), scopes: canBook ? ['book'] : [], allHotels: allHotels || undefined } });
      setCreated(res);
      setName('');
      setNameError(null);
      setAllHotels(false);
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    try {
      await api(`/api/admin/agent-keys/${revoking.id}?propertyId=${encodeURIComponent(propertyId)}`, { method: 'DELETE' });
      toast.success(`“${revoking.name}” no longer works`);
      setRevoking(null);
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const keys = data?.keys ?? [];
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => !!k.revokedAt);

  return (
    <Card className="overflow-hidden p-0">
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <IconTile icon={KeyRound} size="lg" className="hidden sm:flex" />
          <div className="min-w-0 flex-1">
            <SectionHeader
              title="API keys"
              description={`For partners and developers whose own AI agents — like a Muse or Grok app — should make confirmed bookings at ${hotelName}. Guests pay at the hotel. Guests using ChatGPT or Claude don’t need a key.`}
            />
          </div>
        </div>

        {error && (
          <Callout tone="danger" className="mt-5" role="alert">
            {(error as Error).message}
          </Callout>
        )}
        {data?.locked && (
          <Callout
            tone="info"
            title="You’re looking at a demo hotel"
            className="mt-5"
            action={
              <Button asChild size="sm" variant="outline" className="bg-surface">
                <Link href="/onboarding">Get started</Link>
              </Button>
            }
          >
            {data.locked}
          </Callout>
        )}

        {data?.canManage && (
          <form onSubmit={create} className="mt-5 space-y-4 rounded-xl border bg-surface-sunken/40 p-4" noValidate>
            <h3 className="text-sm font-medium">Create a key</h3>
            <Field label="Name" error={nameError} hint="Who it’s for, so you recognise it later.">
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="e.g. Muse travel agent"
                maxLength={50}
                autoComplete="off"
                required
              />
            </Field>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p id="key-book-label" className="text-sm font-medium">
                  Can make confirmed bookings
                </p>
                <p id="key-book-desc" className="mt-0.5 text-sm text-muted-foreground">
                  Paid at the hotel and emailed to the guest. Turn off for a key that only searches and sends booking links.
                </p>
              </div>
              <Switch checked={canBook} onCheckedChange={setCanBook} aria-labelledby="key-book-label" aria-describedby="key-book-desc" />
            </div>
            {data.canCreateAllHotels && (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p id="key-all-label" className="text-sm font-medium">
                    Works for every hotel
                  </p>
                  <p id="key-all-desc" className="mt-0.5 text-sm text-muted-foreground">
                    Platform admins only. Leave off for a key that only works at {hotelName}.
                  </p>
                </div>
                <Switch checked={allHotels} onCheckedChange={setAllHotels} aria-labelledby="key-all-label" aria-describedby="key-all-desc" />
              </div>
            )}
            <Button type="submit" loading={creating} loadingText="Creating key…" className="h-11 sm:h-10">
              <Plus aria-hidden /> Create key
            </Button>
          </form>
        )}
      </div>

      <div className="border-t">
        <h3 className="sr-only">Your keys</h3>
        {!data && !error ? (
          <div className="space-y-2 p-5" aria-busy>
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <span className="sr-only" role="status">
              Loading keys…
            </span>
          </div>
        ) : keys.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">No keys yet. You only need one if a partner asks for it.</p>
        ) : (
          <>
            {active.length > 0 ? (
              <>
                <p className="px-5 pt-4 text-xs font-medium text-muted-foreground" aria-live="polite">
                  {active.length} active {active.length === 1 ? 'key' : 'keys'}
                </p>
                <ul className="divide-y" aria-label="Active API keys">
                  {active.map((k) => (
                    <KeyRow key={k.id} k={k} canManage={!!data?.canManage} onRevoke={setRevoking} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground" aria-live="polite">
                No active keys. You only need one if a partner asks for it.
              </p>
            )}
            {revoked.length > 0 && (
              <div className="border-t">
                <button
                  type="button"
                  aria-expanded={showRevoked}
                  aria-controls="revoked-keys"
                  onClick={() => setShowRevoked((v) => !v)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-5 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {showRevoked ? 'Hide' : 'Show'} {revoked.length} revoked {revoked.length === 1 ? 'key' : 'keys'}
                  <ChevronDown className={cn('size-4 shrink-0 transition-transform', showRevoked && 'rotate-180')} aria-hidden />
                </button>
                {showRevoked && (
                  <ul id="revoked-keys" className="divide-y border-t" aria-label="Revoked API keys">
                    {revoked.map((k) => (
                      <KeyRow key={k.id} k={k} canManage={false} onRevoke={setRevoking} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <NewKeyDialog created={created} hotelName={hotelName} origin={origin} onClose={() => setCreated(null)} />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke “${revoking?.name ?? ''}”?`}
        description="It stops working right away, and any assistant using it loses access. This can’t be undone — you can always create a new key."
        confirmLabel="Revoke key"
        destructive
        loading={busy}
        onConfirm={() => void revoke()}
      />
    </Card>
  );
}

export default function AssistantsPage() {
  const { property, propertyId, can, role } = useConsole();
  const origin = useOrigin();
  const canManageKeys = can('agentkeys.manage');
  // Same request as the API keys card (SWR shares it): whether the hotel is listed.
  const keysUrl = usePropertyUrl('/api/admin/agent-keys');
  const { data: keysData } = useSWR<KeysResponse>(canManageKeys ? keysUrl : null, fetcher, { revalidateOnFocus: false });

  return (
    <PageShell
      size="narrow"
      title="AI assistants"
      description={`Let guests find and book ${property?.name ?? 'your hotel'} from ChatGPT, Claude, Grok and other AI assistants.`}
      actions={
        <Button asChild variant="outline" className="h-11 sm:h-10">
          <Link href="/assistants" target="_blank" rel="noopener">
            Guest guide <ExternalLink aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </Link>
        </Button>
      }
    >
      {!property || !propertyId ? (
        <div className="space-y-6" aria-busy>
          <Skeleton className="h-[360px] rounded-2xl" />
          <Skeleton className="h-[220px] rounded-2xl" />
        </div>
      ) : (
        <>
          <HotelLink origin={origin} hotelId={propertyId} hotelName={property.name} listed={keysData?.listed} />

          {canManageKeys ? (
            <ApiKeys propertyId={propertyId} hotelName={property.name} origin={origin} />
          ) : (
            <Card className="p-5 sm:p-6">
              <SectionHeader title="API keys" description="For partners whose own AI agents should make confirmed bookings. Guests using ChatGPT or Claude don’t need one." />
              <Callout tone="neutral" className="mt-4" icon={TriangleAlert}>
                Only the hotel owner can create or revoke API keys.
              </Callout>
            </Card>
          )}

          <DeveloperNote open={role === 'ADMIN'} title="For developers">
            <p>
              {PRODUCT_NAME}’s MCP server for every hotel: <code className="break-all">{origin}/api/mcp</code> (Streamable HTTP, no sign-in). This hotel only:{' '}
              <code className="break-all">{origin}/api/mcp/hotels/{propertyId}</code>.
            </p>
            <p>
              REST API with an{' '}
              <a href="/openapi.json" className="font-medium text-primary underline-offset-4 hover:underline">
                OpenAPI description
              </a>{' '}
              (works as a ChatGPT GPT Action), plus{' '}
              <a href="/llms.txt" className="font-medium text-primary underline-offset-4 hover:underline">
                llms.txt
              </a>{' '}
              and{' '}
              <a href="/llms-full.txt" className="font-medium text-primary underline-offset-4 hover:underline">
                llms-full.txt
              </a>{' '}
              for models. Keys go in <code>Authorization: Bearer ho_live_…</code>; only bookings need one.
            </p>
          </DeveloperNote>
        </>
      )}
    </PageShell>
  );
}
