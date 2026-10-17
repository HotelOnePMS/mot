'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, BadgeDollarSign, Eye, EyeOff, MoreHorizontal, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { parseRoomNumbers } from '@/lib/rooms';
import { formatNumber } from '@/lib/status';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { ChipInput } from '@/components/setup/ChipInput';
import { PhotoManager } from '@/components/setup/PhotoManager';
import { errorSummary } from '@/components/setup/PropertyFields';
import { RoomTypeFields, roomTypeErrors, type RoomTypeDraft } from '@/components/setup/RoomTypeFields';
import { SaveBar } from '@/components/setup/SaveBar';
import { ConfirmDialog } from '@/components/frontdesk/dialogs';
import { useConsole } from '@/components/console/ConsoleProvider';

interface RoomLite {
  id: string;
  roomNumber: string;
  floor: string | null;
  tags: string[];
  status: string;
  isOutOfOrder: boolean;
  notes?: string | null;
}
interface RoomTypeDetail {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  basePrice: number;
  totalRooms: number;
  amenities: string[];
  isActive: boolean;
  property: { id: string; name: string };
  rooms: RoomLite[];
  _count: { bookings: number };
}

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

const ROOM_TAGS = ['quiet', 'high floor', 'accessible', 'connecting', 'corner', 'near elevator', 'ocean view', 'garden view', 'balcony'];

function toDraft(t: RoomTypeDetail): RoomTypeDraft {
  return {
    name: t.name,
    description: t.description ?? '',
    capacity: String(t.capacity),
    basePrice: String(t.basePrice),
    totalRooms: String(t.totalRooms),
    amenities: t.amenities,
  };
}

