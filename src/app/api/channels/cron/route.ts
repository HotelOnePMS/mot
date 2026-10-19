import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { pullReservations } from '@/server/channels/reservations';
import { errorMessage, pushAri } from '@/server/channels/sync';
import { handleRoute, json } from '@/server/http';
import { safeEqual } from '@/server/vault';

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

/**
 * GET or POST /api/channels/cron — OTA reservation import and reconciliation.
 * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET` (vercel.json);
 * any other scheduler can too. Pulls new OTA reservations for every active
 * connection; with ?full=1 it also re-pushes the whole availability/rate window.
 */
async function run(request: NextRequest) {
  if (!authorized(request)) return json({ error: 'Unauthorized' }, { status: 401 });

  const full = request.nextUrl.searchParams.get('full') === '1';
  const connections = await prisma.channelConnection.findMany({
    where: { status: { in: ['ACTIVE', 'ERROR'] } },
    select: { id: true },
  });

  const results = [];
  for (const { id } of connections) {
    const result: Record<string, unknown> = { connectionId: id };
    try {
      result.reservations = (await pullReservations(id)).length;
    } catch (error) {
      result.reservationError = errorMessage(error);
    }
    if (full) {
      try {
        result.ari = (await pushAri(id)).message;
      } catch (error) {
        result.ariError = errorMessage(error);
      }
    }
    results.push(result);
  }
  return json({ connections: results.length, results });
}

export const GET = handleRoute(run);
export const POST = handleRoute(run);
