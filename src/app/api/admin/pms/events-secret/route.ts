import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff } from '@/server/authz';
import { notFound } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { EVENT_SIGNATURE_HEADER, EVENT_TIMESTAMP_HEADER, EVENT_TOLERANCE_SECONDS, EVENT_TYPES, eventsPath, eventsSecret, eventsUrl } from '@/server/pms';
import { pmsProperty } from '@/server/pms/guard';

/**
 * GET ?propertyId — the events webhook URL and its signing secret, shown to
 * owners on demand (to paste into the PMS vendor's webhook settings).
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const q = parseQuery(request, z.object({ propertyId: z.string().min(1) }));
  const property = await pmsProperty(actor, q.propertyId, { demoLock: 'The demo hotels’ webhook secrets aren’t shown. Set up your own hotel to connect its PMS events.' });
  const c = await prisma.pmsConnection.findUnique({ where: { propertyId: property.id }, select: { id: true, system: true } });
  if (!c) throw notFound('PMS connection');
  await recordAudit({ actor, source: 'classic' }, property.id, 'PMS_EVENTS_SECRET', `Viewed the ${c.system} events webhook secret`, { connectionId: c.id });
  return json(
    {
      url: eventsUrl(c.id),
      path: eventsPath(c.id),
      secret: eventsSecret(c.id),
      signature: {
        timestampHeader: 'X-HotelOne-Timestamp',
        signatureHeader: 'X-HotelOne-Signature',
        scheme: 'sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>',
        toleranceSeconds: EVENT_TOLERANCE_SECONDS,
        headers: [EVENT_TIMESTAMP_HEADER, EVENT_SIGNATURE_HEADER],
      },
      types: EVENT_TYPES,
      docs: '/developers/pms#events',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
