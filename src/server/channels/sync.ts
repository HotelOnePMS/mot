import { after } from 'next/server';
import type { Prisma, SyncLogStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAdapter } from './adapters';
import { buildAriUpdates, computeChannelDays, loadConnection } from './ari';
import { addDays, hotelToday, toISODate } from './dates';
import { ChannelApiError } from './types';

export async function logSync(
  connectionId: string,
  action: string,
  status: SyncLogStatus,
  message: string,
  details?: unknown
): Promise<void> {
  try {
    await prisma.channelSyncLog.create({
      data: {
        connectionId,
        action,
        status,
        message: message.slice(0, 1000),
        details: details === undefined ? undefined : (JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    console.error('Failed to write channel sync log:', error);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ChannelApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface AriPushOptions {
  from?: string;
  to?: string;
  roomTypeIds?: string[];
  /** Push even when the connection isn't ACTIVE (used during activation) */
  force?: boolean;
}

export interface AriPushSummary {
  connectionId: string;
  pushed: boolean;
  updates: number;
  requests: number;
  from: string;
  to: string;
  message: string;
}

/** Pushes availability, rates and restrictions for a connection to its OTA */
export async function pushAri(connectionId: string, options: AriPushOptions = {}): Promise<AriPushSummary> {
  const connection = await loadConnection(connectionId);
  if (!connection) throw new ChannelApiError('Channel connection not found');

  const today = hotelToday();
  const lastDay = addDays(today, connection.syncWindowDays - 1);
  const from = options.from && options.from > today ? options.from : today;
  const to = options.to && options.to < lastDay ? options.to : lastDay;
  const base = { connectionId, from, to, updates: 0, requests: 0 };

  if (!options.force && connection.status !== 'ACTIVE' && connection.status !== 'ERROR') {
    return { ...base, pushed: false, message: `Skipped: connection is ${connection.status.toLowerCase()}` };
  }
  if (!connection.syncRates && !connection.syncAvailability) {
    return { ...base, pushed: false, message: 'Skipped: rate and availability sync are both off' };
  }
  if (from > to) {
    return { ...base, pushed: false, message: 'Skipped: dates are outside the sync window' };
  }

  try {
    const days = await computeChannelDays(connection, from, to, options.roomTypeIds);
    const updates = buildAriUpdates(connection, days);
    if (updates.length === 0) {
      return { ...base, pushed: false, message: 'Nothing to push: no mapped room types' };
    }

    const adapter = await getAdapter(connection);
    const result = await adapter.pushAri(updates);
    const message = `Pushed ${result.updates} updates (${from} to ${to}) in ${result.requests} request(s)`;

    await prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        lastAriSyncAt: new Date(),
        lastError: null,
        ...(connection.status === 'ERROR' ? { status: 'ACTIVE' } : {}),
      },
    });
    await logSync(connectionId, 'ARI_PUSH', 'SUCCESS', message, {
      from,
      to,
      roomTypeIds: options.roomTypeIds ?? null,
      warnings: result.warnings,
      sample: updates.slice(0, 5),
    });
    return { ...base, pushed: true, updates: result.updates, requests: result.requests, message };
  } catch (error) {
    const message = errorMessage(error);
    await prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        lastError: message,
        ...(connection.status === 'ACTIVE' ? { status: 'ERROR' } : {}),
      },
    });
    await logSync(connectionId, 'ARI_PUSH', 'FAILED', message, {
      from,
      to,
      details: error instanceof ChannelApiError ? error.otaDetails : undefined,
    });
    throw error;
  }
}

/** Pushes the given room type's dates to every active connection that sells it */
export async function syncRoomTypeToChannels(roomTypeId: string, from: string, to: string): Promise<AriPushSummary[]> {
  const connections = await prisma.channelConnection.findMany({
    where: {
      status: { in: ['ACTIVE', 'ERROR'] },
      roomMappings: { some: { roomTypeId, isActive: true } },
    },
    select: { id: true },
  });

  const results: AriPushSummary[] = [];
  for (const { id } of connections) {
    try {
      results.push(await pushAri(id, { from, to, roomTypeIds: [roomTypeId] }));
    } catch (error) {
      console.error(`ARI push to connection ${id} failed:`, error);
    }
  }
  return results;
}

/** Runs after the response is sent (never delays or fails the PMS operation that triggered it). */
function inBackground(run: () => Promise<unknown>): void {
  const safe = () => run().catch((error) => console.error('Scheduled channel sync failed:', error));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/**
 * Channel update after a booking or rate change, in the background.
 * Never throws, so PMS operations don't fail because an OTA is unreachable.
 * `checkOut` is exclusive (the departure date), like a booking.
 */
export function scheduleInventorySync(roomTypeId: string, checkIn: Date | string, checkOut: Date | string): void {
  const from = toISODate(checkIn);
  const lastNight = addDays(toISODate(checkOut), -1);
  const to = lastNight < from ? from : lastNight;
  inBackground(() => syncRoomTypeToChannels(roomTypeId, from, to));
}

/** Same as scheduleInventorySync but for an inclusive list of changed dates */
export function scheduleRateSync(roomTypeId: string, dates: string[]): void {
  if (dates.length === 0) return;
  const sorted = [...dates].sort();
  scheduleInventorySync(roomTypeId, sorted[0], addDays(sorted[sorted.length - 1], 1));
}

/** Every active connection that sells any of the property's room types, for the whole sync window (room count or base price changed). */
export function schedulePropertySync(propertyId: string): void {
  inBackground(async () => {
    const connections = await prisma.channelConnection.findMany({
      where: { propertyId, status: { in: ['ACTIVE', 'ERROR'] } },
      select: { id: true },
    });
    for (const { id } of connections) {
      await pushAri(id).catch((error) => console.error(`ARI push to connection ${id} failed:`, error));
    }
  });
}
