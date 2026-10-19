import { requireActor } from '@/server/authz';
import { mfaStatus } from '@/server/auth/account';
import { handleRoute, json } from '@/server/http';

/** GET — your two-step sign-in and verification status (works before required two-step setup is done). */
export const GET = handleRoute(async () => {
  const actor = await requireActor();
  return json({ email: actor.email, ...(await mfaStatus(actor)) });
});
