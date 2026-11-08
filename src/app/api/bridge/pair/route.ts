import { NextRequest } from 'next/server';
import { z } from 'zod';
import { DomainError } from '@/server/errors';
import { handleRoute, json, parseJson, clientIp } from '@/server/http';
import { pairDevice } from '@/server/services/bridge';

// Pairing codes are short-lived; this keeps guessing impractical as well.
const attempts = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const hits = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  attempts.set(ip, hits);
  return hits.length > 10;
}

/**
 * POST /api/bridge/pair { code, deviceName } — called by the HotelOne Connector
 * on the hotel's computer. Returns the device token exactly once.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const ip = clientIp(request);
  if (limited(ip)) throw new DomainError(429, 'RATE_LIMITED', 'Too many pairing attempts. Wait a minute and try again.');
  const body = await parseJson(request, z.object({ code: z.string().trim().min(4).max(20), deviceName: z.string().trim().min(1).max(80) }));
  return json(await pairDevice(body.code, body.deviceName));
});
