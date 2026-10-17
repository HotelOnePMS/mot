/**
 * Messages and booking requests callers leave with the voice front desk
 * (phone line, WhatsApp, booking page). The team sees them in Voice →
 * Messages and gets an email for each new one.
 */
import { after } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { isDemoEmail } from '@/config/product';
import { siteUrl } from '../concierge/urls';
import { sendGuestRequestAlert } from '../email';

const CHANNEL: Record<string, string> = { PHONE: 'Phone call', WHATSAPP: 'WhatsApp', VOICE: 'Booking page', AGENT: 'AI assistant' };
const email = z.string().email();

/** "a@x.com, b@y.com" → valid, real addresses (demo logins never receive mail). */
export function parseNotifyEmails(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()))].filter((s) => s && email.safeParse(s).success && !isDemoEmail(s)).slice(0, 10);
}

async function deliver(requestId: string) {
  const r = await prisma.guestRequest.findUnique({
    where: { id: requestId },
    include: {
      property: {
        select: {
          name: true,
          setupPath: true,
          voiceAgent: { select: { notifyEmail: true } },
          // No address set: the hotel's owners hear about it.
          assignedUsers: { where: { user: { role: 'OWNER', isActive: true } }, select: { user: { select: { email: true } } } },
        },
      },
    },
  });
  if (!r) return;
  const configured = parseNotifyEmails(r.property.voiceAgent?.notifyEmail);
  const to = configured.length ? configured : parseNotifyEmails(r.property.assignedUsers.map((a) => a.user.email).join(','));
  if (!to.length) return;
  await sendGuestRequestAlert({
    to,
    propertyName: r.property.name,
    // Voice-only hotels have no booking page: their web conversations are the team's test calls.
    channel: r.source === 'VOICE' && r.property.setupPath === 'VOICE' ? 'Test call' : (CHANNEL[r.source] ?? 'Voice front desk'),
    booking: /booking request:/i.test(r.message),
    guestName: r.name,
    phone: r.phone,
    email: r.email,
    message: r.message,
    consoleUrl: siteUrl('/admin/voice#messages'),
  });
}

/** Email the hotel's team about a new message, after the response is sent (never delays the caller). */
export function alertTeam(requestId: string): void {
  const run = () => deliver(requestId).catch((e) => console.error('[requests] alert failed for', requestId, e));
  try {
    after(run);
  } catch {
    void run();
  }
}
