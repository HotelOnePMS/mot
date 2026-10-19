/**
 * Audit trail for team changes (who changed whom, before and after). Written to the
 * same per-property activity log as everything else, so it shows on the Activity page.
 * Never put passwords, tokens or hashes in `before`/`after`.
 */
import { prisma } from '@/lib/prisma';
import type { AuditEntry } from '@/lib/team-rules';

export interface TeamAuditContext {
  /** Who did it (for the user's own password reset, the user themself). */
  actorUserId: string;
  source: 'classic' | 'system';
  targetUserId: string;
  /** Every property this change touches (the person's properties before and after). */
  propertyIds: string[];
}

/** Records each entry on each affected property. Never throws: the audit must not break the change. */
export async function recordTeamAudit(ctx: TeamAuditContext, entries: AuditEntry[]): Promise<void> {
  const propertyIds = [...new Set(ctx.propertyIds)];
  if (!entries.length) return;
  if (!propertyIds.length) {
    // Activity entries are per property; a platform-level account with no property has none to attach to.
    console.info('[team-audit]', JSON.stringify({ actor: ctx.actorUserId, target: ctx.targetUserId, entries: entries.map((e) => ({ action: e.action, before: e.before, after: e.after })) }));
    return;
  }
  try {
    await prisma.agentAuditLog.createMany({
      data: propertyIds.flatMap((propertyId) =>
        entries.map((e) => ({
          propertyId,
          userId: ctx.actorUserId,
          action: e.action,
          detail: JSON.stringify({ source: ctx.source, summary: e.summary, targetUserId: ctx.targetUserId, before: e.before, after: e.after }).slice(0, 4000),
        })),
      ),
    });
  } catch (e) {
    console.error('Team audit write failed:', e);
  }
}
