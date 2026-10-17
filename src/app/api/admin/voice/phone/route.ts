import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { toE164 } from '@/lib/phone';
import { can, requireStaff, resolvePropertyId, type Actor } from '@/server/authz';
import { assertNotDemoHotel, demoHotelLocked } from '@/server/demo';
import { DomainError, badRequest } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { describeElevenLabsError, elevenLabsConfigured, phoneLineStatus, phoneWebhookBase } from '@/server/voice/elevenlabs';

export const dynamic = 'force-dynamic';

const DEMO_LOCKED = 'Phone lines aren’t available on demo hotels or with the shared demo logins. Set up your own hotel (Get started), then connect your number there.';

/**
 * The hotel's phone line as the console shows it. With `check`, also syncs
 * the hotel's phone agent at ElevenLabs and lists the numbers that ring it
 * (whoever runs the ElevenLabs account points numbers at the agent there).
 */
async function overview(actor: Actor, propertyId: string, check: boolean) {
  // Phone lines run on ElevenLabs whichever provider serves the booking page.
  const ready = elevenLabsConfigured();
  const [line, property, voice] = await Promise.all([
    prisma.voicePhoneLine.findUnique({ where: { propertyId }, select: { enabled: true, transferNumber: true } }),
    prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { isDemo: true } }),
    prisma.voiceAgentConfig.findUnique({ where: { propertyId }, select: { enabled: true } }),
  ]);
  const locked = demoHotelLocked(actor, property.isDemo);
  let urlIssue: string | null = null;
  if (ready) {
    try {
      phoneWebhookBase();
    } catch (e) {
      urlIssue = (e as Error).message;
    }
  }
  const checked = check && ready && !!line && !urlIssue;
  let status: Awaited<ReturnType<typeof phoneLineStatus>> | null = null;
  let statusError: string | null = null;
  if (checked) {
    try {
      status = await phoneLineStatus(propertyId);
    } catch (e) {
      statusError = describeElevenLabsError(e);
    }
  }
  return {
    ready,
    canManage: can(actor, 'phone.manage') && !locked,
    locked: locked ? DEMO_LOCKED : null,
    /** The hotel's master voice switch (Settings): off means calls get the not-available message. */
    voiceOn: voice?.enabled ?? true,
    line,
    urlIssue,
    /** Whether live status was fetched (it's for people who manage the voice). */
    checked,
    status,
    statusError,
  };
}

/** GET ?propertyId[&check=1] — phone line settings and, with check, live status from ElevenLabs. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('requests.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional(), check: z.enum(['0', '1']).optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  // Checking syncs the agent at ElevenLabs, so it's for the people who manage the voice.
  return json(await overview(actor, propertyId, q.check === '1' && can(actor, 'voice.manage')));
});

const schema = z.object({
  propertyId: z.string().min(1),
  enabled: z.boolean(),
  transferNumber: z.string().trim().max(40).nullable().optional(),
});

/**
 * PUT — turn the phone line on or off and set where callers are put through
 * (owners and platform admins). The hotel's agent is synced right away; if
 * ElevenLabs can't take a change that turns the line on or moves transfers,
 * nothing is changed. Pausing always sticks — HotelOne declines the calls itself.
 */
export const PUT = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('phone.manage');
  const body = await parseJson(request, schema);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  if (!elevenLabsConfigured()) throw new DomainError(409, 'VOICE_DISABLED', 'Phone lines run on ElevenLabs Agents — add ELEVENLABS_API_KEY to the server first.');
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { isDemo: true } });
  assertNotDemoHotel(actor, property.isDemo, DEMO_LOCKED);
  const transferNumber = body.transferNumber ? toE164(body.transferNumber) : null;
  if (body.transferNumber && !transferNumber) throw badRequest('Enter the transfer number in international format, like +1 831 555 0100.');
  phoneWebhookBase(); // a clear error before anything is created

  const before = await prisma.voicePhoneLine.findUnique({ where: { propertyId }, select: { enabled: true, transferNumber: true } });
  await prisma.voicePhoneLine.upsert({
    where: { propertyId },
    create: { propertyId, enabled: body.enabled, transferNumber },
    update: { enabled: body.enabled, transferNumber },
  });
  const result = await overview(actor, propertyId, true);
  if (result.statusError && body.enabled) {
    // Keep what calls actually get in step with the agent at ElevenLabs.
    if (before) await prisma.voicePhoneLine.update({ where: { propertyId }, data: before });
    else await prisma.voicePhoneLine.delete({ where: { propertyId } });
    throw new DomainError(502, 'VOICE_UPSTREAM', `Nothing was changed — ${result.statusError}`);
  }
  await recordAudit(
    { actor, source: 'classic' },
    propertyId,
    'VOICE_PHONE_LINE',
    `${body.enabled ? 'Turned on' : 'Paused'} the phone line${transferNumber ? `; callers who ask for a person go to ${transferNumber}` : ''}`,
  );
  return json(result);
});
