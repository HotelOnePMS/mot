'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Ban,
  Cable,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock3,
  Cloud,
  Download,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  Pause,
  Play,
  Plug,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Unplug,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Callout, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { WelcomeBanner } from '@/components/console/WelcomeBanner';
import { DeveloperNote } from '@/components/setup/DeveloperNote';
import { CommandLine, EMPTY_MCP_FORM, McpPanel, McpSetupFields, authPayload, mcpFormReady, useDemoLocked, type McpForm, type McpStatus } from './mcp';

interface Connection {
  id: string;
  system: string;
  mode: 'DESKTOP' | 'CLOUD' | 'MCP';
  status: 'PENDING' | 'CONNECTED' | 'ERROR' | 'PAUSED';
  loginUrl: string | null;
  hasCredentials: boolean;
  deviceName: string | null;
  devicePaired: boolean;
  lastSeenAt: string | null;
  online: boolean;
  lastError: string | null;
  pairing: { code: string; expiresAt: string } | null;
}
interface Task {
  id: string;
  kind: string;
  instruction: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'NEEDS_HELP' | 'CANCELLED';
  summary: string | null;
  error: string | null;
  createdAt: string;
  /** 'mcp' when it ran through the PMS's MCP server. */
  via?: string | null;
}
interface BridgeData {
  connection: Connection | null;
  tasks: Task[];
  systems: string[];
  operator: { ready: boolean; model: string };
  vaultReady: boolean;
  cloudWorker: boolean;
}

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';
/** The renamed connector; installs of the older stayos-connector.mjs keep working. */
const CONNECTOR = 'hotelone-connector.mjs';
/** What computers paired before the rename downloaded; still supported. */
const LEGACY_CONNECTOR = 'stayos-connector.mjs';
const INSTALL = 'npm i playwright && npx playwright install chromium';

const TASK_STATUS: Record<Task['status'], { label: string; variant: BadgeProps['variant']; icon: LucideIcon; spin?: boolean; className?: string }> = {
  QUEUED: { label: 'Waiting', variant: 'neutral', icon: Clock3 },
  RUNNING: { label: 'Working on it', variant: 'info', icon: Loader2, spin: true },
  DONE: { label: 'Done', variant: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Failed', variant: 'danger', icon: CircleAlert },
  NEEDS_HELP: { label: 'Needs your help', variant: 'warning', icon: CircleAlert },
  CANCELLED: { label: 'Cancelled', variant: 'outline', icon: Ban, className: 'text-muted-foreground' },
};

const stepDot = 'flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong/60 text-xs font-semibold tabular';

/** A selectable card backed by a real (visually hidden) radio input. */
function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  className,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer rounded-xl border bg-card text-left transition-[border-color,background-color,box-shadow] hover:border-border-strong/60 hover:bg-accent/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
        checked && 'border-primary bg-primary-soft/50 ring-1 ring-primary hover:border-primary hover:bg-primary-soft/60',
        className
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}

