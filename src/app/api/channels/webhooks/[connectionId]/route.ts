import { NextRequest } from 'next/server';
import { handleReservationWebhook, MAX_WEBHOOK_BYTES } from '@/server/channels/webhooks';

type Params = { params: Promise<{ connectionId: string }> };

/**
 * POST /api/channels/webhooks/[connectionId]?token=... — reservations pushed by an OTA
 * (Airbnb JSON notifications; OTA_HotelResNotifRQ, OTA_HotelResRQ, OTA_HotelResModifyNotifRQ
 * or OTA_CancelRQ from Agoda, Trip.com and the others). The URL is shown in the connection setup.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { connectionId } = await params;
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_WEBHOOK_BYTES) return Response.json({ error: 'Payload too large' }, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_WEBHOOK_BYTES) return Response.json({ error: 'Payload too large' }, { status: 413 });

  const reply = await handleReservationWebhook(
    connectionId,
    request.nextUrl.searchParams.get('token') ?? request.headers.get('x-hotelone-token'),
    body,
    request.headers.get('content-type') ?? ''
  );
  return new Response(reply.body, { status: reply.status, headers: { 'Content-Type': reply.contentType } });
}
