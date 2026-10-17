import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { SkillsResponse } from '@/lib/dto';
import { can, requireStaff, resolvePropertyId } from '@/server/authz';
import { conflict, forbidden } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { parametersFor, skillKey, upsertSkill, type MacroBody } from '@/server/skills';
import { SKILLS_DEMO_LOCKED, guestAnswersLocked, skillView, skillsForAdmin } from '@/server/skills/admin';

export const dynamic = 'force-dynamic';

/**
 * GET ?propertyId — everything the hotel's agents know and can do: answers
 * from settings (CONFIG), what agents learned (shortcuts, PMS recipes,
 * suggestions) and what people added (MANUAL). Needs skills.view.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('skills.view');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const [{ skills, pmsTools }, locked] = await Promise.all([skillsForAdmin(propertyId), guestAnswersLocked(actor, propertyId)]);
  const body: SkillsResponse = { skills, pmsTools, canManage: can(actor, 'skills.manage'), guestAnswersLocked: locked ? SKILLS_DEMO_LOCKED : null };
  return json(body);
});

const text = (max: number, msg: string) => z.string().trim().min(1, msg).max(max);

const createSchema = z.discriminatedUnion('kind', [
  z.object({
    propertyId: z.string().min(1),
    kind: z.literal('ANSWER'),
    question: text(120, 'Write the question, like “Is parking free?”'),
    answer: text(4000, 'Write the answer agents should give.'),
    /** ALL = guests and staff; STAFF = staff only. */
    audience: z.enum(['ALL', 'STAFF']).default('ALL'),
  }),
  z.object({
    propertyId: z.string().min(1),
    kind: z.literal('MACRO'),
    name: text(60, 'Give the shortcut a short name, like “late checkout”.'),
    steps: z.array(z.string().trim().max(500)).max(20).transform((a) => a.filter(Boolean)).pipe(z.array(z.string()).min(1, 'Add at least one step — a command you’d type to the agent.')),
  }),
]);

/** POST — add an answer or a shortcut (source MANUAL). Needs skills.manage. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('skills.manage');
  const body = await parseJson(request, createSchema);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  const ctx = { actor, source: 'classic' as const };

  if (body.kind === 'ANSWER') {
    if (body.audience !== 'STAFF' && (await guestAnswersLocked(actor, propertyId))) throw forbidden(SKILLS_DEMO_LOCKED);
    const key = `answer-${skillKey(body.question, 52)}`;
    if (await prisma.agentSkill.findFirst({ where: { propertyId, key }, select: { id: true } })) throw conflict('There’s already an answer to that question — edit it instead.');
    const skill = await upsertSkill({
      propertyId,
      key,
      title: body.question,
      description: `Saved answer. Use when someone asks: “${body.question.replace(/["“”]/g, '')}”`,
      kind: 'ANSWER',
      audience: body.audience,
      body: { answer: body.answer },
      source: 'MANUAL',
      status: 'ACTIVE',
      createdById: actor.userId,
    });
    await recordAudit(ctx, propertyId, 'SKILL_CREATE', `Added the saved answer “${skill.title}”${skill.audience === 'STAFF' ? ' (staff only)' : ''}`, { skillId: skill.id, skillKey: skill.key });
    return json({ skill: skillView(skill) }, { status: 201 });
  }

  const key = skillKey(body.name);
  if (await prisma.agentSkill.findFirst({ where: { propertyId, key }, select: { id: true } })) throw conflict('There’s already a shortcut with that name — pick another name or edit the existing one.');
  const macro: MacroBody = { steps: body.steps.map((command) => ({ command })) };
  const skill = await upsertSkill({
    propertyId,
    key,
    title: body.name.charAt(0).toUpperCase() + body.name.slice(1),
    description: `Shortcut: ${body.steps.join(' → ')}`.slice(0, 500),
    kind: 'MACRO',
    audience: 'STAFF',
    parameters: parametersFor('MACRO', macro),
    body: macro,
    source: 'MANUAL',
    status: 'ACTIVE',
    createdById: actor.userId,
  });
  await recordAudit(ctx, propertyId, 'SKILL_CREATE', `Added the shortcut “${skill.title}” (${body.steps.length} step${body.steps.length === 1 ? '' : 's'})`, { skillId: skill.id, skillKey: skill.key });
  return json({ skill: skillView(skill) }, { status: 201 });
});
