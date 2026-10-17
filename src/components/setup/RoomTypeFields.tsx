'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput } from './ChipInput';

export interface RoomTypeDraft {
  name: string;
  description: string;
  capacity: string;
  basePrice: string;
  totalRooms: string;
  amenities: string[];
}

export const EMPTY_ROOM_TYPE: RoomTypeDraft = { name: '', description: '', capacity: '2', basePrice: '', totalRooms: '', amenities: [] };

export const AMENITY_SUGGESTIONS = [
  'Wi-Fi',
  'King bed',
  'Queen bed',
  'Two queens',
  'Ocean view',
  'Garden view',
  'Balcony',
  'Kitchenette',
  'Air conditioning',
  'Rain shower',
  'Bathtub',
  'Smart TV',
  'Coffee maker',
  'Mini fridge',
  'Workspace',
  'Pet friendly',
];

export type RoomTypeErrors = Partial<Record<keyof RoomTypeDraft, string>>;

/** Every problem with the draft, keyed by field, so each one shows next to its field. */
export function roomTypeErrors(d: RoomTypeDraft): RoomTypeErrors {
  const e: RoomTypeErrors = {};
  if (d.name.trim().length < 2) e.name = 'Give the room type a name.';
  if (!(Number(d.capacity) >= 1)) e.capacity = 'How many guests can stay? At least 1.';
  if (d.basePrice === '' || !(Number(d.basePrice) >= 0)) e.basePrice = 'Set a nightly base price.';
  if (d.totalRooms !== '' && !(Number(d.totalRooms) >= 0)) e.totalRooms = 'Room count must be zero or more.';
  return e;
}

/** The first problem with the draft as one sentence, or null when it's ready to save. */
export function validateRoomType(d: RoomTypeDraft): string | null {
  const e = roomTypeErrors(d);
  return e.name ?? e.capacity ?? e.basePrice ?? e.totalRooms ?? null;
}

/**
 * The room type form. Pass `errors` (from `roomTypeErrors`) to show each
 * problem next to its field; leave it out until the person tries to save.
 */
export function RoomTypeFields({
  value,
  onChange,
  showCount = true,
  errors = {},
}: {
  value: RoomTypeDraft;
  onChange: (v: RoomTypeDraft) => void;
  showCount?: boolean;
  errors?: RoomTypeErrors;
}) {
  const set = <K extends keyof RoomTypeDraft>(k: K, v: RoomTypeDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-5">
      <Field label="Name" required error={errors.name} hint="What guests see when they book, like “Ocean King” or “Family Suite”.">
        <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Ocean King" maxLength={80} required />
      </Field>
      <Field label="Description" optional hint="Two or three sentences: the bed, the view, what makes it special.">
        <Textarea rows={3} value={value.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sleeps" required error={errors.capacity} hint="Most guests allowed.">
          <Input type="number" inputMode="numeric" min={1} max={20} value={value.capacity} onChange={(e) => set('capacity', e.target.value)} required />
        </Field>
        <Field label="Base price per night" required error={errors.basePrice} hint="Before any custom rates.">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-muted-foreground md:text-sm" aria-hidden>
              $
            </span>
            <Input type="number" inputMode="decimal" min={0} step="0.01" value={value.basePrice} onChange={(e) => set('basePrice', e.target.value)} className="pl-7" placeholder="189" required />
          </div>
        </Field>
        {showCount && (
          <Field label="Rooms of this type" error={errors.totalRooms} hint="How many you can sell each night.">
            <Input type="number" inputMode="numeric" min={0} value={value.totalRooms} onChange={(e) => set('totalRooms', e.target.value)} placeholder="10" />
          </Field>
        )}
      </div>
      <Field label="Amenities" optional hint="Pick from the suggestions or type your own and press Enter.">
        <ChipInput value={value.amenities} onChange={(v) => set('amenities', v)} suggestions={AMENITY_SUGGESTIONS} placeholder="e.g. Fireplace" />
      </Field>
    </div>
  );
}
