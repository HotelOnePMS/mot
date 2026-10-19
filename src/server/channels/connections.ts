import type { ChannelConnection, ChannelMode, OtaChannel } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAdapter, sealPassword } from './adapters';
import { addDays, todayAt } from './dates';
import { pullReservations } from './reservations';
import { errorMessage, logSync, pushAri } from './sync';
import { CHANNEL_LABELS, ChannelApiError, OtaRoomType } from './types';

export const CHANNELS: OtaChannel[] = ['EXPEDIA', 'BOOKING_COM'];

/** Connection as returned by the API - credentials are never sent back */
export function serializeConnection(connection: ChannelConnection & Record<string, unknown>) {
  const { passwordCipher, ...rest } = connection;
  return {
    ...rest,
    channelLabel: CHANNEL_LABELS[connection.channel],
    defaultMarkupPercent: Number(connection.defaultMarkupPercent),
    hasPassword: Boolean(passwordCipher),
  };
}

export async function createConnection(propertyId: string, channel: OtaChannel, mode: ChannelMode) {
  if (!CHANNELS.includes(channel)) throw new ChannelApiError(`Unsupported channel ${channel}`);
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, setupPath: true } });
  if (!property) throw new ChannelApiError('Property not found');
  // Bridge and voice-only hotels keep their bookings in their own system, so HotelOne can't tell an OTA what's free.
  if (property.setupPath !== 'FULL') {
    throw new ChannelApiError('The channel manager is for hotels that take their bookings in HotelOne.');
  }

  const existing = await prisma.channelConnection.findUnique({
    where: { propertyId_channel: { propertyId, channel } },
  });
  if (existing) return existing;
  return prisma.channelConnection.create({ data: { propertyId, channel, mode } });
}

export interface ConnectionSettings {
  mode?: ChannelMode;
  otaPropertyId?: string;
  username?: string;
  /** Only replaced when a non-empty value is sent */
  password?: string;
  currency?: string;
  defaultMarkupPercent?: number;
  syncRates?: boolean;
  syncAvailability?: boolean;
  importReservations?: boolean;
  syncWindowDays?: number;
}

export async function updateConnectionSettings(connectionId: string, settings: ConnectionSettings) {
  const connection = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new ChannelApiError('Channel connection not found');

  if (settings.defaultMarkupPercent !== undefined && (settings.defaultMarkupPercent < -50 || settings.defaultMarkupPercent > 100)) {
    throw new ChannelApiError('Markup must be between -50% and 100%');
  }
  if (settings.syncWindowDays !== undefined && (settings.syncWindowDays < 30 || settings.syncWindowDays > 730)) {
    throw new ChannelApiError('Sync window must be between 30 and 730 days');
  }
  if (settings.currency !== undefined && !/^[A-Z]{3}$/.test(settings.currency)) {
    throw new ChannelApiError('Currency must be a 3-letter ISO code');
  }

  const credentialsChanged =
    (settings.mode !== undefined && settings.mode !== connection.mode) ||
    (settings.otaPropertyId !== undefined && settings.otaPropertyId !== connection.otaPropertyId) ||
    (settings.username !== undefined && settings.username !== connection.username) ||
    Boolean(settings.password);

  return prisma.channelConnection.update({
    where: { id: connectionId },
    data: {
      mode: settings.mode,
      otaPropertyId: settings.otaPropertyId?.trim(),
      username: settings.username?.trim(),
      passwordCipher: settings.password ? sealPassword(connectionId, settings.password) : undefined,
      currency: settings.currency,
      defaultMarkupPercent: settings.defaultMarkupPercent,
      syncRates: settings.syncRates,
      syncAvailability: settings.syncAvailability,
      importReservations: settings.importReservations,
      syncWindowDays: settings.syncWindowDays,
      // New credentials have to be verified again before syncing
      ...(credentialsChanged && connection.status !== 'DRAFT' ? { status: 'DRAFT' } : {}),
    },
  });
}

