'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { CheckCircle2, CircleDashed, ExternalLink, FileSignature, IdCard, Link2, Mail, Send, Share2, ShieldAlert, XCircle } from 'lucide-react';
import type { BookingSummary } from '@/lib/dto';
import {
  CARD_AUTH_STATUS,
  ID_TYPE_LABEL,
  cardBrandLabel,
  countryName,
  joinNames,
  splitNames,
  type CardAuthDisplayStatus,
  type CheckResult,
  type IdType,
} from '@/lib/card-authorization';
import { api, fetcher } from '@/lib/fetcher';
import { formatMoney, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/setup/CopyButton';

interface Authorization {
  id: string;
  status: CardAuthDisplayStatus;
  createdAt: string;
  expiresAt: string;
  requestedBy: string | null;
  cardholderName: string;
  cardholderEmail: string | null;
  guestNames: string[];
  amount: number;
  currency: string;
  coversIncidentals: boolean;
  incidentalsLimit: number | null;
  card: { brand: string | null; last4: string } | null;
  emailedAt: string | null;
  failedAttempts: number;
  signed: {
    name: string;
    email: string | null;
    phone: string | null;
    billingAddress: { line1: string; city: string; postalCode: string; country: string } | null;
    card: { brand: string | null; last4: string | null };
    id: { type: string | null; country: string | null; last4: string | null; photo: boolean; photoPurgedAt: string | null };
    signature: { method: string | null; image: string | null };
    at: string;
    ip: string | null;
    userAgent: string | null;
    text: string | null;
    textVersion: string | null;
    textHash: string | null;
    documentHash: string | null;
  } | null;
  checks: { key: string; result: CheckResult; label: string; detail: string }[];
  outcome: 'MATCH' | 'REVIEW' | null;
  review: { decision: 'VERIFIED' | 'REJECTED'; at: string; by: string | null; note: string | null } | null;
  cancelledAt: string | null;
}

interface Overview {
  authorizations: Authorization[];
  defaults: { cardholderName: string; cardholderEmail: string; guestNames: string[]; amount: number; currency: string; card: { brand: string | null; last4: string } | null };
  emailEnabled: boolean;
  idPhotos: boolean;
  reservation: { code: string; roomTypes: number } | null;
}

interface IssuedLink {
  authorization: Authorization;
  url: string;
  qrSvg: string;
  emailed: boolean;
}

const formatDateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });

const CHECK_ICON: Record<CheckResult, { icon: React.ElementType; className: string; sr: string }> = {
  MATCH: { icon: CheckCircle2, className: 'text-success', sr: 'Matches' },
  MISMATCH: { icon: XCircle, className: 'text-destructive', sr: 'Doesn’t match' },
  UNVERIFIED: { icon: CircleDashed, className: 'text-muted-foreground', sr: 'To check' },
};

function StatusBadge({ status }: { status: CardAuthDisplayStatus }) {
  const s = CARD_AUTH_STATUS[status];
  return <Badge variant={s.tone === 'neutral' ? 'neutral' : s.tone}>{s.label}</Badge>;
}

