'use client';

/**
 * Connect page pieces for PMSs that offer their own MCP server: the setup
 * fields (address + how it signs in, test before saving) and the connected
 * view (server, tools the agent may use, events webhook). API: /api/admin/pms.
 */
import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Ban, Check, CircleDashed, KeyRound, Plug, RotateCcw, Stethoscope, Webhook } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME, isDemoEmail } from '@/config/product';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { CopyButton } from '@/components/setup/CopyButton';

export type McpAuthType = 'bearer' | 'header' | 'none';
export interface McpForm {
  url: string;
  authType: McpAuthType;
  headerName: string;
  token: string;
}
export const EMPTY_MCP_FORM: McpForm = { url: '', authType: 'bearer', headerName: 'X-API-Key', token: '' };

interface Coverage {
  matched: number;
  total: number;
  operations: { operation: string; title: string; writes: boolean; tool: string | null }[];
}
interface TestResult {
  ok: true;
  server: { name: string; title: string | null; version: string | null; protocolVersion: string };
  toolCount: number;
  contract: Coverage;
  ms: number;
}
interface McpTool {
  key: string;
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  contract: string | null;
  blocked: boolean;
  status: string;
  uses: number;
}
export interface McpStatus {
  connection: { id: string; system: string; mode: string; status: string; lastSeenAt: string | null; lastError: string | null; events: { url: string; path: string } } | null;
  mcp: {
    url: string | null;
    authType: string;
    authHeaderName: string | null;
    hasToken: boolean;
    vaultReadable: boolean;
    server: { name: string; title: string | null; version: string | null; protocolVersion: string; checkedAt: string } | null;
    toolCount: number;
    activeCount: number;
    lastToolsSyncAt: string | null;
    contract: Coverage;
    tools: McpTool[];
    plannerReady: boolean;
  } | null;
  vaultReady: boolean;
  planner: { ready: boolean; model: string };
}

/** Mirrors the server's demo lock (src/server/demo.ts) so the form explains it up front. */
export function useDemoLocked(): boolean {
  const { property, role, ctx } = useConsole();
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true' || role === 'ADMIN') return false;
  return !!property?.isDemo || isDemoEmail(ctx?.user.email ?? '');
}

export function CommandLine({ command, label }: { command: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-lg border bg-surface-sunken py-1 pl-3 pr-1">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 font-mono text-xs text-foreground scrollbar-thin">{command}</code>
      <CopyButton iconOnly value={command} label={label} />
    </div>
  );
}

export function authPayload(f: McpForm) {
  return f.authType === 'none' ? { type: 'none' as const } : f.authType === 'header' ? { type: 'header' as const, headerName: f.headerName.trim(), token: f.token.trim() } : { type: 'bearer' as const, token: f.token.trim() };
}

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const serverName = (s: { name: string; title: string | null; version: string | null }) => `${s.title || s.name}${s.version ? ` ${s.version}` : ''}`;

/** Step 3 of setup when the hotel picked "Through your PMS's MCP server". */
export function McpSetupFields({
  system,
  form,
  setForm,
  keepToken,
  vaultReady,
  locked,
  test,
}: {
  system: string;
  form: McpForm;
  setForm: (f: McpForm) => void;
  /** Reconnecting to the same address: an empty token keeps the stored one. */
  keepToken: boolean;
  vaultReady: boolean;
  locked: boolean;
  test: { result: TestResult | null; error: string | null };
}) {
  const set = (patch: Partial<McpForm>) => setForm({ ...form, ...patch });
  const name = system || 'your PMS';
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="flex items-center gap-3 text-base font-semibold tracking-tight">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong/60 text-xs font-semibold tabular" aria-hidden>
          3
        </span>
        Connect to {name}’s MCP server
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask {name} for its MCP server address and an access token for this hotel.{' '}
        <Link href="/developers/pms" className="font-medium text-primary underline-offset-4 hover:underline">
          What PMS companies need to offer
        </Link>
      </p>
      <div className="mt-4 space-y-3">
        {locked && <Callout tone="warning" title="Demo hotels can’t be connected to an outside PMS">Set up your own hotel to connect yours.</Callout>}
        {!vaultReady && form.authType !== 'none' && (
          <Callout tone="warning" title="Secure storage isn’t set up on this server yet">
            Tokens can’t be saved until it is (platform admin: set HOTELONE_VAULT_KEY).
          </Callout>
        )}
      </div>
      <fieldset disabled={locked} className="mt-4 grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">MCP server</legend>
        <Field label="MCP server address" required className="sm:col-span-2 sm:max-w-xl" hint="It starts with https:// — for example https://mcp.yourpms.com/mcp">
          <Input type="url" inputMode="url" autoComplete="off" spellCheck={false} required value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium" id="mcp-auth-label">
            How it signs in
          </p>
          <SegmentedControl<McpAuthType>
            layoutId="mcp-auth"
            aria-label="How the MCP server signs in"
            value={form.authType}
            onChange={(v) => set({ authType: v })}
            options={[
              { value: 'bearer', label: 'Access token' },
              { value: 'header', label: 'Custom header' },
              { value: 'none', label: 'No token' },
            ]}
          />
        </div>
        {form.authType === 'header' && (
          <Field label="Header name" required hint="The header your PMS expects, e.g. X-API-Key.">
            <Input autoComplete="off" spellCheck={false} value={form.headerName} onChange={(e) => set({ headerName: e.target.value })} className="font-mono" placeholder="X-API-Key" />
          </Field>
        )}
        {form.authType !== 'none' && (
          <Field
            label="Token"
            required={!keepToken}
            optional={keepToken}
            className={form.authType === 'header' ? '' : 'sm:col-span-2 sm:max-w-xl'}
            hint={`Sealed with AES-256-GCM. Never shown again, never sent to the AI.${keepToken ? ' Leave it empty to keep the stored token.' : ''}`}
          >
            <Input type="password" autoComplete="new-password" spellCheck={false} value={form.token} onChange={(e) => set({ token: e.target.value })} className="font-mono" />
          </Field>
        )}
      </fieldset>
      <div aria-live="polite" className="mt-4 empty:hidden">
        {test.result && (
          <Callout tone="success" title={`${serverName(test.result.server)} answered`}>
            {test.result.toolCount} tool{test.result.toolCount === 1 ? '' : 's'} found — {test.result.contract.matched} of {test.result.contract.total} of the recommended ones. Nothing is saved until you connect.
          </Callout>
        )}
        {test.error && (
          <Callout tone="warning" title="That didn’t work">
            {test.error}
          </Callout>
        )}
      </div>
    </Card>
  );
}

