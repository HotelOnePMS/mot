import { requireActor } from '@/server/authz';
import { signOutEverywhere } from '@/server/auth/account';
import { handleRoute, json } from '@/server/http';

/** POST — end every session of this account, on every device. */
export const POST = handleRoute(async () => {
  const actor = await requireActor();
  await signOutEverywhere(actor);
  return json({ message: 'Signed out everywhere.' });
});
