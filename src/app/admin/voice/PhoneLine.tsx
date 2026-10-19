'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Check, ChevronDown, CircleDashed, CirclePause, CheckCircle2, Eye, EyeOff, MessageCircle, Phone, PhoneCall, Plug, RefreshCw, TriangleAlert } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';
import { Button, IconButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { CopyButton } from '@/components/setup/CopyButton';
import { DeveloperNote } from '@/components/setup/DeveloperNote';
import { SaveBar } from '@/components/setup/SaveBar';

interface PhoneOverview {
  ready: boolean;
  canManage: boolean;
  /** Why this hotel's line can't be changed here (public demo hotels). */
  locked: string | null;
  /** The hotel's master voice switch (Settings). */
  voiceOn: boolean;
  line: { enabled: boolean; transferNumber: string | null } | null;
  urlIssue: string | null;
  /** Live status was fetched (managers only). */
  checked: boolean;
  status: { agentId: string; agentName: string; numbers: { phoneNumber: string; label: string | null; provider: string }[] } | null;
  statusError: string | null;
}

const code = 'rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground';
const PROVIDERS: Record<string, string> = { twilio: 'Twilio', sip_trunk: 'SIP trunk', exotel: 'Exotel', whatsapp: 'WhatsApp' };

/** One step of the setup checklist: a numbered row that opens to show the details. */
function Step({
  n,
  title,
  who,
  done,
  optional,
  defaultOpen,
  children,
}: {
  n: number;
  title: string;
  who?: string;
  done?: boolean;
  optional?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-xl border bg-card">
      <details className="group" open={defaultOpen}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular',
              done ? 'bg-success-soft text-success-soft-foreground' : 'border border-border-strong/60 text-foreground'
            )}
            aria-hidden
          >
            {done ? <Check className="size-4" /> : n}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              <span className="sr-only">Step {n}{done ? ', done' : ''}: </span>
              {title}
            </span>
            {who && <span className="block text-xs text-muted-foreground">{who}</span>}
          </span>
          {optional && (
            <Badge variant="neutral" size="sm">
              Optional
            </Badge>
          )}
          {done && (
            <Badge variant="success" size="sm" className="hidden sm:inline-flex">
              Done
            </Badge>
          )}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-3 px-4 pb-4 text-sm leading-relaxed text-muted-foreground sm:pl-14">{children}</div>
      </details>
    </li>
  );
}

/** A dial code with what it does, and a copy button when there's a real number in it. */
function DialCode({ value, children, copyable }: { value: string; children: React.ReactNode; copyable: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-surface-sunken/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <dt className="text-sm text-foreground">{children}</dt>
      <dd className="flex items-center gap-1.5">
        <code className={cn(code, 'break-all')}>{value}</code>
        {copyable && <CopyButton iconOnly value={value} label={`Copy ${value}`} />}
      </dd>
    </div>
  );
}

interface AccountNumber {
  id: string;
  phoneNumber: string;
  label: string | null;
  provider: string;
  agentName: string | null;
  thisHotel: boolean;
}

/**
 * Connect a number to this hotel without opening ElevenLabs: a Twilio number
 * (whoever owns the Twilio account), or — for the platform team — any number
 * already in the ElevenLabs account.
 */
