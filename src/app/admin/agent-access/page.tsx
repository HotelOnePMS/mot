'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { ALERT_ROLES, draftFrom, draftSwitches, POLICY_ROLES, updateFromDraft, type AccessCell, type AgentAccessUpdate, type AgentAccessView, type AlertRole, type NoticeKind } from '@/lib/agent/access';
import { api, fetcher } from '@/lib/fetcher';
import { timeAgo } from '@/lib/format';
import { roleLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { PageShell, SectionHeader } from '@/components/console/PageShell';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

type Draft = Pick<AgentAccessUpdate, 'capabilities' | 'alerts'>;

function defaultsFrom(v: AgentAccessView): Draft {
  return {
    capabilities: Object.fromEntries(POLICY_ROLES.map((r) => [r, Object.fromEntries(v.capabilities.map((c) => [c.key, c.cells[r].byDefault]))])) as Draft['capabilities'],
    alerts: Object.fromEntries(ALERT_ROLES.map((r) => [r, v.alerts.filter((a) => a.cells[r].byDefault).map((a) => a.kind)])) as Draft['alerts'],
  };
}

/** A switch in the grid (as the draft has it), with a dot when it differs from the role's default. */
function Toggle({ cell, label, editable, onChange }: { cell: AccessCell; label: string; editable: boolean; onChange: (v: boolean) => void }) {
  const changed = cell.on !== cell.byDefault;
  return (
    <div className="inline-flex items-center gap-1.5" title={cell.locked ?? (changed ? `Changed (default: ${cell.byDefault ? 'on' : 'off'})` : undefined)}>
      <Switch checked={cell.on} onCheckedChange={onChange} disabled={!editable || !!cell.locked} aria-label={label} />
      <span className={cn('size-1.5 rounded-full', changed && !cell.locked ? 'bg-agent' : 'bg-transparent')} aria-hidden />
    </div>
  );
}

function Grid<Row extends { label: string; description: string; cells: Record<string, AccessCell> }>({
  caption,
  roles,
  rows,
  editable,
  onChange,
}: {
  caption: string;
  roles: readonly string[];
  rows: (Row & { id: string })[];
  editable: boolean;
  onChange: (row: string, role: string, on: boolean) => void;
}) {
  const toggle = (row: Row & { id: string }, r: string) => (
    <Toggle cell={row.cells[r]} label={`${row.label} — ${roleLabel(r)}`} editable={editable} onChange={(on) => onChange(row.id, r, on)} />
  );
  return (
    <>
      {/* Phones: one row per switch group, the roles side by side under it. */}
      <ul className="divide-y text-sm sm:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={row.id} className="py-3">
            <span className="font-medium">{row.label}</span>
            {row.description && <span className="mt-0.5 block text-xs text-muted-foreground">{row.description}</span>}
            <div className="mt-2.5 grid gap-2" style={{ gridTemplateColumns: `repeat(${roles.length}, minmax(0, 1fr))` }}>
              {roles.map((r) => (
                <div key={r} className="flex flex-col items-start gap-1">
                  <span className="text-xs text-muted-foreground">{roleLabel(r)}</span>
                  {toggle(row, r)}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left">
            <th scope="col" className="py-2 pr-4 font-medium text-muted-foreground">
              &nbsp;
            </th>
            {roles.map((r) => (
              <th key={r} scope="col" className="w-28 px-2 py-2 text-center font-medium">
                {roleLabel(r)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-b-0">
              <th scope="row" className="py-3 pr-4 text-left font-normal">
                <span className="font-medium">{row.label}</span>
                {row.description && <span className="mt-0.5 block text-xs text-muted-foreground">{row.description}</span>}
              </th>
              {roles.map((r) => (
                <td key={r} className="px-2 py-3 text-center align-middle">
                  {toggle(row, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function AgentAccessPage() {
  const { property } = useConsole();
  const url = usePropertyUrl('/api/admin/agent-access');
  const { data, error, mutate } = useSWR<AgentAccessView>(url, fetcher);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (data) setDraft(draftFrom(data));
  }, [data]);

  // Locks follow the draft, so turning a capability on unlocks what needs it before saving.
  const shown = data && draft ? draftSwitches(data, draft) : null;
  // Compare what would be saved, not what's underneath a lock.
  const sends = (d: Draft) => (data ? JSON.stringify(updateFromDraft(data, d)) : '');
  const dirty = !!data && !!draft && sends(draft) !== sends(draftFrom(data));
  const atDefaults = !!data && !!draft && sends(draft) === sends(defaultsFrom(data));

  async function save() {
    if (!data || !draft || !property) return;
    setSaving(true);
    try {
      const next = await api<AgentAccessView>('/api/admin/agent-access', { method: 'PUT', json: { propertyId: property.id, ...updateFromDraft(data, draft) } });
      await mutate(next, { revalidate: false });
      toast.success('Agent access saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      size="narrow"
      title="Agent access"
      description="What each role can do through the agent — in the console and on WhatsApp — and what the always-on agent tells them about. Owners always have everything."
    >
      {error ? (
        <Callout tone="danger" role="alert">
          {(error as Error).message}
        </Callout>
      ) : !data || !draft || !shown ? (
        <div className="space-y-6" aria-busy>
          <Skeleton className="h-[420px] rounded-2xl" />
          <Skeleton className="h-[260px] rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-6">
          {!data.whatsapp && (
            <Callout tone="info" title="WhatsApp isn’t set up on this site yet">
              These settings already apply in the console. WhatsApp chats and alerts start once the WhatsApp number is connected (see WHATSAPP.md).
            </Callout>
          )}

          <Card className="p-4 sm:p-6">
            <SectionHeader className="mb-4" title="What each role can do" description={`At ${data.propertyName}. A dot marks a change from the role’s default. Every change the agent makes still waits for the person to confirm it.`} />
            <Grid
              caption="Agent capabilities by role"
              roles={POLICY_ROLES}
              rows={shown.capabilities.map((c) => ({ ...c, id: c.key }))}
              editable={data.canEdit}
              onChange={(row, role, on) =>
                setDraft((d) => d && { ...d, capabilities: { ...d.capabilities, [role]: { ...d.capabilities[role as (typeof POLICY_ROLES)[number]], [row]: on } } })
              }
            />
          </Card>

          <Card className="p-4 sm:p-6">
            <SectionHeader className="mb-4" title="Alerts on WhatsApp" description="The agent messages people who linked WhatsApp when something needs them, with the fix as a one-number reply. Quiet from 10pm to 7am, except card disputes." />
            <Grid
              caption="Alerts by role"
              roles={ALERT_ROLES}
              rows={shown.alerts.map((a) => ({ ...a, id: a.kind }))}
              editable={data.canEdit}
              onChange={(row, role, on) =>
                setDraft((d) => {
                  if (!d) return d;
                  const list = d.alerts[role as AlertRole].filter((k) => k !== row);
                  return { ...d, alerts: { ...d.alerts, [role]: on ? [...list, row as NoticeKind] : list } };
                })
              }
            />
          </Card>

          {data.canEdit && (
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 p-3 shadow-soft backdrop-blur">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {dirty ? 'Unsaved changes' : data.updatedAt ? `Saved${data.updatedBy ? ` by ${data.updatedBy}` : ''} ${timeAgo(data.updatedAt)}` : 'Using the defaults'}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={atDefaults || saving} onClick={() => setDraft(defaultsFrom(data))}>
                  <RotateCcw aria-hidden /> Defaults
                </Button>
                <Button size="sm" loading={saving} disabled={!dirty} onClick={save}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
