import { NextRequest } from 'next/server';
import { requestOrigin } from '@/server/agent-api';
import { requireActor } from '@/server/authz';
import { sendVerificationEmail } from '@/server/auth/account';
import { handleRoute, json } from '@/server/http';

/** POST — send the signed-in person a new verification link. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireActor();
  if (actor.emailVerified) return json({ sent: false, message: 'Your email address is already verified.' });
  const sent = await sendVerificationEmail(actor.userId, requestOrigin(request));
  return json({ sent, message: sent ? `We sent a link to ${actor.email}.` : 'Email isn’t set up on this server yet, so no link was sent.' });
});
