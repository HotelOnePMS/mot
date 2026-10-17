'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/fetcher';
import { parseRoomNumbers } from '@/lib/rooms';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, PageHeader } from '@/components/ui/primitives';
import { errorSummary } from '@/components/setup/PropertyFields';
import { EMPTY_ROOM_TYPE, RoomTypeFields, roomTypeErrors, type RoomTypeDraft } from '@/components/setup/RoomTypeFields';
import { useConsole } from '@/components/console/ConsoleProvider';

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

export default function AddRoomTypePage() {
  const router = useRouter();
  const { property, propertyId, refresh } = useConsole();
  const [draft, setDraft] = React.useState<RoomTypeDraft>(EMPTY_ROOM_TYPE);
  const [numbers, setNumbers] = React.useState('');
  // Field errors show once someone has tried to save, then update as they type.
  const [tried, setTried] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const parsed = numbers.trim() ? parseRoomNumbers(numbers) : null;
  const roomNumbers = parsed && 'numbers' in parsed ? parsed.numbers : [];
  const numbersError = parsed && 'error' in parsed ? parsed.error : null;
  const errors = tried ? roomTypeErrors(draft) : {};
  const summary = errorSummary({ ...errors, numbers: tried ? (numbersError ?? undefined) : undefined });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setServerError(null);
    if (Object.keys(roomTypeErrors(draft)).length || numbersError) {
      // Take people to the first field that needs fixing.
      requestAnimationFrame(() => {
        const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.focus();
        first?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    if (!propertyId) return;
    setSaving(true);
    try {
      const totalRooms = Math.max(Number(draft.totalRooms || 0), roomNumbers.length);
      const created = await api<{ id: string; name: string }>('/api/admin/room-types', {
        method: 'POST',
        json: {
          propertyId,
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          capacity: Number(draft.capacity),
          basePrice: Number(draft.basePrice),
          totalRooms,
          amenities: draft.amenities,
        },
      });
      if (roomNumbers.length) {
        try {
          await api('/api/admin/rooms', { method: 'POST', json: { propertyId, roomTypeId: created.id, roomNumbers } });
        } catch (err) {
          toast.error(`Room type saved, but rooms weren’t added: ${(err as Error).message}`);
        }
      }
      toast.success(`${created.name} is ready to sell`);
      refresh();
      router.push(`/admin/room-types/${created.id}`);
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={FRAME}>
      <div className="max-w-4xl space-y-6">
        <Link
          href="/admin/room-types"
          className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden /> Rooms
        </Link>
        <PageHeader title="New room type" description={property ? `For ${property.name}. You can add photos and adjust rates right after.` : 'You can add photos and adjust rates right after.'} />

        <form ref={formRef} onSubmit={save} className="space-y-6" noValidate>
          <Card className="p-5 sm:p-6">
            <h2 className="mb-5 text-base font-semibold tracking-tight">Details</h2>
            <RoomTypeFields value={draft} onChange={setDraft} errors={errors} />
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="mb-4 text-base font-semibold tracking-tight">Room numbers</h2>
            <Field
              label="Room numbers"
              optional
              hint={
                roomNumbers.length
                  ? `${roomNumbers.length} room${roomNumbers.length === 1 ? '' : 's'}: ${roomNumbers.slice(0, 10).join(', ')}${roomNumbers.length > 10 ? '…' : ''}`
                  : 'Ranges and lists both work, like “101-110, 201”. Floors are read from the number. You can add them later too.'
              }
              error={numbersError ?? undefined}
            >
              <Input value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="101-110" autoComplete="off" />
            </Field>
          </Card>

          {(serverError || summary) && (
            <Callout tone="danger" title={serverError ? 'We couldn’t create the room type' : 'Please check the form'} role="alert">
              {serverError ?? summary}
            </Callout>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} loadingText="Creating the room type…">
              Create room type
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
