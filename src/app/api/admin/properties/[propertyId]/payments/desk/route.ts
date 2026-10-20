import { NextRequest } from 'next/server';
import { z } from 'zod';
import { MAX_SECURITY_DEPOSIT, SECURITY_DEPOSIT_MODES } from '@/lib/desk-payments';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { getDeskSettings, registerReader, removeReader, setDepositPolicy } from '@/server/payments/terminal';

type Params = { params: Promise<{ propertyId: string }> };

/** GET — front desk payment settings: the security deposit and the hotel's card readers. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('payments.view');
  return json(await getDeskSettings(actor, propertyId));
});

const depositSchema = z.object({
  mode: z.enum(SECURITY_DEPOSIT_MODES as [string, ...string[]]).transform((m) => m as (typeof SECURITY_DEPOSIT_MODES)[number]),
  amount: z.coerce.number().min(0).max(MAX_SECURITY_DEPOSIT),
});

/** PUT — the security deposit taken at check-in: none, a card hold, or a charge refunded at check-out. */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('payments.manage');
  return json(await setDepositPolicy({ actor, source: 'classic' }, propertyId, await parseJson(request, depositSchema)));
});

/** POST — register a card reader with the pairing code on its screen ("simulated-wpe" adds a test reader). */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('payments.manage');
  const body = await parseJson(request, z.object({ registrationCode: z.string().min(3).max(100), label: z.string().min(1).max(100) }));
  return json(await registerReader({ actor, source: 'classic' }, propertyId, body), { status: 201 });
});

/** DELETE ?readerId= — remove a card reader. */
export const DELETE = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('payments.manage');
  const readerId = request.nextUrl.searchParams.get('readerId');
  if (!readerId) return json({ error: 'readerId is required' }, { status: 400 });
  return json(await removeReader({ actor, source: 'classic' }, propertyId, readerId));
});
