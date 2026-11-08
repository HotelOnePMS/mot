'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { apiJson, CHANNEL_NAMES, ChannelBadge, ModeBadge, StatusBadge, timeAgo } from '@/components/channels/ChannelBadges';
import { cn } from '@/lib/utils';

type Mapping = {
  roomTypeId: string;
  otaRoomTypeId: string;
  otaRoomTypeName: string | null;
  otaRatePlanId: string;
  otaRatePlanName: string | null;
  markupPercent: number | null;
  inventoryAllocation: number | null;
  isActive: boolean;
  roomType: { id: string; name: string; basePrice: number; totalRooms: number };
};
type Promotion = {
  id: string;
  externalId: string | null;
  name: string;
  type: string;
  discountPercent: number;
  stayStart: string;
  stayEnd: string;
  bookStart: string | null;
  bookEnd: string | null;
  minStay: number | null;
  minDaysInAdvance: number | null;
  maxDaysInAdvance: number | null;
  status: string;
  lastError: string | null;
  createdBy: string | null;
};
type Connection = {
  id: string;
  channel: string;
  mode: string;
  status: string;
  otaPropertyId: string | null;
  otaPropertyName: string | null;
  currency: string;
  defaultMarkupPercent: number;
  syncRates: boolean;
  syncAvailability: boolean;
  importReservations: boolean;
  syncWindowDays: number;
  lastAriSyncAt: string | null;
  lastReservationPullAt: string | null;
  lastError: string | null;
  connectivityProvider: string | null;
  webhookUrl: string | null;
  property: { id: string; name: string };
  roomMappings: Mapping[];
  promotions: Promotion[];
  reservations: Array<{
    id: string;
    externalId: string;
    status: string;
    guestName: string | null;
    totalAmount: string | null;
    currency: string | null;
    receivedAt: string;
    booking: { id: string; checkIn: string; checkOut: string; status: string; rooms: number; roomType: { name: string } } | null;
  }>;
  syncLogs: Array<{ id: string; action: string; status: string; message: string; createdAt: string }>;
};
type CalendarDay = {
  date: string;
  weekday: string;
  pmsRate: number;
  channelRate: number;
  channelPriceOverride: number | null;
  available: number;
  booked: number;
  closed: boolean;
  minStay: number | null;
  promotions: string[];
};
type Calendar = { currency: string; roomTypes: Array<{ roomTypeId: string; name: string; markupPercent: number; days: CalendarDay[] }> };

const TABS = ['Rates & availability', 'Promotions', 'Reservations', 'Activity', 'Settings'] as const;
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const CALENDAR_DAYS = 14;

function todayString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ACTIONS = [
  { value: 'increase_percent', label: 'Increase price by %', kind: 'rates' },
  { value: 'decrease_percent', label: 'Decrease price by %', kind: 'rates' },
  { value: 'increase_amount', label: 'Increase price by $', kind: 'rates' },
  { value: 'decrease_amount', label: 'Decrease price by $', kind: 'rates' },
  { value: 'set_price', label: 'Set channel price to $', kind: 'rates' },
  { value: 'reset_to_pms_rate', label: 'Remove channel prices (PMS rate + markup)', kind: 'rates' },
  { value: 'close', label: 'Stop sell (close)', kind: 'restrictions' },
  { value: 'open', label: 'Open for sale', kind: 'restrictions' },
  { value: 'min_stay', label: 'Set minimum stay (nights)', kind: 'restrictions' },
] as const;