function RequestDialog({ booking, overview, open, onOpenChange, onIssued }: { booking: BookingSummary; overview: Overview; open: boolean; onOpenChange: (o: boolean) => void; onIssued: (l: IssuedLink) => void }) {
  const d = overview.defaults;
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [guests, setGuests] = React.useState('');
  const [covers, setCovers] = React.useState<'ROOM' | 'INCIDENTALS'>('ROOM');
  const [limit, setLimit] = React.useState('');
  const [sendEmail, setSendEmail] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setName(d.cardholderName);
    setEmail(d.cardholderEmail);
    setGuests(d.guestNames.join(', '));
    setCovers('ROOM');
    setLimit('');
    setSendEmail(overview.emailEnabled && !!d.cardholderEmail);
    setError('');
  }, [open, d, overview.emailEnabled]);

  const guestList = splitNames(guests);
  const limitValue = limit.trim() ? Number(limit) : null;
  const limitOk = limitValue === null || (Number.isFinite(limitValue) && limitValue >= 0);
  const emailOk = !email.trim() || /^\S+@\S+\.\S+$/.test(email.trim());
  const valid = name.trim().length >= 2 && guestList.length > 0 && limitOk && emailOk && (!sendEmail || !!email.trim());

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const link = await api<IssuedLink>(`/api/admin/bookings/${booking.id}/card-authorizations`, {
        method: 'POST',
        json: {
          cardholderName: name.trim(),
          cardholderEmail: email.trim() || null,
          guestNames: guestList,
          coversIncidentals: covers === 'INCIDENTALS',
          incidentalsLimit: covers === 'INCIDENTALS' ? limitValue : null,
          sendEmail,
        },
      });
      onIssued(link);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask the cardholder to authorize</DialogTitle>
          <DialogDescription>
            They get a short form: their details, the card’s last four digits, a photo of their ID and a signature. It works by email, as a link you text them, or on this device at the desk.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Cardholder’s name" htmlFor="ca-name" required hint="The person who owns the card, as on the card.">
            <Input id="ca-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Cardholder’s email" htmlFor="ca-email" optional error={emailOk ? undefined : 'Check the email address.'}>
            <Input id="ca-email" type="email" inputMode="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Guests the card pays for" htmlFor="ca-guests" required hint="Separate names with commas.">
            <Input id="ca-guests" value={guests} onChange={(e) => setGuests(e.target.value)} />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium" id="ca-covers-label">
              What the card covers
            </p>
            <SegmentedControl
              layoutId="ca-covers"
              aria-label="What the card covers"
              value={covers}
              onChange={setCovers}
              options={[
                { value: 'ROOM', label: 'Room and taxes' },
                { value: 'INCIDENTALS', label: 'Plus incidentals' },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Room and taxes: {formatMoney(d.amount, d.currency, { cents: true })}
              {overview.reservation ? ` for all ${overview.reservation.roomTypes} room types in ${overview.reservation.code}` : ''}.
            </p>
          </div>
          {covers === 'INCIDENTALS' && (
            <Field label={`Incidentals limit (${d.currency})`} htmlFor="ca-limit" optional hint="The most that may be charged for extras. Leave empty for no limit." error={limitOk ? undefined : 'Enter an amount, or leave it empty.'}>
              <Input id="ca-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className="w-40" />
            </Field>
          )}
          <Callout tone="neutral" icon={null}>
            {d.card
              ? `They’ll confirm the last four digits of the ${cardBrandLabel(d.card.brand)} ending ${d.card.last4} that paid online. The form doesn’t show those digits.`
              : 'No card has been charged online. They’ll tell you the card type and its last four digits; check them when you charge the card.'}
          </Callout>
          <label className={cn('flex min-h-10 items-start gap-2.5 text-sm', overview.emailEnabled ? 'cursor-pointer' : 'cursor-not-allowed text-muted-foreground')}>
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={sendEmail}
              disabled={!overview.emailEnabled}
              onChange={(e) => setSendEmail(e.target.checked)}
            />
            <span>
              Email them the link
              {!overview.emailEnabled && <span className="block text-xs">Email isn’t set up on this site. Copy the link or show the QR code instead.</span>}
              {overview.emailEnabled && sendEmail && !email.trim() && <span className="block text-xs text-destructive">Add their email above.</span>}
            </span>
          </label>
          {!overview.idPhotos && (
            <Callout tone="warning">ID photos can’t be stored securely until HOTELONE_VAULT_KEY is set, so the form will ask for ID details without a photo.</Callout>
          )}
          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button disabled={!valid} loading={busy} loadingText="Creating the link…" onClick={submit}>
            <Send aria-hidden /> {sendEmail ? 'Create and email link' : 'Create link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ link, onOpenChange }: { link: IssuedLink | null; onOpenChange: (o: boolean) => void }) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const a = link?.authorization;
  return (
    <Dialog open={!!link} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link ready for {a?.cardholderName}</DialogTitle>
          <DialogDescription>Send it however suits them. It works for 7 days, once. This is the only time it’s shown: if it gets lost, make a new one.</DialogDescription>
        </DialogHeader>
        {link && (
          <div className="space-y-4">
            {link.emailed && (
              <Callout tone="success" role="status">
                Emailed to {a?.cardholderEmail}.
              </Callout>
            )}
            <div className="flex gap-2">
              <Input readOnly value={link.url} aria-label="Authorization link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <CopyButton value={link.url} label="Copy" />
            </div>
            <div className="flex flex-col items-center gap-4 rounded-xl border p-4 sm:flex-row sm:items-start">
              <div className="size-36 shrink-0 rounded-lg border bg-white p-1.5 [&_svg]:size-full" role="img" aria-label="QR code of the authorization link" dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
              <div className="space-y-2 text-sm">
                <p className="font-medium">At the desk?</p>
                <p className="text-muted-foreground">They can scan this with their own phone, or sign on this device. The form doesn’t show the card’s digits or anything else about the reservation.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}>
                    <ExternalLink aria-hidden /> Open on this device
                  </Button>
                  {canShare && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.share({ title: 'Card authorization', text: `Please authorize your card for ${joinNames(a?.guestNames ?? [])}’s stay:`, url: link.url }).catch(() => undefined)}
                    >
                      <Share2 aria-hidden /> Share…
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ authorization: a, mode, onOpenChange, onDone }: { authorization: Authorization | null; mode: 'verify' | 'reject' | null; onOpenChange: (o: boolean) => void; onDone: () => Promise<void> }) {
  const [confirmed, setConfirmed] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    setConfirmed(false);
    setNote('');
    setError('');
  }, [mode, a?.id]);
  if (!a?.signed) return null;
  const name = a.signed.name;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/card-authorizations/${a!.id}`, { method: 'POST', json: mode === 'verify' ? { action: 'verify' } : { action: 'reject', note: note.trim() } });
      toast.success(mode === 'verify' ? `${name}’s authorization verified` : 'Authorization rejected');
      await onDone();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!mode} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'verify' ? `Verify ${name}’s authorization?` : `Reject ${name}’s authorization?`}</DialogTitle>
          <DialogDescription>
            {mode === 'verify'
              ? 'Your name and the time are recorded with it, and it covers “card shown” on the check-in checklist.'
              : 'Say why, for the record. You can then ask them (or the right person) to sign again.'}
          </DialogDescription>
        </DialogHeader>
        {mode === 'verify' ? (
          <label className="flex min-h-10 cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              I looked at the ID{a.signed.id.photo ? ' photo' : ''}: it’s a valid photo ID in the name of {name}
              {a.outcome === 'REVIEW' ? ', and I’m satisfied with the details that didn’t match' : ''}.
            </span>
          </label>
        ) : (
          <Field label="Reason" htmlFor="ca-reject" required>
            <Textarea id="ca-reject" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The name on the ID is different" />
          </Field>
        )}
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          {mode === 'verify' ? (
            <Button disabled={!confirmed} loading={busy} onClick={submit}>
              <CheckCircle2 aria-hidden /> Verify
            </Button>
          ) : (
            <Button variant="destructive" disabled={!note.trim()} loading={busy} onClick={submit}>
              Reject
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdPhotoDialog({ authorization: a, onOpenChange }: { authorization: Authorization | null; onOpenChange: (o: boolean) => void }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [a?.id]);
  return (
    <Dialog open={!!a} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{a?.signed?.name}’s photo ID</DialogTitle>
          <DialogDescription>
            {a?.signed?.id.type ? ID_TYPE_LABEL[a.signed.id.type as IdType] ?? a.signed.id.type : 'ID'}
            {a?.signed?.id.country ? ` · ${countryName(a.signed.id.country)}` : ''}
            {a?.signed?.id.last4 ? ` · number ending ${a.signed.id.last4}` : ''}. Viewing is logged.
          </DialogDescription>
        </DialogHeader>
        {a &&
          (failed ? (
            <Callout tone="danger">The photo couldn’t be loaded. It may have been deleted after the retention period.</Callout>
          ) : (
            // Served from our own authenticated endpoint (no-store), so next/image's optimizer must not cache it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/admin/card-authorizations/${a.id}/id-photo`} alt={`Photo ID of ${a.signed?.name ?? 'the cardholder'}`} className="max-h-[70vh] w-full rounded-xl border bg-muted object-contain" onError={() => setFailed(true)} />
          ))}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignedDetails({ a, onViewId }: { a: Authorization; onViewId: () => void }) {
  const s = a.signed!;
  return (
    <div className="mt-3 space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Signed by</dt>
        <dd className="text-foreground">{s.name}</dd>
        {s.email && (
          <>
            <dt>Contact</dt>
            <dd className="truncate text-foreground">
              {s.email}
              {s.phone ? ` · ${s.phone}` : ''}
            </dd>
          </>
        )}
        <dt>Card</dt>
        <dd className="text-foreground">
          {cardBrandLabel(s.card.brand)} ending {s.card.last4}
        </dd>
        {s.billingAddress && (
          <>
            <dt>Billing</dt>
            <dd className="text-foreground">
              {s.billingAddress.line1}, {s.billingAddress.city} {s.billingAddress.postalCode}, {countryName(s.billingAddress.country)}
            </dd>
          </>
        )}
        <dt>ID</dt>
        <dd className="text-foreground">
          {s.id.type ? (ID_TYPE_LABEL[s.id.type as IdType] ?? s.id.type) : 'ID'}
          {s.id.country ? ` · ${countryName(s.id.country)}` : ''}
          {s.id.last4 ? ` · ending ${s.id.last4}` : ''}
        </dd>
        <dt>When</dt>
        <dd className="text-foreground">
          {formatDateTime(s.at)}
          {s.ip ? ` · ${s.ip}` : ''}
        </dd>
        <dt>For</dt>
        <dd className="text-foreground">
          {joinNames(a.guestNames)} · {formatMoney(a.amount, a.currency, { cents: true })}
          {a.coversIncidentals ? ` + incidentals${a.incidentalsLimit != null ? ` up to ${formatMoney(a.incidentalsLimit, a.currency, { cents: true })}` : ''}` : ''}
        </dd>
      </dl>

      <ul className="space-y-1.5" aria-label="How the details matched">
        {a.checks.map((c) => {
          const look = CHECK_ICON[c.result];
          return (
            <li key={c.key} className="flex items-start gap-2 text-xs">
              <look.icon className={cn('mt-0.5 size-3.5 shrink-0', look.className)} aria-hidden />
              <span>
                <span className="sr-only">{look.sr}: </span>
                <span className="font-medium">{c.label}.</span> <span className="text-muted-foreground">{c.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-end gap-3">
        {s.signature.method === 'DRAWN' && s.signature.image ? (
          // A data URL stored with the authorization.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.signature.image} alt={`Signature of ${s.name}`} className="h-16 max-w-[220px] rounded-lg border bg-white object-contain p-1" />
        ) : (
          <p className="rounded-lg border bg-white px-3 py-1.5 text-xl text-slate-900" style={{ fontFamily: '"Brush Script MT", "Segoe Script", "Apple Chancery", cursive' }}>
            <span className="sr-only">Typed signature: </span>
            {s.name}
          </p>
        )}
        {s.id.photo ? (
          <Button variant="outline" size="sm" onClick={onViewId}>
            <IdCard aria-hidden /> View ID photo
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{s.id.photoPurgedAt ? `ID photo deleted ${formatDate(s.id.photoPurgedAt)} (retention period).` : 'No ID photo was collected.'}</p>
        )}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">What they signed</summary>
        <p className="mt-2 whitespace-pre-line rounded-lg bg-muted/60 p-3 leading-relaxed">{s.text}</p>
        <p className="mt-2 break-all text-muted-foreground">
          Record SHA-256 {s.documentHash} · wording {s.textVersion}
          {s.userAgent ? ` · ${s.userAgent}` : ''}
        </p>
      </details>
    </div>
  );
}

function AuthorizationItem({
  a,
  busy,
  onRenew,
  onCancel,
  onReview,
  onViewId,
}: {
  a: Authorization;
  busy: boolean;
  onRenew: (sendEmail: boolean) => void;
  onCancel: () => void;
  onReview: (mode: 'verify' | 'reject') => void;
  onViewId: () => void;
}) {
  const open = a.status === 'PENDING' || a.status === 'EXPIRED';
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{a.signed?.name ?? a.cardholderName}</p>
        <StatusBadge status={a.status} />
      </div>
      {a.status === 'PENDING' && (
        <p className="mt-1 text-xs text-muted-foreground">
          {a.emailedAt ? `Emailed to ${a.cardholderEmail} ${timeAgo(a.emailedAt)}` : `Link made ${timeAgo(a.createdAt)}${a.requestedBy ? ` by ${a.requestedBy}` : ''}`} · works until {formatDate(a.expiresAt)}
        </p>
      )}
      {a.status === 'EXPIRED' && <p className="mt-1 text-xs text-muted-foreground">The link expired {formatDate(a.expiresAt)} without a signature.</p>}
      {a.failedAttempts > 0 && a.status !== 'LOCKED' && !a.signed && (
        <p className="mt-1 text-xs text-warning-soft-foreground">
          {a.failedAttempts} attempt{a.failedAttempts === 1 ? '' : 's'} with card digits that don’t match the card that paid.
        </p>
      )}
      {a.status === 'LOCKED' && (
        <Callout tone="danger" icon={ShieldAlert} className="mt-2">
          Locked after {a.failedAttempts} tries with card digits that don’t match the card that paid. Someone other than the cardholder may have the link. Talk to the cardholder before asking again.
        </Callout>
      )}
      {a.status === 'CANCELLED' && <p className="mt-1 text-xs text-muted-foreground">Cancelled {a.cancelledAt ? timeAgo(a.cancelledAt) : ''}. That link no longer works.</p>}

      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onRenew(false)}>
            <Link2 aria-hidden /> New link
          </Button>
          {a.cardholderEmail && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onRenew(true)}>
              <Mail aria-hidden /> Email a new link
            </Button>
          )}
          {a.status === 'PENDING' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              Cancel request
            </Button>
          )}
        </div>
      )}

      {a.signed && <SignedDetails a={a} onViewId={onViewId} />}

      {a.status === 'SIGNED' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onReview('verify')}>
            <CheckCircle2 aria-hidden /> Verify
          </Button>
          <Button variant="outline" size="sm" onClick={() => onReview('reject')}>
            Reject…
          </Button>
        </div>
      )}
      {a.review && (
        <p className={cn('mt-3 text-xs', a.review.decision === 'VERIFIED' ? 'text-success-soft-foreground' : 'text-destructive')}>
          {a.review.decision === 'VERIFIED' ? 'Verified' : 'Rejected'} by {a.review.by ?? 'staff'} · {formatDateTime(a.review.at)}
          {a.review.note ? `: ${a.review.note}` : ''}
        </p>
      )}
    </div>
  );
}

