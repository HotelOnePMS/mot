import { NextRequest } from 'next/server';
import { z } from 'zod';
import { DESK_KINDS } from '@/lib/desk-payments';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { getDeskPayments, recordCashPayment, startCardEntry, startReaderPayment } from '@/server/payments/desk';
import { publicSiteUrl } from '@/server/public-url';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — balance, security deposit, payments so far, card readers and any OTA card, for collecting at the desk. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('payments.collect');
  return json(await getDeskPayments(actor, bookingId));
});

const kind = z.enum(DESK_KINDS as [string, ...string[]]).transform((k) => k as (typeof DESK_KINDS)[number]);
const amount = z.number().positive().max(1_000_000);

const bodySchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('CASH'), kind, amount, tendered: amount.optional(), note: z.string().max(200).optional() }),
  z.object({ method: z.literal('TERMINAL'), kind, amount, readerId: z.string().min(1).max(100) }),
  z.object({ method: z.literal('CARD_ENTRY'), kind, amount }),
  z.object({ method: z.literal('VIRTUAL_CARD'), kind, amount }),
]);

/**
 * POST — collect money: CASH is recorded at once; TERMINAL sends the amount to
 * a card reader; CARD_ENTRY and VIRTUAL_CARD return Stripe's payment page `url`
 * for staff to type the card into. Card results are polled at
 * /api/admin/desk-payments/:id.
 */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('payments.collect');
  const body = await parseJson(request, bodySchema);
  const op = { actor, source: 'classic' as const };
  switch (body.method) {
    case 'CASH':
      return json(await recordCashPayment(op, bookingId, body), { status: 201 });
    case 'TERMINAL':
      return json(await startReaderPayment(op, bookingId, body), { status: 201 });
    default:
      return json(await startCardEntry(op, bookingId, { kind: body.kind, amount: body.amount, virtualCard: body.method === 'VIRTUAL_CARD', siteUrl: publicSiteUrl() ?? request.nextUrl.origin }), { status: 201 });
  }
});
