'use client';

import * as React from 'react';
import { CalendarDays, MapPin, Minus, Plus, Search, Users } from 'lucide-react';
import { addDays, fmtDay, localToday, nightsBetween } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface StayQuery {
  q?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms?: number;
}

export function defaultStay(): StayQuery {
  const today = localToday();
  // Default to next Friday → Sunday: the most common leisure search.
  const d = new Date(`${today}T12:00:00Z`).getUTCDay();
  const toFri = (5 - d + 7) % 7 || 7;
  const checkIn = addDays(today, toFri);
  return { checkIn, checkOut: addDays(checkIn, 2), guests: 2, rooms: 1 };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const noopSubscribe = () => () => {};
/**
 * The guest's own calendar date, or undefined while server-rendering: the
 * server's clock (UTC on Vercel) is a day ahead of US evenings, and React
 * keeps a server-rendered `min` attribute after hydration.
 */
function useGuestToday(): string | undefined {
  return React.useSyncExternalStore(noopSubscribe, localToday, () => undefined);
}

/**
 * − value + control. Each button is a 40px target with its own accessible
 * name; the value is announced as it changes. Pass `labelledBy` to name the
 * group after a visible label.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 12,
  label,
  labelledBy,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Plural noun for the count, e.g. "guests". */
  label: string;
  labelledBy?: string;
}) {
  const btn =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-input bg-surface text-foreground transition-colors hover:border-foreground/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface';
  return (
    <div className="flex items-center gap-2" role="group" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className={btn} aria-label={`Fewer ${label}`}>
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <span className="w-6 text-center text-base font-semibold tabular" aria-live="polite" aria-atomic>
        {value}
        <span className="sr-only"> {label}</span>
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className={btn} aria-label={`More ${label}`}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * A date field that shows a friendly "Fri, Nov 13" over the native date
 * input: the input stays the real, labelled control (phones get their own
 * picker, keyboards can type), it just isn't drawn. Clicking anywhere on the
 * field or pressing Space opens the browser's picker. `bordered` draws it as a
 * standalone form control (e.g. in a dialog) instead of a search-bar segment.
 */
export function DateField({
  id,
  label,
  value,
  min,
  max,
  onChange,
  extra,
  icon,
  className,
  disabled,
  bordered,
}: {
  id: string;
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
  extra?: React.ReactNode;
  icon?: boolean;
  className?: string;
  disabled?: boolean;
  bordered?: boolean;
}) {
  const open = (el: HTMLInputElement) => {
    try {
      el.showPicker?.();
    } catch {
      /* not allowed here (e.g. no user gesture); the input still works */
    }
  };
  return (
    <div
      className={cn(
        segment,
        'cursor-pointer',
        bordered && 'border border-input bg-surface',
        disabled && 'cursor-not-allowed bg-muted opacity-70 hover:bg-muted',
        className
      )}
    >
      {icon && <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1 whitespace-nowrap text-xs font-medium text-muted-foreground">
          <label htmlFor={id}>{label}</label>
          {extra}
        </span>
        <span className="block truncate text-[15px] font-semibold leading-6 text-foreground" aria-hidden>
          {value ? fmtDay(value, 'weekday') : 'Add date'}
        </span>
      </div>
      <input
        id={id}
        type="date"
        required
        disabled={disabled}
        min={min}
        max={max}
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault();
            open(e.currentTarget);
          }
        }}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none text-base opacity-0 disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </div>
  );
}

/** One field of the search bar: hover tint, and a focus ring when its control has keyboard focus. */
const segment =
  'relative flex min-h-14 items-center gap-3 rounded-xl px-3.5 py-2 transition-colors hover:bg-accent/70 has-[:focus-visible]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';

/**
 * Destination + dates + guests. `bar` is the wide one-row search (stacks on
 * phones); `stacked` is the compact 2×2 grid for a booking sidebar.
 * Check-out follows check-in so the range is always valid.
 */
