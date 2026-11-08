/**
 * Reservation webhooks for OTAs that push bookings (Airbnb, Agoda, Trip.com,
 * Priceline, Hopper, Hostelworld): POST /api/channels/webhooks/[connectionId]?token=...
 *
 * The token is derived from the vault key and the connection ID (nothing stored),
 * so each connection has its own unguessable URL. The OTA's message is parsed by
 * the connection's adapter, imported like a pulled reservation, and answered in
 * the format the OTA expects with HotelOne's confirmation codes.
 */
import { prisma } from '@/lib/prisma';
import { publicSiteUrl } from '../public-url';
import { derivedToken, safeEqual } from '../vault';
import { getAdapter } from './adapters';
import { loadConnection } from './ari';
import { importAndConfirmations } from './reservations';
import { errorMessage, logSync } from './sync';
import type { WebhookReply } from './types';

/** Bodies above this are rejected before parsing */
export const MAX_WEBHOOK_BYTES = 1_000_000;

export function webhookToken(connectionId: string): string {
  return derivedToken(`channel-webhook:${connectionId}`);
}

export function webhookUrl(connectionId: string): string | null {
  let token: string;
  try {
    token = webhookToken(connectionId);
  } catch {
    return null; // vault key not configured
  }
  const path = `/api/channels/webhooks/${encodeURIComponent(connectionId)}?token=${token}`;
  const base = publicSiteUrl();
  return base ? `${base}${path}` : path;
}

export function validWebhookToken(connectionId: string, token: string | null): boolean {
  if (!token) return false;
  try {
    return safeEqual(token, webhookToken(connectionId));
  } catch {
    return false;
  }
}

const plain = (status: number, message: string): WebhookReply => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ error: message }),
});

export async function handleReservationWebhook(
  connectionId: string,
  token: string | null,
  body: string,
  contentType: string
): Promise<WebhookReply> {
  // Same answer for an unknown connection and a wrong token, so IDs can't be probed
  if (!validWebhookToken(connectionId, token)) return plain(401, 'Unauthorized');
  const connection = await loadConnection(connectionId);
  if (!connection) return plain(401, 'Unauthorized');
  if (connection.mode !== 'LIVE') return plain(409, 'This connection is in sandbox mode');

  const adapter = await getAdapter(connection);
  if (!adapter.parseWebhook || !adapter.webhookResponse) return plain(404, 'This channel does not deliver reservations by webhook');
  const request = { body, contentType };

  if (!connection.importReservations) {
    await logSync(connectionId, 'RESERVATION_PUSH', 'FAILED', 'Reservation received while reservation import is turned off');
    return adapter.webhookResponse(request, { confirmations: [], error: 'Reservation import is turned off for this hotel' });
  }

  try {
    const reservations = adapter.parseWebhook(request);
    const { results, confirmations } = await importAndConfirmations(connection, reservations);
    const failed = results.filter((r) => r.outcome === 'failed');
    await prisma.channelConnection.update({ where: { id: connectionId }, data: { lastReservationPullAt: new Date() } });
    await logSync(
      connectionId,
      'RESERVATION_PUSH',
      failed.length > 0 ? 'FAILED' : 'SUCCESS',
      `Received ${reservations.length} reservation message(s) by webhook` +
        (failed.length > 0 ? `, ${failed.length} failed: ${failed.map((f) => f.message).join('; ')}` : ''),
      { results }
    );
    // Tell the OTA when nothing could be applied, so it retries or alerts the hotel
    const error = reservations.length > 0 && confirmations.length === 0 ? failed.map((f) => f.message).join('; ') || 'Reservation could not be applied' : null;
    return adapter.webhookResponse(request, { confirmations, error });
  } catch (error) {
    const message = errorMessage(error);
    await logSync(connectionId, 'RESERVATION_PUSH', 'FAILED', message);
    return adapter.webhookResponse(request, { confirmations: [], error: message });
  }
}
