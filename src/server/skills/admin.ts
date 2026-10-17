/**
 * The Skills page's server side: skill views for the console, access and
 * demo checks, and plain-words audit summaries. Routes in
 * src/app/api/admin/skills use these.
 */
import { prisma } from '@/lib/prisma';
import type { SkillView } from '@/lib/dto';
import { assertPropertyAccess, type Actor } from '../authz';
import { demoHotelLocked } from '../demo';
import { badRequest, forbidden, notFound } from '../errors';
import { ensureConfigSkills } from './config';
import { getSkillById, listSkills } from './index';
import { inputNames } from './params';
import { SKILL_KINDS, isSkillKind, type Skill } from './types';

/** Why guest-facing answers stay as seeded in the public demo. */
export const SKILLS_DEMO_LOCKED = 'Demo hotels keep what guests hear the same for every visitor. Shortcuts and staff-only answers are yours to try — set up your own hotel to change guest answers.';

const SAMPLE: Record<string, string> = { guest: 'Smith', guest2: 'Lee', room: 'room 204', room2: 'room 205', date: 'tomorrow', date2: 'Friday' };

/** Where a CONFIG answer comes from, so people change it there. */
function editIn(skill: Skill): SkillView['editIn'] {
  if (skill.source !== 'CONFIG' || !skill.propertyId) return null;
  if (skill.key.startsWith('faq-')) return { label: 'Edit in Voice settings', href: '/admin/voice#settings' };
  if (skill.key === 'rooms') return { label: 'Edit in Room types', href: '/admin/room-types' };
  if (skill.key === 'amenities' || skill.key === 'contact') return { label: 'Edit in Property', href: `/admin/properties/${skill.propertyId}` };
  return null; // policies: the standard platform policy
}

/** A skill as the console shows it. */
export function skillView(skill: Skill, names: Map<string, string> = new Map()): SkillView {
  const inputs = inputNames(skill.kind, skill.body, skill.parameters);
  const base: SkillView = {
    id: skill.id,
    key: skill.key,
    kind: skill.kind,
    source: skill.source,
    status: skill.status,
    audience: skill.audience,
    title: skill.title,
    description: skill.description,
    inputs,
    uses: skill.uses,
    lastUsedAt: skill.lastUsedAt?.toISOString() ?? null,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
    createdBy: skill.createdById ? names.get(skill.createdById) ?? null : null,
    editIn: editIn(skill),
  };
  if (skill.kind === 'ANSWER') return { ...base, answer: skill.body.answer };
  if (skill.kind === 'MACRO') {
    const name = skill.title.charAt(0).toLowerCase() + skill.title.slice(1);
    return { ...base, steps: skill.body.steps.map((s) => s.command), example: inputs.length ? `${name} for ${inputs.map((p) => SAMPLE[p] ?? p).slice(0, 3).join(', ')}` : name };
  }
  return {
    ...base,
    steps: skill.body.steps,
    system: skill.body.system,
    intent: skill.body.intent,
    successes: skill.body.successes ?? 0,
    failures: skill.body.failures ?? 0,
    failStreak: skill.body.failStreak ?? 0,
    autoDisabled: skill.status === 'DISABLED' && !!skill.body.autoDisabledAt,
  };
}

/** A hotel's skills for the Skills page (generating its settings answers on first visit), plus its PMS tool count. */
export async function skillsForAdmin(propertyId: string): Promise<{ skills: SkillView[]; pmsTools: number }> {
  await ensureConfigSkills(propertyId);
  const [skills, pmsTools] = await Promise.all([
    listSkills(propertyId, { kinds: [...SKILL_KINDS] }),
    prisma.agentSkill.count({ where: { propertyId, kind: { notIn: [...SKILL_KINDS] } } }),
  ]);
  const ids = [...new Set(skills.map((s) => s.createdById).filter((x): x is string => !!x))];
  const people = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const names = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
  return { skills: skills.map((s) => skillView(s, names)), pmsTools };
}

/** True when changing this skill changes what guests hear (a guest-facing answer). */
export const guestFacing = (s: Pick<Skill, 'kind' | 'audience'>) => s.kind === 'ANSWER' && s.audience !== 'STAFF';

/** Whether guest-facing answers are locked for this person at this hotel (public demo). */
export async function guestAnswersLocked(actor: Actor, propertyId: string): Promise<boolean> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { isDemo: true } });
  return demoHotelLocked(actor, !!p?.isDemo);
}

/**
 * Loads a skill a staff member may manage: it must belong to a hotel they
 * can access (platform-wide skills are for platform admins) and be one of
 * the kinds this page handles. DomainError 404 / 403 / 400.
 */
export async function skillForStaff(actor: Actor, id: string): Promise<Skill> {
  const skill = await getSkillById(id);
  if (!skill) throw notFound('Skill');
  if (skill.propertyId) assertPropertyAccess(actor, skill.propertyId);
  else if (actor.role !== 'ADMIN') throw forbidden('Only platform admins can change skills shared by every hotel.');
  if (!isSkillKind(skill.kind)) throw badRequest('This tool is managed on the Your PMS page.');
  return skill;
}

const KIND_WORD: Record<string, string> = { ANSWER: 'saved answer', MACRO: 'shortcut', RECIPE: 'PMS recipe' };

/** "the saved answer “Is parking free?”" */
export const describeSkill = (s: Pick<Skill, 'kind' | 'title' | 'status'>, opts: { suggested?: boolean } = {}) =>
  `the ${opts.suggested ? 'suggested ' : ''}${KIND_WORD[s.kind] ?? 'skill'} “${s.title.slice(0, 80)}”`;
