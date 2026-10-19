import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertLiveAllowed, connectionActor } from '@/server/channels/access';
import { serializeConnection, updateConnectionSettings } from '@/server/channels/connections';
import { serializePromotion } from '@/server/channels/promotions';
import { connectionSettingsSchema } from '@/server/channels/schemas';
import { notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';

type Params = { params: Promise<{ connectionId: string }> };

/** GET — one connection with its mappings, promotions, reservations and sync log. */
export const GET = handleRoute(async (_request: NextRequest, { params }: Params) => {
  const { connectionId } = await params;
  await connectionActor('channels.view', connectionId);
  const connection = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    include: {
      property: { select: { id: true, name: true } },
      roomMappings: { include: { roomType: { select: { id: true, name: true, basePrice: true, totalRooms: true } } } },
      promotions: { orderBy: { createdAt: 'desc' } },
      reservations: {
        take: 25,
        orderBy: { receivedAt: 'desc' },
        include: {
          booking: {
            select: { id: true, code: true, checkIn: true, checkOut: true, status: true, rooms: true, roomType: { select: { name: true } } },
          },
        },
      },
      syncLogs: { take: 30, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!connection) throw notFound('Channel connection');

  return json({
    ...serializeConnection(connection),
    roomMappings: connection.roomMappings.map((m) => ({
      ...m,
      markupPercent: m.markupPercent === null ? null : Number(m.markupPercent),
      roomType: { ...m.roomType, basePrice: Number(m.roomType.basePrice) },
    })),
    promotions: connection.promotions.map(serializePromotion),
    reservations: connection.reservations.map((r) => ({ ...r, rawPayload: undefined })),
  });
});

/** PATCH — credentials and sync settings. */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { connectionId } = await params;
  const actor = await connectionActor('channels.manage', connectionId);
  const settings = await parseJson(request, connectionSettingsSchema);
  const current = await prisma.channelConnection.findUnique({ where: { id: connectionId }, select: { propertyId: true, mode: true } });
  if (!current) throw notFound('Channel connection');
  if ((settings.mode ?? current.mode) === 'LIVE') await assertLiveAllowed(actor, current.propertyId);
  return json(serializeConnection(await updateConnectionSettings(connectionId, settings)));
});

/** DELETE — disconnect (bookings already imported stay in HotelOne). */
export const DELETE = handleRoute(async (_request: NextRequest, { params }: Params) => {
  const { connectionId } = await params;
  await connectionActor('channels.manage', connectionId);
  await prisma.channelConnection.delete({ where: { id: connectionId } });
  return json({ success: true });
});
