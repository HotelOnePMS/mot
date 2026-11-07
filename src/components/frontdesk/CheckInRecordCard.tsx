'use client';

import * as React from 'react';
import useSWR from 'swr';
import { Eye, FileSignature, IdCard, ScrollText } from 'lucide-react';
import type { BookingSummary } from '@/lib/dto';
import { ID_TYPE_LABEL, countryName, type IdType } from '@/lib/card-authorization';
import { api, fetcher } from '@/lib/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { useConsole } from '@/components/console/ConsoleProvider';

/** What the guided check-in recorded (CheckInRecordSummary in server/services/checkin.ts). */
interface CheckInRecord {
  id: {
    source: string;
    idType: string;
    country: string | null;
    region: string | null;
    last4: string;
    expiresOn: string | null;
    nameOnId: string;
    nameMatched: boolean;
    adult: boolean | null;
    confirmedBy: string | null;
    at: string;
    photo: boolean;
    sealed: boolean;
    purgedAt: string | null;
  } | null;
  registration: {
    signedAt: string;
    guestName: string;
    signatureMethod: string;
    signatureImage: string | null;
    witnessedBy: string | null;
    text: string;
    textVersion: string;
    documentHash: string;
  } | null;
}

/** The sealed ID details (revealGuestIdDetails in server/services/checkin.ts). */
interface IdDetails {
  documentNumber: string;
  dateOfBirth: string | null;
  address: { line1: string; city: string; region: string; postalCode: string; country: string | null } | null;
  sex: string | null;
  nationality: string | null;
}

const SOURCE_LABEL: Record<string, string> = { SCAN_AAMVA: 'Scanned the barcode', SCAN_MRZ: 'Read the passport lines', MANUAL: 'Typed in' };
const SIGNATURE_LABEL: Record<string, string> = { DRAWN: 'Drawn signature', TYPED: 'Typed their name' };
const SEX_LABEL: Record<string, string> = { M: 'Male', F: 'Female', X: 'X' };

const formatDateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
/** A calendar day (YYYY-MM-DD), read in UTC so it never shifts with the viewer's timezone. */
const formatDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString([], { dateStyle: 'medium', timeZone: 'UTC' });
const revoke = (url: string) => URL.revokeObjectURL(url);

