'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { AlertCircle, Bot, Globe, Loader2, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { PageShell } from '@/components/console/PageShell';
import { useConsole } from '@/components/console/ConsoleProvider';
import { CHANNEL_NAMES, ChannelBadge, ModeBadge, StatusBadge, timeAgo } from '@/components/channels/ChannelBadges';
import { channelInfo } from '@/lib/channels/catalog';

type Connection = {
  id: string;
  channel: string;
  mode: string;
  status: string;
  otaPropertyId: string | null;
  otaPropertyName: string | null;
  defaultMarkupPercent: number;
  lastAriSyncAt: string | null;
  lastReservationPullAt: string | null;
  lastError: string | null;
  _count: { roomMappings: number; promotions: number; reservations: number };
};

type Overview = {
  channels: string[];
  property: {
    id: string;
    name: string;
    city: string;
    state: string;
    setupPath: string;
    _count: { roomTypes: number };
    channelConnections: Connection[];
  } | null;
  recentReservations: Array<{
    id: string;
    externalId: string;
    status: string;
    guestName: string | null;
    receivedAt: string;
    connection: { channel: string };
    booking: { id: string; code: string | null; checkIn: string; checkOut: string; status: string; roomType: { name: string } } | null;
  }>;
  recentLogs: Array<{
    id: string;
    action: string;
    status: string;
    message: string;
    createdAt: string;
    connection: { channel: string };
  }>;
};


export default function ChannelsPage() {
  const { propertyId, can } = useConsole();
  const key = propertyId ? `/api/admin/channels?propertyId=${propertyId}` : null;
  const { data, error, isLoading, mutate } = useSWR<Overview>(key, fetcher);
  const [syncing, setSyncing] = React.useState<string | null>(null);
  const [syncError, setSyncError] = React.useState('');
  const canManage = can('channels.manage');

  const syncNow = async (connectionId: string) => {
    setSyncing(connectionId);
    setSyncError('');
    try {
      await api(`/api/admin/channels/${connectionId}/sync`, { method: 'POST', json: { type: 'all' } });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(null);
      mutate();
    }
  };

  const property = data?.property;
  const takesBookings = property?.setupPath === 'FULL';

  return (
    <PageShell
      title="Channels"
      description="Sell your rooms on Expedia, Booking.com, Google, Airbnb and more, and keep their rates and availability in step with HotelOne."
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => mutate()}>
            <RefreshCw aria-hidden /> Refresh
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/channels/agent">
              <Bot aria-hidden /> Ask the channel agent
            </Link>
          </Button>
        </>
      }
    >
      {(error || syncError) && <Callout tone="danger">{syncError || error?.message}</Callout>}

      {isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy>
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : !property ? (
        <Card>
          <EmptyState icon={Globe} title="No property yet" description="Add a property first, then connect it to the OTAs." />
        </Card>
      ) : !takesBookings ? (
        <Callout tone="info" title="Channels are for hotels that take bookings in HotelOne">
          {property.name} keeps its reservations in its own system, so HotelOne can’t tell the OTAs what’s free. Connect the OTAs in your
          own PMS or channel manager instead.
        </Callout>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.channels.map((channel) => {
            const connection = property.channelConnections.find((c) => c.channel === channel);
            if (!connection) {
              return (
                <Card key={channel} className="flex flex-col gap-3 border-dashed p-5">
                  <div className="flex items-center justify-between">
                    <ChannelBadge channel={channel} />
                    <span className="text-xs text-muted-foreground">Not connected</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{channelInfo(channel)?.reach}</p>
                  {canManage ? (
                    <Button asChild variant="outline" size="sm" className="self-start">
                      <Link href={`/admin/channels/connect?propertyId=${property.id}&channel=${channel}`}>
                        <Plus aria-hidden /> Connect {CHANNEL_NAMES[channel]}
                      </Link>
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Ask the hotel owner to connect it.</p>
                  )}
                </Card>
              );
            }

            const live = ['ACTIVE', 'PAUSED', 'ERROR'].includes(connection.status);
            return (
              <Card key={channel} className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <ChannelBadge channel={channel} />
                  <div className="flex items-center gap-2">
                    <ModeBadge mode={connection.mode} />
                    <StatusBadge status={connection.status} />
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div>
                    {connection.otaPropertyName || 'OTA property'}{' '}
                    {connection.otaPropertyId && <span className="text-muted-foreground">#{connection.otaPropertyId}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{connection._count.roomMappings} rooms mapped</span>
                    <span>{connection.defaultMarkupPercent}% markup</span>
                    <span>{connection._count.promotions} active promotions</span>
                    <span>{connection._count.reservations} OTA bookings</span>
                  </div>
                  {live && <div className="text-xs text-muted-foreground">Last rate push {timeAgo(connection.lastAriSyncAt)}</div>}
                  {connection.lastError && (
                    <div className="flex items-start gap-1 text-xs text-destructive">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {connection.lastError}
                    </div>
                  )}
                </div>
                <div className="mt-auto flex gap-2">
                  {live ? (
                    <>
                      <Button asChild size="sm">
                        <Link href={`/admin/channels/${connection.id}`}>
                          <Settings2 aria-hidden /> Manage
                        </Link>
                      </Button>
                      <Button size="sm" variant="outline" disabled={syncing === connection.id} onClick={() => syncNow(connection.id)}>
                        {syncing === connection.id ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                        Sync now
                      </Button>
                    </>
                  ) : canManage ? (
                    <Button asChild size="sm">
                      <Link href={`/admin/channels/connect?connectionId=${connection.id}`}>Continue setup</Link>
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Setup in progress.</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {data && takesBookings && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Latest OTA reservations</CardTitle>
            </CardHeader>
            <CardContent>
              {!data.recentReservations.length ? (
                <p className="text-sm text-muted-foreground">No reservations received yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {data.recentReservations.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ChannelBadge channel={r.connection.channel} />
                          <span className="truncate font-medium">{r.guestName}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          #{r.externalId}
                          {r.booking && (
                            <>
                              {' '}
                              &middot; {r.booking.roomType.name}, {r.booking.checkIn.slice(0, 10)} to {r.booking.checkOut.slice(0, 10)}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <StatusBadge status={r.status} />
                        {r.booking && (
                          <Link href={`/admin/bookings/${r.booking.id}`} className="mt-1 block text-xs text-primary hover:underline">
                            {r.booking.code ? `Open ${r.booking.code}` : 'Open reservation'}
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sync activity</CardTitle>
            </CardHeader>
            <CardContent>
              {!data.recentLogs.length ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Globe className="size-4" aria-hidden />
                  Connect a channel to start syncing.
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {data.recentLogs.map((log) => (
                    <li key={log.id} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ChannelBadge channel={log.connection.channel} />
                          <span className="font-mono text-xs text-muted-foreground">{log.action}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{timeAgo(log.createdAt)}</span>
                      </div>
                      <div className={`mt-1 text-xs ${log.status === 'FAILED' ? 'text-destructive' : 'text-muted-foreground'}`}>{log.message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
