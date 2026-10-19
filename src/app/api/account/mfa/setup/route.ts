import { requireActor } from '@/server/authz';
import { beginMfaSetup } from '@/server/auth/account';
import { handleRoute, json } from '@/server/http';

/** POST — start two-step sign-in: a new secret and the QR code to scan. */
export const POST = handleRoute(async () => {
  const actor = await requireActor();
  return json(await beginMfaSetup(actor), { headers: { 'Cache-Control': 'no-store' } });
});
