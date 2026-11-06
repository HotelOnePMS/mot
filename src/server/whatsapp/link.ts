/**
 * Linking a staff member's WhatsApp number to their account. The console
 * shows a one-time code; the person sends "LINK <code>" from their phone to
 * the staff number. Meta tells us which number sent it, so the number is
 * proven by the phone and the account by the signed-in console — nobody
 * types a number that could be wrong or someone else's.
 */
import { createHash, randomInt } from 'crypto';
import { prisma } from '@/lib/prisma';
import { isStaffRole } from '@/lib/routes';
import { hasPropertyAccess, scopeProperties, type Actor } from '../authz';
import { canUseWhatsAppAnywhere } from '../agent/policy';
import { forbidden } from '../errors';
import { recordAudit } from '../services/audit';
import { whatsAppConfig } from './cloud';

const CODE_TTL_MS = 10 * 60 * 1000;
// No 0/O, 1/I/L: the code is read off a screen and typed on a phone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** "ab3d-k7mq", "AB3DK7MQ" and "ab3d k7mq" are the same code. */
export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (code: string) => createHash('sha256').update(`whatsapp-link:${normalizeCode(code)}`).digest('hex');

/** "LINK AB3D-K7MQ" → "AB3DK7MQ"; null for anything else. */
export function parseLinkCommand(text: string): string | null {
  const m = /^\s*link\s+([a-z0-9][a-z0-9\s-]{6,20})\s*$/i.exec(text);
  const code = m ? normalizeCode(m[1]) : '';
  return code.length === 8 ? code : null;
}

/** "+1 ••• ••• 0100" for showing a linked number without printing all of it. */
export function maskNumber(digits: string): string {
  return `+${digits.slice(0, digits.length > 11 ? 2 : 1)} ••• ${digits.slice(-4)}`;
}

/** The agent on WhatsApp at any of this person's hotels (owners can turn it on or off per role). */
const mayLink = async (actor: Actor) => isStaffRole(actor.role) && (await canUseWhatsAppAnywhere(actor));

export interface WhatsAppLinkStatus {
  /** The staff number is set up on this deployment. */
  available: boolean;
  /** The number to message (E.164), when the deployment shows it. */
  staffNumber: string | null;
  linked: { number: string; linkedAt: string } | null;
}

export async function linkStatus(actor: Actor): Promise<WhatsAppLinkStatus> {
  const cfg = whatsAppConfig();
  if (!cfg || !(await mayLink(actor))) return { available: false, staffNumber: null, linked: null };
  const link = await prisma.staffWhatsAppLink.findUnique({
    where: { userId: actor.userId },
    select: { number: true, linkedAt: true, sessionVersion: true, user: { select: { sessionVersion: true } } },
  });
  // A link from before "sign out everywhere" (or a password change) no longer works.
  const live = link?.number && link.linkedAt && link.sessionVersion === link.user.sessionVersion;
  return {
    available: true,
    staffNumber: cfg.displayNumber,
    linked: live ? { number: maskNumber(link.number!), linkedAt: link.linkedAt!.toISOString() } : null,
  };
}

