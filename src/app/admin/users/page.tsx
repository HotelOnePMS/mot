'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { BriefcaseBusiness, Building2, Check, ConciergeBell, Crown, KeyRound, MoreHorizontal, Search, ShieldCheck, Brush, UserPlus, Users, type LucideIcon } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { formatPhone } from '@/lib/format';
import { formatNumber, roleLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { useConsole } from '@/components/console/ConsoleProvider';
import { CopyButton } from '@/components/setup/CopyButton';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  assignedProperties: { property: { id: string; name: string } }[];
  _count: { bookings: number };
}

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

const STAFF_ROLES = [
  { value: 'MANAGER', desc: 'Runs operations: front desk, housekeeping, rates and the team.' },
  { value: 'FRONT_DESK', desc: 'Arrivals, check-in and check-out, reservations and the agent.' },
  { value: 'HOUSEKEEPER', desc: 'Their cleaning list, designed for a phone.' },
  { value: 'OWNER', desc: 'Everything, including properties, rates and team.' },
];

/** Roles are identities, not states: told apart by icon and fill, never by status colours. */
const ROLE_LOOK: Record<string, { icon: LucideIcon; variant: BadgeProps['variant'] }> = {
  ADMIN: { icon: ShieldCheck, variant: 'outline' },
  OWNER: { icon: Crown, variant: 'primary' },
  MANAGER: { icon: BriefcaseBusiness, variant: 'outline' },
  FRONT_DESK: { icon: ConciergeBell, variant: 'neutral' },
  HOUSEKEEPER: { icon: Brush, variant: 'neutral' },
};

function RoleBadge({ role }: { role: string }) {
  const look = ROLE_LOOK[role] ?? { icon: Users, variant: 'neutral' as const };
  return (
    <Badge variant={look.variant} size="sm" icon={look.icon}>
      {roleLabel(role)}
    </Badge>
  );
}

