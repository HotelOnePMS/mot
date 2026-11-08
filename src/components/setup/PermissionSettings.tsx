'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { api, fetcher } from '@/lib/fetcher';
import type { PermissionSettings as Settings } from '@/lib/permissions';
import { roleLabel } from '@/lib/status';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';

/** Owners: let other roles do what only owners can by default, at this hotel (each change is in the activity log). */
export function PermissionSettings({ propertyId, onChanged }: { propertyId: string; onChanged?: () => void }) {
  const url = `/api/admin/properties/${propertyId}/permissions`;
  const { data, error, mutate } = useSWR<Settings>(url, fetcher);
  const [busy, setBusy] = React.useState<string | null>(null);

  if (error && !data) return <Callout tone="danger">Couldn’t load the permissions. {(error as Error).message}</Callout>;
  if (!data) return <Skeleton className="h-28 rounded-xl" />;

  async function toggle(permission: string, label: string, role: string, granted: boolean) {
    const id = `${permission}:${role}`;
    setBusy(id);
    try {
      const next = await api<Settings>(url, { method: 'PUT', json: { permission, role, granted } });
      await mutate(next, { revalidate: false });
      toast.success(granted ? `${roleLabel(role)} can now ${label.toLowerCase()}` : `${roleLabel(role)} can no longer ${label.toLowerCase()}`);
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {data.permissions.map((p) => (
        <div key={p.permission} className="rounded-xl border p-4">
          <p className="text-sm font-medium">{p.label}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{p.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">Always allowed: {p.always.map((r) => roleLabel(r).toLowerCase()).join(', ')}.</p>
          <ul className="mt-3 divide-y">
            {p.roles.map((r) => (
              <li key={r.role} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 text-sm">
                  <span>{roleLabel(r.role)}</span>
                  {r.granted && r.grantedBy && (
                    <span className="block text-xs text-muted-foreground">
                      Allowed by {r.grantedBy}
                      {r.grantedAt ? ` on ${new Date(r.grantedAt).toLocaleDateString([], { dateStyle: 'medium' })}` : ''}
                    </span>
                  )}
                </div>
                <Switch
                  checked={r.granted}
                  disabled={busy === `${p.permission}:${r.role}`}
                  onCheckedChange={(v) => void toggle(p.permission, p.label, r.role, v)}
                  aria-label={`${roleLabel(r.role)}: ${p.label}`}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