export async function testConnection(connectionId: string) {
  const connection = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new ChannelApiError('Channel connection not found');
  if (!connection.otaPropertyId) throw new ChannelApiError(`Enter your ${CHANNEL_LABELS[connection.channel]} property ID`);
  if (connection.mode === 'LIVE' && (!connection.username || !connection.passwordCipher)) {
    throw new ChannelApiError('Enter the API username and password');
  }

  try {
    const adapter = await getAdapter(connection);
    const result = await adapter.testConnection();
    const updated = await prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        otaPropertyName: result.otaPropertyName ?? connection.otaPropertyName,
        lastError: null,
        ...(connection.status === 'DRAFT' ? { status: 'CONNECTED' } : {}),
      },
    });
    await logSync(connectionId, 'CONNECTION_TEST', 'SUCCESS', result.message);
    return { ...result, connection: updated };
  } catch (error) {
    const message = errorMessage(error);
    await prisma.channelConnection.update({ where: { id: connectionId }, data: { lastError: message } });
    await logSync(connectionId, 'CONNECTION_TEST', 'FAILED', message);
    throw error instanceof ChannelApiError ? error : new ChannelApiError(message);
  }
}

function normalize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['room', 'the', 'with', 'and'].includes(word));
}

/** Best OTA room for a PMS room type, by shared words in the names */
function suggestRoom(pmsName: string, otaRooms: OtaRoomType[]): OtaRoomType | undefined {
  const words = new Set(normalize(pmsName));
  let best: OtaRoomType | undefined;
  let bestScore = 0;
  for (const room of otaRooms) {
    const score = normalize(room.name).filter((word) => words.has(word)).length;
    if (score > bestScore) {
      best = room;
      bestScore = score;
    }
  }
  return best;
}

/** OTA room types + PMS room types, with existing or suggested mappings */
export async function getMappingOptions(connectionId: string) {
  const connection = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    include: { roomMappings: true },
  });
  if (!connection) throw new ChannelApiError('Channel connection not found');
  if (connection.status === 'DRAFT') throw new ChannelApiError('Verify the connection before mapping rooms');

  let otaRooms: OtaRoomType[];
  try {
    otaRooms = await (await getAdapter(connection)).fetchRoomTypes();
    await logSync(connectionId, 'ROOM_FETCH', 'SUCCESS', `Fetched ${otaRooms.length} room types`);
  } catch (error) {
    await logSync(connectionId, 'ROOM_FETCH', 'FAILED', errorMessage(error));
    throw error;
  }

  const pmsRoomTypes = await prisma.roomType.findMany({
    where: { propertyId: connection.propertyId, isActive: true },
    select: { id: true, name: true, basePrice: true, totalRooms: true },
    orderBy: { name: 'asc' },
  });

  const rows = pmsRoomTypes.map((roomType) => {
    const existing = connection.roomMappings.find((m) => m.roomTypeId === roomType.id);
    if (existing) {
      return {
        roomTypeId: roomType.id,
        otaRoomTypeId: existing.otaRoomTypeId,
        otaRatePlanId: existing.otaRatePlanId,
        markupPercent: existing.markupPercent === null ? null : Number(existing.markupPercent),
        inventoryAllocation: existing.inventoryAllocation,
        isActive: existing.isActive,
        suggested: false,
      };
    }
    const room = suggestRoom(roomType.name, otaRooms);
    const ratePlan = room?.ratePlans.find((p) => /standard|flexible|refundable/i.test(p.name) && !/non/i.test(p.name)) ?? room?.ratePlans[0];
    return {
      roomTypeId: roomType.id,
      otaRoomTypeId: room?.id ?? null,
      otaRatePlanId: ratePlan?.id ?? null,
      markupPercent: null,
      inventoryAllocation: null,
      isActive: Boolean(room && ratePlan),
      suggested: Boolean(room),
    };
  });

  return {
    otaRooms,
    pmsRoomTypes: pmsRoomTypes.map((rt) => ({ ...rt, basePrice: Number(rt.basePrice) })),
    mappings: rows,
  };
}

export interface MappingInput {
  roomTypeId: string;
  otaRoomTypeId: string;
  otaRoomTypeName?: string | null;
  otaRatePlanId: string;
  otaRatePlanName?: string | null;
  markupPercent: number | null;
  inventoryAllocation: number | null;
  isActive: boolean;
}