/** The ID photo as an object URL; revoke it when done. */
async function loadIdPhoto(bookingId: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/bookings/${bookingId}/guest-id/photo`, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new Error('Couldn’t reach the server. Try again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'The photo couldn’t be loaded.');
  }
  return URL.createObjectURL(await res.blob());
}

/**
 * Something only loaded when staff ask for it (every load is logged on the
 * server) and forgotten when they close it. Started from the click rather
 * than an effect, so a re-render can't log a second view.
 */
function useOnDemand<T>(load: () => Promise<T>, release?: (value: T) => void) {
  const [state, setState] = React.useState<{ value: T | null; error: string } | null>(null);
  const run = React.useRef(0);
  const held = React.useRef<T | null>(null);

  const close = React.useCallback(() => {
    run.current += 1;
    if (held.current !== null) release?.(held.current);
    held.current = null;
    setState(null);
  }, [release]);

  async function show() {
    const mine = ++run.current;
    setState({ value: null, error: '' });
    try {
      const value = await load();
      // Closed (or opened again) while it loaded: drop this copy.
      if (mine !== run.current) return release?.(value);
      held.current = value;
      setState({ value, error: '' });
    } catch (e) {
      if (mine === run.current) setState({ value: null, error: (e as Error).message });
    }
  }

  React.useEffect(() => close, [close]);
  return { open: state !== null, value: state?.value ?? null, error: state?.error ?? '', show, close };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}

/**
 * What check-in recorded: the guest's photo ID (type, country, last four,
 * with the photo and sealed details for staff allowed to see them) and the
 * registration card they signed. A guest checked in without them can have
 * them added afterwards (onRecord opens the check-in wizard).
 */
export function CheckInRecordCard({ booking, onRecord }: { booking: BookingSummary; onRecord?: () => void }) {
  const { can } = useConsole();
  const { data } = useSWR<CheckInRecord>(`/api/admin/bookings/${booking.id}/guest-id`, fetcher);
  const [reading, setReading] = React.useState(false);
  const photo = useOnDemand(() => loadIdPhoto(booking.id), revoke);
  const details = useOnDemand(() => api<IdDetails>(`/api/admin/bookings/${booking.id}/guest-id/details`, { cache: 'no-store' }));

  if (!data) return null;
  const { id, registration: card } = data;

  if (!id && !card) {
    // Before check-in the wizard records them; afterwards they can be added to a stay checked in without them.
    if (booking.status !== 'CHECKED_IN' || !onRecord) return null;
    return (
      <Card className="p-5 sm:p-6">
        <h2 className="flex min-h-9 items-center gap-2 text-base font-semibold tracking-tight">
          <IdCard className="size-4 text-muted-foreground" aria-hidden /> Check-in record
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">No photo ID or registration card was recorded at check-in.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onRecord}>
          <IdCard aria-hidden /> Add ID and registration card
        </Button>
      </Card>
    );
  }

  const viewer = can('guestId.view');
  const idLine = id
    ? [ID_TYPE_LABEL[id.idType as IdType] ?? id.idType, id.country ? countryName(id.country) + (id.region ? ` (${id.region})` : '') : null, `ending ${id.last4}`].filter(Boolean).join(' · ')
    : '';

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="flex min-h-9 items-center gap-2 text-base font-semibold tracking-tight">
        <IdCard className="size-4 text-muted-foreground" aria-hidden /> Check-in record
      </h2>

      {id && (
        <section aria-labelledby="checkin-id-title" className="mt-3 rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="checkin-id-title" className="text-sm font-medium">
              Photo ID
            </h3>
            {id.adult === false && (
              <Badge variant="warning" size="sm">
                Under 18
              </Badge>
            )}
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Row label="ID">{idLine}</Row>
            {id.expiresOn && <Row label="Expires">{formatDay(id.expiresOn)}</Row>}
            <Row label="Name on ID">
              {id.nameOnId}
              {!id.nameMatched && (
                <Badge variant="warning" size="sm" className="ml-1.5" title={`The reservation is for ${booking.guest.name}`}>
                  Different name
                </Badge>
              )}
            </Row>
            <Row label="Checked by">
              {id.confirmedBy ?? 'Staff'} · {formatDateTime(id.at)}
            </Row>
            <Row label="How">{SOURCE_LABEL[id.source] ?? id.source}</Row>
          </dl>

          {id.purgedAt ? (
            <p className="mt-3 text-xs text-muted-foreground">Photo and details deleted on {formatDate(id.purgedAt)} (retention).</p>
          ) : !id.photo && !id.sealed ? (
            <p className="mt-3 text-xs text-muted-foreground">No ID photo was kept.</p>
          ) : (
            viewer && (
              <div className="mt-3 flex flex-wrap gap-2">
                {id.photo && (
                  <Button variant="outline" size="sm" onClick={() => void photo.show()}>
                    <IdCard aria-hidden /> View ID photo
                  </Button>
                )}
                {id.sealed && (
                  <Button variant="ghost" size="sm" onClick={() => void details.show()}>
                    <Eye aria-hidden /> Show full details
                  </Button>
                )}
              </div>
            )
          )}
        </section>
      )}

      {card && (
        <section aria-labelledby="checkin-card-title" className="mt-3 rounded-xl border p-3">
          <h3 id="checkin-card-title" className="flex items-center gap-2 text-sm font-medium">
            <FileSignature className="size-4 text-muted-foreground" aria-hidden /> Registration card
          </h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Row label="Signed">
              {formatDateTime(card.signedAt)} by {card.guestName}
            </Row>
            <Row label="Signature">{SIGNATURE_LABEL[card.signatureMethod] ?? card.signatureMethod}</Row>
            {card.witnessedBy && <Row label="Witnessed by">{card.witnessedBy}</Row>}
          </dl>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {card.signatureImage && (
              // A PNG data URL stored with the card, on white like the pad it was drawn on.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.signatureImage} alt={`Signature of ${card.guestName}`} className="h-12 max-w-[180px] rounded-lg border bg-white object-contain p-1" />
            )}
            <Button variant="outline" size="sm" onClick={() => setReading(true)}>
              <ScrollText aria-hidden /> Read the card
            </Button>
          </div>
        </section>
      )}

      {id && (
        <Dialog open={photo.open} onOpenChange={(o) => !o && photo.close()}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{booking.guest.name}’s photo ID</DialogTitle>
              <DialogDescription>{idLine}. Viewing is logged.</DialogDescription>
            </DialogHeader>
            {photo.error ? (
              <Callout tone="danger">{photo.error}</Callout>
            ) : photo.value ? (
              // A private object URL of a no-store response, so next/image's optimizer can't serve it.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.value} alt={`Photo ID of ${id.nameOnId}`} className="max-h-[70vh] w-full rounded-xl border bg-muted object-contain" />
            ) : (
              <>
                <Skeleton className="aspect-[3/2] h-auto rounded-xl" />
                <span className="sr-only" role="status">
                  Loading the photo…
                </span>
              </>
            )}
            <DialogFooter>
              <Button onClick={photo.close}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {id && (
        <Dialog open={details.open} onOpenChange={(o) => !o && details.close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{booking.guest.name}’s ID details</DialogTitle>
              <DialogDescription>{idLine}. Viewing is logged.</DialogDescription>
            </DialogHeader>
            {details.error ? (
              <Callout tone="danger">{details.error}</Callout>
            ) : details.value ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">ID number</dt>
                <dd className="break-all font-mono">{details.value.documentNumber}</dd>
                {details.value.dateOfBirth && (
                  <>
                    <dt className="text-muted-foreground">Date of birth</dt>
                    <dd>{formatDay(details.value.dateOfBirth)}</dd>
                  </>
                )}
                {details.value.sex && (
                  <>
                    <dt className="text-muted-foreground">Sex</dt>
                    <dd>{SEX_LABEL[details.value.sex] ?? details.value.sex}</dd>
                  </>
                )}
                {details.value.nationality && (
                  <>
                    <dt className="text-muted-foreground">Nationality</dt>
                    <dd>{countryName(details.value.nationality)}</dd>
                  </>
                )}
                {details.value.address && (
                  <>
                    <dt className="text-muted-foreground">Address</dt>
                    <dd className="break-words">
                      {details.value.address.line1}, {[details.value.address.city, details.value.address.region, details.value.address.postalCode].filter(Boolean).join(' ')}
                      {details.value.address.country ? `, ${countryName(details.value.address.country)}` : ''}
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <>
                <Skeleton className="h-24 rounded-xl" />
                <span className="sr-only" role="status">
                  Loading the details…
                </span>
              </>
            )}
            <DialogFooter>
              <Button onClick={details.close}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {card && (
        <Dialog open={reading} onOpenChange={setReading}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Registration card</DialogTitle>
              <DialogDescription>
                Exactly what {card.guestName} signed on {formatDateTime(card.signedAt)}.
              </DialogDescription>
            </DialogHeader>
            <p className="whitespace-pre-wrap rounded-xl bg-muted/60 p-4 text-sm leading-relaxed">{card.text}</p>
            {card.signatureImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.signatureImage} alt={`Signature of ${card.guestName}`} className="h-20 max-w-[280px] rounded-lg border bg-white object-contain p-1" />
            )}
            <p className="break-all font-mono text-2xs text-muted-foreground">
              Wording {card.textVersion} · record SHA-256 {card.documentHash}
            </p>
            <DialogFooter>
              <Button onClick={() => setReading(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