function ConnectNumber({ propertyId, isAdmin, onConnected }: { propertyId: string; isAdmin: boolean; onConnected: () => void }) {
  const [phone, setPhone] = React.useState('');
  const [sid, setSid] = React.useState('');
  const [token, setToken] = React.useState('');
  const [showToken, setShowToken] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [accountNumbers, setAccountNumbers] = React.useState<AccountNumber[] | null>(null);
  const [picked, setPicked] = React.useState('');
  const [loadingNumbers, setLoadingNumbers] = React.useState(false);

  async function connectTwilio(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!phone.trim() || !sid.trim() || !token.trim()) {
      setError('Fill in the number, the Account SID and the Auth Token.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ phoneNumber: string }>('/api/admin/voice/phone/numbers', { method: 'POST', json: { propertyId, phoneNumber: phone, accountSid: sid, authToken: token } });
      toast.success(`${formatPhone(res.phoneNumber)} now rings your voice front desk`);
      setToken('');
      onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadAccountNumbers() {
    setLoadingNumbers(true);
    setError(null);
    try {
      const res = await api<{ numbers: AccountNumber[] }>(`/api/admin/voice/phone/numbers?propertyId=${encodeURIComponent(propertyId)}`);
      setAccountNumbers(res.numbers);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingNumbers(false);
    }
  }

  async function assign() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ phoneNumber: string }>('/api/admin/voice/phone/numbers', { method: 'PUT', json: { propertyId, phoneNumberId: picked } });
      toast.success(`${formatPhone(res.phoneNumber)} now rings this hotel`);
      setPicked('');
      setAccountNumbers(null);
      onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={connectTwilio} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Twilio phone number" hint="The number you bought in Twilio, with the country code.">
            <Input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 831 555 0123" maxLength={40} />
          </Field>
          <Field label="Account SID" hint="On the Twilio Console home page. Starts with AC.">
            <Input autoComplete="off" spellCheck={false} value={sid} onChange={(e) => setSid(e.target.value.trim())} placeholder="AC…" maxLength={40} className="font-mono" />
          </Field>
        </div>
        <Field label="Auth Token" hint={`Next to the Account SID. ${PRODUCT_NAME} checks it with Twilio and hands it to ElevenLabs once to set up the number — it isn’t stored here.`}>
          <div className="relative sm:max-w-md">
            <Input
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value.trim())}
              maxLength={128}
              className="pr-12 font-mono"
            />
            <IconButton
              type="button"
              size="icon-sm"
              label={showToken ? 'Hide token' : 'Show token'}
              aria-pressed={showToken}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? <EyeOff /> : <Eye />}
            </IconButton>
          </div>
        </Field>
        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
          </p>
        )}
        <Button type="submit" variant="agent" loading={busy} loadingText="Connecting…">
          <Plug aria-hidden /> Connect number
        </Button>
      </form>

      {isAdmin && (
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Platform team: use a number already in ElevenLabs</p>
          {accountNumbers === null ? (
            <Button variant="outline" size="sm" onClick={() => void loadAccountNumbers()} loading={loadingNumbers} loadingText="Loading numbers…">
              Show the account’s numbers
            </Button>
          ) : accountNumbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">There are no numbers in the ElevenLabs account yet.</p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={picked} onValueChange={setPicked}>
                <SelectTrigger className="sm:max-w-sm" aria-label="Number to connect">
                  <SelectValue placeholder="Choose a number" />
                </SelectTrigger>
                <SelectContent>
                  {accountNumbers.map((n) => (
                    <SelectItem key={n.id} value={n.id} disabled={n.thisHotel}>
                      {formatPhone(n.phoneNumber)} · {n.thisHotel ? 'this hotel' : n.agentName ? `rings ${n.agentName}` : 'not connected'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="secondary" onClick={() => void assign()} disabled={!picked} loading={busy && !!picked} loadingText="Connecting…">
                Connect to this hotel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The hotel's phone line: HotelOne keeps a phone agent for this hotel in
 * ElevenLabs; numbers (Twilio, SIP trunk, Exotel) are pointed at it there,
 * and the hotel forwards its existing number to one of them.
 */
export function PhoneLine({ onChanged, onOpenSettings }: { onChanged?: () => void; /** Jump to the voice Settings tab. */ onOpenSettings?: () => void }) {
  const { propertyId, property, role } = useConsole();
  const url = usePropertyUrl('/api/admin/voice/phone', { check: 1 });
  const { data, mutate, isValidating } = useSWR<PhoneOverview>(url, fetcher, { revalidateOnFocus: false });
  const [enabled, setEnabled] = React.useState(true);
  const [transfer, setTransfer] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const isAdmin = role === 'ADMIN';

  React.useEffect(() => {
    setEnabled(data?.line?.enabled ?? true);
    setTransfer(data?.line?.transferNumber ?? '');
  }, [data?.line?.enabled, data?.line?.transferNumber]);

  async function save(next: { enabled: boolean; transferNumber: string }) {
    setSaving(true);
    try {
      const res = await api<PhoneOverview>('/api/admin/voice/phone', { method: 'PUT', json: { propertyId, enabled: next.enabled, transferNumber: next.transferNumber.trim() || null } });
      await mutate(res, { revalidate: false });
      if (res.statusError) toast.error(res.statusError);
      else toast.success(next.enabled ? 'Phone line is on' : 'Phone line paused — calls get a short “not available” message');
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-[180px] rounded-2xl" />
        <Skeleton className="h-[260px] rounded-2xl" />
        <span className="sr-only" role="status">
          Checking your phone line…
        </span>
      </div>
    );
  }

  // Notices go first, so nobody fills in a form that can't be saved.
  const lockedNotice = data.locked && (
    <Callout
      tone="info"
      title="You’re looking at a demo hotel"
      action={
        <Button asChild size="sm" variant="outline" className="bg-surface">
          <Link href="/onboarding">Get started</Link>
        </Button>
      }
    >
      {data.locked}
    </Callout>
  );
  const urlNotice = data.urlIssue && (
    <Callout tone="warning" title={`${PRODUCT_NAME} needs a public web address for phone calls`}>
      <p>Calls can’t reach this site yet. This is a one-time server setting — your developer or {PRODUCT_NAME} contact can fix it.</p>
      <DeveloperNote open={isAdmin} className="mt-3">
        <p>{data.urlIssue}</p>
      </DeveloperNote>
    </Callout>
  );

  if (!data.ready) {
    return (
      <div className="space-y-6">
        {lockedNotice}
        <Callout tone="warning" title="Phone lines aren’t connected yet">
          <p>
            {PRODUCT_NAME} answers hotel phones through ElevenLabs Agents. Once that’s connected on the server, you can answer your hotel number with this voice.
            {!isAdmin && (
              <>
                {' '}
                Write to{' '}
                <a className="font-medium underline underline-offset-2" href={`mailto:${PRODUCT_SUPPORT_EMAIL}`}>
                  {PRODUCT_SUPPORT_EMAIL}
                </a>{' '}
                to get it switched on.
              </>
            )}
          </p>
          <DeveloperNote open={isAdmin} className="mt-3">
            <p>
              Add <code>ELEVENLABS_API_KEY</code> to the server environment and redeploy.
            </p>
          </DeveloperNote>
        </Callout>
      </div>
    );
  }

  if (!data.line) {
    return (
      <div className="space-y-6">
        {lockedNotice}
        {urlNotice}
        <Card className="relative overflow-hidden p-5 sm:p-6">
          <div className="bg-aurora pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-agent-soft text-agent-soft-foreground" aria-hidden>
              <PhoneCall className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold tracking-tight">Answer your hotel phone with this voice</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Same answers as your booking page — live availability, prices, bookings and messages for the team. Keep your number: forward the calls you can’t pick up. WhatsApp works too.
              </p>
            </div>
            {data.canManage ? (
              <Button variant="agent" className="self-start sm:self-center" onClick={() => void save({ enabled: true, transferNumber: '' })} loading={saving} loadingText="Turning on…" disabled={!!data.urlIssue}>
                <PhoneCall aria-hidden /> Turn on phone line
              </Button>
            ) : (
              !data.locked && <p className="max-w-xs text-sm text-muted-foreground">Ask the hotel owner to turn this on.</p>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const numbers = data.status?.numbers ?? [];
  const agentName = data.status?.agentName ?? `${PRODUCT_NAME} — ${property?.name ?? 'your hotel'} phone`;
  const agentId = data.status?.agentId;
  const target = numbers[0]?.phoneNumber ?? '<new number>';
  const hasNumber = numbers.length > 0;
  const hasWhatsApp = numbers.some((n) => n.provider === 'whatsapp');
  const paused = !data.line.enabled || !data.voiceOn;
  const badge = paused ? (
    <Badge variant="neutral" icon={CirclePause}>
      Paused
    </Badge>
  ) : data.statusError || data.urlIssue ? (
    <Badge variant="danger" icon={TriangleAlert}>
      Needs attention
    </Badge>
  ) : !data.checked ? (
    <Badge variant="neutral">On</Badge>
  ) : !data.status ? (
    <Badge variant="neutral">Checking…</Badge>
  ) : hasNumber ? (
    <Badge variant="success" icon={CheckCircle2}>
      Live
    </Badge>
  ) : (
    <Badge variant="warning" icon={CircleDashed}>
      Waiting for a number
    </Badge>
  );
  const dirty = enabled !== data.line.enabled || transfer.trim() !== (data.line.transferNumber ?? '');
  const handoff = `Phone agent: ${agentName}${agentId ? `\nAgent ID: ${agentId}` : ''}\nHotel: ${property?.name ?? ''}`;

  return (
    <div className="space-y-6">
      {lockedNotice}
      {urlNotice}
      {data.statusError && (
        <Callout tone="danger" title="We couldn’t check the line with ElevenLabs" role="alert">
          {data.statusError}
        </Callout>
      )}
      {!data.voiceOn && (
        <Callout
          tone="warning"
          title="Your voice front desk is switched off"
          action={
            onOpenSettings ? (
              <Button size="sm" variant="outline" className="bg-surface" onClick={onOpenSettings}>
                Open Settings
              </Button>
            ) : undefined
          }
        >
          Callers hear a short “not available” message until you switch it back on in Settings.
        </Callout>
      )}

      {/* Status: is it live, and which numbers ring it */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="text-base font-semibold tracking-tight">Phone line</h2>
              <span aria-live="polite">{badge}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Calls — and WhatsApp messages — to these numbers are answered by your voice front desk.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void mutate()} loading={isValidating} loadingText="Checking the line…">
            <RefreshCw aria-hidden /> Refresh
          </Button>
        </div>

        {!data.checked && !data.urlIssue && <p className="mt-4 text-sm text-muted-foreground">A manager or the owner can see which numbers ring this line.</p>}

        {data.status && (
          <>
            <ul className="mt-4 space-y-2" aria-label="Numbers that ring this hotel">
              {numbers.length === 0 && (
                <li className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">
                  <CircleDashed className="size-4 shrink-0" aria-hidden />
                  No number rings this hotel yet — follow the steps below.
                </li>
              )}
              {numbers.map((n) => (
                <li key={n.phoneNumber} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3">
                  {n.provider === 'whatsapp' ? <MessageCircle className="size-4 text-muted-foreground" aria-hidden /> : <Phone className="size-4 text-muted-foreground" aria-hidden />}
                  <span className="font-medium tabular">{formatPhone(n.phoneNumber)}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{[n.label, PROVIDERS[n.provider] ?? n.provider].filter(Boolean).join(' · ')}</span>
                  <CopyButton iconOnly value={n.phoneNumber} label={`Copy ${formatPhone(n.phoneNumber)}`} className="ml-auto" />
                </li>
              ))}
            </ul>
            {/* The ElevenLabs agent's name and ID are only for whoever runs that account (step 2). */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm text-muted-foreground">
              <span>Answered by this hotel’s own phone agent, with your Voice settings.</span>
              <CopyButton value={data.status.agentId} label="Copy agent ID" copiedLabel="Agent ID copied" variant="ghost" className="-mr-2" />
            </div>
          </>
        )}
      </Card>

      {data.status && data.canManage && propertyId && (
        <Card className="p-5 sm:p-6">
          {hasNumber ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                Connect another number
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="mt-4">
                <ConnectNumber propertyId={propertyId} isAdmin={isAdmin} onConnected={() => void mutate()} />
              </div>
            </details>
          ) : (
            <>
              <h2 className="text-base font-semibold tracking-tight">Connect a number</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Bought a number in Twilio? Connect it here and it rings your voice front desk straight away. No number yet? See step 1 below.
              </p>
              <div className="mt-5">
                <ConnectNumber propertyId={propertyId} isAdmin={isAdmin} onConnected={() => void mutate()} />
              </div>
            </>
          )}
        </Card>
      )}

      {/* Setup checklist */}
      {data.checked && data.line.enabled && (
        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-semibold tracking-tight">{hasNumber ? 'How calls reach the assistant' : 'Connect your number'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasNumber ? 'Your number is connected. Open a step to check or change it.' : 'Five short steps — most hotels are done in ten minutes.'}
          </p>
          <ol className="mt-4 space-y-2.5">
            <Step n={1} title="Get a phone number for the assistant" who="You, or whoever handles your phones" done={hasNumber} defaultOpen={!hasNumber}>
              <ul className="list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
                <li>
                  <span className="text-foreground">Most countries:</span> a local number from Twilio — about $1.15 a month in the US. In Twilio, open{' '}
                  <strong className="font-medium text-foreground">Phone Numbers → Buy a number</strong>, pick one with Voice, then connect it above.
                </li>
                <li>
                  <span className="text-foreground">India:</span> an Indian provider such as Exotel. Ask ElevenLabs about India data residency first.
                </li>
                <li>
                  <span className="text-foreground">A hotel phone system with SIP:</span> ask your provider for a SIP trunk.
                </li>
              </ul>
            </Step>

            <Step n={2} title="Connect the number to this hotel" who="With Connect a number above — or in ElevenLabs" done={hasNumber}>
              <p>
                A Twilio number: use <strong className="font-medium text-foreground">Connect a number</strong> above. Exotel or a SIP trunk: whoever runs your {PRODUCT_NAME} ElevenLabs account opens{' '}
                <strong className="font-medium text-foreground">Agents → Phone numbers → Import number</strong> and chooses the agent <strong className="font-medium text-foreground">{agentName}</strong>.
              </p>
              <p>Hotel owners don’t need access to that account — send the number and these details to the person who runs it.</p>
              <div className="flex flex-col gap-2 rounded-lg border bg-surface-sunken/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <dl className="min-w-0 space-y-0.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">Agent</dt>
                    <dd className="min-w-0 truncate font-medium text-foreground">{agentName}</dd>
                  </div>
                  {agentId && (
                    <div className="flex items-center gap-2">
                      <dt className="shrink-0 text-muted-foreground">Agent ID</dt>
                      <dd className="flex min-w-0 items-center gap-1">
                        <code className={cn(code, 'break-all')}>{agentId}</code>
                        <CopyButton iconOnly value={agentId} label="Copy agent ID" copiedLabel="Agent ID copied" />
                      </dd>
                    </div>
                  )}
                </dl>
                <CopyButton value={handoff} label="Copy details" copiedLabel="Details copied" className="shrink-0 self-start bg-surface sm:self-center" />
              </div>
            </Step>

            <Step n={3} title="Keep your hotel number — forward calls to the assistant" who="Dial these from the hotel phone">
              {!hasNumber && <p>Once the assistant has a number, these codes fill in with it.</p>}
              <dl className="space-y-2">
                <DialCode value={`**61*${target}*11*20#`} copyable={hasNumber}>
                  Mobiles: forward calls nobody answers within 20 seconds
                </DialCode>
                <DialCode value={`**67*${target}#`} copyable={hasNumber}>
                  Mobiles: forward calls while you’re on another call
                </DialCode>
                <DialCode value="##61# / ##67#" copyable={false}>
                  Undo either one (your voicemail may need switching back on)
                </DialCode>
                <DialCode value={`*72 ${target}`} copyable={false}>
                  US landlines: forward every call (<code className={code}>*73</code> stops it)
                </DialCode>
              </dl>
              <p>Codes vary by carrier (Verizon uses its own). Your carrier or phone system can also set “forward when unanswered” for you.</p>
            </Step>

            <Step n={4} title="Answer WhatsApp too" who={`Whoever runs your ${PRODUCT_NAME} ElevenLabs account`} optional done={hasWhatsApp}>
              <p>
                In ElevenLabs open <strong className="font-medium text-foreground">Agents → WhatsApp → Import account</strong>, sign in with the hotel’s Meta business account and assign the same agent. The assistant then answers WhatsApp
                messages — and WhatsApp calls, once calling is turned on in WhatsApp Manager.
              </p>
              <p>A number can’t be in the WhatsApp Business app at the same time. The easy choice: use the assistant’s own number for WhatsApp, and keep the app on the hotel’s number for your team.</p>
            </Step>

            <Step n={5} title="Test it">
              <p>
                Call the assistant’s number directly first — ask for a room next weekend, then leave a message and check it lands in Messages. Then call your hotel number and let it ring through, or send the WhatsApp
                number a message.
              </p>
            </Step>
          </ol>
          <p className="mt-5 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
            Calls cost about $0.08–0.10 a minute in ElevenLabs, plus your phone provider’s rate. Calls end after 10 minutes, or after 45 seconds of silence.
          </p>
        </Card>
      )}

      {/* Call handling */}
      <div className="space-y-4">
        <fieldset disabled={!data.canManage}>
          <legend className="sr-only">Call handling</legend>
          <Card className="divide-y p-0">
            <div className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p id="p-enabled-label" className="text-sm font-medium">
                  Answer calls on this line
                </p>
                <p id="p-enabled-desc" className="mt-0.5 text-sm text-muted-foreground">
                  Paused lines play a short “not available right now” message.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-labelledby="p-enabled-label" aria-describedby="p-enabled-desc" />
            </div>
            <div className="p-5">
              <Field
                label="Put callers through to"
                optional
                hint="When a caller asks for a person. Use a direct line or mobile that doesn’t forward back to the assistant — otherwise calls loop. Leave it empty to take a message instead."
              >
                <Input type="tel" inputMode="tel" autoComplete="tel" value={transfer} onChange={(e) => setTransfer(e.target.value)} placeholder="+1 831 555 0100" maxLength={40} />
              </Field>
            </div>
          </Card>
        </fieldset>
        {data.canManage ? (
          <SaveBar
            dirty={dirty}
            saving={saving}
            onSave={() => void save({ enabled, transferNumber: transfer })}
            onDiscard={() => {
              setEnabled(data.line!.enabled);
              setTransfer(data.line!.transferNumber ?? '');
            }}
            saveLabel="Save phone line"
          />
        ) : (
          !data.locked && <p className="text-sm text-muted-foreground">Only the hotel owner can change the phone line.</p>
        )}
      </div>
    </div>
  );
}
