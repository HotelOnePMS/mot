import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { editFolio, getFolio } from '@/server/services/folio';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — the folio: room and tax lines, payments online and at the desk, refunds, security deposits, balance. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('folio.view');
  return json(await getFolio(actor, bookingId));
});

const amount = z.number().min(0).max(1_000_000);
const shown = z.object({ amount: z.number(), label: z.string().max(200) });
const shownCharge = z.object({ amount: z.number(), name: z.string().max(200) });
const day = z.string().max(10).nullable().optional();
const reason = z.string().max(200).optional();

const editSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('room'), label: z.string().max(200).nullable().optional(), amount: amount.optional(), expected: shown, reason }),
  z.object({ target: z.literal('charge'), index: z.number().int().min(0).max(100), name: z.string().max(200).optional(), amount: amount.optional(), date: day, expected: shownCharge, reason }),
  z.object({ target: z.literal('addCharge'), name: z.string().max(200), amount, date: day, reason }),
  z.object({ target: z.literal('removeCharge'), index: z.number().int().min(0).max(100), expected: shownCharge, reason }),
  z.object({
    target: z.literal('setTotal'),
    refs: z.array(z.string().regex(/^(room|charge:\d{1,3})$/)).min(1).max(51),
    amount,
    expected: z.record(z.string(), z.number()),
    reason,
  }),
  z.object({ target: z.literal('allowance'), id: z.string().min(1).max(64), amount: amount.optional(), allowanceReason: z.string().max(200).optional(), reason }),
  z.object({
    target: z.literal('payment'),
    id: z.string().min(1).max(64),
    amount: amount.optional(),
    amountRefunded: amount.optional(),
    method: z.string().max(32).optional(),
    paidAt: z.string().max(40).optional(),
    note: z.string().max(200).nullable().optional(),
    reason,
  }),
  z.object({ target: z.literal('removePayment'), id: z.string().min(1).max(64), reason }),
]);

/**
 * PATCH — change something on the folio: the room line, a tax or fee, an extra charge (add, change, remove), several
 * lines to one total ("room and tax together $50"), an allowance, or a payment. folio.edit at the booking's hotel
 * (owners, or a role the owner allowed). Returns the folio.
 */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  // folio.edit is checked against the booking's hotel (owner-given permissions are per hotel).
  const actor = await requireStaff('folio.view');
  const body = await parseJson(request, editSchema);
  return json(await editFolio({ actor, source: 'classic' }, bookingId, body));
});