export function StaySearch({
  value,
  onSubmit,
  showDestination = true,
  showRooms = false,
  submitLabel = 'Search',
  className,
  compact,
  layout = 'bar',
  pending = false,
  label,
}: {
  value: StayQuery;
  onSubmit: (v: StayQuery) => void;
  showDestination?: boolean;
  showRooms?: boolean;
  submitLabel?: string;
  className?: string;
  compact?: boolean;
  /** `bar` (default): one row from md up. `stacked`: a 2×2 grid for narrow columns. */
  layout?: 'bar' | 'stacked';
  /** Shows a spinner on the button while results load. */
  pending?: boolean;
  /** Accessible name of the form. Defaults to "Search stays" / "Check availability". */
  label?: string;
}) {
  const [v, setV] = React.useState<StayQuery>(value);
  React.useEffect(() => setV(value), [value]);
  const uid = React.useId();
  const ids = { q: `${uid}-q`, in: `${uid}-in`, out: `${uid}-out`, guests: `${uid}-guests`, rooms: `${uid}-rooms` };
  const today = useGuestToday();
  const nights = nightsBetween(v.checkIn, v.checkOut);
  const stacked = layout === 'stacked';
  // Divider between the row's groups, shown only once the form is one row.
  const divider = cn('hidden w-px self-stretch bg-border', showRooms ? 'lg:my-2 lg:block' : 'md:my-2 md:block');

  const setCheckIn = (checkIn: string) => {
    setV((cur) => ({ ...cur, checkIn, checkOut: cur.checkOut <= checkIn ? addDays(checkIn, Math.max(1, nightsBetween(cur.checkIn, cur.checkOut))) : cur.checkOut }));
  };

  // Hidden on phones, where the half-width field has no room for it (the dates themselves say it).
  const nightsNote = nights > 0 && (
    <span className="hidden whitespace-nowrap font-normal sm:inline" aria-hidden>
      · {plural(nights, 'night')}
    </span>
  );
  const checkIn = (
    <DateField id={ids.in} label="Check in" value={v.checkIn} min={today} onChange={setCheckIn} icon={!stacked} className={cn(stacked && 'rounded-none')} />
  );
  const checkOut = (
    <DateField
      id={ids.out}
      label="Check out"
      value={v.checkOut}
      min={addDays(v.checkIn, 1)}
      max={addDays(v.checkIn, 30)}
      onChange={(checkOut) => setV((cur) => ({ ...cur, checkOut }))}
      extra={nightsNote}
      icon={!stacked}
      className={cn(stacked && 'rounded-none')}
    />
  );
  const counter = (key: 'guests' | 'rooms', text: string, noun: string, max: number) => (
    <div
      className={cn(
        segment,
        stacked
          ? 'flex-col items-start gap-1.5 rounded-none py-3'
          : showRooms
            ? 'flex-col items-start justify-center gap-1'
            : 'justify-between md:flex-col md:items-start md:justify-center md:gap-1'
      )}
    >
      <span className="flex items-center gap-3">
        {!stacked && !showRooms && key === 'guests' && <Users className="h-4 w-4 shrink-0 text-muted-foreground md:hidden" aria-hidden />}
        <span id={ids[key]} className="text-xs font-medium text-muted-foreground">
          {text}
        </span>
      </span>
      <Stepper
        value={key === 'guests' ? v.guests : (v.rooms ?? 1)}
        onChange={(n) => setV((cur) => ({ ...cur, [key]: n }))}
        label={noun}
        labelledBy={ids[key]}
        max={max}
      />
    </div>
  );

  return (
    <form
      role="search"
      aria-label={label ?? (showDestination ? 'Search stays' : 'Check availability')}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className={cn(
        stacked
          ? 'grid gap-3'
          : cn('grid gap-1.5 rounded-2xl border bg-card p-2', showRooms ? 'lg:flex lg:items-stretch lg:gap-1' : 'md:flex md:items-stretch md:gap-1'),
        !stacked && (compact ? 'shadow-soft' : 'shadow-lifted'),
        className
      )}
    >
      {stacked ? (
        <div className="overflow-hidden rounded-xl border border-input bg-surface">
          <div className="grid grid-cols-2 divide-x divide-input">
            {checkIn}
            {checkOut}
          </div>
          <div className={cn('grid border-t border-input', showRooms && 'grid-cols-2 divide-x divide-input')}>
            {counter('guests', 'Guests', 'guests', 16)}
            {showRooms && counter('rooms', 'Rooms', 'rooms', 9)}
          </div>
        </div>
      ) : (
        <>
          {showDestination && (
            <div className={cn(segment, 'md:flex-[1.3]')}>
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <label htmlFor={ids.q} className="block text-xs font-medium text-muted-foreground">
                  Where
                </label>
                <input
                  id={ids.q}
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={v.q ?? ''}
                  onChange={(e) => setV({ ...v, q: e.target.value })}
                  placeholder="City or hotel name"
                  className="w-full bg-transparent text-base font-semibold leading-6 text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:outline-none md:text-[15px] [&::-webkit-search-cancel-button]:hidden"
                />
              </div>
            </div>
          )}
          {showDestination && <span className={divider} aria-hidden />}
          <div className="grid grid-cols-2 gap-1.5 md:flex md:flex-[1.6] md:gap-1">
            <div className="md:flex-1">{checkIn}</div>
            <span className="hidden w-px self-stretch bg-border md:my-2 md:block" aria-hidden />
            <div className="md:flex-1">{checkOut}</div>
          </div>
          <span className={divider} aria-hidden />
          <div className={cn('grid gap-1.5 md:flex md:gap-1', showRooms && 'grid-cols-2')}>
            {counter('guests', 'Guests', 'guests', 16)}
            {showRooms && counter('rooms', 'Rooms', 'rooms', 9)}
          </div>
        </>
      )}
      <Button type="submit" size="lg" variant="brand" loading={pending} className={cn('h-12 min-h-12 rounded-xl px-6', stacked ? 'w-full' : showRooms ? 'w-full lg:ml-1 lg:h-auto lg:w-auto lg:self-stretch' : 'w-full md:ml-1 md:h-auto md:w-auto md:self-stretch')}>
        <Search aria-hidden /> {submitLabel}
      </Button>
      <span className="sr-only" aria-live="polite">
        {fmtDay(v.checkIn, 'weekday')} to {fmtDay(v.checkOut, 'weekday')}, {plural(nights, 'night')}, {plural(v.guests, 'guest')}
        {showRooms ? `, ${plural(v.rooms ?? 1, 'room')}` : ''}
      </span>
    </form>
  );
}
