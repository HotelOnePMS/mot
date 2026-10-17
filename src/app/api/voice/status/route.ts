import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { handleRoute, json, parseQuery } from '@/server/http';
import { conciergeVoiceAvailable, voiceAvailable, voiceProvider } from '@/server/voice/provider';

const query = z.object({ propertyId: z.string().min(1).max(64).optional() });

/**
 * GET /api/voice/status?propertyId — what the booking site's voice dock can
 * offer here: the hotel's own front desk on its pages (when the hotel has
 * its online voice on), and the HotelOne concierge everywhere else. Public;
 * no secrets.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const q = parseQuery(request, query);
  const on = voiceAvailable();
  let hotel: { id: string; name: string; primaryColor: string | null; available: boolean } | null = null;
  if (q.propertyId) {
    const p = await prisma.property.findFirst({
      where: { id: q.propertyId, isActive: true },
      select: { id: true, name: true, primaryColor: true, voiceAgent: { select: { enabled: true, guestWidget: true } } },
    });
    if (p) hotel = { id: p.id, name: p.name, primaryColor: p.primaryColor, available: on && (p.voiceAgent?.enabled ?? true) && (p.voiceAgent?.guestWidget ?? true) };
  }
  return json({ provider: voiceProvider(), concierge: conciergeVoiceAvailable(), hotel }, { headers: { 'Cache-Control': 'no-store' } });
});
