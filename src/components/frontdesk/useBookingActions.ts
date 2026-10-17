'use client';

import * as React from 'react';
import { toast } from 'sonner';
import type { BookingStatus, BookingSummary } from '@/lib/dto';
import { api } from '@/lib/fetcher';
import { useConsole } from '@/components/console/ConsoleProvider';

const VERB: Partial<Record<BookingStatus, string>> = {
  CHECKED_IN: 'checked in',
  CHECKED_OUT: 'checked out',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'marked as no-show',
};

/** Booking mutations with toasts and a console-wide refresh afterwards. */
export function useBookingActions() {
  const { refresh } = useConsole();
  const [pending, setPending] = React.useState<string | null>(null);

  const run = React.useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success: (r: T) => string): Promise<T | null> => {
      setPending(key);
      try {
        const r = await fn();
        toast.success(success(r));
        refresh();
        return r;
      } catch (e) {
        toast.error((e as Error).message);
        return null;
      } finally {
        setPending(null);
      }
    },
    [refresh]
  );

  const transition = React.useCallback(
    (b: Pick<BookingSummary, 'id' | 'guest'>, status: BookingStatus, opts: { roomId?: string; notes?: string; allowDirtyRoom?: boolean } = {}) =>
      run(
        `${b.id}:${status}`,
        () =>
          api<{ booking: BookingSummary; effects: string[] }>(`/api/admin/bookings/${b.id}`, {
            method: 'PATCH',
            json: { status, ...opts },
          }),
        (r) => `${b.guest.name} ${VERB[status] ?? 'updated'}${r.booking.room && status === 'CHECKED_IN' ? ` · Room ${r.booking.room.number}` : ''}`
      ),
    [run]
  );

  const assignRoom = React.useCallback(
    (b: Pick<BookingSummary, 'id' | 'guest'>, roomId: string) =>
      run(
        `${b.id}:room`,
        () => api<BookingSummary>(`/api/admin/bookings/${b.id}/room`, { method: 'POST', json: { roomId } }),
        (r) => `${b.guest.name} → Room ${r.room?.number}`
      ),
    [run]
  );

  const addNote = React.useCallback(
    (b: Pick<BookingSummary, 'id' | 'guest'>, note: string) =>
      run(`${b.id}:note`, () => api<BookingSummary>(`/api/admin/bookings/${b.id}/notes`, { method: 'POST', json: { note } }), () => `Note added to ${b.guest.name}`),
    [run]
  );

  return { transition, assignRoom, addNote, pending };
}
