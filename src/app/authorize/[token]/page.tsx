'use client';

import * as React from 'react';
import useSWR from 'swr';
import { useParams } from 'next/navigation';
import { Camera, CheckCircle2, IdCard, Lock, Mail, PenLine, Phone, RotateCcw, TriangleAlert } from 'lucide-react';
import {
  CARD_BRANDS,
  COUNTRY_CODES,
  ID_TYPES,
  ID_TYPE_LABEL,
  cardBrandLabel,
  countryName,
  joinNames,
  typedSignatureMatches,
  type CardAuthDisplayStatus,
  type IdType,
} from '@/lib/card-authorization';
import { ApiError, api, fetcher } from '@/lib/fetcher';
import { fmtDay, formatPhone, telHref } from '@/lib/format';
import { money } from '@/lib/status';
import { shrinkImage } from '@/lib/shrink-image';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, inputBase } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { useFieldControl } from '@/components/ui/field-context';
import { brandScope } from '@/components/guest/brand';
import { SignaturePad } from '@/components/payments/SignaturePad';

interface AuthorizationForm {
  status: CardAuthDisplayStatus;
  hotel: { name: string; primaryColor: string | null; phone: string | null; email: string | null };
  signedAt: string | null;
  form: {
    cardholderName: string;
    guestNames: string[];
    bookingCode: string;
    checkIn: string;
    checkOut: string;
    amount: number;
    currency: string;
    coversIncidentals: boolean;
    incidentalsLimit: number | null;
    paidCard: { brand: string | null } | null;
    attemptsLeft: number;
    idPhotoRequired: boolean;
    text: string;
    textVersion: string;
    textHash: string;
    expiresAt: string;
  } | null;
}

interface Values {
  name: string;
  email: string;
  phone: string;
  line1: string;
  city: string;
  postalCode: string;
  country: string;
  cardBrand: string;
  last4: string;
  idType: IdType | '';
  idCountry: string;
  idLast4: string;
  photo: string | null;
  sigMethod: 'DRAWN' | 'TYPED';
  sigImage: string | null;
  sigText: string;
  consent: boolean;
}

type Errors = Partial<Record<keyof Values, string>>;

const CLOSED: Record<Exclude<CardAuthDisplayStatus, 'PENDING'>, { title: string; body: string; done?: boolean }> = {
  SIGNED: { title: 'Already signed', body: 'This authorization has been signed. Thank you — there’s nothing more to do.', done: true },
  VERIFIED: { title: 'Already signed', body: 'This authorization has been signed and checked by the hotel. Thank you.', done: true },
  REJECTED: { title: 'Reviewed by the hotel', body: 'The hotel reviewed this authorization. If they asked you to sign again, they’ll send you a new link.' },
  CANCELLED: { title: 'This link was replaced', body: 'The hotel cancelled this request or sent a newer link. Use the most recent one, or ask them for a new link.' },
  LOCKED: { title: 'This link is locked', body: 'The card digits didn’t match the card that paid too many times. Please contact the hotel.' },
  EXPIRED: { title: 'This link has expired', body: 'Ask the hotel to send you a new link.' },
};

const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));

function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const a11y = useFieldControl(props);
  return (
    <select className={cn(inputBase, 'h-11 py-2 pr-8', className)} {...props} {...a11y}>
      {children}
    </select>
  );
}

function CountrySelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <NativeSelect {...props}>
      <option value="">Choose a country</option>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function Section({ step, title, description, children }: { step: number; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  const id = `section-${step}`;
  return (
    <Card className="p-5 sm:p-6" aria-labelledby={id} role="group">
      <h2 id={id} className="flex items-center gap-3 text-base font-semibold tracking-tight">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-soft-foreground" aria-hidden>
          {step}
        </span>
        {title}
      </h2>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </Card>
  );
}

/** The visitor's country from their browser language ("en-GB" → "GB"), for the country pickers. */
function browserCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && COUNTRY_CODES.includes(region) ? region : '';
  } catch {
    return '';
  }
}

