import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { badRequest, forbidden } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { deleteSkill, updateSkill, type SkillBody, type SkillPatch } from '@/server/skills';
import { SKILLS_DEMO_LOCKED, describeSkill, guestAnswersLocked, guestFacing, skillForStaff, skillView } from '@/server/skills/admin';

export const dynamic = 'force-dynamic';

type Route = { params: Promise<{ skillId: string }> };

const patchSchema = z
  .object({
    /** ACTIVE (on / approve), DISABLED (off / dismiss). */
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    title: z.string().trim().min(1, 'The name can’t be empty.').max(120).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    /** ANSWER only. */
    answer: z.string().trim().min(1, 'The answer can’t be empty.').max(4000).optional(),
    /** ANSWER only: guests and staff, or staff only. */
    audience: z.enum(['ALL', 'STAFF']).optional(),
    /** MACRO (commands) or RECIPE (instructions). */
    steps: z.array(z.string().trim().max(1000)).max(40).transform((a) => a.filter(Boolean)).pipe(z.array(z.string()).min(1, 'Keep at least one step.')).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change.');

/**
 * PATCH — switch a skill on or off, approve or dismiss a suggestion, or edit
 * the wording/steps of a learned or added skill. Answers made from settings
 * can only be switched on or off (their words come from the settings).
 */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Route) => {
  const actor = await requireStaff('skills.manage');
  const { skillId } = await params;
  const skill = await skillForStaff(actor, skillId);
  const body = await parseJson(request, patchSchema);
  const edits = body.title !== undefined || body.description !== undefined || body.answer !== undefined || body.audience !== undefined || body.steps !== undefined;
  if (edits && skill.source === 'CONFIG') throw badRequest('This answer is made from your settings — change the words there, or switch it off here.');
  if (body.answer !== undefined && skill.kind !== 'ANSWER') throw badRequest('Only saved answers have an answer.');
  if (body.audience !== undefined && skill.kind !== 'ANSWER') throw badRequest('Only saved answers can be for guests.');
  if (body.steps !== undefined && skill.kind === 'ANSWER') throw badRequest('Saved answers don’t have steps.');
  const touchesGuests = guestFacing(skill) || body.audience === 'ALL';
  if (touchesGuests && skill.propertyId && (await guestAnswersLocked(actor, skill.propertyId))) throw forbidden(SKILLS_DEMO_LOCKED);

  const patch: SkillPatch = { status: body.status, title: body.title, description: body.description, audience: body.audience };
  if (skill.kind === 'ANSWER' && body.answer !== undefined) patch.body = { answer: body.answer };
  if (skill.kind === 'MACRO' && body.steps) {
    patch.body = { steps: body.steps.map((command) => ({ command: command.slice(0, 500) })) };
    if (body.description === undefined && skill.description.startsWith('Shortcut:')) patch.description = `Shortcut: ${body.steps.join(' → ')}`.slice(0, 500);
  }
  if (skill.kind === 'RECIPE' && body.steps) patch.body = { ...skill.body, steps: body.steps } as SkillBody;
  const updated = await updateSkill(skill.id, patch);

  const what = describeSkill(skill, { suggested: skill.status === 'SUGGESTED' });
  const summary =
    skill.status === 'SUGGESTED' && body.status === 'ACTIVE'
      ? `Approved ${what}`
      : skill.status === 'SUGGESTED' && body.status === 'DISABLED'
        ? `Dismissed ${what}`
        : body.status && body.status !== skill.status && !edits
          ? `${body.status === 'ACTIVE' ? 'Switched on' : 'Switched off'} ${what}`
          : `Edited ${what}${body.title && body.title !== skill.title ? ` (now “${updated.title}”)` : ''}`;
  if (skill.propertyId) await recordAudit({ actor, source: 'classic' }, skill.propertyId, 'SKILL_UPDATE', summary, { skillId: skill.id, skillKey: skill.key, status: updated.status });
  return json({ skill: skillView(updated) });
});

/** DELETE — remove a learned or added skill. Answers from settings come back with the next sync, so they're switched off instead. */
export const DELETE = handleRoute(async (_request: NextRequest, { params }: Route) => {
  const actor = await requireStaff('skills.manage');
  const { skillId } = await params;
  const skill = await skillForStaff(actor, skillId);
  if (skill.source === 'CONFIG') throw badRequest('This answer is made from your settings, so it would come back. Switch it off instead.');
  if (guestFacing(skill) && skill.propertyId && (await guestAnswersLocked(actor, skill.propertyId))) throw forbidden(SKILLS_DEMO_LOCKED);
  const removed = await deleteSkill(skill.id);
  if (skill.propertyId) {
    await recordAudit({ actor, source: 'classic' }, skill.propertyId, 'SKILL_DELETE', `${skill.status === 'SUGGESTED' ? 'Dismissed' : 'Deleted'} ${describeSkill(skill, { suggested: skill.status === 'SUGGESTED' })}`, { skillKey: skill.key });
  }
  return json({ deleted: removed.id });
});
