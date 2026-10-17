import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { isDemoEmail } from '@/config/product';
import { badRequest, conflict, DomainError } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { VOICES } from '@/server/voice/live';
import { toE164 } from '@/lib/phone';
import { cloudLoginUrlIssue, pmsLoginUrlSchema } from '@/server/schemas';
import { scheduleConfigSkillSync } from '@/server/skills';

/** "15:00" — a time of day on the 24-hour clock. */
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .optional()
  .nullable();

const schema = z.object({
  path: z.enum(['FULL', 'BRIDGE', 'VOICE']).default('FULL'),
  account: z.object({
    firstName: z.string().trim().min(1, 'is required').max(60),
    lastName: z.string().trim().min(1, 'is required').max(60),
    email: z.string().trim().toLowerCase().email('must be a valid email').refine((v) => !isDemoEmail(v), 'belongs to the public demo — use your own email'),
    password: z.string().min(8, 'must be at least 8 characters').max(200),
  }),
  property: z.object({
    name: z.string().trim().min(2).max(120),
    type: z.enum(['Hotel', 'Motel', 'Inn', 'B&B', 'Boutique', 'Other']).default('Hotel'),
    address: z.string().trim().min(3).max(200),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    zipCode: z.string().trim().min(2).max(20),
    phone: z.string().trim().min(5).max(40),
    tagline: z.string().trim().max(160).optional().nullable(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  }),
  roomTypes: z
    .array(z.object({ name: z.string().trim().min(2).max(80), capacity: z.coerce.number().int().min(1).max(20), basePrice: z.coerce.number().min(0).max(100000), totalRooms: z.coerce.number().int().min(0).max(2000) }))
    .max(8)
    .default([]),
  bridge: z.object({ system: z.string().trim().min(2).max(60), mode: z.enum(['DESKTOP', 'CLOUD']), loginUrl: pmsLoginUrlSchema }).optional(),
  voice: z
    .object({
      voice: z.enum(VOICES).default('marin'),
      greeting: z.string().trim().max(300).optional().nullable(),
      handoffPhone: z.string().trim().max(40).optional().nullable(),
      checkInTime: clock,
      checkOutTime: clock,
      cancellationPolicy: z.string().trim().max(500).optional().nullable(),
      /** Voice only: where the phone line puts callers who ask for a person. */
      transferNumber: z
        .string()
        .trim()
        .max(40)
        .optional()
        .nullable()
        .refine((v) => !v || toE164(v) !== null, 'must be an international number, like +1 831 555 0100'),
    })
    .optional(),
});

/**
 * POST /api/onboarding — create the owner, their property and the setup for
 * the path they chose (run on HotelOne, keep their PMS, or voice only) in one
 * transaction. No payment data is collected here.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const body = await parseJson(request, schema);
  if (body.path === 'VOICE' && body.roomTypes.length === 0) {
    throw new DomainError(400, 'VALIDATION', 'Add at least one room type with its price — the voice quotes it to callers.', { issues: [{ path: ['roomTypes', 0, 'name'], message: 'is required' }] });
  }
  const urlIssue = body.bridge ? cloudLoginUrlIssue(body.bridge.mode, body.bridge.loginUrl) : null;
  if (urlIssue) throw badRequest(urlIssue);
  // Sign-up is open, so cap new hotels per hour (shared across server instances).
  const recentSignups = await prisma.property.count({ where: { isDemo: false, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recentSignups >= Number(process.env.ONBOARDING_MAX_PER_HOUR || 30)) {
    throw new DomainError(429, 'RATE_LIMITED', 'Lots of hotels are signing up right now — please try again in a little while.');
  }
  if (await prisma.user.findUnique({ where: { email: body.account.email }, select: { id: true } })) {
    throw conflict('An account with this email already exists — sign in instead.');
  }
  const passwordHash = await bcrypt.hash(body.account.password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { firstName: body.account.firstName, lastName: body.account.lastName, email: body.account.email, password: passwordHash, role: 'OWNER' },
    });
    const property = await tx.property.create({
      data: {
        name: body.property.name,
        type: body.property.type,
        address: body.property.address,
        city: body.property.city,
        state: body.property.state,
        zipCode: body.property.zipCode,
        phone: body.property.phone,
        tagline: body.property.tagline || null,
        primaryColor: body.property.primaryColor || null,
        amenities: [],
        isActive: true,
        isDemo: false,
        setupPath: body.path,
        // Hotels that keep their PMS start in the agent, where the bridge lives.
        interfaceMode: body.path === 'BRIDGE' ? 'AGENTIC' : 'CLASSIC',
      },
    });
    await tx.userPropertyAssignment.create({ data: { userId: user.id, propertyId: property.id } });
    for (const rt of body.roomTypes) {
      await tx.roomType.create({ data: { propertyId: property.id, name: rt.name, capacity: rt.capacity, basePrice: rt.basePrice, totalRooms: rt.totalRooms, amenities: [] } });
    }
    if (body.path === 'BRIDGE' && body.bridge) {
      await tx.pmsConnection.create({ data: { propertyId: property.id, system: body.bridge.system, mode: body.bridge.mode, loginUrl: body.bridge.loginUrl || null } });
    }
    // Every path gets the voice front desk configured (it's how VOICE hotels start).
    const voiceOnly = body.path === 'VOICE';
    await tx.voiceAgentConfig.create({
      data: {
        propertyId: property.id,
        voice: body.voice?.voice ?? 'marin',
        greeting: body.voice?.greeting || `Thanks for calling ${body.property.name} — how can I help?`,
        handoffPhone: body.voice?.handoffPhone || body.property.phone,
        enabled: true,
        // Voice-only hotels have no booking page to show it on.
        guestWidget: !voiceOnly,
        // Hotels that keep their own system tell callers their own times and policy.
        ...(body.path !== 'FULL'
          ? { checkInTime: body.voice?.checkInTime ?? null, checkOutTime: body.voice?.checkOutTime ?? null, cancellationPolicy: body.voice?.cancellationPolicy || null }
          : {}),
        // Messages and booking requests from callers go to the owner until they change it.
        notifyEmail: body.account.email,
      },
    });
    // The phone line is what voice-only hotels sign up for: it's on from the start, and its
    // agent is created at ElevenLabs the first time the Phone tab is opened.
    if (voiceOnly) {
      await tx.voicePhoneLine.create({ data: { propertyId: property.id, enabled: true, transferNumber: toE164(body.voice?.transferNumber) } });
    }
    await tx.agentAuditLog.create({
      data: { propertyId: property.id, userId: user.id, action: 'ONBOARDED', detail: JSON.stringify({ source: 'classic', summary: `Set up ${property.name} (${body.path === 'FULL' ? 'full platform' : body.path === 'BRIDGE' ? `keeping ${body.bridge?.system ?? 'their PMS'}` : 'voice front desk'})` }) },
    });
    return { user, property };
  });
  // The new hotel's rooms, policy and contact details become agent skills.
  scheduleConfigSkillSync(result.property.id);

  const next = body.path === 'VOICE' ? '/admin/voice?welcome=1' : body.path === 'BRIDGE' ? '/admin/connect?welcome=1' : '/admin/dashboard?welcome=1';
  return json({ message: 'Onboarding complete', property: { id: result.property.id, name: result.property.name }, next }, { status: 201 });
});