/** Whether the setup form is complete enough to test or connect. */
export function mcpFormReady(f: McpForm, keepToken: boolean): boolean {
  if (!/^https?:\/\/\S+\.\S+|^https?:\/\/localhost/i.test(f.url.trim())) return false;
  if (f.authType === 'header' && !f.headerName.trim()) return false;
  return f.authType === 'none' || !!f.token.trim() || keepToken;
}

/** The connected view: server, what the agent may use, and the events webhook. */
export function McpPanel({ system, onChange }: { system: string; onChange: () => void }) {
  const { propertyId, can } = useConsole();
  const url = usePropertyUrl('/api/admin/pms');
  const { data, mutate } = useSWR<McpStatus>(url, fetcher, { refreshInterval: 30_000 });
  const [busy, setBusy] = React.useState<null | 'test' | 'refresh' | 'secret'>(null);
  const [toggling, setToggling] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const manage = can('bridge.manage');
  const mcp = data?.mcp;
  const conn = data?.connection;

  async function run(kind: 'test' | 'refresh') {
    setBusy(kind);
    try {
      if (kind === 'test') {
        const r = await api<TestResult>('/api/admin/pms/test', { method: 'POST', json: { propertyId } });
        toast.success(`${serverName(r.server)} answered in ${r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`} — ${r.toolCount} tools`);
      } else {
        const r = await api<{ tools: unknown[] }>('/api/admin/pms/refresh-tools', { method: 'POST', json: { propertyId } });
        toast.success(`Tools refreshed — ${r.tools.length} found`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      await mutate();
      onChange();
    }
  }
  async function showSecret() {
    setBusy('secret');
    try {
      const r = await api<{ secret: string }>(`/api/admin/pms/events-secret?propertyId=${propertyId}`);
      setSecret(r.secret);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function toggle(tool: McpTool, enabled: boolean) {
    setToggling(tool.name);
    try {
      await api('/api/admin/pms/tools', { method: 'PATCH', json: { propertyId, tool: tool.name, enabled } });
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToggling(null);
    }
  }

  if (!data) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-[132px] rounded-2xl" />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
    );
  }
  if (!mcp || !conn) return null;

  const eventsUrl = conn.events.url.startsWith('/') && typeof window !== 'undefined' ? `${window.location.origin}${conn.events.url}` : conn.events.url;
  const authLabel = mcp.authType === 'header' ? `Token in ${mcp.authHeaderName ?? 'a header'}, sealed` : mcp.authType === 'bearer' ? 'Access token, sealed' : 'No token';
  const answering = conn.status === 'CONNECTED';
  const tools = [...mcp.tools].sort((a, b) => Number(!!b.contract) - Number(!!a.contract) || Number(a.blocked) - Number(b.blocked) || a.title.localeCompare(b.title));
  const shown = showAll ? tools : tools.slice(0, 8);

  return (
    <>
      <Card className="p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Plug className="size-4 text-muted-foreground" aria-hidden /> {system}’s MCP server
        </h2>
        <div className="mt-4 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <span className={cn('size-2.5 shrink-0 rounded-full', answering ? 'bg-success' : conn.status === 'ERROR' ? 'bg-warning' : 'bg-border-strong')} aria-hidden />
              {mcp.server ? serverName(mcp.server) : system}
              <span className="sr-only">{answering ? ', answering' : ', not answering'}</span>
            </p>
            {mcp.url && <p className="break-all text-muted-foreground">{mcp.url}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {authLabel} · {conn.lastSeenAt ? `last answered ${timeAgo(conn.lastSeenAt)}` : 'not reached yet'}
              {mcp.server ? ` · MCP ${mcp.server.protocolVersion}` : ''}
            </p>
          </div>
          {manage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => run('test')} loading={busy === 'test'} loadingText="Testing…" disabled={!!busy}>
                <Stethoscope aria-hidden /> Test
              </Button>
              <Button size="sm" variant="outline" onClick={() => run('refresh')} loading={busy === 'refresh'} loadingText="Refreshing…" disabled={!!busy}>
                <RotateCcw aria-hidden /> Refresh tools
              </Button>
            </div>
          )}
        </div>
        {!mcp.vaultReadable && (
          <Callout tone="warning" title="The stored token can’t be opened" className="mt-4">
            The server’s secure-storage key changed. Reconnect with “Change connection” and paste the token again.
          </Callout>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">
            What {system} lets {PRODUCT_NAME} do
          </h2>
          <Badge variant={mcp.contract.matched === mcp.contract.total ? 'success' : 'primary'} size="sm">
            {mcp.contract.matched} of {mcp.contract.total} recommended tools
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Look-ups only use tools that read. Changes always ask you first. Switch off anything you don’t want the agent to use.
        </p>
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Recommended tools">
          {mcp.contract.operations.map((op) => (
            <li key={op.operation}>
              <Badge variant={op.tool ? 'success' : 'outline'} size="sm" icon={op.tool ? Check : CircleDashed} className={cn(!op.tool && 'text-muted-foreground')}>
                {op.title}
                <span className="sr-only">{op.tool ? ` — ${system} has it` : ` — ${system} doesn’t offer it`}</span>
              </Badge>
            </li>
          ))}
        </ul>
        {tools.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No tools cached yet — refresh the tools.</p>
        ) : (
          <>
            <ul className="mt-4 divide-y rounded-xl border" aria-label={`${system} tools`}>
              {shown.map((t) => {
                const on = t.status === 'ACTIVE';
                return (
                  <li key={t.key} className="flex min-h-[52px] items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm font-medium', !on && 'text-muted-foreground')}>{t.title}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{t.name}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {t.contract && snake(t.name) !== t.contract && (
                        // Only when the PMS calls it something else: shows which recommended tool it stands in for.
                        <Badge variant="outline" size="sm" className="hidden font-mono md:inline-flex" title={`Used as ${t.contract}`}>
                          <span className="sr-only">Used as </span>
                          {t.contract}
                        </Badge>
                      )}
                      {t.blocked ? (
                        <Badge variant="neutral" size="sm" icon={Ban}>
                          Never used
                        </Badge>
                      ) : (
                        <Badge variant={t.readOnly ? 'success' : 'warning'} size="sm">
                          {t.readOnly ? 'Reads' : 'Changes data'}
                        </Badge>
                      )}
                    </div>
                    {manage && !t.blocked && (
                      <Switch checked={on} disabled={toggling === t.name} onCheckedChange={(v) => void toggle(t, v)} aria-label={`Let ${PRODUCT_NAME} use “${t.title}”`} />
                    )}
                  </li>
                );
              })}
            </ul>
            {tools.length > 8 && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? 'Show fewer' : `Show all ${tools.length} tools`}
              </Button>
            )}
          </>
        )}
      </Card>

      <Card className="p-5 sm:p-6" id="pms-events">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Webhook className="size-4 text-muted-foreground" aria-hidden /> Updates from {system}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Give {system} this address so new bookings, cancellations and room changes show up in your activity log — where the agent sees them too.{' '}
          <Link href="/developers/pms#events" className="font-medium text-primary underline-offset-4 hover:underline">
            How updates are signed
          </Link>
        </p>
        <div className="mt-4 max-w-2xl space-y-3">
          <CommandLine command={eventsUrl} label="Copy the events address" />
          {manage &&
            (secret ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Signing secret</p>
                <CommandLine command={secret} label="Copy the signing secret" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Keep it private — anyone with it can post updates to your activity log.</p>
                  <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
                    Hide
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={showSecret} loading={busy === 'secret'} loadingText="Loading…">
                <KeyRound aria-hidden /> Show signing secret
              </Button>
            ))}
        </div>
      </Card>
    </>
  );
}
