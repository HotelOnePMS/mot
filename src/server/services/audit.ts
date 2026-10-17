/**
 * Audit trail for every operational action, whether a person clicked it in
 * the classic UI or the agent executed it. Stored in agent_audit_logs
 * (action + JSON detail) so the existing table keeps its meaning.
 */
import { prisma } from '@/lib/prisma';
import type { ActivityEntry } from '@/lib/dto';
import type { Actor } from '../authz';
import { personName } from './mappers';

export type ActionSource = 'agent' | 'classic' | 'system';

export interface OpContext {
  actor: Actor;
  source: ActionSource;
}

export async function recordAudit(
  ctx: OpContext,
  propertyId: string,
  action: string,
  summary: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.agentAuditLog.create({
      data: {
        propertyId,
        userId: ctx.actor.userId,
        action,
        detail: JSON.stringify({ source: ctx.source, summary, ...data }).slice(0, 4000),
      },
    });
  } catch (e) {
    // The audit log must never break the action itself.
    console.error('Audit log write failed:', e);
  }
}

export async function listActivity(propertyId: string, limit = 60, opts: { bookingId?: string } = {}): Promise<ActivityEntry[]> {
  const rows = await prisma.agentAuditLog.findMany({
    // Booking-scoped entries carry `"bookingId":"…"` in their JSON detail.
    where: { propertyId, ...(opts.bookingId ? { detail: { contains: `"bookingId":"${opts.bookingId}"` } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  return rows.map((r) => {
    let parsed: { source?: ActivityEntry['source']; summary?: string; message?: string; from?: string; to?: string } = {};
    try {
      parsed = r.detail ? JSON.parse(r.detail) : {};
    } catch {
      parsed = { summary: r.detail ?? '' };
    }
    const summary =
      parsed.summary ??
      (r.action === 'MODE_SWITCH' && parsed.to
        ? `Switched default interface to ${parsed.to === 'AGENTIC' ? 'Agentic' : 'Classic'}`
        : r.action === 'COMMAND' && parsed.message
          ? `Asked: “${parsed.message}”`
          : r.action);
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      user: { id: r.user.id, name: personName(r.user) },
      action: r.action,
      source: parsed.source ?? (r.action === 'COMMAND' ? 'agent' : 'classic'),
      summary,
    };
  });
}
