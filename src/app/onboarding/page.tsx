'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  Cloud,
  Eye,
  EyeOff,
  Hotel,
  Laptop,
  Phone,
  Plus,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/fetcher';
import { HALF_HOURS, formatClock } from '@/lib/format';
import { toE164 } from '@/lib/phone';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME, isDemoEmail } from '@/config/product';
import { Logo } from '@/components/brand/Logo';
import { Button, IconButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BRAND_SWATCHES, PROPERTY_TYPES } from '@/components/setup/PropertyFields';

type Path = 'FULL' | 'BRIDGE' | 'VOICE';
interface RoomDraft {
  name: string;
  capacity: string;
  basePrice: string;
  totalRooms: string;
}
/** Field-level problems, keyed by field (room rows use `room-<i>-<field>`). */
type Errors = Record<string, string>;

const PATHS: { id: Path; icon: LucideIcon; title: string; text: string; badge: string }[] = [
  { id: 'FULL', icon: Hotel, title: `Run on ${PRODUCT_NAME}`, text: 'Booking site, front desk, housekeeping, rates, the agent and voice — all in one place.', badge: 'Most complete' },
  { id: 'BRIDGE', icon: ServerCog, title: 'Keep your PMS', text: 'The agent and voice work your current reservation system for you. Move over any time.', badge: 'No migration' },
  { id: 'VOICE', icon: AudioLines, title: 'Just voice', text: 'A voice front desk that answers calls with your real rooms and prices.', badge: 'Fastest' },
];
const SYSTEMS = ['Cloudbeds', 'Mews', 'Oracle OPERA Cloud', 'Little Hotelier', 'RoomRaccoon', 'eZee Absolute', 'innRoad', 'WebRezPro', 'SkyTouch', 'Hotelogix', 'Other'];
const SWATCH_NAMES: Record<string, string> = {
  '#0E7490': 'Lagoon',
  '#1D4ED8': 'Royal blue',
  '#7C3AED': 'Violet',
  '#BE185D': 'Raspberry',
  '#B45309': 'Amber',
  '#15803D': 'Forest',
  '#0F172A': 'Midnight',
  '#9F1239': 'Claret',
};
const EMPTY_ROOM: RoomDraft = { name: '', capacity: '2', basePrice: '', totalRooms: '' };
/** Where each field lives, so the first problem can take focus. */
const FIELD_IDS: Record<string, string> = {
  firstName: 'o-first',
  lastName: 'o-last',
  email: 'o-email',
  password: 'o-pass',
  name: 'o-name',
  address: 'o-addr',
  city: 'o-city',
  state: 'o-state',
  zipCode: 'o-zip',
  phone: 'o-phone',
  system: 'o-sys-0',
  other: 'o-other',
  loginUrl: 'o-url',
  greeting: 'o-greet',
  checkInTime: 'o-cin',
  checkOutTime: 'o-cout',
  cancellationPolicy: 'o-cancel',
  transferNumber: 'o-transfer',
};
const fieldId = (key: string) => {
  const room = /^room-(\d+)-(\w+)$/.exec(key);
  if (room) return `rt-${room[2][0]}-${room[1]}`; // name → rt-n-0, basePrice → rt-b-0 …
  return FIELD_IDS[key] ?? key;
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Plain wording for the few limits only the server checks. */
const SERVER_MESSAGES: Record<string, string> = {
  firstName: 'Use up to 60 characters.',
  lastName: 'Use up to 60 characters.',
  email: 'Enter an email address, like name@yourhotel.com.',
  password: 'Use 8 to 200 characters.',
  name: 'Use 2 to 120 characters.',
  loginUrl: 'Use the full address, starting with https://',
  greeting: 'Use up to 300 characters.',
  cancellationPolicy: 'Use up to 500 characters.',
  transferNumber: 'Use the international format, like +1 831 555 0100.',
  'room:name': 'Use 2 to 80 characters.',
  'room:capacity': 'From 1 to 20.',
  'room:basePrice': `Use a price up to ${usd.format(100000)}.`,
  'room:totalRooms': 'A whole number up to 2,000.',
};
const PROPERTY_FIELDS = new Set(['name', 'address', 'city', 'state', 'zipCode', 'phone']);

/**
 * Maps a 400 from /api/onboarding to the step and field it belongs to, so
 * the person lands on the problem instead of reading a technical message.
 * `sentRooms[i]` is the form row of the i-th room type that was sent.
 */
function serverProblem(e: ApiError, path: Path, sentRooms: number[], hasLoginUrl: boolean): { step: number; key: string; message: string } | null {
  if (e.status !== 400) return null;
  // The only other 400 is the cloud browser refusing a private sign-in address; its message is already plain.
  if (e.code !== 'VALIDATION') return path === 'BRIDGE' && hasLoginUrl ? { step: 3, key: 'loginUrl', message: e.message } : null;
  const issue = (e.details as { issues?: { path?: (string | number)[] }[] } | undefined)?.issues?.[0];
  const [scope, a, b] = issue?.path ?? [];
  let found: { step: number; key: string; kind: string } | null = null;
  if (scope === 'account' && typeof a === 'string' && a in SERVER_MESSAGES) found = { step: 1, key: a, kind: a };
  else if (scope === 'property' && typeof a === 'string' && PROPERTY_FIELDS.has(a)) found = { step: 2, key: a, kind: a };
  else if (scope === 'roomTypes' && typeof a === 'number' && typeof b === 'string' && sentRooms[a] !== undefined) found = { step: 3, key: `room-${sentRooms[a]}-${b}`, kind: `room:${b}` };
  else if (scope === 'bridge' && path === 'BRIDGE') found = a === 'loginUrl' ? { step: 3, key: 'loginUrl', kind: 'loginUrl' } : { step: 3, key: 'system', kind: 'system' };
  else if (scope === 'voice' && path === 'VOICE' && typeof a === 'string' && a in FIELD_IDS) found = { step: 3, key: a, kind: a };
  if (!found) return null;
  return { step: found.step, key: found.key, message: SERVER_MESSAGES[found.kind] ?? 'Check this entry and try again.' };
}

const formatPrice = (v: string) => (v !== '' && Number.isFinite(Number(v)) ? usd.format(Number(v)) : '—');
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
/** A selectable card wrapping a visually hidden native radio. */
const choiceCard = (selected: boolean) =>
  cn(
    'relative flex cursor-pointer rounded-2xl border bg-card text-left transition-[border-color,background-color,box-shadow] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
    selected ? 'border-primary bg-primary-soft/60 shadow-xs ring-1 ring-primary' : 'hover:border-border-strong/60 hover:bg-accent/60'
  );

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors', selected ? 'border-primary bg-primary' : 'border-input bg-surface')}
    >
      {selected && <span className="h-2 w-2 rounded-full bg-primary-foreground" />}
    </span>
  );
}