/** Replaces the connection's room mappings */
export async function saveMappings(connectionId: string, mappings: MappingInput[]) {
  const connection = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new ChannelApiError('Channel connection not found');

  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId: connection.propertyId },
    select: { id: true },
  });
  const validIds = new Set(roomTypes.map((rt) => rt.id));
  const seenOta = new Set<string>();
  for (const mapping of mappings) {
    if (!validIds.has(mapping.roomTypeId)) throw new ChannelApiError('Room type does not belong to this property');
    if (!mapping.otaRoomTypeId || !mapping.otaRatePlanId) {
      throw new ChannelApiError('Every mapped room needs an OTA room and rate plan');
    }
    const key = `${mapping.otaRoomTypeId}|${mapping.otaRatePlanId}`;
    if (mapping.isActive && seenOta.has(key)) {
      throw new ChannelApiError('Two PMS room types cannot share the same OTA room and rate plan');
    }
    seenOta.add(key);
    if (mapping.markupPercent !== null && (mapping.markupPercent < -50 || mapping.markupPercent > 100)) {
      throw new ChannelApiError('Markup must be between -50% and 100%');
    }
    if (mapping.inventoryAllocation !== null && (!Number.isInteger(mapping.inventoryAllocation) || mapping.inventoryAllocation < 0)) {
      throw new ChannelApiError('Allocation must be a whole number of rooms');
    }
  }

  await prisma.$transaction([
    prisma.channelRoomMapping.deleteMany({
      where: { connectionId, roomTypeId: { notIn: mappings.map((m) => m.roomTypeId) } },
    }),
    ...mappings.map((mapping) =>
      prisma.channelRoomMapping.upsert({
        where: { connectionId_roomTypeId: { connectionId, roomTypeId: mapping.roomTypeId } },
        create: { connectionId, ...mapping },
        update: mapping,
      })
    ),
  ]);
  await logSync(connectionId, 'MAPPING', 'SUCCESS', `Saved ${mappings.length} room mapping(s)`);

  // Keep the OTA in step when an already-active connection's mapping changes
  if (connection.status === 'ACTIVE') {
    await pushAri(connectionId).catch(() => undefined);
  }
  return prisma.channelRoomMapping.findMany({ where: { connectionId } });
}

/** Goes live: full ARI push for the sync window, then a first reservation pull */
export async function activateConnection(connectionId: string) {
  const connection = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    include: { _count: { select: { roomMappings: { where: { isActive: true } } } } },
  });
  if (!connection) throw new ChannelApiError('Channel connection not found');
  if (connection.status === 'DRAFT') throw new ChannelApiError('Verify the connection first');
  if (connection._count.roomMappings === 0) throw new ChannelApiError('Map at least one room type first');

  const today = await todayAt(connection.propertyId);
  const ari = await pushAri(connectionId, {
    from: today,
    to: addDays(today, connection.syncWindowDays - 1),
    force: true,
  });
  const updated = await prisma.channelConnection.update({
    where: { id: connectionId },
    data: { status: 'ACTIVE', activatedAt: connection.activatedAt ?? new Date(), lastError: null },
  });
  await logSync(connectionId, 'ACTIVATION', 'SUCCESS', `${CHANNEL_LABELS[connection.channel]} connection activated`);

  let reservations: Awaited<ReturnType<typeof pullReservations>> = [];
  try {
    reservations = await pullReservations(connectionId);
  } catch {
    // Logged by pullReservations; activation itself succeeded
  }
  return { connection: updated, ari, reservations };
}

export async function setConnectionPaused(connectionId: string, paused: boolean) {
  const connection = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new ChannelApiError('Channel connection not found');
  if (!paused) return activateConnection(connectionId).then((result) => result.connection);
  if (connection.status !== 'ACTIVE' && connection.status !== 'ERROR') {
    throw new ChannelApiError('Only active connections can be paused');
  }
  const updated = await prisma.channelConnection.update({ where: { id: connectionId }, data: { status: 'PAUSED' } });
  await logSync(connectionId, 'PAUSE', 'SUCCESS', 'Syncing paused');
  return updated;
}
