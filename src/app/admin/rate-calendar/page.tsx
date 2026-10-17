'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, BedDouble, CalendarX2, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Sparkles, X } from 'lucide-react';
import type { ISODate } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { addDays, fmtDay, fmtRange, weekday } from '@/lib/format';
import { formatNumber, money } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { AskAgentButton } from '@/components/console/AskAgentButton';
import { PageShell } from '@/components/console/PageShell';

interface RoomTypeLite {
  id: string;
  name: string;
  basePrice: number | string;
  totalRooms: number;
}
interface RateDay {
  date: ISODate;
  price: number;
  isCustom: boolean;
  sold: number;
  total: number;
}
interface RatesResponse {
  roomType: { id: string; name: string; basePrice: number; totalRooms: number };
  days: RateDay[];
}

type EditMode = 'set' | 'adjust' | 'reset';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_LONG = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const DOW_JS = [1, 2, 3, 4, 5, 6, 0];
const CURRENCY = 'USD';
const whole = (n: number) => money(n, { cents: false, currency: CURRENCY });
const currencySymbol = new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '$';

function monthGrid(month: string) {
  // month = YYYY-MM-01. Weeks start Monday; always 6 rows for a steady layout.
  const first = month;
  const offset = (weekday(first) + 6) % 7;
  const start = addDays(first, -offset);
  return { start, end: addDays(start, 41), cells: Array.from({ length: 42 }, (_, i) => addDays(start, i)) };
}

function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const isWeekendNight = (d: ISODate) => weekday(d) === 5 || weekday(d) === 6;

function Legend({ min, max, occupancy = true }: { min?: number; max?: number; /** Rooms sold (hotels whose bookings live in HotelOne). */ occupancy?: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Calendar key">
      <li className="inline-flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-primary" aria-hidden /> Custom price
      </li>
      {occupancy && (
        <>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-primary/70" aria-hidden /> Rooms sold
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-success" aria-hidden /> 85%+ sold
          </li>
        </>
      )}
      <li className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 rounded-sm border border-border-strong/40 bg-muted/70" aria-hidden /> Fri &amp; Sat nights
      </li>
      {min !== undefined && max !== undefined && (
        <li className="tabular">
          This month {whole(min)}
          {max !== min ? `–${whole(max)}` : ''}
        </li>
      )}
    </ul>
  );
}

