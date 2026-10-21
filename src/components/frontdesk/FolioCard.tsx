'use client';

import * as React from 'react';
import useSWR from 'swr';
import type { BookingSummary } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import type { FolioDeposit, FolioLine, FolioView } from '@/lib/folio';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/primitives';
import { useConsole } from '@/components/console/ConsoleProvider';

const key = (bookingId: string) => `/api/admin/bookings/${bookingId}/folio`;
const fmt = (n: number, c: string) => formatMoney(n, c, { cents: true });
/** Payments read as negative, with a real minus sign. */
const signed = (n: number, c: string) => (n < 0 ? `−${fmt(-n, c)}` : fmt(n, c));
const formatDateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** A booking's folio. Null for staff who can't see it (folio.view). */
export function useFolio(bookingId: string | null | undefined) {
  const { can } = useConsole();
  return useSWR<FolioView>(bookingId && can('folio.view') ? key(bookingId) : null, fetcher);
}

const HEADING = 'text-2xs font-semibold uppercase tracking-wider text-muted-foreground';

function LineTable({ title, lines, currency, empty }: { title: string; lines: FolioLine[]; currency: string; empty: string }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className={HEADING}>
        {title}
      </h3>
      {lines.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="mt-1 w-full text-sm" aria-labelledby={id}>
          <thead className="sr-only">
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => {
              const detail = [l.detail, l.at ? formatDateTime(l.at) : null].filter(Boolean).join(' · ');
              return (
                <tr key={l.key} className="align-top">
                  <th scope="row" className="min-w-0 py-2 pr-3 text-left font-normal">
                    <span className="block break-words">{l.label}</span>
                    {detail && <span className="block break-words text-xs text-muted-foreground">{detail}</span>}
                  </th>
                  <td className="whitespace-nowrap py-2 text-right tabular">{signed(l.amount, currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function depositState(d: FolioDeposit, currency: string): { label: string; tone: 'info' | 'neutral' } {
  if (d.state === 'HELD') return { label: d.hold ? 'Held on card' : 'Held', tone: 'info' };
  if (d.state === 'RELEASED') return { label: 'Released', tone: 'neutral' };
  return { label: d.kept > 0 ? `Kept ${fmt(d.kept, currency)}` : 'Returned', tone: 'neutral' };
}

function Deposits({ folio }: { folio: FolioView }) {
  const id = React.useId();
  const { currency } = folio;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className={HEADING}>
        Security deposit
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Held against incidentals, not part of the balance{folio.depositHeld > 0 ? ` · ${fmt(folio.depositHeld, currency)} still held` : ''}.
      </p>
      <table className="mt-1 w-full text-sm" aria-labelledby={id}>
        <thead className="sr-only">
          <tr>
            <th scope="col">Deposit</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {folio.deposits.map((d) => {
            const state = depositState(d, currency);
            const when = d.settledAt ? `settled ${formatDateTime(d.settledAt)}` : formatDateTime(d.at);
            return (
              <tr key={d.id} className="align-top">
                <th scope="row" className="min-w-0 py-2 pr-3 text-left font-normal">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {d.methodLabel}
                    <Badge variant={state.tone} size="sm">
                      {state.label}
                    </Badge>
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">{[d.card, when].filter(Boolean).join(' · ')}</span>
                </th>
                <td className="whitespace-nowrap py-2 text-right tabular">{fmt(d.amount, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The folio without its card: the room and taxes, payments and refunds, the
 * totals with the balance, and security deposits apart (they never count
 * toward the balance). Used on the reservation page and in the check-in wizard.
 */
export function FolioSummary({ bookingId }: { bookingId: string }) {
  const { can } = useConsole();
  const { data, error, mutate } = useFolio(bookingId);
  if (!can('folio.view')) return null;

  if (error && !data) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn’t load the folio.{' '}
        <Button variant="link" className="text-sm" onClick={() => void mutate()}>
          Try again
        </Button>
      </p>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-20 rounded-xl" />
        <span className="sr-only" role="status">
          Loading the folio…
        </span>
      </div>
    );
  }

  const { currency, totals: t } = data;
  const charges = data.lines.filter((l) => l.section === 'CHARGES');
  const payments = data.lines.filter((l) => l.section === 'PAYMENTS');
  const due = t.balance > 0.004;
  const credit = t.balance < -0.004;

  return (
    <div className="space-y-4">
      <LineTable title="Charges" lines={charges} currency={currency} empty="No charges." />
      <LineTable title="Payments" lines={payments} currency={currency} empty="Nothing paid yet." />

      <dl className="space-y-1 rounded-xl bg-muted px-3 py-2.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Charges</dt>
          <dd className="tabular">{fmt(t.charges, currency)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="tabular">{signed(-t.paid, currency)}</dd>
        </div>
        {t.refunded > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Refunded</dt>
            <dd className="tabular">{fmt(t.refunded, currency)}</dd>
          </div>
        )}
        <div className="flex items-start justify-between gap-3 border-t pt-2 font-semibold">
          <dt>
            {due ? 'Balance due' : credit ? 'Credit' : 'Settled'}
            {credit && <span className="block text-xs font-normal text-muted-foreground">Owed back to the guest</span>}
          </dt>
          <dd className={cn('tabular', due && 'text-warning-soft-foreground')}>{fmt(Math.abs(t.balance), currency)}</dd>
        </div>
      </dl>

      {data.deposits.length > 0 && <Deposits folio={data} />}

      {data.reservation && (
        <p className="text-xs text-muted-foreground">
          Shows this room type’s share of reservation {data.reservation.code} ({data.reservation.roomTypes} room types paid together).
        </p>
      )}
    </div>
  );
}

/** The reservation page's folio card. Nothing for staff who can't see the folio. */
export function FolioCard({ booking }: { booking: BookingSummary }) {
  const { can } = useConsole();
  const { data, mutate } = useFolio(booking.id);

  // Payments taken elsewhere on the page refresh the booking: follow its balance and status so the folio keeps up.
  const seen = React.useRef(`${booking.balance}|${booking.status}`);
  React.useEffect(() => {
    const now = `${booking.balance}|${booking.status}`;
    if (seen.current === now) return;
    seen.current = now;
    void mutate();
  }, [booking.balance, booking.status, mutate]);

  if (!can('folio.view')) return null;
  // A cancelled stay or a no-show isn't collected through the folio, so no "due" badge for those.
  const open = booking.status !== 'CANCELLED' && booking.status !== 'NO_SHOW';

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Folio</h2>
        {data &&
          (data.settled ? (
            <Badge variant="success" dot>
              Settled
            </Badge>
          ) : (
            open && (
              <Badge variant="warning" dot className="tabular">
                {fmt(data.totals.balance, data.currency)} due
              </Badge>
            )
          ))}
      </div>
      <div className="mt-3">
        <FolioSummary bookingId={booking.id} />
      </div>
    </Card>
  );
}
