import { requireActor, requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { cancelLinkCode, linkStatus, startLink, unlink } from '@/server/whatsapp/link';

/** GET — whether the agent is on WhatsApp here, and this person's linked number (masked). */
export const GET = handleRoute(async () => json(await linkStatus(await requireActor())));

/** POST — a one-time code to send from the phone being linked ("LINK ABCD-EFGH"), valid for 10 minutes. */
export const POST = handleRoute(async () => json(await startLink(await requireStaff())));

/** DELETE — unlink this person's WhatsApp number; with ?code=1, only stop the code that hasn't been used yet. */
export const DELETE = handleRoute(async (request: Request) => {
  if (new URL(request.url).searchParams.get('code') === '1') {
    await cancelLinkCode(await requireStaff());
    return json({ message: 'Code cancelled.' });
  }
  await unlink(await requireStaff(), 'console');
  return json({ message: 'WhatsApp unlinked.' });
});
