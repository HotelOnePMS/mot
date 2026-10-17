import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff, requirePermission, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { LIVE_MODEL, VOICES } from '@/server/voice/live';
import { voiceAvailable, voiceProvider } from '@/server/voice/provider';
import { elevenLabsConfigured } from '@/server/voice/elevenlabs';
import { isEmailConfigured } from '@/server/email';
import { assertDemoHotelUnchanged } from '@/server/demo';
import { scheduleConfigSkillSync } from '@/server/skills';
import { parseNotifyEmails } from '@/server/services/guestRequests';

const DEFAULTS = { enabled: true, voice: 'marin', greeting: null, instructions: null, faqs: [], handoffPhone: null, guestWidget: true, checkInTime: null, checkOutTime: null, cancellationPolicy: null, notifyEmail: null };

/** GET — voice agent settings, recent usage and open guest requests. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('requests.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const since = new Date(Date.now() - 7 * 86400_000);
  const [config, sessions, phoneCalls, whatsAppChats, openRequests, recentSessions, phoneLine, roomTypes, webCallsEver, phoneCallsEver, owners] = await Promise.all([
    prisma.voiceAgentConfig.findUnique({ where: { propertyId } }),
    prisma.voiceSession.groupBy({ by: ['audience'], where: { propertyId, startedAt: { gte: since } }, _count: { _all: true }, _sum: { toolCalls: true } }),
    prisma.voiceSession.count({ where: { propertyId, channel: 'PHONE', startedAt: { gte: since } } }),
    prisma.voiceSession.count({ where: { propertyId, channel: 'WHATSAPP', startedAt: { gte: since } } }),
    prisma.guestRequest.count({ where: { propertyId, status: 'NEW' } }),
    prisma.voiceSession.findMany({ where: { propertyId }, orderBy: { startedAt: 'desc' }, take: 8, select: { id: true, audience: true, startedAt: true, endedAt: true, toolCalls: true } }),
    prisma.voicePhoneLine.findUnique({ where: { propertyId }, select: { enabled: true } }),
    // The go-live checklist: rooms to quote, a test call, a first real call.
    prisma.roomType.count({ where: { propertyId, isActive: true } }),
    prisma.voiceSession.count({ where: { propertyId, audience: 'GUEST', channel: 'WEB' } }),
    prisma.voiceSession.count({ where: { propertyId, audience: 'GUEST', channel: { in: ['PHONE', 'WHATSAPP'] } } }),
    prisma.userPropertyAssignment.findMany({ where: { propertyId, user: { role: 'OWNER', isActive: true } }, select: { user: { select: { email: true } } } }),
  ]);
  const notifyTo = parseNotifyEmails(config?.notifyEmail);
  const minutes = recentSessions.reduce((s, r) => s + (r.endedAt ? (r.endedAt.getTime() - r.startedAt.getTime()) / 60000 : 0), 0);
  return json({
    connected: voiceAvailable(),
    provider: voiceProvider(),
    model: voiceProvider() === 'elevenlabs' ? 'ElevenLabs Agents' : LIVE_MODEL,
    voices: VOICES,
    config: config ?? { ...DEFAULTS, propertyId },
    phoneLine: phoneLine ? { enabled: phoneLine.enabled } : null,
    phoneReady: elevenLabsConfigured(),
    emailReady: isEmailConfigured(),
    stats: {
      guestCalls: sessions.find((s) => s.audience === 'GUEST')?._count._all ?? 0,
      phoneCalls,
      whatsAppChats,
      staffSessions: sessions.find((s) => s.audience === 'STAFF')?._count._all ?? 0,
      toolCalls: sessions.reduce((s, r) => s + (r._sum.toolCalls ?? 0), 0),
      recentMinutes: Math.round(minutes),
      openRequests,
    },
    setup: {
      roomTypes,
      faqs: Array.isArray(config?.faqs) ? config.faqs.length : 0,
      policies: !!(config?.checkInTime && config?.checkOutTime),
      testCalls: webCallsEver,
      phoneCalls: phoneCallsEver,
      /** Where caller messages are emailed (the owners when none is set). */
      notifyTo: notifyTo.length ? notifyTo : parseNotifyEmails(owners.map((o) => o.user.email).join(',')),
    },
    recent: recentSessions.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null })),
  });
});

const schema = z.object({
  propertyId: z.string().min(1),
  enabled: z.boolean().optional(),
  voice: z.enum(VOICES).optional(),
  greeting: z.string().trim().max(300).nullable().optional(),
  instructions: z.string().trim().max(4000).nullable().optional(),
  faqs: z.array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(1200) })).max(40).optional(),
  handoffPhone: z.string().trim().max(40).nullable().optional(),
  guestWidget: z.boolean().optional(),
  checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  cancellationPolicy: z.string().trim().max(500).nullable().optional(),
  notifyEmail: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .refine((v) => !v || v.split(/[,;\s]+/).filter(Boolean).length === parseNotifyEmails(v).length, 'must be email addresses separated by commas'),
});

/** PUT — update voice settings (managers and owners). */
export const PUT = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('voice.manage');
  const body = await parseJson(request, schema);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  requirePermission(actor, 'voice.manage');
  const { propertyId: _p, ...data } = body;
  const clean = {
    ...data,
    greeting: data.greeting || null,
    instructions: data.instructions || null,
    handoffPhone: data.handoffPhone || null,
    cancellationPolicy: data.cancellationPolicy || null,
    ...(data.notifyEmail !== undefined ? { notifyEmail: parseNotifyEmails(data.notifyEmail).join(', ') || null } : {}),
  };
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { isDemo: true, voiceAgent: true } });
  const sent = Object.fromEntries(Object.keys(data).map((k) => [k, clean[k as keyof typeof clean]]));
  assertDemoHotelUnchanged(actor, { isDemo: property.isDemo, ...DEFAULTS, ...(property.voiceAgent ?? {}) }, sent, ['greeting', 'instructions', 'faqs', 'handoffPhone', 'enabled', 'guestWidget', 'checkInTime', 'checkOutTime', 'cancellationPolicy', 'notifyEmail']);
  const config = await prisma.voiceAgentConfig.upsert({
    where: { propertyId },
    create: { propertyId, ...DEFAULTS, ...clean, faqs: clean.faqs ?? [] },
    update: clean,
  });
  await recordAudit({ actor, source: 'classic' }, propertyId, 'VOICE_SETTINGS', 'Updated voice agent settings');
  // FAQs become agent skills.
  scheduleConfigSkillSync(propertyId);
  return json(config);
});
