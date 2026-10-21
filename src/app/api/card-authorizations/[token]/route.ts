import { NextRequest } from 'next/server';
import { z } from 'zod';
import { CARD_BRANDS, ID_TYPES } from '@/lib/card-authorization';
import { clientIp, handleRoute, json, parseJson } from '@/server/http';
import { getAuthorizationForm, submitCardAuthorization } from '@/server/payments/cardAuthorization';

type Params = { params: Promise<{ token: string }> };

const noStore = { headers: { 'Cache-Control': 'private, no-store' } };

/** GET — what the cardholder's link shows (public: the token is the key). */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { token } = await params;
  return json(await getAuthorizationForm(token), noStore);
});

const country = z.string().trim().regex(/^[A-Za-z]{2}$/, 'Choose a country');

const bodySchema = z.object({
  textHash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).nullish(),
  billing: z.object({
    line1: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().min(1).max(20),
    country,
  }),
  card: z.object({ brand: z.enum(CARD_BRANDS).nullish(), last4: z.string().trim().regex(/^\d{4}$/, 'Enter the last four digits') }),
  id: z.object({
    type: z.enum(ID_TYPES),
    country,
    last4: z.string().trim().regex(/^[A-Za-z0-9]{4}$/, 'Enter the last four characters of the ID number'),
    // A data URL; the form shrinks photos to well under this.
    photo: z.string().max(3_500_000).nullish(),
  }),
  signature: z.discriminatedUnion('method', [
    z.object({ method: z.literal('DRAWN'), image: z.string().max(420_000) }),
    z.object({ method: z.literal('TYPED'), text: z.string().trim().min(2).max(120) }),
  ]),
  consent: z.literal(true, { errorMap: () => ({ message: 'Tick the box to agree before signing' }) }),
});

/** POST — the cardholder signs (details, card digits, ID, signature). */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { token } = await params;
  const body = await parseJson(request, bodySchema);
  const result = await submitCardAuthorization(token, body, { ip: clientIp(request), userAgent: request.headers.get('user-agent') });
  return json(result, noStore);
});