/**
 * Someone else pays: the cardholder's signed authorization with photo ID. Staff
 * send the form (email, a link to text, a QR code or this device), see how the
 * details matched the card, look at the ID and verify it.
 */
export function CardAuthorizationPanel({ booking: b }: { booking: BookingSummary }) {
  const { mutate } = useSWRConfig();
  const key = `/api/admin/bookings/${b.id}/card-authorizations`;
  const { data, error } = useSWR<Overview>(key, fetcher);
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [link, setLink] = React.useState<IssuedLink | null>(null);
  const [review, setReview] = React.useState<{ a: Authorization; mode: 'verify' | 'reject' } | null>(null);
  const [viewing, setViewing] = React.useState<Authorization | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    await Promise.all([mutate(key), mutate(`/api/admin/bookings/${b.id}/checklist`), mutate(`/api/admin/bookings/${b.id}`)]);
  }, [mutate, key, b.id]);

  async function act(a: Authorization, body: Record<string, unknown>) {
    setBusyId(a.id);
    try {
      const r = await api<IssuedLink | { authorization: Authorization }>(`/api/admin/card-authorizations/${a.id}`, { method: 'POST', json: body });
      if ('url' in r) setLink(r);
      else toast.success('Request cancelled');
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const closed = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
  const [latest, ...earlier] = data?.authorizations ?? [];
  const active = latest && (latest.status === 'PENDING' || latest.status === 'SIGNED');
  const payerDiffers = b.riskFlags.includes('CARDHOLDER_DIFFERS');

  if (error) return null;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <FileSignature className="size-4 text-muted-foreground" aria-hidden /> Cardholder authorization
        </h2>
      </div>
      {!data ? (
        <Skeleton className="mt-3 h-16 rounded-xl" />
      ) : (
        <>
          {!latest && (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                Someone else paying, online or at the desk? Get their signed authorization with photo ID before you hand over the key, even if they can’t be here.
              </p>
              {payerDiffers && (
                <Callout tone="warning" className="mt-3">
                  The card that paid is in another name. A signed authorization from the cardholder protects you if they dispute the charge.
                </Callout>
              )}
            </>
          )}
          {latest && (
            <div className="mt-3 rounded-xl border p-3">
              <AuthorizationItem
                a={latest}
                busy={busyId === latest.id}
                onRenew={(sendEmail) => void act(latest, { action: 'renew', sendEmail })}
                onCancel={() => void act(latest, { action: 'cancel' })}
                onReview={(mode) => setReview({ a: latest, mode })}
                onViewId={() => setViewing(latest)}
              />
            </div>
          )}
          {earlier.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">Earlier requests ({earlier.length})</summary>
              <ul className="mt-2 space-y-2">
                {earlier.map((a) => (
                  <li key={a.id} className="rounded-xl border p-3">
                    <AuthorizationItem
                      a={a}
                      busy={busyId === a.id}
                      onRenew={(sendEmail) => void act(a, { action: 'renew', sendEmail })}
                      onCancel={() => void act(a, { action: 'cancel' })}
                      onReview={(mode) => setReview({ a, mode })}
                      onViewId={() => setViewing(a)}
                    />
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!closed && !active && (
            <Button variant={latest ? 'ghost' : 'outline'} size="sm" className="mt-3" onClick={() => setRequestOpen(true)}>
              <Send aria-hidden /> {latest ? 'Ask for a new authorization…' : 'Ask the cardholder to sign…'}
            </Button>
          )}
          <RequestDialog
            booking={b}
            overview={data}
            open={requestOpen}
            onOpenChange={setRequestOpen}
            onIssued={(l) => {
              setRequestOpen(false);
              setLink(l);
              void refresh();
            }}
          />
        </>
      )}
      <LinkDialog link={link} onOpenChange={(o) => !o && setLink(null)} />
      <ReviewDialog authorization={review?.a ?? null} mode={review?.mode ?? null} onOpenChange={(o) => !o && setReview(null)} onDone={refresh} />
      <IdPhotoDialog authorization={viewing} onOpenChange={(o) => !o && setViewing(null)} />
    </Card>
  );
}