export default function RateCalendarPage() {
  const { ctx, property, can, refresh } = useConsole();
  // Voice-only hotels keep bookings in their own system: prices only, no rooms sold.
  const voiceOnly = property?.setupPath === 'VOICE';
  const reduce = useReducedMotion();
  const today = ctx?.today ?? '';
  const typesUrl = usePropertyUrl('/api/admin/room-types');
  const { data: types } = useSWR<RoomTypeLite[]>(typesUrl, fetcher);
  const [roomTypeId, setRoomTypeId] = React.useState<string>('');
  const [month, setMonth] = React.useState<string>('');
  React.useEffect(() => {
    if (today && !month) setMonth(`${today.slice(0, 7)}-01`);
  }, [today, month]);
  React.useEffect(() => {
    if (types?.length && !types.find((t) => t.id === roomTypeId)) setRoomTypeId(types[0].id);
  }, [types, roomTypeId]);

  const grid = month ? monthGrid(month) : null;
  const ratesUrl = roomTypeId && grid ? `/api/admin/room-types/${roomTypeId}/rates?startDate=${grid.start}&endDate=${grid.end}` : null;
  const { data, error, isValidating, mutate } = useSWR<RatesResponse>(ratesUrl, fetcher, { keepPreviousData: true });
  const byDay = React.useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);

  // Selection: drag with a mouse, tap first + last night on touch, or
  // Enter / Shift+Enter (and Shift+arrows) from the keyboard.
  const [anchor, setAnchor] = React.useState<ISODate | null>(null);
  const [focus, setFocus] = React.useState<ISODate | null>(null);
  const [dragging, setDragging] = React.useState(false);
  // Keyboard cursor for the roving tab stop inside the month grid.
  const [cursor, setCursor] = React.useState<ISODate | null>(null);
  const selStart = anchor && focus ? (anchor < focus ? anchor : focus) : null;
  const selEnd = anchor && focus ? (anchor < focus ? focus : anchor) : null;
  const inSel = (d: ISODate) => !!selStart && !!selEnd && d >= selStart && d <= selEnd;
  const editable = can('rates.write');
  const gridRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const clear = () => {
    setAnchor(null);
    setFocus(null);
  };

  // Editor state
  const [mode, setMode] = React.useState<EditMode>('set');
  const [price, setPrice] = React.useState('');
  const [pct, setPct] = React.useState('10');
  const [dows, setDows] = React.useState<number[]>([]);
  const [saving, setSaving] = React.useState(false);

  const selectedNights = React.useMemo(() => {
    if (!selStart || !selEnd) return [];
    const out: RateDay[] = [];
    for (let d = selStart; d <= selEnd; d = addDays(d, 1)) {
      if (dows.length && !dows.includes(weekday(d))) continue;
      const r = byDay.get(d);
      if (r) out.push(r);
    }
    return out;
  }, [selStart, selEnd, dows, byDay]);

  React.useEffect(() => {
    if (selectedNights.length && !price) setPrice(String(Math.round(selectedNights[0].price)));
  }, [selectedNights, price]);

  const preview = (r: RateDay) => {
    if (mode === 'set') return Number(price) || r.price;
    if (mode === 'adjust') return Math.max(0, Math.round(r.price * (1 + (Number(pct) || 0) / 100)));
    return data?.roomType.basePrice ?? r.price;
  };
  const before = selectedNights.reduce((s, r) => s + r.price, 0);
  const after = selectedNights.reduce((s, r) => s + preview(r), 0);

  async function apply() {
    if (!selStart || !selEnd || !roomTypeId) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { startDate: selStart, endDate: selEnd };
      if (dows.length) body.daysOfWeek = dows;
      if (mode === 'set') body.price = Number(price);
      else if (mode === 'adjust') body.adjustPercent = Number(pct);
      else body.reset = true;
      const r = await api<{ count: number }>(`/api/admin/room-types/${roomTypeId}/rates`, { method: 'POST', json: body });
      toast.success(`${formatNumber(r.count)} night${r.count === 1 ? '' : 's'} of ${data?.roomType.name} updated`);
      await mutate();
      refresh();
      clear();
      setPrice('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = month ? new Date(`${month}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const currentMonth = today ? `${today.slice(0, 7)}-01` : '';
  const monthDays = (data?.days ?? []).filter((d) => d.date.slice(0, 7) === month.slice(0, 7));
  const prices = monthDays.map((d) => d.price);
  const minP = prices.length ? Math.min(...prices) : undefined;
  const maxP = prices.length ? Math.max(...prices) : undefined;
  const monthStats = monthDays.length
    ? {
        avg: prices.reduce((a, b) => a + b, 0) / prices.length,
        custom: monthDays.filter((d) => d.isCustom).length,
        sold: (() => {
          const cap = monthDays.reduce((a, d) => a + d.total, 0);
          return cap ? Math.round((monthDays.reduce((a, d) => a + d.sold, 0) / cap) * 100) : 0;
        })(),
      }
    : null;

  const selectable = (d: ISODate) => editable && d >= today;
  // The one cell in the grid that takes Tab: the cursor, else today (if shown), else the first selectable night.
  const tabStop = React.useMemo(() => {
    if (!grid) return null;
    if (cursor && grid.cells.includes(cursor) && selectable(cursor)) return cursor;
    if (grid.cells.includes(today) && selectable(today)) return today;
    return grid.cells.find((d) => d.slice(0, 7) === month.slice(0, 7) && selectable(d)) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid?.start, cursor, today, month, editable]);

  const startAt = (d: ISODate) => {
    setAnchor(d);
    setFocus(d);
    setPrice('');
  };

  // Mice drag from pointerdown; touch and pen act on click, so a swipe that
  // scrolls the page never starts a selection.
  const lastPointer = React.useRef<string>('mouse');
  const onPointerDown = (e: React.PointerEvent, d: ISODate) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType !== 'mouse' || e.button !== 0 || !selectable(d)) return;
    setCursor(d);
    if (e.shiftKey && anchor) {
      setFocus(d);
      return;
    }
    startAt(d);
    setDragging(true);
  };

  const onTap = (e: React.MouseEvent, d: ISODate) => {
    // e.detail === 0: a click synthesised from the keyboard (handled in onKeyDown).
    if (e.detail === 0 || lastPointer.current === 'mouse' || !selectable(d)) return;
    setCursor(d);
    if (anchor && anchor === focus && d !== anchor) {
      setFocus(d);
      window.setTimeout(() => {
        if (window.matchMedia('(max-width: 1023px)').matches) editorRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }, 50);
    } else {
      startAt(d);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent, d: ISODate) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (anchor && e.shiftKey) setFocus(d);
      else startAt(d);
      return;
    }
    if (e.key === 'Escape' && anchor) {
      e.preventDefault();
      clear();
      return;
    }
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key as 'ArrowLeft'];
    if (!delta || !grid) return;
    e.preventDefault();
    const target = addDays(d, delta);
    if (!grid.cells.includes(target) || !selectable(target)) return;
    setCursor(target);
    if (e.shiftKey) {
      if (!anchor) startAt(d);
      setFocus(target);
    }
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-rate-day="${target}"]`)?.focus();
  };

  if (types && types.length === 0) {
    return (
      <PageShell title="Rates">
        <Card>
          <EmptyState
            icon={BedDouble}
            title="Add a room type first"
            description="Rates are set per room type. Create one and its base price fills the calendar."
            action={
              <Button asChild>
                <Link href="/admin/room-types/add">Add room type</Link>
              </Button>
            }
          />
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Rates"
      description={
        data
          ? `${data.roomType.name} · base ${whole(data.roomType.basePrice)} a night${voiceOnly ? '' : ` · ${formatNumber(data.roomType.totalRooms)} rooms`}`
          : 'Nightly prices and demand by room type'
      }
      actions={
        <>
          {!voiceOnly && (
            <AskAgentButton size="default" command="weekend forecast for the next 3 weekends">
              Recommend rates
            </AskAgentButton>
          )}
          <Select
            value={roomTypeId}
            onValueChange={(v) => {
              setRoomTypeId(v);
              clear();
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Room type">
              <SelectValue placeholder="Room type" />
            </SelectTrigger>
            <SelectContent>
              {(types ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 p-3 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex items-center gap-1">
              <IconButton label="Previous month" size="icon-sm" onClick={() => setMonth(shiftMonth(month, -1))}>
                <ChevronLeft />
              </IconButton>
              <h2 className="min-w-36 text-center text-base font-semibold tabular" aria-live="polite">
                {monthLabel}
              </h2>
              <IconButton label="Next month" size="icon-sm" onClick={() => setMonth(shiftMonth(month, 1))}>
                <ChevronRight />
              </IconButton>
              {month !== currentMonth && (
                <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth)}>
                  This month
                </Button>
              )}
            </div>
            <Legend min={minP} max={maxP} occupancy={!voiceOnly} />
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-2xs font-semibold uppercase tracking-wider text-muted-foreground" aria-hidden>
            {DOW.map((d) => (
              <div key={d} className="pb-1.5">
                <span className="sm:hidden">{d.slice(0, 1)}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          {error && !data ? (
            <EmptyState
              icon={CalendarX2}
              title="We couldn’t load the rates"
              description="Check your connection and try again. No prices were changed."
              action={
                <Button variant="outline" onClick={() => mutate()} loading={isValidating}>
                  <RefreshCw aria-hidden /> Try again
                </Button>
              }
            />
          ) : !grid || !data ? (
            <div className="grid grid-cols-7 gap-1" role="status">
              <span className="sr-only">Loading rates…</span>
              {Array.from({ length: 42 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg sm:h-[88px]" />
              ))}
            </div>
          ) : (
            <div
              ref={gridRef}
              role="group"
              aria-label={`${monthLabel} nightly rates${data ? ` for ${data.roomType.name}` : ''}`}
              aria-describedby="rate-help"
              className="grid touch-manipulation select-none grid-cols-7 gap-1"
            >
              {grid.cells.map((d) => {
                const r = byDay.get(d);
                const outside = d.slice(0, 7) !== month.slice(0, 7);
                const past = d < today;
                const canPick = selectable(d);
                const sel = inSel(d) && (!dows.length || dows.includes(weekday(d)));
                const occ = r && r.total ? r.sold / r.total : 0;
                const isToday = d === today;
                const shownPrice = r ? (sel && mode !== 'reset' && (mode === 'adjust' || price) ? preview(r) : r.price) : 0;
                return (
                  <button
                    key={d}
                    type="button"
                    data-rate-day={d}
                    disabled={!canPick}
                    tabIndex={d === tabStop ? 0 : -1}
                    aria-label={`${fmtDay(d, 'weekday')}${isToday ? ' (today)' : ''}: ${r ? whole(r.price) : 'no rate'}${r?.isCustom ? ', custom price' : ''}${voiceOnly ? '' : `, ${r?.sold ?? 0} of ${r?.total ?? 0} rooms sold`}${past ? ', past' : ''}`}
                    aria-pressed={canPick ? sel : undefined}
                    onPointerDown={(e) => onPointerDown(e, d)}
                    onClick={(e) => onTap(e, d)}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && dragging && canPick && setFocus(d)}
                    onFocus={() => setCursor(d)}
                    onKeyDown={(e) => onKeyDown(e, d)}
                    className={cn(
                      'relative flex h-16 min-w-0 flex-col rounded-lg border p-1 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card sm:h-[88px] sm:p-2',
                      outside
                        ? 'border-transparent bg-transparent'
                        : past
                          ? 'border-border/70 border-dashed bg-transparent'
                          : isWeekendNight(d)
                            ? 'border-border bg-muted/70'
                            : 'border-border bg-card',
                      canPick && !sel && 'cursor-pointer hover:border-primary/50',
                      !canPick && 'cursor-default',
                      sel && 'border-primary bg-primary-soft ring-1 ring-inset ring-primary',
                      isToday && !sel && 'border-primary/60 ring-1 ring-inset ring-primary/30'
                    )}
                  >
                    <span
                      className={cn(
                        'text-2xs leading-4 tabular',
                        isToday ? 'font-bold text-primary-soft-foreground' : outside || past ? 'text-muted-foreground' : 'font-medium text-foreground'
                      )}
                      aria-hidden
                    >
                      {Number(d.slice(8))}
                    </span>
                    {r && (
                      <>
                        <span
                          aria-hidden
                          className={cn(
                            'mt-auto truncate font-semibold tabular',
                            outside ? 'text-2xs font-medium text-muted-foreground sm:text-xs' : 'text-xs sm:text-[15px]',
                            past ? 'font-medium text-muted-foreground' : !outside && (r.isCustom ? 'text-primary-soft-foreground' : 'text-foreground')
                          )}
                        >
                          <span className="sm:hidden">{formatNumber(Math.round(shownPrice))}</span>
                          <span className="hidden sm:inline">{whole(shownPrice)}</span>
                        </span>
                        {!outside && !voiceOnly && (
                          <>
                            <span className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                              <span
                                className={cn('block h-full rounded-full', occ >= 0.85 ? 'bg-success' : 'bg-primary/70')}
                                style={{ width: `${Math.max(occ > 0 ? 8 : 0, occ * 100)}%` }}
                              />
                            </span>
                            <span className="mt-0.5 hidden truncate text-2xs leading-4 text-muted-foreground tabular sm:block" aria-hidden>
                              {r.sold}/{r.total} sold
                            </span>
                          </>
                        )}
                        {r.isCustom && <span className="absolute right-1 top-1.5 size-1.5 rounded-full bg-primary sm:right-2 sm:top-2.5 sm:size-2" aria-hidden />}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <p id="rate-help" className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {editable ? (
              <>
                <span className="[@media(pointer:coarse)]:hidden">Drag across nights, or click one and Shift-click another, to edit a range. </span>
                <span className="hidden [@media(pointer:coarse)]:inline">Tap the first night, then the last night, to edit a range. </span>
                <span className="sr-only">With the keyboard, use the arrow keys to move, Enter to pick a night and Shift with the arrows to extend.</span>
              </>
            ) : (
              'You can view rates; ask a manager to change them.'
            )}
          </p>
        </Card>

        {/* Editor */}
        <div ref={editorRef} className="scroll-mt-20 lg:sticky lg:top-20">
          <AnimatePresence mode="wait" initial={false}>
            {selStart && selEnd ? (
              <motion.div key="edit" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}>
                <Card className="p-5" role="region" aria-labelledby="rate-editor-title">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 id="rate-editor-title" className="text-base font-semibold">
                        {selStart === selEnd ? fmtDay(selStart, 'weekday') : fmtRange(selStart, selEnd)}
                      </h2>
                      <p className="text-sm text-muted-foreground" aria-live="polite">
                        {formatNumber(selectedNights.length)} night{selectedNights.length === 1 ? '' : 's'} · {data?.roomType.name}
                      </p>
                    </div>
                    <IconButton label="Clear selection" size="icon-sm" onClick={clear} className="-mr-1.5 -mt-1.5 text-muted-foreground">
                      <X />
                    </IconButton>
                  </div>

                  <SegmentedControl
                    layoutId="rate-edit-mode"
                    aria-label="How to change the price"
                    size="sm"
                    className="mt-4 flex w-full [&>button]:flex-1"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'set', label: 'Set price' },
                      { value: 'adjust', label: 'Adjust %' },
                      { value: 'reset', label: 'Reset' },
                    ]}
                  />

                  <div className="mt-4">
                    {mode === 'set' && (
                      <Field label="New nightly price" hint={data ? `Base price is ${whole(data.roomType.basePrice)}` : undefined}>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden>
                            {currencySymbol}
                          </span>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            className="h-11 pl-7 text-lg font-semibold tabular md:text-lg"
                          />
                        </div>
                      </Field>
                    )}
                    {mode === 'adjust' && (
                      <div role="group" aria-labelledby="adjust-label">
                        <p id="adjust-label" className="mb-1.5 text-sm font-medium">
                          Change by
                        </p>
                        <div className="grid grid-cols-5 gap-1.5">
                          {[-15, -10, 10, 15, 25].map((p) => {
                            const on = String(p) === pct;
                            return (
                              <button
                                key={p}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setPct(String(p))}
                                className={cn(
                                  'h-10 rounded-lg border text-sm font-medium tabular transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                                  on ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'border-border-strong/50 hover:bg-accent'
                                )}
                              >
                                {p > 0 ? '+' : '−'}
                                {Math.abs(p)}%
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {mode === 'reset' && (
                      <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm">
                        <RotateCcw className="size-4 shrink-0 text-muted-foreground" aria-hidden /> Back to the base price of {whole(data?.roomType.basePrice ?? 0)}
                      </p>
                    )}
                  </div>

                  <div className="mt-4" role="group" aria-labelledby="dow-label">
                    <p id="dow-label" className="mb-1.5 text-sm font-medium">
                      Only on
                    </p>
                    <div className="grid grid-cols-7 gap-1">
                      {DOW.map((d, i) => {
                        const js = DOW_JS[i];
                        const on = dows.includes(js);
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            aria-label={DOW_LONG[i]}
                            onClick={() => setDows((cur) => (on ? cur.filter((x) => x !== js) : [...cur, js]))}
                            className={cn(
                              'h-9 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                              on ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'border-border-strong/50 text-muted-foreground hover:bg-accent hover:text-foreground'
                            )}
                          >
                            {d.slice(0, 2)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{dows.length ? 'Other nights in the range stay as they are.' : 'Every night in the range.'}</p>
                  </div>

                  {selectedNights.length > 0 && (
                    <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-sunken px-3 py-2.5 text-sm">
                      <span className="text-muted-foreground">Average a night</span>
                      <span className="tabular">
                        {whole(before / selectedNights.length)} <span aria-hidden>→</span>
                        <span className="sr-only">becomes</span> <span className="font-semibold">{whole(after / selectedNights.length)}</span>
                      </span>
                    </div>
                  )}

                  <Button
                    className="mt-4 w-full"
                    onClick={apply}
                    loading={saving}
                    loadingText="Saving prices…"
                    disabled={!selectedNights.length || (mode === 'set' && !(Number(price) >= 0 && price !== ''))}
                  >
                    Apply to {formatNumber(selectedNights.length)} night{selectedNights.length === 1 ? '' : 's'}
                  </Button>
                </Card>
              </motion.div>
            ) : (
              <motion.div key="hint" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Card className="p-5">
                  <h2 className="text-base font-semibold">Edit prices</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {editable
                      ? 'Select nights on the calendar to set a price, adjust by a percentage, or reset to the base rate.'
                      : 'Prices for each night of the month. Only owners and managers can change them.'}
                  </p>
                  {monthStats && (
                    <section aria-labelledby="rate-month-title" className="mt-5">
                      <h3 id="rate-month-title" className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {monthLabel.split(' ')[0]} at a glance
                      </h3>
                      <dl className="mt-2 divide-y rounded-lg border bg-surface-sunken text-sm">
                        {[
                          ['Average nightly rate', whole(monthStats.avg)],
                          ['Nights with a custom price', formatNumber(monthStats.custom)],
                          ...(voiceOnly ? [] : [['Rooms sold', `${monthStats.sold}%`]]),
                        ].map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                            <dt className="text-muted-foreground">{k}</dt>
                            <dd className="font-semibold tabular">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  )}
                  {can('agent.use') && editable && !voiceOnly && (
                    <div className="mt-5 rounded-xl bg-agent-soft p-3 text-agent-soft-foreground">
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <Sparkles className="size-3.5" aria-hidden /> Or just ask the agent
                      </p>
                      <SuggestedCommand roomType={data?.roomType.name} />
                    </div>
                  )}
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageShell>
  );
}

function SuggestedCommand({ roomType }: { roomType?: string }) {
  const { askAgent } = useConsole();
  const text = `Raise ${roomType ?? 'weekend'} rates 10% for the next 2 weekends`;
  return (
    <button
      type="button"
      className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-lg border border-agent/20 bg-surface px-3 py-2 text-left text-sm text-foreground shadow-xs transition-colors hover:border-agent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-agent-soft"
      onClick={() => askAgent(text.charAt(0).toLowerCase() + text.slice(1))}
    >
      <span className="sr-only">Ask the agent: </span>
      <span className="min-w-0 flex-1">{text}</span>
      <ArrowUpRight className="size-4 shrink-0 text-agent-soft-foreground" aria-hidden />
    </button>
  );
}
