'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Globe, Lock, Mail, MapPin, Pencil, Phone, Plus, Search, Star, Trash2, Truck, User } from 'lucide-react';
import { VENDOR_CATEGORIES, vendorCategoryLabel, type VendorCategory, type VendorEntry, type VendorInput } from '@/lib/vendors';
import { ApiError, api, fetcher } from '@/lib/fetcher';
import { formatPhone, telHref } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PageShell } from '@/components/console/PageShell';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

interface VendorList {
  vendors: VendorEntry[];
  canManage: boolean;
}

/** The hotel's suppliers and third-party service partners, with who to contact. */
export default function VendorsPage() {
  const { can, role } = useConsole();
  const url = usePropertyUrl('/api/admin/vendors');
  const { data, error, isLoading, mutate } = useSWR<VendorList>(url, fetcher);
  const [editing, setEditing] = React.useState<VendorEntry | 'new' | null>(null);
  const [removing, setRemoving] = React.useState<VendorEntry | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<VendorCategory | 'ALL'>('ALL');
  const [showInactive, setShowInactive] = React.useState(false);
  const canManage = !!data?.canManage;
  const isOwner = role === 'OWNER' || role === 'ADMIN';

  const q = query.trim().toLowerCase();
  const all = data?.vendors ?? [];
  const inactiveCount = all.filter((v) => v.status === 'INACTIVE').length;
  const rows = all.filter(
    (v) =>
      (showInactive || v.status === 'ACTIVE') &&
      (category === 'ALL' || v.category === category) &&
      (!q || [v.name, v.services, v.contactName, v.email, v.phone, v.notes, vendorCategoryLabel(v.category)].some((f) => (f ?? '').toLowerCase().includes(q))),
  );
  const usedCategories = VENDOR_CATEGORIES.filter((c) => all.some((v) => v.category === c.id));

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/api/admin/vendors/${removing.id}`, { method: 'DELETE' });
      toast.success(`${removing.name} was removed`);
      await mutate();
      setRemoving(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const denied = error instanceof ApiError && error.status === 403;

  return (
    <PageShell
      title="Vendors"
      description="Your suppliers and service partners, and who to call. The owner decides who else can see this list and who can change it."
      actions={
        canManage ? (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Add vendor
          </Button>
        ) : undefined
      }
    >
      {isOwner && can('permissions.manage') && (
        <Callout tone="info" icon={Lock}>
          Only owners see vendors unless you allow other roles.{' '}
          <Link href="/admin/settings" className="font-medium underline underline-offset-2">
            Choose who can see or manage them in Settings → Permissions
          </Link>
          .
        </Callout>
      )}
      {denied ? (
        <Card>
          <EmptyState
            icon={Lock}
            title="The owner hasn’t shared vendors with your role"
            description="Ask the hotel’s owner to allow your role under Settings → Permissions."
          />
        </Card>
      ) : error ? (
        <Callout tone="danger">{(error as Error).message}</Callout>
      ) : isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy>
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            icon={Truck}
            title="No vendors yet"
            description={
              canManage
                ? 'Add your suppliers and service partners (linen, food, maintenance, IT) so the team knows who to call.'
                : 'The owner hasn’t added any vendors yet.'
            }
            action={
              canManage ? (
                <Button variant="outline" onClick={() => setEditing('new')}>
                  <Plus aria-hidden /> Add vendor
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input className="pl-9" placeholder="Search name, service, contact or note" aria-label="Search vendors" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Select value={category} onValueChange={(v) => setCategory(v as VendorCategory | 'ALL')}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {usedCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {inactiveCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Show inactive vendors" />
                Show inactive ({inactiveCount})
              </label>
            )}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((v) => (
              <li key={v.id}>
                <VendorCard vendor={v} canManage={canManage} onEdit={() => setEditing(v)} onRemove={() => setRemoving(v)} />
              </li>
            ))}
          </ul>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No vendors match these filters.</p>}
        </>
      )}

      <VendorDialog
        vendor={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={async () => {
          await mutate();
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'this vendor'}?`}
        description="It comes off the list for everyone at this hotel. To keep it for the record instead, edit it and mark it inactive. The activity log keeps who added and removed it."
        confirmLabel="Remove vendor"
        loading={busy}
        onConfirm={remove}
      />
    </PageShell>
  );
}