function RoomDialog({ room, onClose, onSaved }: { room: RoomLite | null; onClose: () => void; onSaved: () => void }) {
  const [number, setNumber] = React.useState('');
  const [floor, setFloor] = React.useState('');
  const [tags, setTags] = React.useState<string[]>([]);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState<'save' | 'delete' | null>(null);
  // Removing a room asks once more, right in the dialog.
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  React.useEffect(() => {
    if (!room) return;
    setNumber(room.roomNumber);
    setFloor(room.floor ?? '');
    setTags(room.tags);
    setNotes(room.notes ?? '');
    setConfirmRemove(false);
  }, [room]);

  async function save() {
    if (!room) return;
    setBusy('save');
    try {
      await api(`/api/admin/rooms/${room.id}`, { method: 'PATCH', json: { roomNumber: number.trim(), floor: floor.trim() || null, tags, notes: notes.trim() || null } });
      toast.success(`Room ${number} saved`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!room) return;
    setBusy('delete');
    try {
      await api(`/api/admin/rooms/${room.id}`, { method: 'DELETE' });
      toast.success(`Room ${room.roomNumber} removed`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={!!room} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Room {room?.roomNumber}</DialogTitle>
          <DialogDescription>Tags help you (and the agent) pick the right room — “quiet room on a high floor” matches these.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Number" required>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Floor" optional>
              <Input value={floor} onChange={(e) => setFloor(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field label="Tags" optional hint="Up to 12. Pick from the suggestions or type your own.">
            <ChipInput value={tags} onChange={(v) => setTags(v.map((t) => t.toLowerCase()))} suggestions={ROOM_TAGS} max={12} placeholder="e.g. quiet" />
          </Field>
          <Field label="Notes for staff" optional>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Sofa bed in the closet" />
          </Field>
        </div>
        {confirmRemove ? (
          <div className="grid gap-3 rounded-xl bg-destructive-soft p-4 text-destructive-soft-foreground" role="alert">
            <p className="text-sm font-medium">Remove room {room?.roomNumber}? Guests can no longer be put in it. This can’t be undone.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setConfirmRemove(false)} disabled={busy === 'delete'}>
                Keep it
              </Button>
              <Button variant="destructive" onClick={remove} loading={busy === 'delete'} loadingText="Removing…">
                <Trash2 aria-hidden /> Remove room
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" className="text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground" onClick={() => setConfirmRemove(true)}>
              <Trash2 aria-hidden /> Remove room…
            </Button>
            <Button onClick={save} loading={busy === 'save'} loadingText="Saving…" disabled={!number.trim()}>
              Save room
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function RoomTypeDetailPage() {
  const { roomTypeId } = useParams<{ roomTypeId: string }>();
  const router = useRouter();
  const { can, refresh } = useConsole();
  const url = `/api/admin/room-types/${roomTypeId}`;
  const { data: t, error, mutate } = useSWR<RoomTypeDetail>(url, fetcher);
  const [draft, setDraft] = React.useState<RoomTypeDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Field errors appear once someone tries to save, then follow their typing.
  const [tried, setTried] = React.useState(false);
  const [editRoom, setEditRoom] = React.useState<RoomLite | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [numbers, setNumbers] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const editable = can('inventory.write');

  React.useEffect(() => {
    if (t && !draft) setDraft(toDraft(t));
  }, [t, draft]);

  if (error) {
    return (
      <div className={FRAME}>
        <div className="max-w-4xl space-y-4">
          <BackLink />
          <Card>
            <EmptyState
              icon={TriangleAlert}
              title="We couldn’t find that room type"
              description="It may have been deleted, or it belongs to a property you don’t have access to."
              action={
                <Button asChild variant="outline">
                  <Link href="/admin/room-types">Back to rooms</Link>
                </Button>
              }
            />
          </Card>
        </div>
      </div>
    );
  }
  if (!t || !draft) {
    return (
      <div className={FRAME}>
        <div className="max-w-4xl space-y-6" aria-busy>
          <Skeleton className="h-10 w-28" />
          <div className="space-y-2">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-5 w-44" />
          </div>
          <Skeleton className="h-[480px] rounded-2xl" />
          <span className="sr-only" role="status">
            Loading room type…
          </span>
        </div>
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(t));
  const parsed = numbers.trim() ? parseRoomNumbers(numbers) : null;
  const roomNumbers = parsed && 'numbers' in parsed ? parsed.numbers : [];
  const errors = tried ? roomTypeErrors(draft) : {};

  async function save() {
    if (!draft) return;
    setTried(true);
    const problems = roomTypeErrors(draft);
    if (Object.keys(problems).length) {
      toast.error(errorSummary(problems));
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('#room-type-form [aria-invalid="true"]');
        first?.focus();
        first?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    setSaving(true);
    try {
      await api(url, {
        method: 'PATCH',
        json: {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          capacity: Number(draft.capacity),
          basePrice: Number(draft.basePrice),
          totalRooms: Number(draft.totalRooms || 0),
          amenities: draft.amenities,
        },
      });
      const fresh = await mutate();
      if (fresh) setDraft(toDraft(fresh));
      refresh();
      setTried(false);
      toast.success(`${draft.name.trim()} saved`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    try {
      await api(url, { method: 'PATCH', json: { isActive: !t!.isActive } });
      await mutate();
      refresh();
      toast.success(t!.isActive ? `${t!.name} is hidden from sale` : `${t!.name} is on sale again`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const r = await api<{ message: string }>(url, { method: 'DELETE' });
      toast.success(r.message);
      refresh();
      router.push('/admin/room-types');
    } catch (e) {
      toast.error((e as Error).message);
      setDeleting(false);
    }
  }

  async function addRooms(e: React.FormEvent) {
    e.preventDefault();
    if (!roomNumbers.length) return;
    setAdding(true);
    try {
      await api('/api/admin/rooms', { method: 'POST', json: { propertyId: t!.property.id, roomTypeId: t!.id, roomNumbers } });
      toast.success(`Added ${roomNumbers.length} room${roomNumbers.length > 1 ? 's' : ''}`);
      setNumbers('');
      const fresh = await mutate();
      if (fresh && draft) setDraft({ ...draft, totalRooms: String(fresh.totalRooms) });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  const canManageRooms = can('room.manage');

  return (
    <div className={FRAME}>
      <div className="max-w-4xl space-y-6">
        <BackLink />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              <span className="min-w-0 break-words">{t.name}</span>
              {!t.isActive && (
                <Badge variant="neutral" icon={EyeOff}>
                  Hidden from sale
                </Badge>
              )}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t.property.name} · {formatNumber(t._count.bookings)} booking{t._count.bookings === 1 ? '' : 's'} so far
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/rate-calendar">
                <BadgeDollarSign aria-hidden /> Rates
              </Link>
            </Button>
            {editable && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`More actions for ${t.name}`} variant="outline">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={toggleActive}>
                    {t.isActive ? <EyeOff aria-hidden /> : <Eye aria-hidden />} {t.isActive ? 'Hide from sale' : 'Put back on sale'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                    <Trash2 aria-hidden /> Delete room type…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {!editable && (
          <Callout tone="neutral" title="View only">
            Only the owner or a manager can change room types.
          </Callout>
        )}

        <Card className="p-5 sm:p-6">
          <h2 className="mb-5 text-base font-semibold tracking-tight">Details</h2>
          <fieldset id="room-type-form" disabled={!editable}>
            <legend className="sr-only">Room type details</legend>
            <RoomTypeFields value={draft} onChange={setDraft} errors={errors} />
          </fieldset>
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-semibold tracking-tight">Photos</h2>
          <p className="mb-4 mt-0.5 text-sm text-muted-foreground">The cover photo leads on your booking page. Bright, wide shots work best.</p>
          <PhotoManager endpoint={`/api/admin/room-types/${t.id}/photos`} editable={editable} />
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-semibold tracking-tight">Room numbers</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatNumber(t.rooms.length)} of {formatNumber(t.totalRooms)} set up
            {canManageRooms && t.rooms.length > 0 ? ' · select a room to add tags like “quiet” or “accessible”' : ''}
          </p>
          {t.rooms.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No room numbers yet. {canManageRooms ? 'Add them below so guests can be given a room at check-in.' : ''}
            </p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {t.rooms.map((r) => {
                const inner = (
                  <>
                    <span className="flex w-full items-center justify-between">
                      <span className="text-lg font-semibold tabular">{r.roomNumber}</span>
                      {canManageRooms && <Pencil className="size-3.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />}
                    </span>
                    <span className="text-xs text-muted-foreground">Floor {r.floor ?? '—'}</span>
                    {r.tags.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {r.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="neutral" size="sm">
                            {tag}
                          </Badge>
                        ))}
                        {r.tags.length > 3 && (
                          <Badge variant="neutral" size="sm">
                            +{r.tags.length - 3}
                          </Badge>
                        )}
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={r.id}>
                    {canManageRooms ? (
                      <button
                        type="button"
                        onClick={() => setEditRoom(r)}
                        aria-label={`Room ${r.roomNumber}, floor ${r.floor ?? 'not set'}${r.tags.length ? `, ${r.tags.join(', ')}` : ''}. Edit`}
                        className="group flex h-full w-full flex-col items-start rounded-xl border bg-surface p-3 text-left transition-[box-shadow,transform,border-color] hover:-translate-y-px hover:border-border-strong/60 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card motion-reduce:hover:translate-y-0"
                      >
                        {inner}
                      </button>
                    ) : (
                      <div className="flex h-full flex-col items-start rounded-xl border bg-surface p-3">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canManageRooms && (
            <form onSubmit={addRooms} className="mt-5 grid gap-2 border-t pt-5">
              <Field
                label="Add room numbers"
                hint={roomNumbers.length ? `${roomNumbers.length} room${roomNumbers.length === 1 ? '' : 's'}: ${roomNumbers.slice(0, 10).join(', ')}${roomNumbers.length > 10 ? '…' : ''}` : 'Ranges and lists both work, like “301-305, 310”.'}
                error={parsed && 'error' in parsed ? parsed.error : undefined}
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="e.g. 301-305" autoComplete="off" />
                  <Button type="submit" variant="outline" loading={adding} loadingText="Adding rooms…" disabled={!roomNumbers.length} className="shrink-0">
                    <Plus aria-hidden /> Add{roomNumbers.length ? ` ${roomNumbers.length}` : ''}
                  </Button>
                </div>
              </Field>
            </form>
          )}
        </Card>

        {editable && (
          <SaveBar
            dirty={dirty}
            saving={saving}
            onSave={() => void save()}
            onDiscard={() => {
              setDraft(toDraft(t));
              setTried(false);
            }}
          />
        )}
      </div>

      <RoomDialog room={editRoom} onClose={() => setEditRoom(null)} onSaved={() => void mutate()} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${t.name}?`}
        description={
          t._count.bookings > 0
            ? 'It has booking history, so it will be hidden from sale instead — past reservations stay intact.'
            : 'This removes the room type, its photos, rates and room numbers. This can’t be undone.'
        }
        confirmLabel={t._count.bookings > 0 ? 'Hide from sale' : 'Delete'}
        destructive
        loading={deleting}
        onConfirm={remove}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/room-types"
      className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden /> Rooms
    </Link>
  );
}
