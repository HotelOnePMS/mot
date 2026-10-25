import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { listCardAuthorizations, requestCardAuthorization } from '@/server/payments/cardAuthorization';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — the reservation's card authorizations (someone else paying), and what a new request is prefilled with. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.cardAuth');
  return json(await listCardAuthorizations(actor, bookingId));
});

const bodySchema = z.object({
  cardholderName: z.string().trim().min(2).max(120),
  cardholderEmail: z.string().trim().email().max(200).nullish().or(z.literal('')),
  guestNames: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
  coversIncidentals: z.boolean(),
  incidentalsLimit: z.number().min(0).max(1_000_000).nullish(),
  sendEmail: z.boolean(),
});

/** POST — ask the cardholder to authorize; returns the link once (and emails it when asked). */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.cardAuth');
  const body = await parseJson(request, bodySchema);
  return json(await requestCardAuthorization({ actor, source: 'classic' }, bookingId, body, new URL(request.url).origin), { status: 201 });
});
