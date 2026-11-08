import { NextRequest } from 'next/server';
import type { OtaChannel } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { assertLiveAllowed } from '@/server/channels/access';
import { CHANNELS, createConnection, serializeConnection } from '@/server/channels/connections';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';

/** GET ?propertyId — the property's OTA connections with recent reservations and sync activity. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('channels.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);

  const [property, recentReservations, recentLogs] = await Promise.all([
    prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        setupPath: true,
        _count: { select: { roomTypes: { where: { isActive: true } } } },
        channelConnections: {
          include: {
            _count: {
              select: {
                roomMappings: { where: { isActive: true } },
                promotions: { where: { status: 'ACTIVE' } },
                reservations: true,
              },
            },
          },
          orderBy: { channel: 'asc' },
        },
      },
    }),
    prisma.channelReservation.findMany({
      where: { connection: { propertyId } },
      take: 10,
      orderBy: { receivedAt: 'desc' },
      include: {
        connection: { select: { channel: true } },
        booking: { select: { id: true, code: true, checkIn: true, checkOut: true, status: true, roomType: { select: { name: true } } } },
      },
    }),
    prisma.channelSyncLog.findMany({
      where: { connection: { propertyId } },
      take: 15,
      orderBy: { createdAt: 'desc' },
      include: { connection: { select: { channel: true } } },
    }),
  ]);

  return json({
    channels: CHANNELS,
    property: property && {
      ...property,
      channelConnections: property.channelConnections.map(serializeConnection),
    },
    recentReservations: recentReservations.map((r) => ({ ...r, rawPayload: undefined })),
    recentLogs,
  });
});

const createBody = z.object({
  propertyId: z.string().min(1),
  channel: z.enum(CHANNELS as [OtaChannel, ...OtaChannel[]]),
  mode: z.enum(['SANDBOX', 'LIVE']).default('SANDBOX'),
});

/** POST — start onboarding a property on an OTA (or return the existing connection). */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('channels.manage');
  const body = await parseJson(request, createBody);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  if (body.mode === 'LIVE') await assertLiveAllowed(actor, propertyId);
  const connection = await createConnection(propertyId, body.channel, body.mode);
  return json(serializeConnection(connection), { status: 201 });
});