function Setup({ data, initial, onDone }: { data: BridgeData; initial?: Connection | null; onDone: () => void }) {
  const { propertyId, can } = useConsole();
  const { mutate } = useSWRConfig();
  const [system, setSystem] = React.useState(initial?.system ?? '');
  const [other, setOther] = React.useState('');
  const [mode, setMode] = React.useState<Connection['mode']>(initial?.mode ?? 'DESKTOP');
  const wasMcp = initial?.mode === 'MCP';
  // An MCP address is shown with its query values masked ("…"); then it has to be pasted again.
  const knownMcpUrl = wasMcp && initial?.loginUrl && !initial.loginUrl.includes('…') ? initial.loginUrl : '';
  const [loginUrl, setLoginUrl] = React.useState(wasMcp ? '' : (initial?.loginUrl ?? ''));
  const [mcpForm, setMcpForm] = React.useState<McpForm>({ ...EMPTY_MCP_FORM, url: knownMcpUrl });
  const [test, setTest] = React.useState<{ result: React.ComponentProps<typeof McpSetupFields>['test']['result']; error: string | null }>({ result: null, error: null });
  const [busy, setBusy] = React.useState<null | 'save' | 'test'>(null);
  const locked = useDemoLocked();
  const chosen = system === 'Other' ? other.trim() : system;
  const keepToken = wasMcp && !!knownMcpUrl && mcpForm.url.trim() === knownMcpUrl;

  // Reconnecting: start from how the saved connection signs in.
  const statusUrl = usePropertyUrl('/api/admin/pms');
  const { data: saved } = useSWR<McpStatus>(wasMcp ? statusUrl : null, fetcher);
  const seeded = React.useRef(false);
  React.useEffect(() => {
    const m = saved?.mcp;
    if (!m || seeded.current) return;
    seeded.current = true;
    if (m.authType === 'bearer' || m.authType === 'header' || m.authType === 'none') {
      setMcpForm((f) => ({ ...f, authType: m.authType as McpForm['authType'], headerName: m.authHeaderName ?? f.headerName }));
    }
  }, [saved]);

  const updateMcp = (f: McpForm) => {
    setMcpForm(f);
    setTest({ result: null, error: null });
  };

  async function save() {
    setBusy('save');
    try {
      await api('/api/admin/bridge', { method: 'PUT', json: { propertyId, system: chosen, mode, loginUrl: loginUrl.trim() || null } });
      await mutate('/api/admin/context');
      toast.success(`${chosen} added — finish connecting below`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function testMcp() {
    setBusy('test');
    setTest({ result: null, error: null });
    try {
      const result = await api<NonNullable<typeof test.result>>('/api/admin/pms/test', { method: 'POST', json: { propertyId, url: mcpForm.url.trim(), auth: authPayload(mcpForm) } });
      setTest({ result, error: null });
    } catch (e) {
      setTest({ result: null, error: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  async function connectMcp() {
    setBusy('save');
    setTest({ result: null, error: null });
    try {
      const r = await api<McpStatus>('/api/admin/pms/connect', { method: 'POST', json: { propertyId, system: chosen, url: mcpForm.url.trim(), auth: authPayload(mcpForm) } });
      await mutate('/api/admin/context');
      if (statusUrl) await mutate(statusUrl, r, { revalidate: false });
      toast.success(`Connected to ${chosen} — ${r.mcp?.toolCount ?? 0} tools found`);
      onDone();
    } catch (e) {
      setTest({ result: null, error: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const mcpReady = !!chosen && mcpFormReady(mcpForm, keepToken) && !locked && (mcpForm.authType === 'none' || data.vaultReady);

  if (!can('bridge.manage')) {
    return (
      <Card>
        <EmptyState icon={Cable} title="Not connected yet" description="Ask the owner to connect your PMS so the agent can look things up and make changes there." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <fieldset>
          <legend className="flex items-center gap-3 text-base font-semibold tracking-tight">
            <span className={stepDot} aria-hidden>
              1
            </span>
            Which system do you use today?
          </legend>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.systems.map((s) => (
              <ChoiceCard key={s} name="pms-system" value={s} checked={system === s} onChange={() => setSystem(s)} className="min-h-12 items-center justify-between gap-2 px-3 py-2.5">
                <span className="text-sm font-medium">{s}</span>
                {system === s && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
              </ChoiceCard>
            ))}
          </div>
        </fieldset>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {system === 'Other' && (
            <Field label="Your PMS name" required>
              <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. RoomKey" autoFocus />
            </Field>
          )}
          {mode !== 'MCP' && (
            <Field label="Sign-in address" optional hint="Where you log in to it, like https://hotels.cloudbeds.com — the operator starts there." className={system === 'Other' ? '' : 'sm:col-span-2 sm:max-w-xl'}>
              <Input type="url" inputMode="url" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="https://" />
            </Field>
          )}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <fieldset>
          <legend className="flex items-center gap-3 text-base font-semibold tracking-tight">
            <span className={stepDot} aria-hidden>
              2
            </span>
            How should {PRODUCT_NAME} reach it?
          </legend>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(
              [
                {
                  m: 'DESKTOP',
                  icon: Laptop,
                  title: 'From a front-desk computer',
                  text: `Run the small ${PRODUCT_NAME} Connector on a computer at the hotel. It uses a browser that’s already signed in — your logins never leave the building.`,
                  tag: 'Most private',
                },
                {
                  m: 'CLOUD',
                  icon: Cloud,
                  title: `In the ${PRODUCT_NAME} cloud browser`,
                  text: 'Nothing to install. We sign in with a login you store here, sealed with AES-256 and never shown to the AI or to anyone.',
                  tag: 'Nothing to install',
                },
                {
                  m: 'MCP',
                  icon: Plug,
                  title: 'Through your PMS’s MCP server',
                  text: `If ${chosen || 'your PMS'} offers an MCP server, paste its address and token. ${PRODUCT_NAME} works with your PMS directly — no browser, answers in seconds.`,
                  tag: 'Fastest',
                },
              ] as const
            ).map((o) => (
              <ChoiceCard key={o.m} name="pms-mode" value={o.m} checked={mode === o.m} onChange={() => setMode(o.m)} className="flex-col rounded-2xl p-5">
                <span className="flex items-center justify-between gap-2">
                  <o.icon className={cn('size-5', mode === o.m ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                  <Badge variant={mode === o.m ? 'primary' : 'neutral'} size="sm">
                    {o.tag}
                  </Badge>
                </span>
                <span className="mt-3 font-semibold">{o.title}</span>
                <span className="mt-1 text-sm text-muted-foreground">{o.text}</span>
              </ChoiceCard>
            ))}
          </div>
        </fieldset>
      </Card>

      {mode === 'MCP' && <McpSetupFields system={chosen} form={mcpForm} setForm={updateMcp} keepToken={keepToken} vaultReady={data.vaultReady} locked={locked} test={test} />}

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        {(!chosen || (mode === 'MCP' && !mcpReady)) && (
          <p className="text-sm text-muted-foreground sm:mr-auto" id="pms-continue-hint">
            {!chosen ? 'Choose your system to continue.' : locked ? 'Demo hotels can’t connect an outside PMS.' : 'Add the MCP server address and its token to continue.'}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {initial && (
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          )}
          {mode === 'MCP' ? (
            <>
              <Button variant="outline" onClick={testMcp} loading={busy === 'test'} loadingText="Testing…" disabled={!mcpReady || !!busy} aria-describedby={!mcpReady ? 'pms-continue-hint' : undefined}>
                Test connection
              </Button>
              <Button onClick={connectMcp} loading={busy === 'save'} loadingText="Connecting…" disabled={!mcpReady || !!busy} aria-describedby={!mcpReady ? 'pms-continue-hint' : undefined}>
                <Plug aria-hidden /> Connect
              </Button>
            </>
          ) : (
            <Button onClick={save} loading={busy === 'save'} loadingText="Saving…" disabled={!chosen} aria-describedby={!chosen ? 'pms-continue-hint' : undefined}>
              {initial ? 'Save' : 'Continue'} <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DesktopPanel({ c, onChange }: { c: Connection; onChange: () => void }) {
  const { propertyId, can } = useConsole();
  const [busy, setBusy] = React.useState(false);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const left = c.pairing ? Math.max(0, Math.round((new Date(c.pairing.expiresAt).getTime() - now) / 1000)) : 0;
  const command = c.pairing ? `node ${CONNECTOR} pair ${c.pairing.code} --server ${origin}` : '';

  async function newCode() {
    setBusy(true);
    try {
      await api('/api/admin/bridge/pairing', { method: 'POST', json: { propertyId } });
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setRevoking(true);
    try {
      await api(`/api/admin/bridge/pairing?propertyId=${propertyId}`, { method: 'DELETE' });
      toast.success('Connector disconnected');
      setConfirmRevoke(false);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <Laptop className="size-4 text-muted-foreground" aria-hidden /> {PRODUCT_NAME} Connector on a front-desk computer
      </h2>
      {c.devicePaired ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
          <span className={cn('size-2.5 shrink-0 rounded-full', c.online ? 'bg-success' : 'bg-border-strong')} aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">
              {c.deviceName ?? 'Paired computer'}
              <span className="sr-only">{c.online ? ', online' : ', offline'}</span>
            </p>
            <p className="text-muted-foreground">
              {c.online ? 'Online — ready for work' : c.lastSeenAt ? `Last seen ${timeAgo(c.lastSeenAt)} — start the connector again on that computer:` : 'Waiting for it to start:'}
            </p>
            {!c.online && (
              <div className="mt-2 max-w-md space-y-2">
                <CommandLine command={`node ${CONNECTOR} run`} label="Copy the start command" />
                {/* Computers paired before the rename have the older file; it keeps working. */}
                <p className="text-xs text-muted-foreground">
                  Set up before the {PRODUCT_NAME} name? That computer has the older file — run <code className="font-mono">node {LEGACY_CONNECTOR} run</code> instead.
                </p>
              </div>
            )}
          </div>
          {can('bridge.manage') && (
            <Button size="sm" variant="ghost" className="self-start text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground sm:self-center" onClick={() => setConfirmRevoke(true)}>
              <Unplug aria-hidden /> Disconnect
            </Button>
          )}
        </div>
      ) : (
        <ol className="mt-5 space-y-5 text-sm">
          <li className="flex gap-3">
            <span className={stepDot} aria-hidden>
              1
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-medium">Download the connector on the front-desk computer</p>
              <p className="text-muted-foreground">It needs Node.js 20 or newer. Then install the browser it drives — one command, once:</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button asChild size="sm" variant="outline" className="self-start">
                  <a href={`/downloads/${CONNECTOR}`} download>
                    <Download aria-hidden /> Download {CONNECTOR}
                  </a>
                </Button>
                <div className="min-w-0 flex-1">
                  <CommandLine command={INSTALL} label="Copy the install command" />
                </div>
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className={stepDot} aria-hidden>
              2
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-medium">Pair it with a one-time code</p>
              {c.pairing && left > 0 ? (
                <div className="rounded-xl border bg-surface-sunken/60 p-4">
                  <p className="font-mono text-3xl font-semibold tracking-[0.3em]" aria-label={`Pairing code ${c.pairing.code.split('').join(' ')}`}>
                    {c.pairing.code}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground" aria-hidden>
                    Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                  </p>
                  <p className="mt-3 text-muted-foreground">In the folder you downloaded it to, run:</p>
                  <div className="mt-1.5">
                    <CommandLine command={command} label="Copy the pairing command" />
                  </div>
                </div>
              ) : (
                <Button size="sm" onClick={newCode} loading={busy} loadingText="Creating a code…" disabled={!can('bridge.manage')}>
                  <KeyRound aria-hidden /> Create pairing code
                </Button>
              )}
            </div>
          </li>
          <li className="flex gap-3">
            <span className={stepDot} aria-hidden>
              3
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-medium">Start it and sign in to {c.system}</p>
              <p className="text-muted-foreground">Sign in to {c.system} in the browser window that opens, and leave it running.</p>
              <div className="max-w-md">
                <CommandLine command={`node ${CONNECTOR} run`} label="Copy the start command" />
              </div>
              <p className="text-xs text-muted-foreground">Already using the older {LEGACY_CONNECTOR}? It keeps working — no need to reinstall.</p>
            </div>
          </li>
        </ol>
      )}
      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={`Disconnect ${c.deviceName ?? 'this computer'}?`}
        description="It stops working for the agent right away. You can pair it again later with a new code."
        confirmLabel="Disconnect"
        destructive
        loading={revoking}
        onConfirm={() => void revoke()}
      />
    </Card>
  );
}

function CloudPanel({ c, data, onChange }: { c: Connection; data: BridgeData; onChange: () => void }) {
  const { propertyId, can, role } = useConsole();
  const [form, setForm] = React.useState({ username: '', password: '', totpSecret: '' });
  const [editing, setEditing] = React.useState(!c.hasCredentials);
  const [busy, setBusy] = React.useState(false);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/admin/bridge/credentials', { method: 'PUT', json: { propertyId, ...form, totpSecret: form.totpSecret.trim() || null } });
      setForm({ username: '', password: '', totpSecret: '' });
      setEditing(false);
      toast.success('Login sealed and stored');
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setRemoving(true);
    try {
      await api(`/api/admin/bridge/credentials?propertyId=${propertyId}`, { method: 'DELETE' });
      setEditing(true);
      setConfirmRemove(false);
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRemoving(false);
    }
  }
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
        <Cloud className="size-4 text-muted-foreground" aria-hidden /> Cloud browser login
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a dedicated {c.system} user for {PRODUCT_NAME} if you can — you can see and revoke its access from {c.system} at any time.
      </p>
      {!editing && c.hasCredentials ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
          <Lock className="size-5 shrink-0 text-success" aria-hidden />
          <div className="flex-1 text-sm">
            <p className="font-medium">Login stored and sealed</p>
            <p className="text-muted-foreground">Encrypted with AES-256-GCM. Never shown again, never sent to the AI.</p>
          </div>
          {can('bridge.manage') && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Replace
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground" onClick={() => setConfirmRemove(true)}>
                Remove
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-4">
          {!data.vaultReady && (
            <Callout tone="warning" title="Secure storage isn’t set up on this server yet">
              <p>Logins can’t be saved until it is. You can use the desktop connector in the meantime.</p>
              <DeveloperNote open={role === 'ADMIN'} className="mt-3">
                <p>
                  Set <code>HOTELONE_VAULT_KEY</code> on the server and redeploy (an existing <code>STAYOS_VAULT_KEY</code> also works).
                </p>
              </DeveloperNote>
            </Callout>
          )}
          <fieldset disabled={!can('bridge.manage') || !data.vaultReady} className="grid gap-4 sm:grid-cols-2">
            <legend className="sr-only">{c.system} login</legend>
            <Field label="Username" required>
              <Input autoComplete="off" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Password" required>
              <Input type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Authenticator setup key" optional className="sm:col-span-2" hint="If your PMS uses 2-step codes, paste the setup key so the cloud browser can generate them.">
              <Input autoComplete="off" value={form.totpSecret} onChange={(e) => setForm({ ...form, totpSecret: e.target.value })} className="font-mono" />
            </Field>
          </fieldset>
          <div className="flex justify-end gap-2">
            {c.hasCredentials && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" loading={busy} loadingText="Sealing…" disabled={!form.username || !form.password || !data.vaultReady}>
              <ShieldCheck aria-hidden /> Seal and save
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the stored login?"
        description={`The cloud browser can’t sign in to ${c.system} until you store a new one. Waiting tasks stay in the queue.`}
        confirmLabel="Remove login"
        destructive
        loading={removing}
        onConfirm={() => void remove()}
      />
    </Card>
  );
}

function TaskList({ tasks, onChange }: { tasks: Task[]; onChange: () => void }) {
  const [acting, setActing] = React.useState<string | null>(null);
  const act = async (id: string, action: 'cancel' | 'retry') => {
    setActing(id);
    try {
      await api(`/api/admin/bridge/tasks/${id}`, { method: 'PATCH', json: { action } });
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActing(null);
    }
  };
  if (!tasks.length) {
    return (
      <Card>
        <EmptyState icon={Search} title="Nothing sent yet" description="Ask the agent — or type a look-up or change in the box above and send it." className="py-10" />
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <ul className="divide-y">
        {tasks.map((t) => {
          const s = TASK_STATUS[t.status];
          return (
            <li key={t.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{t.instruction}</p>
                {t.summary && <p className="mt-1 text-sm text-muted-foreground">{t.summary}</p>}
                {t.error && <p className="mt-1 text-sm text-destructive">{t.error}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.kind === 'LOOKUP' ? 'Look-up' : 'Change'}
                  {t.via === 'mcp' ? ' · via MCP' : ''} · <time dateTime={t.createdAt}>{timeAgo(t.createdAt)}</time>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={s.variant} size="sm" className={cn(s.className, s.spin && 'motion-safe:[&_svg]:animate-spin')} icon={s.icon}>
                  {s.label}
                </Badge>
                {/* A fixed-width action column keeps every status badge lined up. */}
                <div className="flex justify-end sm:w-24">
                  {t.status === 'QUEUED' && (
                    <Button size="sm" variant="ghost" onClick={() => act(t.id, 'cancel')} loading={acting === t.id} aria-label={`Cancel “${t.instruction.slice(0, 60)}”`}>
                      Cancel
                    </Button>
                  )}
                  {(t.status === 'FAILED' || t.status === 'NEEDS_HELP') && (
                    <Button size="sm" variant="ghost" onClick={() => act(t.id, 'retry')} loading={acting === t.id}>
                      <RotateCcw aria-hidden /> Retry
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function ConnectPage() {
  const { propertyId, property, can, askAgent, role } = useConsole();
  const { mutate: globalMutate } = useSWRConfig();
  const reduce = useReducedMotion();
  const url = usePropertyUrl('/api/admin/bridge');
  const { data, mutate } = useSWR<BridgeData>(url, fetcher, {
    refreshInterval: (d) => (d?.tasks.some((t) => t.status === 'QUEUED' || t.status === 'RUNNING') || d?.connection?.pairing ? 3000 : 15000),
  });
  const [editing, setEditing] = React.useState(false);
  const [instruction, setInstruction] = React.useState('');
  const [sending, setSending] = React.useState<null | 'LOOKUP' | 'FREEFORM'>(null);
  const [confirm, setConfirm] = React.useState<null | 'disconnect' | 'migrate' | 'change'>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  const c = data?.connection;
  const isAdmin = role === 'ADMIN';
  const mcp = c?.mode === 'MCP';

  async function send(kind: 'LOOKUP' | 'FREEFORM') {
    setSending(kind);
    try {
      await api('/api/admin/bridge/tasks', { method: 'POST', json: { propertyId, instruction, kind } });
      setInstruction('');
      setConfirm(null);
      await mutate();
      toast.success(kind === 'LOOKUP' ? 'Look-up sent' : mcp ? `Change sent to ${c?.system}` : 'Change sent to the operator');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(null);
    }
  }
  async function pause(paused: boolean) {
    try {
      await api('/api/admin/bridge', { method: 'PATCH', json: { propertyId, paused } });
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function disconnect() {
    setConfirmBusy(true);
    try {
      // MCP connections go through their own route (demo lock, cached tools removed).
      await api(`${mcp ? '/api/admin/pms' : '/api/admin/bridge'}?propertyId=${propertyId}`, { method: 'DELETE' });
      setConfirm(null);
      await mutate();
      await globalMutate('/api/admin/context');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirmBusy(false);
    }
  }
  async function migrate() {
    setConfirmBusy(true);
    try {
      await api('/api/admin/setup-path', { method: 'PUT', json: { propertyId, setupPath: 'FULL' } });
      await globalMutate('/api/admin/context');
      toast.success(`Welcome to ${PRODUCT_NAME} — your front desk now runs here`);
      window.location.href = '/admin/dashboard?welcome=1';
    } catch (e) {
      toast.error((e as Error).message);
      setConfirmBusy(false);
    }
  }

  const ready =
    c && c.status !== 'PAUSED' && (c.mode === 'MCP' ? c.status === 'CONNECTED' || c.status === 'ERROR' : c.mode === 'CLOUD' ? c.hasCredentials && data?.cloudWorker : c.devicePaired);
  const statusBadge = !c ? null : c.status === 'PAUSED' ? (
    <Badge variant="neutral" icon={Pause}>
      Paused
    </Badge>
  ) : ready && c.mode === 'DESKTOP' && !c.online ? (
    // Paired, but the computer isn't running the connector right now.
    <Badge variant="warning" icon={CircleAlert}>
      Computer offline
    </Badge>
  ) : ready && c.mode === 'MCP' && c.status === 'ERROR' ? (
    // Connected, but the last call to the PMS's server failed.
    <Badge variant="warning" icon={CircleAlert}>
      Not answering
    </Badge>
  ) : ready ? (
    <Badge variant="success" icon={CheckCircle2}>
      Ready
    </Badge>
  ) : (
    <Badge variant="warning" icon={CircleDashed}>
      {c.mode === 'CLOUD' && c.hasCredentials ? 'Waiting for the cloud browser' : 'Finish setup'}
    </Badge>
  );

  return (
    <div className={FRAME}>
      <div className="space-y-6">
        <PageHeader
          title="Your PMS"
          description={
            c
              ? `${PRODUCT_NAME} works in ${c.system} for ${property?.name ?? 'your hotel'} — nothing to migrate.`
              : 'Keep the system you know. Connect it once and the agent looks things up and makes changes there for you.'
          }
          actions={
            c && can('bridge.manage') && !editing ? (
              <>
                <Button variant="outline" size="sm" onClick={() => pause(c.status !== 'PAUSED')}>
                  {c.status === 'PAUSED' ? <Play aria-hidden /> : <Pause aria-hidden />} {c.status === 'PAUSED' ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  {mcp ? 'Change connection' : 'Change system'}
                </Button>
              </>
            ) : undefined
          }
        />

        <WelcomeBanner title={`Welcome to ${PRODUCT_NAME} — one step left`}>
          Finish connecting {c?.system ?? 'your system'} below. Then open the Agent and ask “who’s arriving today?” — it will check {c?.system ?? 'your PMS'} for you.
        </WelcomeBanner>

        {!data ? (
          <div className="space-y-6" aria-busy>
            <Skeleton className="h-[96px] rounded-2xl" />
            <Skeleton className="h-[280px] rounded-2xl" />
            <span className="sr-only" role="status">
              Loading your PMS connection…
            </span>
          </div>
        ) : !c || editing ? (
          <Setup
            data={data}
            initial={editing ? c : null}
            onDone={() => {
              setEditing(false);
              void mutate();
            }}
          />
        ) : (
          <>
            <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground" aria-hidden>
                  {mcp ? <Plug className="size-6" /> : <Cable className="size-6" />}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold tracking-tight">{c.system}</h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {c.mode === 'MCP' ? `${c.system}’s MCP server` : c.mode === 'CLOUD' ? `${PRODUCT_NAME} cloud browser` : `${PRODUCT_NAME} Connector on a front-desk computer`}
                    {c.loginUrl ? ` · ${c.loginUrl.replace(/^https?:\/\//, '')}` : ''}
                  </p>
                </div>
                <span aria-live="polite">{statusBadge}</span>
              </Card>
            </motion.div>

            {c.lastError && (
              <Callout tone="warning" title={mcp ? `The last call to ${c.system} ran into a problem` : 'The last task ran into a problem'}>
                {c.lastError}
              </Callout>
            )}
            {c.mode === 'CLOUD' && !data.cloudWorker && (
              <Callout tone="info" title="The cloud browser isn’t running on this server yet">
                <p>Tasks wait in the queue until it starts — or switch to the desktop connector.</p>
                <DeveloperNote open={isAdmin} className="mt-3">
                  <p>
                    Start the cloud worker with <code>BRIDGE_WORKER_SECRET</code> set on both the server and the worker.
                  </p>
                </DeveloperNote>
              </Callout>
            )}
            {mcp && !data.operator.ready && (
              <Callout tone="info" title="Everyday requests work now">
                <p>Look-ups, check-ins and the other recommended tools run directly. Requests outside them need the AI planner, which isn’t switched on yet.</p>
                <DeveloperNote open={isAdmin} className="mt-3">
                  <p>
                    The planner runs on the {PRODUCT_NAME} server and needs <code>OPENAI_API_KEY</code> there (model: <code>PMS_MCP_MODEL</code>).
                  </p>
                </DeveloperNote>
              </Callout>
            )}
            {!mcp && !data.operator.ready && (
              <Callout tone="info" title="The operator isn’t switched on yet">
                <p>Tasks queue up and run as soon as it is.</p>
                <DeveloperNote open={isAdmin} className="mt-3">
                  <p>
                    The operator runs on the {PRODUCT_NAME} server and needs <code>OPENAI_API_KEY</code> there.
                  </p>
                </DeveloperNote>
              </Callout>
            )}

            {c.mode === 'MCP' ? (
              <McpPanel system={c.system} onChange={() => void mutate()} />
            ) : c.mode === 'DESKTOP' ? (
              <DesktopPanel c={c} onChange={() => void mutate()} />
            ) : (
              <CloudPanel c={c} data={data} onChange={() => void mutate()} />
            )}

            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight">Send something to {c.system}</h2>
                {can('agent.use') && (
                  <Button variant="outline" size="sm" onClick={() => askAgent(`who is arriving today?`)}>
                    <Sparkles className="text-agent" aria-hidden /> Or ask the agent
                  </Button>
                )}
              </div>
              <Field label={mcp ? `What should ${PRODUCT_NAME} do in ${c.system}?` : 'What should the operator do?'} hint="Look-ups only read. Changes ask you to confirm first." className="mt-4">
                <Textarea
                  rows={2}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. Find the reservation for Jordan Smith arriving Friday and tell me the room and balance"
                />
              </Field>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => send('LOOKUP')} loading={sending === 'LOOKUP'} loadingText="Sending…" disabled={instruction.trim().length < 4}>
                  <Search aria-hidden /> Look it up
                </Button>
                <Button onClick={() => setConfirm('change')} disabled={instruction.trim().length < 4}>
                  <Wand2 aria-hidden /> Make this change
                </Button>
              </div>
            </Card>

            <section aria-labelledby="pms-recent" className="space-y-3">
              <h2 id="pms-recent" className="text-base font-semibold tracking-tight">
                Recent work
              </h2>
              <TaskList tasks={data.tasks} onChange={() => void mutate()} />
            </section>

            {can('property.write') && (
              <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
                <div className="flex-1">
                  <h2 className="text-base font-semibold tracking-tight">Ready to run everything on {PRODUCT_NAME}?</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Switch when it suits you — we’ll help move your rooms, rates and upcoming reservations. Your connection keeps working until you do.</p>
                </div>
                <Button variant="outline" onClick={() => setConfirm('migrate')}>
                  Move to {PRODUCT_NAME} <ArrowRight aria-hidden />
                </Button>
              </Card>
            )}

            {can('bridge.manage') && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground" onClick={() => setConfirm('disconnect')}>
                  <Unplug aria-hidden /> Disconnect {c.system}
                </Button>
              </div>
            )}
          </>
        )}

        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm === 'change' ? `Make this change in ${c?.system}?` : confirm === 'migrate' ? `Run this property on ${PRODUCT_NAME}?` : `Disconnect ${c?.system}?`}
          description={
            confirm === 'change'
              ? `“${instruction.trim()}” — ${mcp ? PRODUCT_NAME : 'the operator'} changes only this and reports exactly what it did.`
              : confirm === 'migrate'
                ? `Front desk, housekeeping, reservations and rates switch to ${PRODUCT_NAME} screens. Add your rooms and upcoming stays (we can help) before you stop using your old system.`
                : mcp
                  ? `Waiting tasks are cancelled, the stored token is deleted and ${c?.system}’s tools are removed from ${PRODUCT_NAME}.`
                  : 'Waiting tasks are cancelled and the stored login or paired computer stops working immediately.'
          }
          confirmLabel={confirm === 'change' ? 'Send change' : confirm === 'migrate' ? `Switch to ${PRODUCT_NAME}` : 'Disconnect'}
          cancelLabel={confirm === 'disconnect' ? 'Keep it connected' : 'Not now'}
          destructive={confirm === 'disconnect'}
          loading={(confirm === 'change' && sending === 'FREEFORM') || (confirm !== 'change' && confirmBusy)}
          onConfirm={() => (confirm === 'change' ? send('FREEFORM') : confirm === 'migrate' ? migrate() : disconnect())}
        />
      </div>
    </div>
  );
}