/** A new one-time code (any earlier code stops working). The current link, if any, keeps working until a new number is linked. */
export async function startLink(actor: Actor): Promise<{ code: string; expiresAt: string; staffNumber: string | null; chatUrl: string | null }> {
  if (!(await mayLink(actor))) throw forbidden('The agent on WhatsApp isn’t turned on for your role. The hotel’s owner can turn it on under Agent access.');
  const cfg = whatsAppConfig();
  if (!cfg) throw forbidden('WhatsApp isn’t set up on this site yet.');
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { sessionVersion: true } });
  // The code belongs to this session: it stops working if the person is signed out everywhere before using it.
  const pending = { codeHash: hashCode(raw), codeExpiresAt: expiresAt, codeSessionVersion: user.sessionVersion, codeAuthMethod: actor.authMethod ?? 'password' };
  await prisma.staffWhatsAppLink.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, ...pending, sessionVersion: user.sessionVersion },
    update: pending,
  });
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const digits = cfg.displayNumber?.replace(/\D/g, '');
  return { code, expiresAt: expiresAt.toISOString(), staffNumber: cfg.displayNumber, chatUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(`LINK ${code}`)}` : null };
}

/** Stops a code that hasn't been used yet ("Cancel" in the console). An existing link keeps working. */
export async function cancelLinkCode(actor: Actor): Promise<void> {
  await prisma.staffWhatsAppLink.updateMany({ where: { userId: actor.userId }, data: { codeHash: null, codeExpiresAt: null, codeSessionVersion: null, codeAuthMethod: null } });
  await prisma.staffWhatsAppLink.deleteMany({ where: { userId: actor.userId, number: null } });
}

/**
 * Linking and unlinking go in the activity log of the chat's hotel (while the
 * person still works there), or the person's first hotel. A platform admin's
 * link isn't any customer hotel's business: it goes to the server log.
 */
export async function auditLink(actor: Actor, propertyId: string | null, action: 'WHATSAPP_LINKED' | 'WHATSAPP_UNLINKED', summary: string, data: Record<string, unknown> = {}): Promise<void> {
  const chatHotel = propertyId && actor.propertyIds !== 'ALL' && hasPropertyAccess(actor, propertyId) ? propertyId : null;
  const pid =
    chatHotel ?? (actor.propertyIds === 'ALL' ? null : (await prisma.property.findFirst({ where: scopeProperties(actor), orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id);
  if (pid) await recordAudit({ actor, source: 'agent' }, pid, action, summary, { channel: 'whatsapp', ...data });
  else console.info(`[whatsapp] ${action} ${summary} by ${actor.email} (${actor.userId})`);
}

export async function unlink(actor: Actor, via: 'console' | 'whatsapp'): Promise<void> {
  const link = await prisma.staffWhatsAppLink.findUnique({ where: { userId: actor.userId }, select: { number: true, propertyId: true } });
  if (!link) return;
  await prisma.staffWhatsAppLink.delete({ where: { userId: actor.userId } });
  if (link.number) await auditLink(actor, link.propertyId, 'WHATSAPP_UNLINKED', `Unlinked WhatsApp ${maskNumber(link.number)}`, { via });
}

export type LinkOutcome = { ok: true; userId: string; firstName: string; sessionVersion: number; authMethod: string } | { ok: false; reason: 'invalid' | 'taken' };

/**
 * Binds the sender's number to the account whose code they sent. The code is
 * single-use, expires after 10 minutes, and only works while the console
 * session that asked for it would (same sessionVersion). The link records the
 * account's sessionVersion, so "sign out everywhere" also ends it.
 */
export async function linkByCode(from: string, code: string): Promise<LinkOutcome> {
  const pending = await prisma.staffWhatsAppLink.findUnique({
    where: { codeHash: hashCode(code) },
    select: { userId: true, codeExpiresAt: true, codeSessionVersion: true, codeAuthMethod: true, user: { select: { firstName: true, sessionVersion: true, isActive: true } } },
  });
  if (!pending || !pending.codeExpiresAt || pending.codeExpiresAt < new Date() || !pending.user.isActive) return { ok: false, reason: 'invalid' };
  // Signed out everywhere (or a new password) since the code was shown: it no longer works.
  if (pending.codeSessionVersion !== pending.user.sessionVersion) return { ok: false, reason: 'invalid' };
  const authMethod = pending.codeAuthMethod ?? 'password';
  const other = await prisma.staffWhatsAppLink.findUnique({ where: { number: from }, select: { userId: true } });
  if (other && other.userId !== pending.userId) return { ok: false, reason: 'taken' };
  // Clearing the code in the same update makes it single-use even if two messages race.
  const { count } = await prisma.staffWhatsAppLink.updateMany({
    where: { userId: pending.userId, codeHash: hashCode(code), codeSessionVersion: pending.user.sessionVersion },
    data: {
      number: from,
      linkedAt: new Date(),
      codeHash: null,
      codeExpiresAt: null,
      codeSessionVersion: null,
      codeAuthMethod: null,
      sessionVersion: pending.user.sessionVersion,
      authMethod,
      pendingPlan: null,
      choices: [],
      alertUnseen: false,
    },
  });
  if (!count) return { ok: false, reason: 'invalid' };
  return { ok: true, userId: pending.userId, firstName: pending.user.firstName, sessionVersion: pending.user.sessionVersion, authMethod };
}