export default function ManageChannelPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConnection(await apiJson<Connection>(await fetch(`/api/admin/channels/${connectionId}`, { cache: 'no-store' })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connection');
    }
  }, [connectionId]);

  useEffect(() => {
    load();
    const activated = new URLSearchParams(window.location.search).get('activated');
    if (activated !== null) setNotice(`Connection activated. ${activated}`);
  }, [load]);

  const act = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
      load();
    }
  };

  const post = async (path: string, body?: unknown) =>
    apiJson(
      await fetch(`/api/admin/channels/${connectionId}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
    );

  if (!connection) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        {error ? <p className="text-destructive">{error}</p> : <Loader2 className="h-8 w-8 animate-spin text-primary" />}
      </div>
    );
  }

  const channelName = CHANNEL_NAMES[connection.channel];
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <div>
        <Link href="/admin/channels" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Channels
        </Link>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mt-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{connection.property.name}</h1>
              <ChannelBadge channel={connection.channel} />
              <ModeBadge mode={connection.mode} />
              <StatusBadge status={connection.status} />
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              {connection.otaPropertyName} #{connection.otaPropertyId} &middot; rates pushed {timeAgo(connection.lastAriSyncAt)} &middot;
              reservations checked {timeAgo(connection.lastReservationPullAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                act('sync', async () => {
                  const result = await post('/sync', { type: 'all' });
                  return `${result.ari?.message ?? ''} ${result.reservations ? `${result.reservations.length} reservation message(s) processed.` : ''}`;
                })
              }
            >
              {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync now
            </Button>
            {connection.mode === 'SANDBOX' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  act('simulate', async () => {
                    const { results } = await post('/simulate-booking');
                    return results.map((r: { message: string }) => r.message).join(' ');
                  })
                }
              >
                {busy === 'simulate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                Simulate {channelName} booking
              </Button>
            )}
            {connection.status === 'PAUSED' ? (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act('status', async () => void (await post('/status', { action: 'activate' })))}>
                <Play className="h-4 w-4" />
                Resume
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act('status', async () => void (await post('/status', { action: 'pause' })))}>
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/channels/connect?connectionId=${connection.id}`}>Edit setup</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/admin/channels/agent">
                <Bot className="h-4 w-4" />
                Ask the agent
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {(error || connection.lastError) && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error || `Last sync error: ${connection.lastError}`}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success-soft p-3 text-sm text-success-soft-foreground">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          {notice}
        </div>
      )}

      <div className="border-b flex gap-1 overflow-x-auto">
        {TABS.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
              tab === name ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'Rates & availability' && <RatesTab connection={connection} onChanged={load} />}
      {tab === 'Promotions' && <PromotionsTab connection={connection} onChanged={load} />}
      {tab === 'Reservations' && <ReservationsTab connection={connection} />}
      {tab === 'Activity' && (
        <Card>
          <CardContent className="pt-6">
            <ul className="divide-y text-sm">
              {connection.syncLogs.map((log) => (
                <li key={log.id} className="py-2 flex items-start justify-between gap-4">
                  <div>
                    <span className="font-mono text-xs text-muted-foreground mr-2">{log.action}</span>
                    <span className={log.status === 'FAILED' ? 'text-destructive' : 'text-foreground'}>{log.message}</span>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {tab === 'Settings' && (
        <SettingsTab
          connection={connection}
          onSaved={(message) => {
            setNotice(message);
            load();
          }}
          onDeleted={() => router.push('/admin/channels')}
        />
      )}
    </div>
  );
}

function RatesTab({ connection, onChanged }: { connection: Connection; onChanged: () => void }) {
  const [start, setStart] = useState(todayString());
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    roomTypeIds: [] as string[],
    startDate: todayString(),
    endDate: addDays(todayString(), 13),
    daysOfWeek: [] as string[],
    action: 'increase_percent',
    value: '10',
  });
  const [preview, setPreview] = useState<{ summary: string; details: string[]; warnings: string[] } | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const end = addDays(start, CALENDAR_DAYS - 1);
      setCalendar(await apiJson(await fetch(`/api/admin/channels/${connection.id}/calendar?startDate=${start}&endDate=${end}`, { cache: 'no-store' })));
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Failed to load calendar' });
    } finally {
      setLoading(false);
    }
  }, [connection.id, start]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  const action = ACTIONS.find((a) => a.value === form.action)!;
  const buildRequest = () => {
    const common = {
      connectionIds: [connection.id],
      roomTypeIds: form.roomTypeIds,
      startDate: form.startDate,
      endDate: form.endDate,
      daysOfWeek: form.daysOfWeek,
    };
    if (action.kind === 'rates') {
      return {
        kind: 'rates',
        ...common,
        scope: 'channel',
        propertyId: null,
        adjustment: { type: form.action, value: form.action === 'reset_to_pms_rate' ? null : Number(form.value) },
      };
    }
    return {
      kind: 'restrictions',
      ...common,
      closed: form.action === 'close' ? true : form.action === 'open' ? false : null,
      minStay: form.action === 'min_stay' ? Number(form.value) : null,
    };
  };

  const submit = async (isPreview: boolean) => {
    setWorking(true);
    setMessage(null);
    try {
      const result = await apiJson(
        await fetch('/api/admin/channels/rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...buildRequest(), preview: isPreview }),
        })
      );
      const details: string[] = result.groups
        ? result.groups.map(
            (g: any) => `${g.roomTypeName}: ${g.dates} night(s), $${g.oldMin}-${g.oldMax} -> $${g.newMin}-${g.newMax}`
          )
        : result.targets ?? [];
      if (isPreview) {
        setPreview({ summary: result.summary, details, warnings: result.warnings ?? [] });
      } else {
        setPreview(null);
        const failed = (result.sync ?? []).filter((s: any) => s.error);
        setMessage(
          failed.length
            ? { ok: false, text: `Saved, but the push failed: ${failed.map((f: any) => f.error).join('; ')}` }
            : { ok: true, text: `${result.summary} - pushed to ${CHANNEL_NAMES[connection.channel]}.` }
        );
        loadCalendar();
        onChanged();
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setWorking(false);
    }
  };

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const dates = calendar?.roomTypes[0]?.days.map((d) => d) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Prices sent to {CHANNEL_NAMES[connection.channel]}</CardTitle>
            <CardDescription>Per room per night. Blue = channel-specific price, red = closed. Rooms left below each price.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" onClick={() => setStart(addDays(start, -CALENDAR_DAYS))} disabled={start <= todayString()}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input type="date" className="h-9 w-40" value={start} min={todayString()} onChange={(e) => e.target.value && setStart(e.target.value)} />
            <Button size="icon" variant="outline" onClick={() => setStart(addDays(start, CALENDAR_DAYS))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && !calendar ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-background text-left pr-3 py-1 font-medium text-muted-foreground">Room type</th>
                    {dates.map((d) => (
                      <th
                        key={d.date}
                        className={cn('px-1 py-1 font-medium text-center min-w-[64px]', ['FRI', 'SAT'].includes(d.weekday) ? 'text-primary' : 'text-muted-foreground')}
                      >
                        <div>{d.weekday}</div>
                        <div>{d.date.slice(5)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calendar?.roomTypes.map((roomType) => (
                    <tr key={roomType.roomTypeId} className="border-t">
                      <td className="sticky left-0 bg-background pr-3 py-2 font-medium text-foreground whitespace-nowrap">
                        {roomType.name}
                        <div className="text-[10px] text-muted-foreground font-normal">+{roomType.markupPercent}% markup</div>
                      </td>
                      {roomType.days.map((d) => (
                        <td
                          key={d.date}
                          title={`PMS rate $${d.pmsRate}${d.minStay ? `, min stay ${d.minStay}` : ''}${d.promotions.length ? `, promotions: ${d.promotions.join(', ')}` : ''}`}
                          className={cn('px-1 py-2 text-center border-l', d.closed && 'bg-destructive-soft')}
                        >
                          <div className={cn('font-semibold', d.channelPriceOverride !== null ? 'text-primary' : 'text-foreground', d.closed && 'line-through text-destructive')}>
                            ${Math.round(d.channelRate)}
                          </div>
                          <div className={cn(d.available === 0 ? 'text-destructive' : 'text-muted-foreground')}>
                            {d.available} left{d.minStay ? ` · ${d.minStay}n` : ''}
                          </div>
                          {d.promotions.length > 0 && <div className="text-[10px] text-success-soft-foreground">promo</div>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bulk change</CardTitle>
          <CardDescription>
            Changes here apply to {CHANNEL_NAMES[connection.channel]} only. To change the rate for every channel and the website, use{' '}
            <Link href="/admin/rate-calendar" className="underline">
              Rates
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Room types</Label>
              <div className="flex flex-wrap gap-2">
                {connection.roomMappings
                  .filter((m) => m.isActive)
                  .map((m) => (
                    <button
                      key={m.roomTypeId}
                      type="button"
                      onClick={() => setForm({ ...form, roomTypeIds: toggle(form.roomTypeIds, m.roomTypeId) })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs',
                        form.roomTypeIds.includes(m.roomTypeId) && 'border-primary bg-primary-soft text-primary'
                      )}
                    >
                      {m.roomType.name}
                    </button>
                  ))}
                <span className="text-xs text-muted-foreground self-center">{form.roomTypeIds.length === 0 && 'none selected = all'}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Nights of the week</Label>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setForm({ ...form, daysOfWeek: toggle(form.daysOfWeek, day) })}
                    className={cn('rounded border px-2 py-1 text-xs', form.daysOfWeek.includes(day) && 'border-primary bg-primary-soft text-primary')}
                  >
                    {day}
                  </button>
                ))}
                <span className="text-xs text-muted-foreground self-center ml-1">{form.daysOfWeek.length === 0 && 'none = every night'}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>From</Label>
                <Input type="date" value={form.startDate} min={todayString()} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>To (last night)</Label>
                <Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-[1fr_100px] gap-2">
              <div className="space-y-2">
                <Label>Change</Label>
                <select
                  value={form.action}
                  onChange={(e) => {
                    setForm({ ...form, action: e.target.value });
                    setPreview(null);
                  }}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background h-9"
                >
                  {ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              {!['reset_to_pms_rate', 'close', 'open'].includes(form.action) && (
                <div className="space-y-2">
                  <Label>Value</Label>
                  <Input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                </div>
              )}
            </div>
          </div>

          {preview && (
            <div className="rounded-md border border-primary/30 bg-primary-soft p-3 text-sm space-y-1">
              <div className="font-medium text-primary-soft-foreground">{preview.summary}</div>
              {preview.details.map((line) => (
                <div key={line} className="text-primary-soft-foreground">
                  {line}
                </div>
              ))}
              {preview.warnings.map((line) => (
                <div key={line} className="text-warning-soft-foreground">
                  {line}
                </div>
              ))}
            </div>
          )}
          {message && <div className={cn('text-sm', message.ok ? 'text-success-soft-foreground' : 'text-destructive')}>{message.text}</div>}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => submit(true)} disabled={working}>
              Preview
            </Button>
            <Button onClick={() => submit(false)} disabled={working || !preview}>
              {working && <Loader2 className="h-4 w-4 animate-spin" />}
              Apply & push
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const PROMOTION_TYPES = [
  { value: 'BASIC', label: 'Basic deal' },
  { value: 'EARLY_BOOKER', label: 'Early booker' },
  { value: 'LAST_MINUTE', label: 'Last minute' },
  { value: 'MULTI_NIGHT', label: 'Multi-night' },
];

function PromotionsTab({ connection, onChanged }: { connection: Connection; onChanged: () => void }) {
  const [form, setForm] = useState({
    name: '',
    type: 'BASIC',
    discountPercent: '10',
    stayStart: todayString(),
    stayEnd: addDays(todayString(), 30),
    bookEnd: '',
    minStay: '',
    days: '',
  });
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const create = async () => {
    setWorking('create');
    setMessage(null);
    try {
      const [promotion] = await apiJson(
        await fetch('/api/admin/channels/promotions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionIds: [connection.id],
            name: form.name,
            type: form.type,
            discountPercent: Number(form.discountPercent),
            stayStart: form.stayStart,
            stayEnd: form.stayEnd,
            bookStart: null,
            bookEnd: form.bookEnd || null,
            minStay: form.minStay ? Number(form.minStay) : null,
            minDaysInAdvance: form.type === 'EARLY_BOOKER' && form.days ? Number(form.days) : null,
            maxDaysInAdvance: form.type === 'LAST_MINUTE' && form.days ? Number(form.days) : null,
            roomTypeIds: [],
          }),
        })
      );
      setMessage(
        promotion.status === 'FAILED'
          ? { ok: false, text: `Saved but not published: ${promotion.lastError}` }
          : { ok: true, text: `"${promotion.name}" published on ${CHANNEL_NAMES[connection.channel]}` }
      );
      setForm({ ...form, name: '' });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Failed to create promotion' });
    } finally {
      setWorking(null);
    }
  };

  const setActive = async (promotion: Promotion, active: boolean) => {
    setWorking(promotion.id);
    setMessage(null);
    try {
      await apiJson(
        await fetch(`/api/admin/channels/promotions/${promotion.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active }),
        })
      );
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Update failed' });
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardContent className="pt-6">
          {connection.promotions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No promotions yet.</p>
          ) : (
            <ul className="divide-y">
              {connection.promotions.map((p) => (
                <li key={p.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      -{p.discountPercent}% &middot; {PROMOTION_TYPES.find((t) => t.value === p.type)?.label} &middot; stays {p.stayStart} to {p.stayEnd}
                      {p.minStay ? ` · min ${p.minStay} nights` : ''}
                      {p.minDaysInAdvance ? ` · book ${p.minDaysInAdvance}+ days ahead` : ''}
                      {p.maxDaysInAdvance ? ` · within ${p.maxDaysInAdvance} days` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {p.externalId ? `OTA ID ${p.externalId}` : 'Not on the OTA'} {p.createdBy && `· by ${p.createdBy}`}
                    </div>
                    {p.lastError && <div className="text-xs text-destructive mt-0.5">{p.lastError}</div>}
                  </div>
                  <Button size="sm" variant="outline" disabled={working === p.id} onClick={() => setActive(p, p.status !== 'ACTIVE')}>
                    {working === p.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    {p.status === 'ACTIVE' ? 'Pause' : p.status === 'FAILED' ? 'Retry' : 'Resume'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">New promotion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Winter getaway" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Type</Label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border rounded-md px-2 py-2 text-sm bg-background h-9">
                {PROMOTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Discount %</Label>
              <Input type="number" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Stays from</Label>
              <Input type="date" value={form.stayStart} onChange={(e) => setForm({ ...form, stayStart: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Stays until</Label>
              <Input type="date" value={form.stayEnd} onChange={(e) => setForm({ ...form, stayEnd: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Bookable until</Label>
              <Input type="date" value={form.bookEnd} onChange={(e) => setForm({ ...form, bookEnd: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Min nights</Label>
              <Input type="number" min={1} value={form.minStay} onChange={(e) => setForm({ ...form, minStay: e.target.value })} />
            </div>
          </div>
          {(form.type === 'EARLY_BOOKER' || form.type === 'LAST_MINUTE') && (
            <div className="space-y-1">
              <Label>{form.type === 'EARLY_BOOKER' ? 'Book at least (days ahead)' : 'Book within (days)'}</Label>
              <Input type="number" min={1} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
            </div>
          )}
          {message && <div className={cn('text-sm', message.ok ? 'text-success-soft-foreground' : 'text-destructive')}>{message.text}</div>}
          <Button onClick={create} disabled={working === 'create' || !form.name}>
            {working === 'create' && <Loader2 className="h-4 w-4 animate-spin" />}
            Publish promotion
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ReservationsTab({ connection }: { connection: Connection }) {
  return (
    <Card>
      <CardContent className="pt-6 overflow-x-auto">
        {connection.reservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reservations yet.{connection.mode === 'SANDBOX' && ' Use "Simulate booking" to send a test reservation through the import.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">OTA #</th>
                <th className="py-2 pr-3">Guest</th>
                <th className="py-2 pr-3">Room</th>
                <th className="py-2 pr-3">Stay</th>
                <th className="py-2 pr-3">Total</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {connection.reservations.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs">{r.externalId}</td>
                  <td className="py-2 pr-3">{r.guestName}</td>
                  <td className="py-2 pr-3">
                    {r.booking ? `${r.booking.rooms} × ${r.booking.roomType.name}` : '-'}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.booking ? `${r.booking.checkIn.slice(0, 10)} to ${r.booking.checkOut.slice(0, 10)}` : '-'}</td>
                  <td className="py-2 pr-3">{r.totalAmount ? `${r.currency ?? ''} ${Number(r.totalAmount).toFixed(2)}` : '-'}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {timeAgo(r.receivedAt)}
                    {r.booking && (
                      <Link href={`/admin/bookings/${r.booking.id}`} className="block text-primary hover:underline">
                        Open booking
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsTab({ connection, onSaved, onDeleted }: { connection: Connection; onSaved: (message: string) => void; onDeleted: () => void }) {
  const [settings, setSettings] = useState({
    defaultMarkupPercent: connection.defaultMarkupPercent,
    syncRates: connection.syncRates,
    syncAvailability: connection.syncAvailability,
    importReservations: connection.importReservations,
    syncWindowDays: connection.syncWindowDays,
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setWorking(true);
    setError('');
    try {
      const markupChanged = settings.defaultMarkupPercent !== connection.defaultMarkupPercent;
      const { defaultMarkupPercent, ...rest } = settings;
      await apiJson(
        await fetch(`/api/admin/channels/${connection.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rest),
        })
      );
      // Markup changes go through the rates API so the new prices are pushed right away
      if (markupChanged) {
        await apiJson(
          await fetch('/api/admin/channels/rates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'markup', connectionId: connection.id, roomTypeId: null, markupPercent: defaultMarkupPercent }),
          })
        );
      }
      onSaved('Settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setWorking(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(`Disconnect ${CHANNEL_NAMES[connection.channel]}? Existing PMS bookings are kept, but rates and reservations stop syncing.`)) return;
    try {
      await apiJson(await fetch(`/api/admin/channels/${connection.id}`, { method: 'DELETE' }));
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sync settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Default markup %</Label>
              <Input
                type="number"
                value={settings.defaultMarkupPercent}
                onChange={(e) => setSettings({ ...settings, defaultMarkupPercent: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>Days open for booking</Label>
              <Input type="number" value={settings.syncWindowDays} onChange={(e) => setSettings({ ...settings, syncWindowDays: Number(e.target.value) })} />
            </div>
          </div>
          {(
            [
              ['syncRates', 'Send rates'],
              ['syncAvailability', 'Send availability & restrictions'],
              ['importReservations', 'Import reservations'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          {error && <div className="text-sm text-destructive">{error}</div>}
          <Button onClick={save} disabled={working}>
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Room mapping</CardTitle>
          <CardDescription>
            <Link href={`/admin/channels/connect?connectionId=${connection.id}`} className="text-primary hover:underline">
              Edit mapping and credentials
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="text-sm divide-y">
            {connection.roomMappings.map((m) => (
              <li key={m.roomTypeId} className="py-2 flex justify-between gap-2">
                <span className={cn(!m.isActive && 'text-muted-foreground line-through')}>{m.roomType.name}</span>
                <span className="text-muted-foreground text-right">
                  {m.otaRoomTypeName ?? m.otaRoomTypeId} / {m.otaRatePlanName ?? m.otaRatePlanId}
                  {m.markupPercent !== null && ` · +${m.markupPercent}%`}
                  {m.inventoryAllocation !== null && ` · max ${m.inventoryAllocation}`}
                </span>
              </li>
            ))}
          </ul>
          {connection.connectivityProvider && (
            <p className="text-sm text-muted-foreground">Connected through {connection.connectivityProvider === 'CHANNEX' ? 'Channex' : connection.connectivityProvider}.</p>
          )}
          {connection.webhookUrl && (
            <div className="space-y-1">
              <Label htmlFor="webhookUrl">Reservation webhook URL</Label>
              <Input id="webhookUrl" readOnly value={connection.webhookUrl} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
            </div>
          )}
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={disconnect}>
            <Trash2 className="h-4 w-4" />
            Disconnect {CHANNEL_NAMES[connection.channel]}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
