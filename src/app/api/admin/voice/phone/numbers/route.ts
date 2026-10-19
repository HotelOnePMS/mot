import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { toE164 } from '@/lib/phone';
import { forbidden, DomainError } from '@/server/errors';
import { requireStaff, resolvePropertyId, type Actor } from '@/server/authz';
import { assertNotDemoHotel } from '@/server/demo';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { accountNumbers, assignAccountNumber, connectTwilioNumber, elevenLabsConfigured } from '@/server/voice/elevenlabs';

export const dynamic = 'force-dynamic';

const DEMO_LOCKED = 'Phone numbers can’t be connected to demo hotels. Set up your own hotel (Get started), then connect your number there.';

/** Checks shared by every change: ElevenLabs is set up, the hotel has a phone line, it isn't a demo hotel. */
async function phoneLineFor(actor: Actor, propertyId: string) {
  if (!elevenLabsConfigured()) throw new DomainError(409, 'VOICE_DISABLED', 'Phone lines run on ElevenLabs Agents — add ELEVENLABS_API_KEY to the server first.');
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { isDemo: true, phoneLine: { select: { enabled: true } } } });
  assertNotDemoHotel(actor, property.isDemo, DEMO_LOCKED);
  if (!property.phoneLine) throw new DomainError(409, 'NO_PHONE_LINE', 'Turn on the phone line first, then connect a number to it.');
}

/** Numbers span every hotel in the ElevenLabs account, so only platform admins see or pick from them. */
function requirePlatformAdmin(actor: Actor) {
  if (actor.role !== 'ADMIN') throw forbidden('Only the platform team can pick from the account’s numbers. Connect your own Twilio number instead.');
}

/** GET ?propertyId — every number in the ElevenLabs account and the agent it rings (platform admins). */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('phone.manage');
  requirePlatformAdmin(actor);
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  await phoneLineFor(actor, propertyId);
  return json({ numbers: await accountNumbers(propertyId) });
});

const twilio = z.object({
  propertyId: z.string().min(1),
  phoneNumber: z.string().trim().max(40),
  accountSid: z
    .string()
    .trim()
    .regex(/^AC[0-9a-fA-F]{32}$/, 'must be the Account SID from the Twilio Console (it starts with AC)'),
  authToken: z.string().trim().min(16).max(128),
});

/**
 * POST — connect a Twilio number to this hotel (owners and platform admins).
 * Twilio confirms the credentials hold the number; ElevenLabs imports it and
 * points it at the hotel's phone agent. Credentials aren't stored.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('phone.manage');
  const body = await parseJson(request, twilio);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  const phoneNumber = toE164(body.phoneNumber);
  if (!phoneNumber) throw new DomainError(400, 'BAD_REQUEST', 'Enter the Twilio number in international format, like +1 831 555 0100.');
  await phoneLineFor(actor, propertyId);
  await connectTwilioNumber(propertyId, { phoneNumber, accountSid: body.accountSid, authToken: body.authToken });
  await recordAudit({ actor, source: 'classic' }, propertyId, 'VOICE_PHONE_NUMBER', `Connected ${phoneNumber} (Twilio) to the phone line`);
  return json({ ok: true, phoneNumber });
});

/** PUT { propertyId, phoneNumberId } — point a number already in the ElevenLabs account at this hotel (platform admins). */
export const PUT = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('phone.manage');
  requirePlatformAdmin(actor);
  const body = await parseJson(request, z.object({ propertyId: z.string().min(1), phoneNumberId: z.string().trim().min(1).max(200) }));
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  await phoneLineFor(actor, propertyId);
  const number = (await accountNumbers(propertyId)).find((n) => n.id === body.phoneNumberId);
  if (!number) throw new DomainError(404, 'NOT_FOUND', 'That number isn’t in the ElevenLabs account any more — refresh and try again.');
  await assignAccountNumber(propertyId, number.id);
  await recordAudit(
    { actor, source: 'classic' },
    propertyId,
    'VOICE_PHONE_NUMBER',
    `Connected ${number.phoneNumber} to the phone line${number.agentName && !number.thisHotel ? ` (moved from ${number.agentName})` : ''}`,
  );
  return json({ ok: true, phoneNumber: number.phoneNumber });
});
