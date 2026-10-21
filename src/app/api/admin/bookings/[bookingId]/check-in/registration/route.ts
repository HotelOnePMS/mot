import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { previewRegistration } from '@/server/services/checkin';
import { registrationDraftSchema } from '../schemas';

type Params = { params: Promise<{ bookingId: string }> };

/** POST — the registration card the guest is about to sign, with the hash the check-in must send back. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('booking.checkin');
  const draft = await parseJson(request, registrationDraftSchema);
  return json(await previewRegistration(actor, bookingId, { ...draft, id: { ...draft.id, country: draft.id.country?.toUpperCase() ?? null, last4: draft.id.last4.toUpperCase() } }));
});