function validate(v: Values, f: NonNullable<AuthorizationForm['form']>): Errors {
  const e: Errors = {};
  if (v.name.trim().length < 2) e.name = 'Enter your full name.';
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = 'Enter an email address for your copy.';
  if (!v.line1.trim()) e.line1 = 'Enter the street address.';
  if (!v.city.trim()) e.city = 'Enter the city.';
  if (!v.postalCode.trim()) e.postalCode = 'Enter the postal code.';
  if (!v.country) e.country = 'Choose the country.';
  if (!f.paidCard && !v.cardBrand) e.cardBrand = 'Choose the type of card.';
  if (!/^\d{4}$/.test(v.last4)) e.last4 = 'Enter the last four digits.';
  if (!v.idType) e.idType = 'Choose the type of ID.';
  if (!v.idCountry) e.idCountry = 'Choose the country that issued it.';
  if (!/^[A-Za-z0-9]{4}$/.test(v.idLast4.trim())) e.idLast4 = 'Enter the last four letters or digits of the ID number.';
  if (f.idPhotoRequired && !v.photo) e.photo = 'Add a photo of your ID.';
  if (v.sigMethod === 'DRAWN' && !v.sigImage) e.sigImage = 'Sign in the box, or switch to typing your name.';
  if (v.sigMethod === 'TYPED' && !typedSignatureMatches(v.sigText, v.name)) e.sigText = v.name.trim() ? `Type your full name exactly: ${v.name.trim()}` : 'Enter your full name above first, then type it here.';
  if (!v.consent) e.consent = 'Tick the box to agree before signing.';
  return e;
}

const ORDER: (keyof Values)[] = ['name', 'email', 'line1', 'city', 'postalCode', 'country', 'cardBrand', 'last4', 'idType', 'idCountry', 'idLast4', 'photo', 'consent', 'sigImage', 'sigText'];