function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const pct = ((current + 1) / steps.length) * 100;
  return (
    <nav aria-label="Sign-up progress">
      {/* Phones: "Step 2 of 4 · Account" and a bar. */}
      <div className="sm:hidden">
        <p className="text-sm text-muted-foreground">
          Step {current + 1} of {steps.length} · <span className="font-medium text-foreground">{steps[current]}</span>
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li key={s} className="flex items-center gap-2" aria-current={now ? 'step' : undefined}>
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  done && 'bg-primary text-primary-foreground',
                  now && 'bg-primary text-primary-foreground ring-4 ring-primary/15',
                  !done && !now && 'border border-input bg-surface text-muted-foreground'
                )}
                aria-hidden
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn('whitespace-nowrap text-sm', now ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                <span className="sr-only">Step {i + 1}: </span>
                {s}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              {i < steps.length - 1 && <span aria-hidden className={cn('mx-1 h-px w-6 lg:w-8', done ? 'bg-primary' : 'bg-border')} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepIntro({ headingRef, title, children }: { headingRef: React.Ref<HTMLHeadingElement>; title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h1 id="onb-title" ref={headingRef} tabIndex={-1} className="text-balance font-display text-3xl leading-tight tracking-tight outline-none sm:text-4xl">
        {title}
      </h1>
      {children && <p className="mt-2 text-pretty text-muted-foreground">{children}</p>}
    </div>
  );
}

function Preview({ path, name, tagline, color, rooms, greeting, system, mode }: { path: Path; name: string; tagline: string; color: string; rooms: RoomDraft[]; greeting: string; system: string; mode: string }) {
  const hotel = name || 'Your hotel';
  if (path === 'VOICE') {
    return (
      <div className="flex flex-col items-center text-center">
        <span className="relative flex h-28 w-28 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-agent/25 [animation-duration:2.4s] motion-reduce:animate-none" />
          <span className="absolute inset-2 animate-aurora rounded-full bg-aurora shadow-glow motion-reduce:animate-none" />
          <AudioLines className="relative h-10 w-10 text-agent-gradient-foreground" />
        </span>
        <p className="mt-8 text-sm text-inverse-foreground/70">Callers hear</p>
        <p className="mt-2 max-w-sm text-balance font-display text-2xl leading-snug">“{greeting || `Thanks for calling ${hotel} — how can I help?`}”</p>
        <p className="mt-6 max-w-xs text-sm leading-relaxed text-inverse-foreground/75">Then it quotes your prices, takes booking requests and messages, and emails each one to you to confirm.</p>
        <p className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-inverse-foreground/15 bg-inverse-foreground/10 px-3 py-1 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5" /> Answers 24/7 · says it’s a virtual assistant
        </p>
      </div>
    );
  }
  if (path === 'BRIDGE') {
    return (
      <div className="w-full max-w-sm">
        <p className="text-sm text-inverse-foreground/70">How it works</p>
        <ol className="mt-4 space-y-3">
          {[
            { icon: Sparkles, t: 'You ask', d: '“Check in the Smiths in 204”' },
            { icon: ShieldCheck, t: 'You confirm', d: 'Every change waits for your yes' },
            { icon: mode === 'CLOUD' ? Cloud : Laptop, t: `${PRODUCT_NAME} works ${system || 'your PMS'}`, d: mode === 'CLOUD' ? 'In a secure cloud browser' : 'From your front-desk computer' },
          ].map((s, i) => (
            <motion.li
              key={s.t}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.12 }}
              className="flex items-center gap-3 rounded-2xl border border-inverse-foreground/10 bg-inverse-foreground/[0.07] p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-inverse-foreground/10">
                <s.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="font-medium">{s.t}</p>
                <p className="text-sm text-inverse-foreground/75">{s.d}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    );
  }
  const named = rooms.filter((r) => r.name.trim());
  const shown = (named.length ? named : [{ ...EMPTY_ROOM, name: 'Ocean King', basePrice: '189' }]).slice(0, 3);
  return (
    <div className="w-full max-w-sm">
      <div className="overflow-hidden rounded-3xl bg-surface text-foreground shadow-float">
        <div className="flex h-28 items-end p-5" style={{ background: `linear-gradient(135deg, ${color}, ${color}b3)` }}>
          <span className="rounded-full bg-overlay/30 px-2.5 py-1 text-2xs font-medium uppercase tracking-wider text-inverse-foreground backdrop-blur">Book direct</span>
        </div>
        <div className="p-5">
          <p className="font-display text-2xl leading-tight">{hotel}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tagline || 'Your tagline here'}</p>
          <ul className="mt-4 space-y-2">
            {shown.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="tabular shrink-0 font-semibold">
                  {formatPrice(r.basePrice)}
                  <span className="font-normal text-muted-foreground"> / night</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg py-2.5 text-center text-sm font-medium text-inverse-foreground" style={{ backgroundColor: color }}>
            Book now
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-inverse-foreground/70">A preview of your booking site — your name, never ours.</p>
    </div>
  );
}

function RoomRows({
  rooms,
  errors,
  setRoom,
  removeRoom,
  addRoom,
  showCount = true,
}: {
  rooms: RoomDraft[];
  errors: Errors;
  setRoom: (i: number, k: keyof RoomDraft, v: string) => void;
  removeRoom: (i: number) => void;
  addRoom: () => void;
  /** How many rooms of each type: only hotels whose bookings live in HotelOne need it. */
  showCount?: boolean;
}) {
  return (
    <div className="space-y-3">
      <ul className="space-y-3 sm:space-y-2">
        {rooms.map((r, i) => {
          const labelClass = i > 0 ? 'sm:sr-only' : undefined;
          const label = r.name.trim() || `room type ${i + 1}`;
          return (
            <li
              key={i}
              className={cn(
                'relative grid items-start gap-3 rounded-xl border bg-card p-3 sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0',
                showCount ? 'grid-cols-3 sm:grid-cols-[minmax(0,1fr)_76px_116px_80px_40px]' : 'grid-cols-2 sm:grid-cols-[minmax(0,1fr)_76px_116px_40px]'
              )}
            >
              <Field label="Room type" htmlFor={`rt-n-${i}`} labelClassName={labelClass} error={errors[`room-${i}-name`]} className={cn('pr-12 sm:col-span-1 sm:pr-0', showCount ? 'col-span-3' : 'col-span-2')}>
                <Input id={`rt-n-${i}`} value={r.name} onChange={(e) => setRoom(i, 'name', e.target.value)} placeholder="Ocean King" maxLength={80} />
              </Field>
              <Field label="Sleeps" htmlFor={`rt-c-${i}`} labelClassName={labelClass} error={errors[`room-${i}-capacity`]}>
                <Input id={`rt-c-${i}`} type="number" inputMode="numeric" min={1} max={20} value={r.capacity} onChange={(e) => setRoom(i, 'capacity', e.target.value)} />
              </Field>
              <Field label="Price / night" htmlFor={`rt-b-${i}`} labelClassName={labelClass} error={errors[`room-${i}-basePrice`]}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
                    $
                  </span>
                  <Input id={`rt-b-${i}`} type="number" inputMode="decimal" min={0} step="any" className="pl-6" value={r.basePrice} onChange={(e) => setRoom(i, 'basePrice', e.target.value)} placeholder="189" />
                </div>
              </Field>
              {showCount && (
                <Field label="Rooms" htmlFor={`rt-t-${i}`} labelClassName={labelClass} error={errors[`room-${i}-totalRooms`]}>
                  <Input id={`rt-t-${i}`} type="number" inputMode="numeric" min={0} value={r.totalRooms} onChange={(e) => setRoom(i, 'totalRooms', e.target.value)} placeholder="10" />
                </Field>
              )}
              <div className={cn('absolute right-3 top-10 sm:static', i === 0 && 'sm:pt-7')}>
                <IconButton type="button" label={`Remove ${label}`} variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => removeRoom(i)}>
                  <Trash2 />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      {rooms.length < 8 && (
        <Button type="button" variant="outline" size="sm" onClick={addRoom}>
          <Plus /> Add another room type
        </Button>
      )}
    </div>
  );
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const initialPath = (['FULL', 'BRIDGE', 'VOICE'] as const).find((p) => p.toLowerCase() === params.get('path')?.toLowerCase());
  const [path, setPath] = React.useState<Path>(initialPath ?? 'FULL');
  const [step, setStep] = React.useState(initialPath ? 1 : 0);
  const [account, setAccount] = React.useState({ firstName: '', lastName: '', email: '', password: '' });
  const [showPassword, setShowPassword] = React.useState(false);
  const [prop, setProp] = React.useState({ name: '', type: 'Hotel', address: '', city: '', state: '', zipCode: '', phone: '', tagline: '', primaryColor: BRAND_SWATCHES[0] });
  const [rooms, setRooms] = React.useState<RoomDraft[]>([{ ...EMPTY_ROOM }]);
  const [bridge, setBridge] = React.useState({ system: '', other: '', mode: 'DESKTOP' as 'DESKTOP' | 'CLOUD', loginUrl: '' });
  const [voice, setVoice] = React.useState({ greeting: '', checkInTime: '15:00', checkOutTime: '11:00', cancellationPolicy: '', transferNumber: '' });
  const [errors, setErrors] = React.useState<Errors>({});
  const [formError, setFormError] = React.useState<{ message: string; signIn?: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Move focus to the new step's heading so screen readers announce it.
  const focusHeading = React.useRef(false);
  const headingRef = React.useCallback((el: HTMLHeadingElement | null) => {
    if (el && focusHeading.current) {
      focusHeading.current = false;
      el.focus();
    }
  }, []);

  const lastStep = path === 'FULL' ? 'Rooms & brand' : path === 'BRIDGE' ? 'Your system' : 'Voice';
  const steps = ['Your path', 'Account', 'Property', lastStep];
  const systemName = bridge.system === 'Other' ? bridge.other.trim() : bridge.system;

  const clear = (...keys: string[]) =>
    setErrors((e) => {
      if (!keys.some((k) => k in e)) return e;
      const next = { ...e };
      keys.forEach((k) => delete next[k]);
      return next;
    });

  const setAcc = (k: keyof typeof account, v: string) => {
    setAccount((a) => ({ ...a, [k]: v }));
    clear(k);
  };
  const setP = (k: keyof typeof prop, v: string) => {
    setProp((p) => ({ ...p, [k]: v }));
    clear(k);
  };
  const setB = (patch: Partial<typeof bridge>, ...keys: string[]) => {
    setBridge((b) => ({ ...b, ...patch }));
    clear(...keys);
  };
  const setV = (patch: Partial<typeof voice>, ...keys: string[]) => {
    setVoice((v) => ({ ...v, ...patch }));
    clear(...keys);
  };

  function validate(s: number): Errors {
    const e: Errors = {};
    if (s === 1) {
      if (!account.firstName.trim()) e.firstName = 'Enter your first name.';
      if (!account.lastName.trim()) e.lastName = 'Enter your last name.';
      if (!/^\S+@\S+\.\S+$/.test(account.email.trim())) e.email = 'Enter an email address, like name@yourhotel.com.';
      else if (isDemoEmail(account.email)) e.email = 'That address belongs to the public demo — use your own email.';
      if (account.password.length < 8) e.password = 'Use at least 8 characters.';
    }
    if (s === 2) {
      if (prop.name.trim().length < 2) e.name = 'Add your property’s name.';
      if (prop.address.trim().length < 3) e.address = 'Add the street address — guests use it to find you.';
      if (!prop.city.trim()) e.city = 'Add the city.';
      if (!prop.state.trim()) e.state = 'Add the state or region.';
      if (prop.zipCode.trim().length < 2) e.zipCode = 'Add the postal code.';
      if (prop.phone.trim().length < 5) e.phone = 'Add a phone number guests can call.';
    }
    if (s === 3 && path === 'BRIDGE') {
      if (!bridge.system) e.system = 'Choose the system you use today.';
      else if (bridge.system === 'Other' && bridge.other.trim().length < 2) e.other = 'Type the name of your system.';
      const url = bridge.loginUrl.trim();
      if (url && !(/^https?:\/\//i.test(url) && URL.canParse(url))) e.loginUrl = 'Paste the full sign-in address, starting with https:// (or http:// on your own network).';
      else if (url && bridge.mode === 'CLOUD' && !/^https:\/\//i.test(url)) e.loginUrl = 'The cloud browser needs an address that starts with https://';
    }
    if (s === 3 && path === 'VOICE') {
      // The voice quotes these prices, so it needs at least one.
      if (!rooms.some((r) => r.name.trim())) e['room-0-name'] = 'Add at least one room type with its price — the voice quotes it to callers.';
      const transfer = voice.transferNumber.trim();
      if (transfer && !toE164(transfer)) e.transferNumber = 'Use the international format with the country code, like +1 831 555 0100.';
      else if (transfer && toE164(transfer) === toE164(prop.phone)) e.transferNumber = 'Use a different number from your front desk line — forwarded calls would loop back to the assistant.';
    }
    // The PMS path has no room rows (the hotel's system already has its rooms), so rows typed on another path don't count.
    if (s === 3 && path !== 'BRIDGE') {
      rooms.forEach((r, i) => {
        const named = r.name.trim();
        if (!named) {
          if (r.basePrice || r.totalRooms) e[`room-${i}-name`] = 'Name this room type, or remove the row.';
          return;
        }
        if (named.length < 2) e[`room-${i}-name`] = 'Use at least 2 characters.';
        const cap = Number(r.capacity);
        if (r.capacity !== '' && !(Number.isInteger(cap) && cap >= 1 && cap <= 20)) e[`room-${i}-capacity`] = 'From 1 to 20.';
        const price = Number(r.basePrice);
        if (r.basePrice === '' || !Number.isFinite(price) || price < 0 || price > 100000) e[`room-${i}-basePrice`] = 'Add a nightly price.';
        const total = Number(r.totalRooms);
        if (r.totalRooms !== '' && !(Number.isInteger(total) && total >= 0 && total <= 2000)) e[`room-${i}-totalRooms`] = 'A whole number.';
      });
    }
    return e;
  }

  /** Validates a step; on failure shows the problems and focuses the first one. */
  function check(s: number) {
    const e = validate(s);
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      // A problem whose field isn't on screen still has to be said out loud.
      requestAnimationFrame(() => {
        const field = document.getElementById(fieldId(first));
        if (field) field.focus();
        else setFormError({ message: e[first] });
      });
      return false;
    }
    return true;
  }

  function goTo(s: number) {
    setFormError(null);
    focusHeading.current = true;
    setStep(s);
  }

  async function submit() {
    if (!check(3)) return;
    setFormError(null);
    setBusy(true);
    const sentRooms = path === 'BRIDGE' ? [] : rooms.flatMap((r, i) => (r.name.trim() ? [i] : []));
    try {
      const res = await api<{ next: string }>('/api/onboarding', {
        method: 'POST',
        json: {
          path,
          account: { ...account, email: account.email.trim() },
          property: { ...prop, tagline: prop.tagline || null },
          roomTypes: sentRooms
            .map((i) => rooms[i])
            .map((r) => ({ name: r.name.trim(), capacity: Number(r.capacity) || 2, basePrice: Number(r.basePrice), totalRooms: Number(r.totalRooms) || 0 })),
          ...(path === 'BRIDGE' ? { bridge: { system: systemName, mode: bridge.mode, loginUrl: bridge.loginUrl.trim() || null } } : {}),
          ...(path === 'VOICE'
            ? {
                voice: {
                  greeting: voice.greeting.trim() || null,
                  checkInTime: voice.checkInTime,
                  checkOutTime: voice.checkOutTime,
                  cancellationPolicy: voice.cancellationPolicy.trim() || null,
                  transferNumber: voice.transferNumber.trim() || null,
                },
              }
            : {}),
        },
      });
      const login = await signIn('credentials', { email: account.email.trim().toLowerCase(), password: account.password, redirect: false });
      router.push(login?.error ? '/login?onboarded=1' : res.next);
    } catch (e) {
      setBusy(false);
      const problem = e instanceof ApiError ? serverProblem(e, path, sentRooms, Boolean(bridge.loginUrl.trim())) : null;
      if (problem) {
        // Back to the step with the problem, with focus on the field (after the step transition).
        setFormError(null);
        setErrors({ [problem.key]: problem.message });
        setStep(problem.step);
        window.setTimeout(() => document.getElementById(fieldId(problem.key))?.focus(), problem.step === step ? 0 : 320);
        return;
      }
      const conflict = e instanceof ApiError && e.status === 409;
      const technical = e instanceof ApiError && e.code === 'VALIDATION';
      setFormError({
        message: technical ? 'Some details didn’t go through. Check your entries and try again.' : (e as Error).message || 'Something went wrong. Please try again.',
        signIn: conflict,
      });
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (step < 3) {
      if (check(step)) goTo(step + 1);
    } else {
      void submit();
    }
  }

  const setRoom = (i: number, k: keyof RoomDraft, v: string) => {
    setRooms((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    clear(`room-${i}-${k}`);
  };
  const removeRoom = (i: number) => {
    setRooms((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [{ ...EMPTY_ROOM }]));
    // Row indexes shift, so drop any room problems; they're re-checked on submit.
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('room-'))));
  };
  const addRoom = () => {
    setRooms((rs) => [...rs, { ...EMPTY_ROOM }]);
    requestAnimationFrame(() => document.getElementById(`rt-n-${rooms.length}`)?.focus());
  };

  const nextHint =
    path === 'FULL'
      ? 'Next: your dashboard, with a short checklist to go live.'
      : path === 'BRIDGE'
        ? `Next: connect ${systemName || 'your system'} — it takes about two minutes.`
        : 'Next: hear it with a test call, then connect your phone number.';

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col px-4 py-5 sm:px-10 sm:py-6">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" aria-label={`${PRODUCT_NAME} home`} className={cn('rounded-lg', focusRing)}>
            <Logo />
          </Link>
          <p className="text-sm text-muted-foreground">
            <span className="hidden sm:inline">Have an account? </span>
            <Link href="/login" className={cn('inline-flex min-h-10 items-center rounded-md font-medium text-primary underline-offset-4 hover:underline', focusRing)}>
              Sign in
            </Link>
          </p>
        </header>

        <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-8 sm:py-12">
          <Stepper steps={steps} current={step} />

          <form noValidate onSubmit={onSubmit} className="mt-8" aria-labelledby="onb-title">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
                {step === 0 && (
                  <>
                    <StepIntro headingRef={headingRef} title="How would you like to start?">
                      You can switch paths later without starting over.
                    </StepIntro>
                    <fieldset className="mt-6 space-y-3" aria-labelledby="onb-title">
                      {PATHS.map((p) => {
                        const selected = path === p.id;
                        return (
                          <label key={p.id} className={cn(choiceCard(selected), 'items-start gap-4 p-4 sm:p-5')}>
                            <input type="radio" name="path" value={p.id} checked={selected} onChange={() => setPath(p.id)} className="sr-only" />
                            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors', selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                              <p.icon className="h-5 w-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-semibold">{p.title}</span>
                                <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">{p.badge}</span>
                              </span>
                              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{p.text}</span>
                            </span>
                            <span className="mt-0.5">
                              <RadioDot selected={selected} />
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  </>
                )}

                {step === 1 && (
                  <>
                    <StepIntro headingRef={headingRef} title="Create your account">
                      You’ll be the owner. Invite your team once you’re in.
                    </StepIntro>
                    <div className="mt-6 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="First name" htmlFor="o-first" error={errors.firstName}>
                          <Input id="o-first" autoComplete="given-name" maxLength={60} value={account.firstName} onChange={(e) => setAcc('firstName', e.target.value)} />
                        </Field>
                        <Field label="Last name" htmlFor="o-last" error={errors.lastName}>
                          <Input id="o-last" autoComplete="family-name" maxLength={60} value={account.lastName} onChange={(e) => setAcc('lastName', e.target.value)} />
                        </Field>
                      </div>
                      <Field label="Work email" htmlFor="o-email" error={errors.email} hint="We’ll send booking alerts and your sign-in links here.">
                        <Input id="o-email" type="email" inputMode="email" autoComplete="email" maxLength={254} spellCheck={false} value={account.email} onChange={(e) => setAcc('email', e.target.value)} />
                      </Field>
                      <Field label="Password" htmlFor="o-pass" hint="At least 8 characters." error={errors.password}>
                        <div className="relative">
                          <Input
                            id="o-pass"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            maxLength={200}
                            className="pr-12"
                            value={account.password}
                            onChange={(e) => setAcc('password', e.target.value)}
                          />
                          <IconButton
                            type="button"
                            size="icon-sm"
                            label={showPassword ? 'Hide password' : 'Show password'}
                            aria-pressed={showPassword}
                            className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowPassword((v) => !v)}
                          >
                            {showPassword ? <EyeOff /> : <Eye />}
                          </IconButton>
                        </div>
                      </Field>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <StepIntro headingRef={headingRef} title="Tell us about your property">
                      This appears on your booking site and helps guests find you.
                    </StepIntro>
                    <div className="mt-6 space-y-4">
                      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_168px] sm:gap-3">
                        <Field label="Property name" htmlFor="o-name" error={errors.name}>
                          <Input id="o-name" autoComplete="organization" maxLength={120} value={prop.name} onChange={(e) => setP('name', e.target.value)} placeholder="The Saltwater Inn" />
                        </Field>
                        <Field label="Type" htmlFor="o-type">
                          <Select value={prop.type} onValueChange={(v) => setProp({ ...prop, type: v })}>
                            <SelectTrigger id="o-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PROPERTY_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <Field label="Street address" htmlFor="o-addr" error={errors.address}>
                        <Input id="o-addr" autoComplete="address-line1" maxLength={200} value={prop.address} onChange={(e) => setP('address', e.target.value)} />
                      </Field>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Field label="City" htmlFor="o-city" error={errors.city} className="col-span-2 sm:col-span-1">
                          <Input id="o-city" autoComplete="address-level2" maxLength={100} value={prop.city} onChange={(e) => setP('city', e.target.value)} />
                        </Field>
                        <Field label="State or region" htmlFor="o-state" error={errors.state}>
                          <Input id="o-state" autoComplete="address-level1" maxLength={100} value={prop.state} onChange={(e) => setP('state', e.target.value)} />
                        </Field>
                        <Field label="Postal code" htmlFor="o-zip" error={errors.zipCode}>
                          <Input id="o-zip" autoComplete="postal-code" maxLength={20} value={prop.zipCode} onChange={(e) => setP('zipCode', e.target.value)} />
                        </Field>
                      </div>
                      <Field label="Front desk phone" htmlFor="o-phone" error={errors.phone} hint="Guests use this to reach you.">
                        <Input id="o-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={prop.phone} onChange={(e) => setP('phone', e.target.value)} placeholder="+1 555 010 0100" />
                      </Field>
                    </div>
                  </>
                )}

                {step === 3 && path === 'BRIDGE' && (
                  <>
                    <StepIntro headingRef={headingRef} title="Which system do you use today?">
                      You’ll finish connecting it right after this — it takes about two minutes.
                    </StepIntro>
                    <fieldset className="mt-6" aria-labelledby="onb-title" aria-describedby={errors.system ? 'o-sys-error' : undefined}>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {SYSTEMS.map((s, i) => {
                          const selected = bridge.system === s;
                          return (
                            <label key={s} className={cn(choiceCard(selected), 'min-h-11 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium')}>
                              <input
                                id={`o-sys-${i}`}
                                type="radio"
                                name="system"
                                value={s}
                                checked={selected}
                                onChange={() => setB({ system: s }, 'system', 'other')}
                                className="sr-only"
                              />
                              <RadioDot selected={selected} />
                              <span className="min-w-0">{s === 'Other' ? 'Something else' : s}</span>
                            </label>
                          );
                        })}
                      </div>
                      {errors.system && (
                        <p id="o-sys-error" role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-medium leading-5 text-destructive">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errors.system}
                        </p>
                      )}
                    </fieldset>
                    {bridge.system === 'Other' && (
                      <Field label="Your system’s name" htmlFor="o-other" error={errors.other} className="mt-4">
                        <Input id="o-other" value={bridge.other} maxLength={60} onChange={(e) => setB({ other: e.target.value }, 'other')} />
                      </Field>
                    )}

                    <fieldset className="mt-6">
                      <legend className="text-sm font-medium">Where should the agent work?</legend>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            { m: 'DESKTOP', icon: Laptop, t: 'On your front-desk computer', d: 'A small app. Your logins stay at the hotel.' },
                            { m: 'CLOUD', icon: Cloud, t: `In the ${PRODUCT_NAME} cloud`, d: 'Nothing to install. Logins are stored encrypted.' },
                          ] as const
                        ).map((o) => {
                          const selected = bridge.mode === o.m;
                          return (
                            <label key={o.m} className={cn(choiceCard(selected), 'items-start gap-3 p-4')}>
                              <input type="radio" name="mode" value={o.m} checked={selected} onChange={() => setB({ mode: o.m }, 'loginUrl')} className="sr-only" />
                              <o.icon className={cn('mt-0.5 h-5 w-5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold">{o.t}</span>
                                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{o.d}</span>
                              </span>
                              <RadioDot selected={selected} />
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                    <Field
                      label="Sign-in page address"
                      optional
                      htmlFor="o-url"
                      error={errors.loginUrl}
                      hint={`The web address where you sign in to ${systemName || 'your system'}. You can add it later.`}
                      className="mt-5"
                    >
                      <Input
                        id="o-url"
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        spellCheck={false}
                        maxLength={500}
                        value={bridge.loginUrl}
                        onChange={(e) => setB({ loginUrl: e.target.value }, 'loginUrl')}
                        placeholder="https://"
                      />
                    </Field>
                  </>
                )}

                {step === 3 && path === 'VOICE' && (
                  <>
                    <StepIntro headingRef={headingRef} title="What should the voice tell callers?">
                      It answers 24/7 with these prices and policies. You can change any of it later.
                    </StepIntro>
                    <div className="mt-6">
                      <h2 className="font-semibold">Rooms and nightly prices</h2>
                      <p className="mt-1 text-sm text-muted-foreground">The voice quotes these. You can set different prices for busy nights afterwards.</p>
                      <div className="mt-4">
                        <RoomRows rooms={rooms} errors={errors} setRoom={setRoom} removeRoom={removeRoom} addRoom={addRoom} showCount={false} />
                      </div>
                    </div>
                    <div className="mt-8 space-y-4 border-t pt-6">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Check-in from" htmlFor="o-cin">
                          <Select value={voice.checkInTime} onValueChange={(v) => setV({ checkInTime: v })}>
                            <SelectTrigger id="o-cin">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {HALF_HOURS.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {formatClock(t)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Check-out by" htmlFor="o-cout">
                          <Select value={voice.checkOutTime} onValueChange={(v) => setV({ checkOutTime: v })}>
                            <SelectTrigger id="o-cout">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {HALF_HOURS.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {formatClock(t)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <Field label="Cancellation policy" optional htmlFor="o-cancel" error={errors.cancellationPolicy} hint="In your words. Left blank, the voice offers to take a message instead of guessing.">
                        <Input
                          id="o-cancel"
                          maxLength={500}
                          value={voice.cancellationPolicy}
                          onChange={(e) => setV({ cancellationPolicy: e.target.value }, 'cancellationPolicy')}
                          placeholder="Free cancellation until 24 hours before arrival"
                        />
                      </Field>
                      <Field label="Greeting" optional htmlFor="o-greet" error={errors.greeting} hint="The first thing callers hear. Leave it blank to use the example.">
                        <Input id="o-greet" maxLength={300} value={voice.greeting} onChange={(e) => setV({ greeting: e.target.value }, 'greeting')} placeholder={`Thanks for calling ${prop.name || 'us'} — how can I help?`} />
                      </Field>
                      <Field
                        label="Put callers through to"
                        optional
                        htmlFor="o-transfer"
                        error={errors.transferNumber}
                        hint="A mobile or direct line for when a caller asks for a person — not a number that forwards to the assistant. Leave it blank to take messages instead."
                      >
                        <div className="relative">
                          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                          <Input
                            id="o-transfer"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            maxLength={40}
                            className="pl-9"
                            value={voice.transferNumber}
                            onChange={(e) => setV({ transferNumber: e.target.value }, 'transferNumber')}
                            placeholder="+1 831 555 0100"
                          />
                        </div>
                      </Field>
                    </div>
                  </>
                )}

                {step === 3 && path === 'FULL' && (
                  <>
                    <StepIntro headingRef={headingRef} title="Your rooms and brand">
                      Add your room types now or later — you can set different prices for each night afterwards.
                    </StepIntro>
                    <div className="mt-6">
                      <RoomRows rooms={rooms} errors={errors} setRoom={setRoom} removeRoom={removeRoom} addRoom={addRoom} />
                    </div>
                    <div className="mt-8 space-y-5 border-t pt-6">
                      <Field label="Tagline" optional htmlFor="o-tag" hint="A short line under your hotel’s name.">
                        <Input id="o-tag" maxLength={160} value={prop.tagline} onChange={(e) => setP('tagline', e.target.value)} placeholder="Coastal calm, two blocks from the beach" />
                      </Field>
                      <fieldset aria-describedby="o-color-hint">
                        <legend className="text-sm font-medium">Brand colour</legend>
                        <p id="o-color-hint" className="mt-1 text-xs leading-5 text-muted-foreground">
                          Used for buttons and accents on your booking site. You can fine-tune it later.
                        </p>
                        <div className="mt-3 grid w-fit grid-cols-4 gap-3 sm:grid-cols-8 sm:gap-2.5">
                          {BRAND_SWATCHES.map((c) => {
                            const selected = prop.primaryColor === c;
                            return (
                              <label
                                key={c}
                                title={SWATCH_NAMES[c] ?? c}
                                className={cn(
                                  'relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-foreground/15 ring-offset-2 ring-offset-background transition-transform hover:scale-105 motion-reduce:hover:scale-100 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                                  selected && 'ring-2 ring-foreground/70'
                                )}
                                style={{ backgroundColor: c }}
                              >
                                <input type="radio" name="brand" value={c} checked={selected} onChange={() => setProp({ ...prop, primaryColor: c })} className="sr-only" />
                                <span className="sr-only">{SWATCH_NAMES[c] ?? c}</span>
                                {selected && <Check className="h-4 w-4 text-inverse-foreground" />}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>

            {formError && (
              <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm text-destructive-soft-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {formError.message}
                  {formError.signIn && (
                    <>
                      {' '}
                      <Link href="/login" className="rounded-sm font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Sign in
                      </Link>
                    </>
                  )}
                </p>
              </div>
            )}

            <div className="mt-8 flex items-center justify-between gap-3 border-t pt-6">
              {step > 0 ? (
                <Button type="button" variant="ghost" size="lg" className="px-3" disabled={busy} onClick={() => goTo(step - 1)}>
                  <ArrowLeft /> Back
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" size="lg" loading={busy} loadingText="Creating your hotel…" className="min-w-[10rem]">
                {step < 3 ? 'Continue' : 'Create my hotel'} <ArrowRight />
              </Button>
            </div>
            {step === 3 && <p className="mt-3 text-right text-xs text-muted-foreground">{nextHint}</p>}
            <p role="status" className="sr-only">
              {busy ? 'Creating your hotel…' : ''}
            </p>
          </form>
        </main>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {['Free to start', 'No card needed', 'Switch paths any time'].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-primary" /> {t}
            </li>
          ))}
        </ul>
      </div>

      <aside aria-label="Preview" className="relative isolate hidden overflow-clip bg-inverse text-inverse-foreground lg:block">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_25%_15%,hsl(var(--primary)/0.45),transparent_70%),radial-gradient(45%_40%_at_85%_95%,hsl(var(--highlight)/0.16),transparent_70%)]"
        />
        <div className="sticky top-0 flex h-dvh items-center justify-center p-12">
          <Preview
            path={path}
            name={prop.name}
            tagline={prop.tagline}
            color={prop.primaryColor}
            rooms={rooms}
            greeting={voice.greeting}
            system={systemName}
            mode={bridge.mode}
          />
        </div>
      </aside>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <React.Suspense>
      <Onboarding />
    </React.Suspense>
  );
}