function tempPassword() {
  const words = ['harbor', 'maple', 'cedar', 'coral', 'linen', 'amber', 'willow', 'ember', 'tide', 'meadow'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(100 + Math.random() * 900)}`;
}

/** Role picker: a native radio group (arrow keys work), styled as cards. */
function RoleChooser({ value, onChange, allowOwner, name }: { value: string; onChange: (v: string) => void; allowOwner: boolean; name: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Role</legend>
      <div className="grid gap-2">
        {STAFF_ROLES.filter((r) => allowOwner || r.value !== 'OWNER').map((r) => {
          const on = value === r.value;
          return (
            <label
              key={r.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-popover',
                on ? 'border-primary/60 bg-primary-soft/50 ring-1 ring-primary/30' : 'hover:bg-accent/60'
              )}
            >
              <input type="radio" name={name} value={r.value} checked={on} onChange={() => onChange(r.value)} className="sr-only" />
              <span
                className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong', on && 'border-primary bg-primary text-primary-foreground')}
                aria-hidden
              >
                {on && <Check className="size-2.5" />}
              </span>
              <span>
                <span className="block text-sm font-medium">{roleLabel(r.value)}</span>
                <span className="block text-sm text-muted-foreground">{r.desc}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Which properties someone works at: a labelled group of toggle buttons. */
function PropertyChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { ctx } = useConsole();
  const props = ctx?.properties ?? [];
  const labelId = React.useId();
  if (props.length <= 1) return null;
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={`${labelId}-hint`}>
      <p id={labelId} className="mb-2 text-sm font-medium">
        Works at
      </p>
      <div className="flex flex-wrap gap-2">
        {props.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
              className={cn(
                'inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                on ? 'border-primary/60 bg-primary-soft font-medium text-primary-soft-foreground' : 'border-border-strong/50 hover:bg-accent'
              )}
            >
              {on ? <Check className="size-4" aria-hidden /> : <Building2 className="size-4 text-muted-foreground" aria-hidden />}
              {p.name}
            </button>
          );
        })}
      </div>
      <p id={`${labelId}-hint`} className={cn('mt-2 text-xs', value.length ? 'text-muted-foreground' : 'font-medium text-destructive')}>
        {value.length ? 'They only see reservations and rooms at these properties.' : 'Pick at least one property.'}
      </p>
    </div>
  );
}

function InviteDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { propertyId, role: myRole } = useConsole();
  const [form, setForm] = React.useState({ firstName: '', lastName: '', email: '', role: 'FRONT_DESK', password: tempPassword() });
  const [props, setProps] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState<{ email: string; password: string; name: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm({ firstName: '', lastName: '', email: '', role: 'FRONT_DESK', password: tempPassword() });
      setProps(propertyId ? [propertyId] : []);
      setCreated(null);
    }
  }, [open, propertyId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/admin/users', {
        method: 'POST',
        json: { ...form, email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim(), assignedPropertyIds: props },
      });
      setCreated({ email: form.email.trim().toLowerCase(), password: form.password, name: form.firstName.trim() });
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const credentials = created ? `Sign in at ${typeof window !== 'undefined' ? window.location.origin : ''}/login\nEmail: ${created.email}\nTemporary password: ${created.password}` : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.name} is on the team</DialogTitle>
              <DialogDescription>Share these sign-in details privately. They can change the password from their profile.</DialogDescription>
            </DialogHeader>
            <pre className="whitespace-pre-wrap break-all rounded-xl border bg-surface-sunken p-4 font-mono text-xs leading-relaxed">{credentials}</pre>
            <DialogFooter>
              <CopyButton value={credentials} label="Copy details" copiedLabel="Details copied" size="default" />
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Add a teammate</DialogTitle>
              <DialogDescription>They’ll see only what their role needs.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="First name" required>
                <Input required autoComplete="off" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </Field>
              <Field label="Last name" required>
                <Input required autoComplete="off" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </Field>
            </div>
            <Field label="Work email" required hint="They sign in with this address.">
              <Input type="email" required autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <RoleChooser name="invite-role" value={form.role} onChange={(role) => setForm({ ...form, role })} allowOwner={myRole === 'ADMIN' || myRole === 'OWNER'} />
            <PropertyChecks value={props} onChange={setProps} />
            <Field label="Temporary password" required hint="At least 8 characters. Share it privately; they can change it later.">
              <div className="flex gap-2">
                <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono" minLength={8} required autoComplete="off" />
                <IconButton label="Make up another password" variant="outline" onClick={() => setForm({ ...form, password: tempPassword() })}>
                  <KeyRound />
                </IconButton>
              </div>
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} loadingText="Adding…" disabled={!props.length}>
                Add teammate
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const { role: myRole } = useConsole();
  const [role, setRole] = React.useState('');
  const [props, setProps] = React.useState<string[]>([]);
  const [phone, setPhone] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!user) return;
    setRole(user.role);
    setProps(user.assignedProperties.map((a) => a.property.id));
    setPhone(user.phone ?? '');
  }, [user]);

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        json: { ...(role !== user.role ? { role } : {}), assignedPropertyIds: props, phone: phone.trim() || null },
      });
      toast.success(`${user.firstName} updated`);
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {user?.firstName} {user?.lastName}
          </DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <RoleChooser name="edit-role" value={role} onChange={setRole} allowOwner={myRole === 'ADMIN' || myRole === 'OWNER'} />
          <PropertyChecks value={props} onChange={setProps} />
          <Field label="Phone" optional hint="Include the country code, like +1 831 555 0100.">
            <Input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} loadingText="Saving…">
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamPage() {
  const { ctx, can } = useConsole();
  const { data, isLoading, mutate } = useSWR<UserRow[]>('/api/admin/users', fetcher);
  const [tab, setTab] = React.useState<'team' | 'guests'>('team');
  const [q, setQ] = React.useState('');
  const [invite, setInvite] = React.useState(false);
  const [edit, setEdit] = React.useState<UserRow | null>(null);
  const [confirm, setConfirm] = React.useState<{ user: UserRow; action: 'deactivate' | 'reactivate' | 'reset' } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState('');
  const editable = can('users.write');
  const multiProperty = (ctx?.properties.length ?? 0) > 1;

  const list = (data ?? [])
    .filter((u) => (tab === 'team' ? u.role !== 'CUSTOMER' : u.role === 'CUSTOMER'))
    .filter((u) => {
      const t = q.trim().toLowerCase();
      return !t || `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(t);
    });
  const teamCount = (data ?? []).filter((u) => u.role !== 'CUSTOMER').length;
  const guestCount = (data ?? []).length - teamCount;

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      const { user, action } = confirm;
      if (action === 'reset') {
        await api(`/api/admin/users/${user.id}`, { method: 'PATCH', json: { password: newPassword } });
        toast.success(`New password set for ${user.firstName}: ${newPassword}`, { duration: 15000 });
      } else {
        await api(`/api/admin/users/${user.id}`, { method: 'PATCH', json: { isActive: action === 'reactivate' } });
        toast.success(action === 'reactivate' ? `${user.firstName} can sign in again` : `${user.firstName} can no longer sign in`);
      }
      await mutate();
      setConfirm(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={FRAME}>
      <div className="space-y-5">
        <PageHeader
          title="Team"
          description="Who can sign in to the console, and what each role can do."
          actions={
            editable ? (
              <Button onClick={() => setInvite(true)}>
                <UserPlus aria-hidden /> Add teammate
              </Button>
            ) : undefined
          }
        />

        <div role="search" aria-label="Find people" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SegmentedControl
            layoutId="team-tab"
            aria-label="People"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'team', label: `Team${data ? ` · ${formatNumber(teamCount)}` : ''}` },
              { value: 'guests', label: `Guests${data ? ` · ${formatNumber(guestCount)}` : ''}` },
            ]}
            className="self-start"
          />
          <div className="relative flex-1 sm:max-w-sm">
            <label htmlFor="team-search" className="sr-only">
              Search people
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="team-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className="pl-9" autoComplete="off" />
          </div>
        </div>

        <Card className="overflow-hidden p-0 shadow-xs">
          {isLoading ? (
            <div aria-busy>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex h-[68px] items-center gap-3 border-b px-4 last:border-b-0">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
                </div>
              ))}
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={Users}
              title={q ? 'Nobody matches that search' : tab === 'team' ? 'Just you so far' : 'No guests yet'}
              description={
                q
                  ? 'Try part of a first name, last name or email address.'
                  : tab === 'team'
                    ? 'Add your front desk and housekeeping team so they can use the console.'
                    : 'Guests appear here after their first booking on your booking page.'
              }
              action={
                q ? (
                  <Button variant="outline" onClick={() => setQ('')}>
                    Clear search
                  </Button>
                ) : tab === 'team' && editable ? (
                  <Button onClick={() => setInvite(true)}>
                    <UserPlus aria-hidden /> Add teammate
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y" aria-label={tab === 'team' ? 'Team members' : 'Guests'}>
              {list.map((u) => {
                const me = u.id === ctx?.user.id;
                const showMenu = editable && tab === 'team' && !me && u.role !== 'ADMIN';
                return (
                  <li key={u.id} className={cn('flex items-center gap-3 px-4 py-3', !u.isActive && 'bg-surface-sunken/50')}>
                    <Avatar name={`${u.firstName} ${u.lastName}`} className={cn(!u.isActive && 'opacity-60')} />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium">
                        <span className={cn('truncate', !u.isActive && 'text-muted-foreground')}>
                          {u.firstName} {u.lastName}
                        </span>
                        {me && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                        {!u.isActive && (
                          <Badge variant="outline" size="sm" className="text-muted-foreground">
                            Can’t sign in
                          </Badge>
                        )}
                      </p>
                      {/* Email and phone share a line on wider screens and stack on phones, so neither gets cut off. */}
                      <p className="flex min-w-0 flex-col text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-1.5">
                        <span className="truncate">{u.email}</span>
                        {u.phone && (
                          <span className="tabular">
                            <span className="hidden sm:inline" aria-hidden>
                              ·{' '}
                            </span>
                            {formatPhone(u.phone)}
                          </span>
                        )}
                        {tab === 'guests' && (
                          <span>
                            <span className="hidden sm:inline" aria-hidden>
                              ·{' '}
                            </span>
                            {formatNumber(u._count.bookings)} booking{u._count.bookings === 1 ? '' : 's'}
                          </span>
                        )}
                      </p>
                      {tab === 'team' && (
                        <div className="mt-1.5 sm:hidden">
                          <RoleBadge role={u.role} />
                        </div>
                      )}
                    </div>
                    {tab === 'team' && (
                      <div className="hidden w-56 min-w-0 shrink-0 text-right sm:block">
                        <RoleBadge role={u.role} />
                        {multiProperty && <p className="mt-1 truncate text-xs text-muted-foreground">{u.assignedProperties.map((a) => a.property.name).join(', ') || 'All properties'}</p>}
                      </div>
                    )}
                    {tab === 'team' && editable && (
                      // Reserve the column so every badge lines up, menu or not.
                      <div className="flex w-10 shrink-0 justify-end">
                        {showMenu && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton label={`Actions for ${u.firstName} ${u.lastName}`}>
                                <MoreHorizontal />
                              </IconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setEdit(u)}>Change role and access</DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setNewPassword(tempPassword());
                                  setConfirm({ user: u, action: 'reset' });
                                }}
                              >
                                Reset password…
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {u.isActive ? (
                                <DropdownMenuItem destructive onSelect={() => setConfirm({ user: u, action: 'deactivate' })}>
                                  Deactivate…
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => setConfirm({ user: u, action: 'reactivate' })}>Reactivate…</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <InviteDialog open={invite} onOpenChange={setInvite} onDone={() => void mutate()} />
      <EditDialog user={edit} onClose={() => setEdit(null)} onDone={() => void mutate()} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        cancelLabel={confirm?.action === 'deactivate' ? 'Keep access' : 'Cancel'}
        title={
          confirm?.action === 'reset'
            ? `Reset ${confirm.user.firstName}’s password?`
            : confirm?.action === 'reactivate'
              ? `Reactivate ${confirm?.user.firstName}?`
              : `Deactivate ${confirm?.user.firstName}?`
        }
        description={
          confirm?.action === 'reset'
            ? 'Their current password stops working right away. Share the new one privately.'
            : confirm?.action === 'reactivate'
              ? 'They’ll be able to sign in again with their existing password.'
              : 'They’re signed out on their next request. Their history stays in the activity log.'
        }
        confirmLabel={confirm?.action === 'reset' ? 'Set new password' : confirm?.action === 'reactivate' ? 'Reactivate' : 'Deactivate'}
        destructive={confirm?.action === 'deactivate'}
        loading={busy}
        onConfirm={runConfirm}
      >
        {confirm?.action === 'reset' && (
          <Field label="New password" hint="At least 8 characters.">
            <div className="flex gap-2">
              <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="font-mono" autoComplete="off" />
              <IconButton label="Make up another password" variant="outline" onClick={() => setNewPassword(tempPassword())}>
                <KeyRound />
              </IconButton>
            </div>
          </Field>
        )}
      </ConfirmDialog>
    </div>
  );
}