function VendorCard({ vendor: v, canManage, onEdit, onRemove }: { vendor: VendorEntry; canManage: boolean; onEdit: () => void; onRemove: () => void }) {
  return (
    <Card className={`flex h-full flex-col gap-3 p-4 sm:p-5 ${v.status === 'INACTIVE' ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{v.name}</p>
          {v.services && <p className="text-sm text-muted-foreground">{v.services}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {v.preferred && (
            <Badge variant="highlight" size="sm" icon={Star}>
              Preferred
            </Badge>
          )}
          {v.status === 'INACTIVE' && (
            <Badge variant="neutral" size="sm">
              Inactive
            </Badge>
          )}
          <Badge variant="neutral" size="sm">
            {vendorCategoryLabel(v.category)}
          </Badge>
        </div>
      </div>
      <dl className="space-y-1 text-sm">
        {v.contactName && (
          <Line icon={User} label="Contact">
            {v.contactName}
          </Line>
        )}
        {v.phone && (
          <Line icon={Phone} label="Phone">
            <a href={telHref(v.phone)} className="tabular hover:underline">
              {formatPhone(v.phone)}
            </a>
          </Line>
        )}
        {v.email && (
          <Line icon={Mail} label="Email">
            <a href={`mailto:${v.email}`} className="truncate hover:underline">
              {v.email}
            </a>
          </Line>
        )}
        {v.website && (
          <Line icon={Globe} label="Website">
            <a href={v.website} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
              {v.website.replace(/^https?:\/\//, '')}
            </a>
          </Line>
        )}
        {v.address && (
          <Line icon={MapPin} label="Address">
            {v.address}
          </Line>
        )}
      </dl>
      {(v.accountNumber || v.notes) && (
        <div className="space-y-1 border-t pt-3 text-sm">
          {v.accountNumber && (
            <p>
              <span className="text-muted-foreground">Account no. </span>
              <span className="tabular">{v.accountNumber}</span>
            </p>
          )}
          {v.notes && <p className="whitespace-pre-line text-muted-foreground">{v.notes}</p>}
        </div>
      )}
      {canManage && (
        <div className="mt-auto flex gap-1 pt-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil aria-hidden /> Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 aria-hidden /> Remove
          </Button>
        </div>
      )}
    </Card>
  );
}

function Line({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <dt className="shrink-0">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

type Form = Required<{ [K in keyof VendorInput]: NonNullable<VendorInput[K]> }>;

const EMPTY: Form = {
  name: '',
  category: 'SUPPLIES',
  services: '',
  contactName: '',
  email: '',
  phone: '',
  website: '',
  address: '',
  accountNumber: '',
  notes: '',
  preferred: false,
  status: 'ACTIVE',
};

function VendorDialog({ vendor, onOpenChange, onSaved }: { vendor: VendorEntry | 'new' | null; onOpenChange: (o: boolean) => void; onSaved: () => void | Promise<void> }) {
  const { propertyId } = useConsole();
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const isNew = vendor === 'new';

  React.useEffect(() => {
    if (!vendor) return;
    if (vendor === 'new') setForm(EMPTY);
    else
      setForm({
        name: vendor.name,
        category: vendor.category,
        services: vendor.services ?? '',
        contactName: vendor.contactName ?? '',
        email: vendor.email ?? '',
        phone: vendor.phone ?? '',
        website: vendor.website ?? '',
        address: vendor.address ?? '',
        accountNumber: vendor.accountNumber ?? '',
        notes: vendor.notes ?? '',
        preferred: vendor.preferred,
        status: vendor.status,
      });
  }, [vendor]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof Form) => ({ value: form[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !vendor) return;
    setBusy(true);
    try {
      if (vendor === 'new') {
        await api('/api/admin/vendors', { method: 'POST', json: { propertyId, ...form } });
        toast.success(`${form.name.trim()} was added`);
      } else {
        await api(`/api/admin/vendors/${vendor.id}`, { method: 'PATCH', json: form });
        toast.success(`${form.name.trim()} was updated`);
      }
      await onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!vendor} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add vendor' : `Edit ${form.name || 'vendor'}`}</DialogTitle>
          <DialogDescription>Staff the owner allows can see these contact details. Every change is logged in Activity.</DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vendor name" htmlFor={`${formId}-name`}>
              <Input id={`${formId}-name`} autoComplete="off" {...text('name')} />
            </Field>
            <Field label="Category" htmlFor={`${formId}-category`}>
              <Select value={form.category} onValueChange={(v) => set('category', v as VendorCategory)}>
                <SelectTrigger id={`${formId}-category`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VENDOR_CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="What they supply or do" htmlFor={`${formId}-services`} optional>
            <Input id={`${formId}-services`} placeholder="e.g. Towels and bed linen, weekly delivery" {...text('services')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Contact person" htmlFor={`${formId}-contact`} optional>
              <Input id={`${formId}-contact`} autoComplete="off" {...text('contactName')} />
            </Field>
            <Field label="Phone" htmlFor={`${formId}-phone`} optional>
              <Input id={`${formId}-phone`} type="tel" autoComplete="off" {...text('phone')} />
            </Field>
            <Field label="Email" htmlFor={`${formId}-email`} optional>
              <Input id={`${formId}-email`} type="email" autoComplete="off" {...text('email')} />
            </Field>
            <Field label="Website" htmlFor={`${formId}-website`} optional>
              <Input id={`${formId}-website`} inputMode="url" autoComplete="off" placeholder="acme-linen.com" {...text('website')} />
            </Field>
          </div>
          <Field label="Address" htmlFor={`${formId}-address`} optional>
            <Input id={`${formId}-address`} autoComplete="off" {...text('address')} />
          </Field>
          <Field label="Your account number with them" htmlFor={`${formId}-account`} optional>
            <Input id={`${formId}-account`} autoComplete="off" {...text('accountNumber')} />
          </Field>
          <Field label="Notes" htmlFor={`${formId}-notes`} optional hint="Payment terms, delivery days, contract dates">
            <Textarea id={`${formId}-notes`} rows={3} maxLength={2000} {...text('notes')} />
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={form.preferred} onCheckedChange={(v) => set('preferred', v)} aria-label="Preferred vendor" />
              Preferred vendor
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={form.status === 'INACTIVE'} onCheckedChange={(v) => set('status', v ? 'INACTIVE' : 'ACTIVE')} aria-label="Inactive" />
              Inactive (keep for the record, hide from the list)
            </label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy} loadingText="Saving…" disabled={!form.name.trim()}>
            {isNew ? 'Add vendor' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
