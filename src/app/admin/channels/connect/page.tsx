'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Rocket, ShieldCheck } from 'lucide-react';
import { apiJson, CHANNEL_NAMES, ChannelBadge, ModeBadge, StatusBadge } from '@/components/channels/ChannelBadges';
import { cn } from '@/lib/utils';
import { useConsole } from '@/components/console/ConsoleProvider';

type Connection = {
  id: string;
  propertyId: string;
  channel: string;
  mode: 'SANDBOX' | 'LIVE';
  status: string;
  otaPropertyId: string | null;
  otaPropertyName: string | null;
  username: string | null;
  hasPassword: boolean;
  currency: string;
  defaultMarkupPercent: number;
  syncRates: boolean;
  syncAvailability: boolean;
  importReservations: boolean;
  syncWindowDays: number;
  roomMappings?: Array<{ roomTypeId: string; isActive: boolean }>;
  property?: { id: string; name: string };
};

type OtaRoom = { id: string; name: string; ratePlans: { id: string; name: string }[] };
type MappingRow = {
  roomTypeId: string;
  otaRoomTypeId: string | null;
  otaRatePlanId: string | null;
  markupPercent: number | null;
  inventoryAllocation: number | null;
  isActive: boolean;
  suggested: boolean;
};
type MappingOptions = {
  otaRooms: OtaRoom[];
  pmsRoomTypes: { id: string; name: string; basePrice: number; totalRooms: number }[];
  mappings: MappingRow[];
};

const STEPS = ['Channel', 'Connect', 'Map rooms', 'Pricing & sync', 'Go live'];

const CREDENTIAL_HELP: Record<string, { idLabel: string; userLabel: string; steps: string[] }> = {
  EXPEDIA: {
    idLabel: 'Expedia Hotel ID',
    userLabel: 'EQC API username',
    steps: [
      'In Expedia Partner Central, open the property and choose this PMS as its connectivity provider.',
      'Use the Expedia QuickConnect (EQC) API username and password issued to your connectivity account.',
      'The Hotel ID is the numeric property ID shown in Partner Central.',
    ],
  },
  BOOKING_COM: {
    idLabel: 'Booking.com Hotel ID',
    userLabel: 'Machine account username',
    steps: [
      'In the Booking.com Extranet, go to Account > Connectivity provider and select this PMS.',
      'Use the machine account credentials issued to your connectivity-provider account.',
      'The Hotel ID is the property ID shown at the top of the Extranet.',
    ],
  },
};

function ConnectWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const connectionId = searchParams.get('connectionId');

  const { ctx, propertyId: consolePropertyId } = useConsole();
  // Channels are for hotels that take their bookings in HotelOne.
  const properties = (ctx?.properties ?? []).filter((p) => p.setupPath === 'FULL');
  const [step, setStep] = useState(0);
  const [taken, setTaken] = useState<string[]>([]);
  const [propertyId, setPropertyId] = useState(searchParams.get('propertyId') ?? '');
  const [channel, setChannel] = useState(searchParams.get('channel') ?? 'EXPEDIA');
  const [mode, setMode] = useState<'SANDBOX' | 'LIVE'>('SANDBOX');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [credentials, setCredentials] = useState({ otaPropertyId: '', username: '', password: '', currency: 'USD' });
  const [options, setOptions] = useState<MappingOptions | null>(null);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [settings, setSettings] = useState({ defaultMarkupPercent: 0, syncRates: true, syncAvailability: true, importReservations: true, syncWindowDays: 365 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // ID of the connection already loaded, so the URL change after creating
  // one doesn't trigger a second load that would reset the form mid-typing
  const loadedId = useRef<string | null>(null);

  const loadConnection = useCallback(async (id: string, jumpToStep: boolean) => {
    loadedId.current = id;
    const data = await apiJson<Connection>(await fetch(`/api/admin/channels/${id}`, { cache: 'no-store' }));
    setConnection(data);
    setChannel(data.channel);
    setMode(data.mode);
    setPropertyId(data.propertyId);
    setCredentials({ otaPropertyId: data.otaPropertyId ?? '', username: data.username ?? '', password: '', currency: data.currency });
    setSettings({
      defaultMarkupPercent: data.defaultMarkupPercent,
      syncRates: data.syncRates,
      syncAvailability: data.syncAvailability,
      importReservations: data.importReservations,
      syncWindowDays: data.syncWindowDays,
    });
    if (jumpToStep) {
      const mapped = (data.roomMappings ?? []).some((m) => m.isActive);
      setStep(data.status === 'DRAFT' ? 1 : !mapped ? 2 : data.status === 'CONNECTED' ? 3 : 4);
    }
    return data;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (connectionId && connectionId !== loadedId.current) await loadConnection(connectionId, true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    if (!propertyId && consolePropertyId) setPropertyId(consolePropertyId);
  }, [propertyId, consolePropertyId]);

  // Channels this property already started, so the picker can say so
  useEffect(() => {
    if (!propertyId) return;
    fetch(`/api/admin/channels?propertyId=${propertyId}`, { cache: 'no-store' })
      .then((r) => apiJson(r))
      .then((overview) => setTaken((overview.property?.channelConnections ?? []).map((c: { channel: string }) => c.channel)))
      .catch(() => setTaken([]));
  }, [propertyId]);

  // Load OTA rooms when entering the mapping step
  useEffect(() => {
    if (step !== 2 || !connection) return;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const data = await apiJson<MappingOptions>(await fetch(`/api/admin/channels/${connection.id}/mappings`, { cache: 'no-store' }));
        setOptions(data);
        setMappings(data.mappings);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load rooms from the OTA');
      } finally {
        setBusy(false);
      }
    })();
  }, [step, connection]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const startConnection = () =>
    run(async () => {
      const created = await apiJson<Connection>(
        await fetch('/api/admin/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId, channel, mode }),
        })
      );
      if (created.mode !== mode) {
        await apiJson(
          await fetch(`/api/admin/channels/${created.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
          })
        );
      }
      const loading = loadConnection(created.id, false);
      router.replace(`/admin/channels/connect?connectionId=${created.id}`);
      await loading;
      setStep(1);
    });

  const saveAndTest = () =>
    run(async () => {
      if (!connection) return;
      await apiJson(
        await fetch(`/api/admin/channels/${connection.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            otaPropertyId: credentials.otaPropertyId,
            username: credentials.username,
            currency: credentials.currency.toUpperCase(),
            ...(credentials.password ? { password: credentials.password } : {}),
          }),
        })
      );
      const result = await apiJson(await fetch(`/api/admin/channels/${connection.id}/test`, { method: 'POST' }));
      setNotice(result.message);
      await loadConnection(connection.id, false);
      setStep(2);
    });

  const saveMappings = () =>
    run(async () => {
      if (!connection || !options) return;
      const rows = mappings.filter((m) => m.otaRoomTypeId && m.otaRatePlanId);
      if (!rows.some((m) => m.isActive)) throw new Error('Map at least one room type');
      await apiJson(
        await fetch(`/api/admin/channels/${connection.id}/mappings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mappings: rows.map((m) => {
              const room = options.otaRooms.find((r) => r.id === m.otaRoomTypeId);
              return {
                roomTypeId: m.roomTypeId,
                otaRoomTypeId: m.otaRoomTypeId,
                otaRoomTypeName: room?.name ?? null,
                otaRatePlanId: m.otaRatePlanId,
                otaRatePlanName: room?.ratePlans.find((p) => p.id === m.otaRatePlanId)?.name ?? null,
                markupPercent: m.markupPercent,
                inventoryAllocation: m.inventoryAllocation,
                isActive: m.isActive,
              };
            }),
          }),
        })
      );
      setStep(3);
    });

  const saveSettings = () =>
    run(async () => {
      if (!connection) return;
      await apiJson(
        await fetch(`/api/admin/channels/${connection.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        })
      );
      await loadConnection(connection.id, false);
      setStep(4);
    });

  const activate = () =>
    run(async () => {
      if (!connection) return;
      const result = await apiJson(
        await fetch(`/api/admin/channels/${connection.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'activate' }),
        })
      );
      router.push(`/admin/channels/${connection.id}?activated=${encodeURIComponent(result.ari?.message ?? '')}`);
    });

  const updateMapping = (roomTypeId: string, patch: Partial<MappingRow>) =>
    setMappings((rows) => rows.map((row) => (row.roomTypeId === roomTypeId ? { ...row, ...patch } : row)));

  const help = CREDENTIAL_HELP[channel];
  const propertyName = connection?.property?.name ?? properties.find((p) => p.id === propertyId)?.name;
  const canVisit = (index: number) => {
    if (!connection) return index === 0;
    if (connection.status === 'DRAFT') return index <= 1;
    return index >= 1;
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/admin/channels" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Channels
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-bold text-foreground">Connect {CHANNEL_NAMES[channel]}</h1>
          {connection && (
            <>
              <ModeBadge mode={connection.mode} />
              <StatusBadge status={connection.status} />
            </>
          )}
        </div>
        {propertyName && <p className="text-muted-foreground">{propertyName}</p>}
      </div>

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              disabled={!canVisit(index) || busy}
              onClick={() => setStep(index)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
                step === index ? 'border-primary bg-primary-soft text-primary' : 'text-muted-foreground',
                !canVisit(index) && 'opacity-50'
              )}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs">{index + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success-soft p-3 text-sm text-success-soft-foreground">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          {notice}
        </div>
      )}

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Choose the property and channel</CardTitle>
            <CardDescription>Each property can have one Expedia and one Booking.com connection.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Property</Label>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                disabled={Boolean(connection)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Channel</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {['EXPEDIA', 'BOOKING_COM'].map((value) => {
                  const started = taken.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={Boolean(connection)}
                      onClick={() => setChannel(value)}
                      className={cn('rounded-lg border p-4 text-left', channel === value && 'border-primary ring-1 ring-primary')}
                    >
                      <ChannelBadge channel={value} />
                      <p className="text-sm text-muted-foreground mt-2">
                        {value === 'EXPEDIA' ? 'Expedia QuickConnect (EQC)' : 'Booking.com Connectivity API'}
                        {started && ' - already started for this property'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode('SANDBOX')}
                  className={cn('rounded-lg border p-4 text-left', mode === 'SANDBOX' && 'border-primary ring-1 ring-primary')}
                >
                  <div className="font-medium">Sandbox</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Simulates the OTA so you can try mapping, rate pushes, promotions and test bookings without credentials.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('LIVE')}
                  className={cn('rounded-lg border p-4 text-left', mode === 'LIVE' && 'border-primary ring-1 ring-primary')}
                >
                  <div className="font-medium">Live</div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Talks to the real {CHANNEL_NAMES[channel]} API. Requires connectivity-partner API credentials.
                  </p>
                </button>
              </div>
            </div>
            <Button onClick={startConnection} disabled={busy || !propertyId}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 1 && connection && (
        <Card>
          <CardHeader>
            <CardTitle>Connect to {CHANNEL_NAMES[channel]}</CardTitle>
            <CardDescription>
              {mode === 'SANDBOX'
                ? 'Sandbox mode only needs a property ID - any value works.'
                : 'Enter the API credentials and the property ID, then test the connection.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {mode === 'LIVE' && (
              <div className="rounded-md bg-muted/50 border p-3 text-sm text-muted-foreground space-y-1">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <ShieldCheck className="h-4 w-4" />
                  Before you connect
                </div>
                <ol className="list-decimal pl-5 space-y-1">
                  {help.steps.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex gap-2 text-sm">
              <span className="text-muted-foreground">Mode:</span>
              {(['SANDBOX', 'LIVE'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={cn('rounded-full border px-3 py-0.5', mode === value && 'border-primary bg-primary-soft text-primary')}
                >
                  {value === 'SANDBOX' ? 'Sandbox' : 'Live'}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="otaPropertyId">{help.idLabel}</Label>
                <Input
                  id="otaPropertyId"
                  value={credentials.otaPropertyId}
                  onChange={(e) => setCredentials({ ...credentials, otaPropertyId: e.target.value })}
                  placeholder={channel === 'EXPEDIA' ? 'e.g. 12345678' : 'e.g. 1234567'}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  maxLength={3}
                  value={credentials.currency}
                  onChange={(e) => setCredentials({ ...credentials, currency: e.target.value.toUpperCase() })}
                />
              </div>
              {mode === 'LIVE' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="username">{help.userLabel}</Label>
                    <Input
                      id="username"
                      autoComplete="off"
                      value={credentials.username}
                      onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      placeholder={connection.hasPassword ? 'Saved - leave blank to keep' : ''}
                      value={credentials.password}
                      onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
            <Button onClick={saveAndTest} disabled={busy || !credentials.otaPropertyId}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save & test connection
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && connection && (
        <Card>
          <CardHeader>
            <CardTitle>Map your room types</CardTitle>
            <CardDescription>
              Link each PMS room type to the {CHANNEL_NAMES[channel]} room and rate plan it should update. Suggested matches are pre-filled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {busy && !options ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading rooms from {CHANNEL_NAMES[channel]}...
              </div>
            ) : options ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-3">Sell</th>
                      <th className="py-2 pr-3">PMS room type</th>
                      <th className="py-2 pr-3">{CHANNEL_NAMES[channel]} room</th>
                      <th className="py-2 pr-3">Rate plan</th>
                      <th className="py-2 pr-3">Markup %</th>
                      <th className="py-2">Max rooms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {options.pmsRoomTypes.map((roomType) => {
                      const row = mappings.find((m) => m.roomTypeId === roomType.id)!;
                      const otaRoom = options.otaRooms.find((r) => r.id === row.otaRoomTypeId);
                      return (
                        <tr key={roomType.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            <input
                              type="checkbox"
                              checked={row.isActive}
                              onChange={(e) => updateMapping(roomType.id, { isActive: e.target.checked })}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <div className="font-medium">{roomType.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {roomType.totalRooms} rooms &middot; ${roomType.basePrice} base
                            </div>
                          </td>
                          <td className="py-2 pr-3">
                            <select
                              value={row.otaRoomTypeId ?? ''}
                              onChange={(e) => {
                                const room = options.otaRooms.find((r) => r.id === e.target.value);
                                updateMapping(roomType.id, {
                                  otaRoomTypeId: room?.id ?? null,
                                  otaRatePlanId: room?.ratePlans[0]?.id ?? null,
                                  isActive: Boolean(room),
                                });
                              }}
                              className="border rounded-md px-2 py-1 bg-background max-w-[200px]"
                            >
                              <option value="">Not sold</option>
                              {options.otaRooms.map((room) => (
                                <option key={room.id} value={room.id}>
                                  {room.name} ({room.id})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-3">
                            <select
                              value={row.otaRatePlanId ?? ''}
                              disabled={!otaRoom}
                              onChange={(e) => updateMapping(roomType.id, { otaRatePlanId: e.target.value })}
                              className="border rounded-md px-2 py-1 bg-background max-w-[200px]"
                            >
                              {(otaRoom?.ratePlans ?? []).map((plan) => (
                                <option key={plan.id} value={plan.id}>
                                  {plan.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-3">
                            <Input
                              type="number"
                              className="w-24 h-8"
                              placeholder="default"
                              value={row.markupPercent ?? ''}
                              onChange={(e) =>
                                updateMapping(roomType.id, { markupPercent: e.target.value === '' ? null : Number(e.target.value) })
                              }
                            />
                          </td>
                          <td className="py-2">
                            <Input
                              type="number"
                              min={0}
                              className="w-20 h-8"
                              placeholder="all"
                              value={row.inventoryAllocation ?? ''}
                              onChange={(e) =>
                                updateMapping(roomType.id, {
                                  inventoryAllocation: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))),
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Markup is added to the PMS rate before it is sent (leave blank to use the channel default). Max rooms caps how many rooms of
              that type this channel can sell per night.
            </p>
            <Button onClick={saveMappings} disabled={busy || !options}>
              {busy && options && <Loader2 className="h-4 w-4 animate-spin" />}
              Save mapping
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 3 && connection && (
        <Card>
          <CardHeader>
            <CardTitle>Pricing & sync</CardTitle>
            <CardDescription>Choose what this PMS keeps up to date on {CHANNEL_NAMES[channel]}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="markup">Default markup on PMS rates (%)</Label>
                <Input
                  id="markup"
                  type="number"
                  value={settings.defaultMarkupPercent}
                  onChange={(e) => setSettings({ ...settings, defaultMarkupPercent: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">E.g. 15 sends a $100 PMS rate as $115 to cover commission.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="window">Days to keep open for booking</Label>
                <Input
                  id="window"
                  type="number"
                  min={30}
                  max={730}
                  value={settings.syncWindowDays}
                  onChange={(e) => setSettings({ ...settings, syncWindowDays: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-2">
              {(
                [
                  ['syncRates', 'Send rates', 'Push PMS rates (plus markup and channel prices) to the OTA'],
                  ['syncAvailability', 'Send availability & restrictions', 'Rooms left, stop-sell and minimum stay'],
                  ['importReservations', 'Import reservations', 'New, modified and cancelled OTA bookings become PMS bookings'],
                ] as const
              ).map(([key, label, description]) => (
                <label key={key} className="flex items-start gap-3 rounded-md border p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={settings[key]}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                  />
                  <span>
                    <span className="font-medium text-sm">{label}</span>
                    <span className="block text-xs text-muted-foreground">{description}</span>
                  </span>
                </label>
              ))}
            </div>
            <Button onClick={saveSettings} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save & continue
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 4 && connection && (
        <Card>
          <CardHeader>
            <CardTitle>Go live</CardTitle>
            <CardDescription>
              Activating sends availability and rates for the next {connection.syncWindowDays} days and starts importing reservations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-muted-foreground">Property</dt>
              <dd>{propertyName}</dd>
              <dt className="text-muted-foreground">{CHANNEL_NAMES[channel]} property</dt>
              <dd>
                {connection.otaPropertyName} (#{connection.otaPropertyId})
              </dd>
              <dt className="text-muted-foreground">Mode</dt>
              <dd>
                <ModeBadge mode={connection.mode} />
              </dd>
              <dt className="text-muted-foreground">Rooms mapped</dt>
              <dd>{(connection.roomMappings ?? []).filter((m) => m.isActive).length}</dd>
              <dt className="text-muted-foreground">Default markup</dt>
              <dd>{connection.defaultMarkupPercent}%</dd>
            </dl>
            {connection.status === 'ACTIVE' ? (
              <Button asChild>
                <Link href={`/admin/channels/${connection.id}`}>Connection is live - manage it</Link>
              </Button>
            ) : (
              <Button onClick={activate} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Activate {CHANNEL_NAMES[channel]}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
    </div>
  );
}

export default function ConnectChannelPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <ConnectWizard />
    </Suspense>
  );
}
