'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, EyeOff, SquareArrowOutUpRight, Trash2, TriangleAlert } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { formatNumber } from '@/lib/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { PhotoManager } from '@/components/setup/PhotoManager';
import { EMPTY_PROPERTY, PropertyFields, errorSummary, propertyErrors, toPropertyPayload, type PropertyDraft } from '@/components/setup/PropertyFields';
import { SaveBar } from '@/components/setup/SaveBar';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { useConsole } from '@/components/console/ConsoleProvider';

interface PropertyDetail {
  id: string;
  name: string;
  type: string | null;
  tagline: string | null;
  description: string | null;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string | null;
  amenities: string[];
  primaryColor: string | null;
  isActive: boolean;
  isDemo: boolean;
  roomTypes?: { id: string; totalRooms: number; isActive: boolean }[];
  _count: { rooms: number; bookings: number };
}

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

function toDraft(p: PropertyDetail): PropertyDraft {
  return {
    ...EMPTY_PROPERTY,
    name: p.name,
    type: p.type ?? 'Hotel',
    tagline: p.tagline ?? '',
    description: p.description ?? '',
    address: p.address,
    city: p.city,
    state: p.state,
    zipCode: p.zipCode,
    phone: p.phone,
    email: p.email ?? '',
    amenities: p.amenities,
    primaryColor: p.primaryColor ?? EMPTY_PROPERTY.primaryColor,
  };
}

function BackLink() {
  return (
    <Link
      href="/admin/properties"
      className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden /> Properties
    </Link>
  );
}

export default function PropertyDetailPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const { can } = useConsole();
  const url = `/api/admin/properties/${propertyId}`;
  const { data: p, error, mutate } = useSWR<PropertyDetail>(url, fetcher);
  const [draft, setDraft] = React.useState<PropertyDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Field errors appear once someone tries to save, then follow their typing.
  const [tried, setTried] = React.useState(false);
  const [confirm, setConfirm] = React.useState<'deactivate' | 'delete' | null>(null);
  const [busy, setBusy] = React.useState(false);
  const editable = can('property.write');

  React.useEffect(() => {
    if (p && !draft) setDraft(toDraft(p));
  }, [p, draft]);

  if (error) {
    return (
      <div className={FRAME}>
        <div className="max-w-4xl space-y-4">
          <BackLink />
          <Card>
            <EmptyState
              icon={TriangleAlert}
              title="We couldn’t find that property"
              description="It may have been deleted, or you don’t have access to it."
              action={
                <Button asChild variant="outline">
                  <Link href="/admin/properties">Back to properties</Link>
                </Button>
              }
            />
          </Card>
        </div>
      </div>
    );
  }
  if (!p || !draft) {
    return (
      <div className={FRAME}>
        <div className="max-w-4xl space-y-6" aria-busy>
          <Skeleton className="h-10 w-32" />
          <div className="space-y-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-5 w-48" />
          </div>
          <Skeleton className="h-[720px] rounded-2xl" />
          <span className="sr-only" role="status">
            Loading property…
          </span>
        </div>
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(p));
  // Same count as the Properties list: sellable rooms of the room types on sale.
  const rooms = p.roomTypes ? p.roomTypes.filter((t) => t.isActive).reduce((s, t) => s + t.totalRooms, 0) : p._count.rooms;

  const errors = tried ? propertyErrors(draft) : {};

  async function save() {
    if (!draft || !p) return;
    setTried(true);
    const problems = propertyErrors(draft);
    if (Object.keys(problems).length) {
      toast.error(errorSummary(problems));
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('#property-form [aria-invalid="true"]');
        first?.focus();
        first?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    setSaving(true);
    try {
      await api(url, { method: 'PUT', json: { ...toPropertyPayload(draft), isActive: p.isActive } });
      const fresh = await mutate();
      if (fresh) setDraft(toDraft(fresh));
      await globalMutate('/api/admin/context');
      toast.success('Property saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(isActive: boolean) {
    if (!p) return;
    setBusy(true);
    try {
      await api(url, { method: 'PUT', json: { ...toPropertyPayload(toDraft(p)), isActive } });
      await mutate();
      toast.success(isActive ? `${p.name} is accepting bookings again` : `${p.name} is hidden from guests`);
      setConfirm(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(url, { method: 'DELETE' });
      await globalMutate('/api/admin/context');
      toast.success('Property deleted');
      router.push('/admin/properties');
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div className={FRAME}>
      <div className="max-w-4xl space-y-6">
        <BackLink />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              <span className="min-w-0 break-words">{p.name}</span>
              {!p.isActive && (
                <Badge variant="neutral" icon={EyeOff}>
                  Hidden from guests
                </Badge>
              )}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {formatNumber(rooms)} room{rooms === 1 ? '' : 's'} · {formatNumber(p._count.bookings)} booking{p._count.bookings === 1 ? '' : 's'}
            </p>
          </div>
          <Button asChild variant="outline" className="self-start sm:self-auto">
            <Link href={`/properties/${p.id}`} target="_blank" rel="noopener">
              View booking page <SquareArrowOutUpRight aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </Link>
          </Button>
        </div>

        {!editable && (
          <Callout tone="neutral" title="View only">
            Only the owner can change property details.
          </Callout>
        )}

        <Card className="p-5 sm:p-8">
          <fieldset id="property-form" disabled={!editable}>
            <legend className="sr-only">Property details</legend>
            <PropertyFields value={draft} onChange={setDraft} errors={errors} />
          </fieldset>
        </Card>

        <Card className="p-5 sm:p-8">
          <h2 className="text-base font-semibold tracking-tight">Photos</h2>
          <p className="mb-4 mt-0.5 text-sm text-muted-foreground">Your cover photo is the first thing guests see. Bright, wide shots work best.</p>
          <PhotoManager endpoint={`/api/admin/properties/${p.id}/photos`} editable={editable} />
        </Card>

        {editable && (
          <Card className="p-5 sm:p-8">
            <h2 className="text-base font-semibold tracking-tight">Taking bookings</h2>
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {p.isActive ? 'Guests can find and book this property.' : 'Hidden from the directory and its booking page; existing reservations are unaffected.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => (p.isActive ? setConfirm('deactivate') : setActive(true))} loading={busy && confirm === null}>
                  {p.isActive ? 'Stop taking bookings…' : 'Start taking bookings'}
                </Button>
                {can('property.delete') && !p.isDemo && (
                  <Button variant="ghost" className="text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground" onClick={() => setConfirm('delete')}>
                    <Trash2 aria-hidden /> Delete…
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {editable && (
          <SaveBar
            dirty={dirty}
            saving={saving}
            onSave={() => void save()}
            onDiscard={() => {
              setDraft(toDraft(p));
              setTried(false);
            }}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'delete' ? `Delete ${p.name}?` : `Stop taking bookings at ${p.name}?`}
        description={
          confirm === 'delete'
            ? 'Only possible without booking history. Rooms, rates and photos are removed permanently.'
            : 'The property disappears from search and its booking page. Staff can keep working with existing reservations.'
        }
        confirmLabel={confirm === 'delete' ? 'Delete property' : 'Stop bookings'}
        destructive
        loading={busy}
        onConfirm={() => (confirm === 'delete' ? remove() : setActive(false))}
      />
    </div>
  );
}