function SignForm({ token, data, onSigned, onClosed }: { token: string; data: AuthorizationForm; onSigned: (r: { name: string; email: string; emailed: boolean }) => void; onClosed: () => void }) {
  const f = data.form!;
  const [v, setV] = React.useState<Values>({
    name: f.cardholderName,
    email: '',
    phone: '',
    line1: '',
    city: '',
    postalCode: '',
    country: '',
    cardBrand: '',
    last4: '',
    idType: '',
    idCountry: '',
    idLast4: '',
    photo: null,
    sigMethod: 'DRAWN',
    sigImage: null,
    sigText: '',
    consent: false,
  });
  const [errors, setErrors] = React.useState<Errors>({});
  const [tried, setTried] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState('');
  const [attemptsLeft, setAttemptsLeft] = React.useState(f.attemptsLeft);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const c = browserCountry();
    if (c) setV((x) => ({ ...x, country: x.country || c, idCountry: x.idCountry || c }));
  }, []);

  const set = <K extends keyof Values>(k: K, value: Values[K]) => {
    setV((x) => {
      const next = { ...x, [k]: value };
      if (tried) setErrors(validate(next, f));
      return next;
    });
  };

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      set('photo', await shrinkImage(file));
    } catch (e) {
      setErrors((x) => ({ ...x, photo: (e as Error).message }));
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setServerError('');
    const found = validate(v, f);
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) {
      document.getElementById(`f-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ emailed: boolean }>(`/api/card-authorizations/${encodeURIComponent(token)}`, {
        method: 'POST',
        json: {
          textHash: f.textHash,
          name: v.name.trim(),
          email: v.email.trim(),
          phone: v.phone.trim() || null,
          billing: { line1: v.line1.trim(), city: v.city.trim(), postalCode: v.postalCode.trim(), country: v.country },
          card: { brand: f.paidCard ? null : v.cardBrand || null, last4: v.last4 },
          id: { type: v.idType, country: v.idCountry, last4: v.idLast4.trim(), photo: f.idPhotoRequired ? v.photo : null },
          signature: v.sigMethod === 'DRAWN' ? { method: 'DRAWN', image: v.sigImage } : { method: 'TYPED', text: v.sigText.trim() },
          consent: true,
        },
      });
      onSigned({ name: v.name.trim(), email: v.email.trim(), emailed: r.emailed });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 410) return onClosed();
      const left = (apiErr.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
      if (typeof left === 'number') {
        setAttemptsLeft(left);
        setErrors((x) => ({ ...x, last4: apiErr.message }));
        document.getElementById('f-last4')?.focus();
      } else {
        setServerError(apiErr.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof Values) => (tried ? errors[k] : undefined);
  const brand = f.paidCard ? cardBrandLabel(f.paidCard.brand) : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Card className="p-5 sm:p-6">
        <p className="text-sm text-muted-foreground">{data.hotel.name} asks you to authorize payment for:</p>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{f.guestNames.length > 1 ? 'Guests' : 'Guest'}</dt>
            <dd className="font-medium">{joinNames(f.guestNames)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Stay</dt>
            <dd className="font-medium">
              {fmtDay(f.checkIn, 'weekday')} – {fmtDay(f.checkOut, 'weekday')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reservation</dt>
            <dd className="font-mono font-medium tracking-wider">{f.bookingCode}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Room and taxes</dt>
            <dd className="font-medium tabular">{money(f.amount, { currency: f.currency })}</dd>
          </div>
          {f.coversIncidentals && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Also covers</dt>
              <dd className="font-medium">Incidental charges during the stay{f.incidentalsLimit != null ? `, up to ${money(f.incidentalsLimit, { currency: f.currency })}` : ''}</dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Card</dt>
            <dd className="font-medium">{brand ? `The ${brand} card that already paid online` : 'The card you’ll pay with'}</dd>
          </div>
        </dl>
      </Card>

      <Section step={1} title="You and your card" description="Your name as it appears on the card and on your ID.">
        <Field label="Full name" htmlFor="f-name" required error={err('name')}>
          <Input id="f-name" autoComplete="name" value={v.name} maxLength={120} onChange={(e) => set('name', e.target.value)} className="h-11" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="f-email" required error={err('email')} hint="We’ll send you a copy of what you sign.">
            <Input id="f-email" type="email" autoComplete="email" inputMode="email" value={v.email} maxLength={200} onChange={(e) => set('email', e.target.value)} className="h-11" />
          </Field>
          <Field label="Phone" htmlFor="f-phone" optional>
            <Input id="f-phone" type="tel" autoComplete="tel" value={v.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} className="h-11" />
          </Field>
        </div>
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium">Billing address of the card</legend>
          <Field label="Street address" htmlFor="f-line1" required error={err('line1')}>
            <Input id="f-line1" autoComplete="billing address-line1" value={v.line1} maxLength={200} onChange={(e) => set('line1', e.target.value)} className="h-11" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field label="City" htmlFor="f-city" required error={err('city')}>
              <Input id="f-city" autoComplete="billing address-level2" value={v.city} maxLength={100} onChange={(e) => set('city', e.target.value)} className="h-11" />
            </Field>
            <Field label="Postal code" htmlFor="f-postalCode" required error={err('postalCode')}>
              <Input id="f-postalCode" autoComplete="billing postal-code" value={v.postalCode} maxLength={20} onChange={(e) => set('postalCode', e.target.value)} className="h-11" />
            </Field>
          </div>
          <Field label="Country" htmlFor="f-country" required error={err('country')}>
            <CountrySelect id="f-country" autoComplete="billing country" value={v.country} onChange={(e) => set('country', e.target.value)} />
          </Field>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {!f.paidCard && (
            <Field label="Type of card" htmlFor="f-cardBrand" required error={err('cardBrand')}>
              <NativeSelect id="f-cardBrand" value={v.cardBrand} onChange={(e) => set('cardBrand', e.target.value)}>
                <option value="">Choose</option>
                {CARD_BRANDS.map((b) => (
                  <option key={b} value={b}>
                    {cardBrandLabel(b)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field
            label="Last four digits of the card"
            htmlFor="f-last4"
            required
            error={err('last4')}
            hint={brand ? `Of the ${brand} card that paid. ${attemptsLeft < 5 ? `${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.` : ''}` : 'Only the last four: never enter the whole number.'}
          >
            <Input
              id="f-last4"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4}"
              maxLength={4}
              placeholder="1234"
              value={v.last4}
              onChange={(e) => set('last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="h-11 w-32 font-mono tracking-[0.3em]"
            />
          </Field>
        </div>
      </Section>

      <Section step={2} title="Your photo ID" description="A government photo ID in the same name as the card. The hotel checks it matches you.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type of ID" htmlFor="f-idType" required error={err('idType')}>
            <NativeSelect id="f-idType" value={v.idType} onChange={(e) => set('idType', e.target.value as IdType | '')}>
              <option value="">Choose</option>
              {ID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ID_TYPE_LABEL[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Issued in" htmlFor="f-idCountry" required error={err('idCountry')}>
            <CountrySelect id="f-idCountry" value={v.idCountry} onChange={(e) => set('idCountry', e.target.value)} />
          </Field>
        </div>
        <Field label="Last four characters of the ID number" htmlFor="f-idLast4" required error={err('idLast4')} hint="Not the whole number.">
          <Input
            id="f-idLast4"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={4}
            value={v.idLast4}
            onChange={(e) => set('idLast4', e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase())}
            className="h-11 w-32 font-mono tracking-[0.3em]"
          />
        </Field>
        {f.idPhotoRequired && (
          <Field label="Photo of the ID" htmlFor="f-photo" required error={err('photo') ?? (errors.photo && !tried ? errors.photo : undefined)} hint="The front, with your name and photo easy to read. Never send a photo of your card.">
            <div>
              <input
                ref={fileRef}
                id="f-photo-file"
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => void pickPhoto(e.target.files?.[0])}
              />
              {v.photo ? (
                <div className="flex flex-wrap items-end gap-3">
                  {/* A local preview of the photo the cardholder just chose (a data URL, not a remote image). */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.photo} alt="The ID photo you chose" className="max-h-48 rounded-xl border object-contain" />
                  <Button id="f-photo" type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={photoBusy}>
                    <RotateCcw aria-hidden /> Choose another
                  </Button>
                </div>
              ) : (
                <Button id="f-photo" type="button" variant="outline" className="h-11" onClick={() => fileRef.current?.click()} loading={photoBusy} loadingText="Preparing the photo…">
                  <Camera aria-hidden /> Take or choose a photo
                </Button>
              )}
            </div>
          </Field>
        )}
      </Section>

      <Section step={3} title="Read and sign">
        <div className="max-h-72 overflow-y-auto rounded-xl border bg-surface-sunken/60 p-4 text-sm leading-relaxed" tabIndex={0} aria-label="Authorization wording">
          {f.text}
        </div>
        <label htmlFor="f-consent" className="flex min-h-10 cursor-pointer items-start gap-3 text-sm">
          <input
            id="f-consent"
            type="checkbox"
            checked={v.consent}
            onChange={(e) => set('consent', e.target.checked)}
            aria-invalid={err('consent') ? true : undefined}
            aria-describedby={err('consent') ? 'f-consent-error' : undefined}
            className="mt-0.5 size-5 shrink-0 accent-[hsl(var(--brand))]"
          />
          <span>I’ve read this authorization and agree to it, and I agree to sign electronically.</span>
        </label>
        {err('consent') && (
          <p id="f-consent-error" role="alert" className="-mt-2 text-xs font-medium text-destructive">
            {err('consent')}
          </p>
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium" id="sig-label">
              Your signature
            </p>
            <SegmentedControl
              layoutId="sig-method"
              aria-label="How to sign"
              size="sm"
              value={v.sigMethod}
              onChange={(m) => set('sigMethod', m)}
              options={[
                { value: 'DRAWN', label: 'Draw', icon: <PenLine className="size-3.5" aria-hidden /> },
                { value: 'TYPED', label: 'Type' },
              ]}
            />
          </div>
          {v.sigMethod === 'DRAWN' ? (
            <div id="f-sigImage" tabIndex={-1} className="focus:outline-none">
              <SignaturePad label="Your signature" onChange={(png) => set('sigImage', png)} />
              {err('sigImage') && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {err('sigImage')}
                </p>
              )}
            </div>
          ) : (
            <Field label="Type your full name to sign" htmlFor="f-sigText" error={err('sigText')}>
              <Input id="f-sigText" autoComplete="off" value={v.sigText} maxLength={120} onChange={(e) => set('sigText', e.target.value)} className="h-11" />
            </Field>
          )}
          {v.sigMethod === 'TYPED' && v.sigText.trim() && (
            <p className="rounded-xl border bg-white px-4 py-3 text-2xl text-slate-900" style={{ fontFamily: '"Brush Script MT", "Segoe Script", "Apple Chancery", cursive' }} aria-hidden>
              {v.sigText}
            </p>
          )}
        </div>
      </Section>

      {serverError && (
        <Callout tone="danger" role="alert">
          {serverError}
        </Callout>
      )}
      {tried && Object.keys(errors).length > 0 && (
        <p role="status" className="text-sm text-destructive">
          A few things still need attention above.
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0" aria-hidden /> Sent securely to {data.hotel.name}. Link valid until {new Date(f.expiresAt).toLocaleDateString([], { dateStyle: 'medium' })}.
        </p>
        <Button type="submit" variant="brand" size="lg" loading={busy} loadingText="Signing…" className="w-full sm:w-auto">
          Sign and send
        </Button>
      </div>
    </form>
  );
}

function HotelContact({ hotel }: { hotel: AuthorizationForm['hotel'] }) {
  if (!hotel.phone && !hotel.email) return null;
  return (
    <ul className="mt-4 space-y-1 text-sm">
      {hotel.phone && (
        <li>
          <a href={telHref(hotel.phone)} className="inline-flex min-h-10 items-center gap-2 font-medium text-brand underline-offset-4 hover:underline">
            <Phone className="size-4" aria-hidden /> {formatPhone(hotel.phone)}
          </a>
        </li>
      )}
      {hotel.email && (
        <li>
          <a href={`mailto:${hotel.email}`} className="inline-flex min-h-10 items-center gap-2 font-medium text-brand underline-offset-4 hover:underline">
            <Mail className="size-4" aria-hidden /> {hotel.email}
          </a>
        </li>
      )}
    </ul>
  );
}

export default function AuthorizePage() {
  const { token } = useParams<{ token: string }>();
  const { data, error, isLoading, mutate } = useSWR<AuthorizationForm>(token ? `/api/card-authorizations/${encodeURIComponent(token)}` : null, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
  const [signed, setSigned] = React.useState<{ name: string; email: string; emailed: boolean } | null>(null);
  const scope = brandScope(data?.hotel.primaryColor);
  const notFound = (error as ApiError | undefined)?.status === 404;

  React.useEffect(() => {
    if (signed) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [signed]);

  return (
    <div style={scope.style} className={cn('min-h-dvh bg-background', scope.className)}>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold tracking-tight">{data?.hotel.name ?? (isLoading ? ' ' : 'Card authorization')}</p>
            <p className="text-xs text-muted-foreground">Card authorization</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-soft-foreground">
            <Lock className="size-3.5" aria-hidden /> Secure form
          </span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        {isLoading ? (
          <div className="space-y-5" aria-busy>
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-80 rounded-2xl" />
            <span className="sr-only" role="status">
              Loading the form…
            </span>
          </div>
        ) : error || !data ? (
          <Card className="p-6 sm:p-8">
            <TriangleAlert className="size-8 text-warning" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold tracking-tight">{notFound ? 'This link isn’t valid' : 'We couldn’t load the form'}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {notFound ? 'Check you opened the whole link from the message the hotel sent. If it was replaced by a newer one, use that instead.' : (error as Error | undefined)?.message || 'Try again in a moment.'}
            </p>
            {!notFound && (
              <Button variant="outline" className="mt-5" onClick={() => void mutate()}>
                Try again
              </Button>
            )}
          </Card>
        ) : signed ? (
          <Card className="p-6 text-center sm:p-10">
            <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight" role="status">
              Thank you, {signed.name.split(' ')[0]}
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {data.hotel.name} has your signed authorization{signed.emailed ? `, and we emailed a copy to ${signed.email}` : ''}. You can close this page.
            </p>
          </Card>
        ) : data.status !== 'PENDING' || !data.form ? (
          <Card className="p-6 sm:p-8">
            {CLOSED[data.status as Exclude<CardAuthDisplayStatus, 'PENDING'>]?.done ? <CheckCircle2 className="size-8 text-success" aria-hidden /> : <IdCard className="size-8 text-muted-foreground" aria-hidden />}
            <h1 className="mt-4 text-xl font-semibold tracking-tight">{CLOSED[data.status as Exclude<CardAuthDisplayStatus, 'PENDING'>]?.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{CLOSED[data.status as Exclude<CardAuthDisplayStatus, 'PENDING'>]?.body}</p>
            <HotelContact hotel={data.hotel} />
          </Card>
        ) : (
          <>
            <h1 className="font-display text-2xl font-medium tracking-tight sm:text-3xl">Authorize your card for this stay</h1>
            <p className="mb-6 mt-2 text-sm text-muted-foreground">
              Someone is staying on a reservation paid with your card. This form confirms you agree, so the hotel can welcome them without you there. It takes about two minutes.
            </p>
            <SignForm token={token} data={data} onSigned={setSigned} onClosed={() => void mutate()} />
          </>
        )}
      </main>

      <footer className="mx-auto max-w-2xl px-4 pb-10 text-xs text-muted-foreground sm:px-6">
        Sent by {PRODUCT_NAME} for {data?.hotel.name ?? 'the hotel'}. Card numbers are never collected here.{' '}
        <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy
        </a>
      </footer>
    </div>
  );
}
