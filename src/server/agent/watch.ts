/**
 * The always-on agent. It looks over each hotel the way a good duty manager
 * would — the front desk's alerts, housekeeping gaps, guest messages, card
 * disputes, PMS work that needs a person, OTA connections that stopped — and
 * messages the people who should know on WhatsApp, with the fix as a
 * one-number reply. Replying runs that command through the agent, so any
 * change still comes back as a plan to confirm with YES.
 *
 * Who hears about what is the hotel's agent access (policy.ts): each role's
 * alert list, filtered by what the person may see and whether they may use
 * the agent on WhatsApp there. Each situation is claimed once (AgentNotice,
 * unique per hotel and key) before anything is sent, so overlapping runs
 * never send it twice. Non-urgent alerts wait out the night (22:00–07:00
 * hotel time; front desk and housekeeping alerts until the 08:00 brief,
 * which lists them); the brief goes out between 08:00 and 11:00.
 *
 * Runs from /api/cron/agent-watch (every 15 minutes or so), and right away
 * for one hotel when something urgent happens (watchSoon).
 */
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { NoticeKind } from '@/lib/agent/access';
import { formatMoney } from '@/lib/format';
import { actorForLinkedChannel, can, hasPropertyAccess, type Actor } from '../authz';
import { hotelToday, hourIn } from '../dates';
import { logError } from '../log';
import { publicSiteUrl } from '../public-url';
import { frontDeskSummary } from '../services/frontdesk';
import { localeOf } from '../services/hotels';
import { sendTemplate, sendText, whatsAppConfig, type WhatsAppConfig } from '../whatsapp/cloud';
import { choiceAt, renderBlocks } from '../whatsapp/format';
import { agentActor, alertsFor, canUseWhatsApp, loadPolicy, NOTICE_PERMISSION } from './policy';
import { runRead } from './tools';

export interface Notice {
  /** Stable per situation: the same problem on the same day has the same key. */
  key: string;
  kind: NoticeKind;
  /** Sent at night too. */
  urgent: boolean;
  title: string;
  detail?: string;
  /** A command that deals with it, offered as a numbered reply. */
  action?: { label: string; command: string };
  /** A console page for anything the agent can't do from chat. */
  href?: string;
}

const QUIET_FROM = 22;
const QUIET_UNTIL = 7;
const BRIEF_HOUR = 8;
/** A brief that couldn't go out by 11am (no scheduler running yet, say) is skipped: by then it isn't a morning brief. */
const BRIEF_UNTIL = 11;
/** WhatsApp allows free-form messages for 24 hours after the person's last message; keep a margin. */
const WINDOW_MS = 23.5 * 3600_000;
const MAX_NOTICES = 6;
/** Alerts the morning brief lists itself. */
const FOLDED_INTO_BRIEF = new Set<NoticeKind>(['frontdesk', 'housekeeping']);

export const isQuietHour = (hour: number) => hour >= QUIET_FROM || hour < QUIET_UNTIL;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Reads hotel data for alerts only: never acts, never audits. */
function watcher(propertyId: string): Actor {
  return { userId: 'system:watch', role: 'ADMIN', name: 'Always-on agent', email: '', propertyIds: [propertyId], orgAdminOf: [], orgIds: [], mfaEnabled: false, emailVerified: true, mfaSetupRequired: false };
}

/** Everything worth telling someone at this hotel right now. */
export async function noticesFor(propertyId: string, today: string, now: Date): Promise<Notice[]> {
  const notices: Notice[] = [];
  const since = (hours: number) => new Date(now.getTime() - hours * 3600_000);

  const [summary, requests, disputes, tasks, channels] = await Promise.all([
    frontDeskSummary(watcher(propertyId), propertyId, today).catch((e) => {
      logError('agent/watch', `Front desk summary failed for ${propertyId}:`, e);
      return null;
    }),
    prisma.guestRequest.findMany({ where: { propertyId, status: 'NEW', createdAt: { gte: since(24) } }, orderBy: { createdAt: 'asc' }, take: 10 }),
    prisma.dispute.findMany({
      where: { propertyId, status: { in: ['needs_response', 'warning_needs_response'] }, evidenceSubmittedAt: null, closedAt: null, createdAt: { gte: since(24 * 14) } },
      take: 5,
    }),
    prisma.bridgeTask.findMany({
      where: { propertyId, status: { in: ['FAILED', 'NEEDS_HELP'] }, OR: [{ finishedAt: { gte: since(24) } }, { finishedAt: null, createdAt: { gte: since(24) } }] },
      include: { connection: { select: { system: true } } },
      take: 5,
    }),
    prisma.channelConnection.findMany({ where: { propertyId, status: 'ERROR' }, select: { id: true, channel: true, lastError: true } }),
  ]);

  for (const a of summary?.alerts ?? []) {
    const housekeeping = a.id === 'dirty' || a.id.startsWith('ready-');
    notices.push({
      key: `frontdesk:${a.id}:${today}`,
      kind: housekeeping ? 'housekeeping' : 'frontdesk',
      urgent: false,
      title: a.title,
      detail: a.detail,
      action: a.command ? { label: a.command.charAt(0).toUpperCase() + a.command.slice(1), command: a.command } : undefined,
    });
  }
  for (const r of requests) {
    const booking = /booking request:/i.test(r.message);
    notices.push({
      key: `guestRequest:${r.id}`,
      kind: 'guestRequests',
      urgent: false,
      title: `${booking ? 'Booking request' : 'Message'} from ${r.name}${r.phone ? ` (${r.phone})` : ''}`,
      detail: clip(r.message.replace(/\s+/g, ' '), 220),
      href: '/admin/voice#messages',
    });
  }
  for (const d of disputes) {
    notices.push({
      key: `dispute:${d.id}`,
      kind: 'disputes',
      urgent: true,
      title: `Card dispute: ${formatMoney(Number(d.amount), d.currency.toUpperCase())}${d.reason ? ` (${d.reason.replace(/_/g, ' ')})` : ''}`,
      detail: d.evidenceDueBy ? `Evidence is due by ${d.evidenceDueBy.toUTCString().slice(0, 16)}. It’s ready for you to review.` : 'The evidence is ready for you to review.',
      href: `/admin/disputes?dispute=${d.id}`,
    });
  }
  for (const t of tasks) {
    const summaryText = (t.result as { summary?: string | null } | null)?.summary;
    notices.push({
      key: `pms:${t.id}:${t.status}`,
      kind: 'pms',
      urgent: false,
      title: `${t.connection.system}: “${clip(t.instruction, 80)}” ${t.status === 'FAILED' ? 'failed' : 'needs a person'}`,
      detail: clip((t.status === 'FAILED' ? t.error : summaryText) ?? '', 200) || undefined,
      href: '/admin/connect',
    });
  }
  for (const c of channels) {
    notices.push({
      key: `channel:${c.id}:${today}`,
      kind: 'channels',
      urgent: false,
      title: `${c.channel === 'BOOKING_COM' ? 'Booking.com' : 'Expedia'} stopped syncing`,
      detail: c.lastError ? clip(c.lastError, 200) : undefined,
      href: '/admin/channels',
    });
  }
  return notices;
}

/** One alert message: what happened, and the fixes as numbered replies. */
export function alertMessage(hotelName: string, notices: Notice[], siteUrl: string | null, propertyId: string): { text: string; summary: string; choices: string[] } {
  const choices: string[] = [];
  const lines: string[] = [`🔔 *${hotelName}*${notices.length > 1 ? ` — ${notices.length} things need you` : ''}`];
  for (const n of notices.slice(0, MAX_NOTICES)) {
    const icon = n.urgent ? '🔴' : n.kind === 'guestRequests' ? '💬' : '🟠';
    lines.push('', `${icon} *${n.title}*${n.detail ? `\n${n.detail}` : ''}`);
    if (n.action && choices.length < 9) {
      choices.push(choiceAt(propertyId, n.action.command));
      lines.push(`Reply *${choices.length}* to: ${n.action.label}`);
    } else if (n.href) {
      lines.push(siteUrl ? `${siteUrl}${n.href}` : `Open ${n.href} in the console`);
    }
  }
  if (notices.length > MAX_NOTICES) lines.push('', `…and ${notices.length - MAX_NOTICES} more. Send “brief me” for the full picture.`);
  const summary = notices.map((n) => n.title).join('; ');
  return { text: lines.join('\n'), summary, choices };
}

interface Recipient {
  link: { userId: string; number: string; lastInboundAt: Date | null; propertyId: string | null };
  person: Actor;
}

export interface WatchReport {
  hotels: number;
  notices: number;
  messages: number;
  skipped?: string;
}

/**
 * Looks over every hotel with someone linked on WhatsApp (or just one) and
 * sends what's new. Safe to run as often as you like.
 */
export async function runWatch(opts: { propertyId?: string; now?: Date } = {}): Promise<WatchReport> {
  const cfg = whatsAppConfig();
  if (!cfg) return { hotels: 0, notices: 0, messages: 0, skipped: 'WhatsApp is not configured' };
  const now = opts.now ?? new Date();
  const links = await prisma.staffWhatsAppLink.findMany({
    where: { number: { not: null }, linkedAt: { not: null }, alertsOff: false },
    select: { userId: true, number: true, lastInboundAt: true, propertyId: true, sessionVersion: true },
  });
  const recipients: Recipient[] = [];
  for (const l of links) {
    const person = await actorForLinkedChannel(l.userId, l.sessionVersion);
    // Platform admins see every hotel: they aren't sent every hotel's alerts.
    if (person && person.propertyIds !== 'ALL' && !person.mustChangePassword && !person.mfaSetupRequired) recipients.push({ link: { ...l, number: l.number! }, person });
  }
  const hotelIds = [...new Set(recipients.flatMap((r) => r.person.propertyIds as string[]))].filter((id) => !opts.propertyId || id === opts.propertyId);
  if (!hotelIds.length) return { hotels: 0, notices: 0, messages: 0 };
  const hotels = await prisma.property.findMany({ where: { id: { in: hotelIds } }, select: { id: true, name: true, timezone: true, currency: true } });

  const report: WatchReport = { hotels: hotels.length, notices: 0, messages: 0 };
  // Claims only need to outlive the situations they cover (a day, or a dispute's two weeks).
  if (!opts.propertyId) await prisma.agentNotice.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 3600_000) } } }).catch(() => undefined);
  for (const hotel of hotels) {
    try {
      const sent = await watchHotel(cfg, hotel, recipients.filter((r) => hasPropertyAccess(r.person, hotel.id)), now);
      report.notices += sent.notices;
      report.messages += sent.messages;
    } catch (e) {
      logError('agent/watch', `Watching ${hotel.id} failed:`, e);
    }
  }
  return report;
}

/** Claims each notice once (unique per hotel and key); returns the ones this run won. */
async function claim(propertyId: string, notices: Notice[]): Promise<Notice[]> {
  const won: Notice[] = [];
  for (const n of notices) {
    try {
      await prisma.agentNotice.create({ data: { propertyId, key: n.key, kind: n.kind, title: clip(n.title, 300) } });
      won.push(n);
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
  }
  return won;
}

async function watchHotel(
  cfg: WhatsAppConfig,
  hotel: { id: string; name: string; timezone: string | null; currency: string },
  recipients: Recipient[],
  now: Date
): Promise<{ notices: number; messages: number }> {
  if (!recipients.length) return { notices: 0, messages: 0 };
  const { timezone, currency } = localeOf(hotel);
  const hour = hourIn(timezone, now);
  const today = hotelToday(now, timezone);
  const policy = await loadPolicy(hotel.id);
  // Each person with what they're allowed to hear about here.
  const audience: { r: Recipient; kinds: Set<NoticeKind>; actor: Actor }[] = [];
  for (const r of recipients) {
    const actor = await agentActor(r.person, hotel.id, policy);
    if (!canUseWhatsApp(actor)) continue;
    const kinds = alertsFor(policy, r.person.role).filter((k) => can(actor, NOTICE_PERMISSION[k]));
    if (kinds.length) audience.push({ r, kinds: new Set(kinds), actor });
  }
  if (!audience.length) return { notices: 0, messages: 0 };

  let messages = 0;
  const quiet = isQuietHour(hour);
  const wanted = new Set(audience.flatMap((a) => [...a.kinds]));
  // Front desk and housekeeping alerts wait for the brief hour, so the people who get the brief hear about them once, in it.
  const waits = (n: Notice) => !n.urgent && (quiet || (FOLDED_INTO_BRIEF.has(n.kind) && hour < BRIEF_HOUR));
  const found = (await noticesFor(hotel.id, today, now)).filter((n) => wanted.has(n.kind) && !waits(n));
  const fresh = await claim(hotel.id, found);
  const site = publicSiteUrl();
  // The morning brief: once a day, 08:00–11:00 hotel time. It lists the front desk's alerts, so its readers don't get those twice.
  const briefDue = hour >= BRIEF_HOUR && hour < BRIEF_UNTIL && audience.some((a) => a.kinds.has('brief')) && (await claim(hotel.id, [{ key: `brief:${today}`, kind: 'brief', urgent: false, title: `Morning brief ${today}` }])).length > 0;
  for (const a of audience) {
    const briefed = briefDue && a.kinds.has('brief');
    if (briefed) {
      const brief = await briefFor(a.actor, hotel, today, currency, site);
      if (brief && (await deliver(cfg, a.r, hotel.name, { text: `☀️ *Good morning — ${hotel.name}*\n\n${brief.text}`, summary: 'your morning brief is ready', choices: brief.choices }, now))) messages++;
    }
    const theirs = fresh.filter((n) => a.kinds.has(n.kind) && !(briefed && FOLDED_INTO_BRIEF.has(n.kind)));
    if (!theirs.length) continue;
    const msg = alertMessage(hotel.name, theirs, site, hotel.id);
    if (!(await deliver(cfg, a.r, hotel.name, msg, now))) continue;
    messages++;
    await prisma.agentNotice.updateMany({ where: { propertyId: hotel.id, key: { in: theirs.map((n) => n.key) } }, data: { sentTo: { push: a.r.link.userId } } });
  }
  return { notices: fresh.length, messages };
}

/** Today at a glance, read with the person's own agent access (a look-up: nothing is changed or logged as theirs). */
async function briefFor(actor: Actor, hotel: { id: string; name: string }, today: string, currency: string, site: string | null): Promise<{ text: string; choices: string[] } | null> {
  try {
    const out = await runRead({ actor, propertyId: hotel.id, propertyName: hotel.name, today, memory: {}, message: 'brief me' }, { kind: 'overview' });
    if (!out.blocks.length || out.blocks.every((b) => b.type === 'error')) return null;
    const r = renderBlocks(out.blocks, { currency, siteUrl: site });
    return { text: r.text, choices: r.choices.map((c) => choiceAt(hotel.id, c)) };
  } catch (e) {
    logError('agent/watch', 'Morning brief failed:', e);
    return null;
  }
}

/**
 * Sends inside the 24-hour window as a normal message; outside it, as the
 * approved alert template (when there is one), keeping the full text for
 * "details". The numbered replies work either way.
 */
async function deliver(cfg: WhatsAppConfig, r: Recipient, hotelName: string, msg: { text: string; summary: string; choices: string[] }, now: Date): Promise<boolean> {
  const inWindow = !!r.link.lastInboundAt && now.getTime() - r.link.lastInboundAt.getTime() < WINDOW_MS;
  try {
    if (inWindow) {
      await sendText(cfg, r.link.number, msg.text);
    } else if (cfg.alertTemplate) {
      await sendTemplate(cfg, r.link.number, cfg.alertTemplate, [hotelName, msg.summary]);
    } else {
      return false; // WhatsApp won't deliver a free-form message now, and there's no template to use.
    }
  } catch (e) {
    logError('agent/watch', `Alert to ${r.link.userId} failed:`, e);
    return false;
  }
  await prisma.staffWhatsAppLink.update({ where: { userId: r.link.userId }, data: { choices: msg.choices, lastAlert: msg.text.slice(0, 4000) } });
  return true;
}

const lastLook = new Map<string, number>();
const HEARTBEAT_MS = 10 * 60_000;

/**
 * Check one hotel after the response: right away when something just
 * happened there, or — with `heartbeat` — at most every 10 minutes per server
 * instance while people are using HotelOne, so alerts flow even before a
 * scheduler is set up. Claims make every extra run harmless.
 */
export function watchSoon(propertyId: string, opts: { heartbeat?: boolean } = {}): void {
  if (!whatsAppConfig()) return;
  if (opts.heartbeat) {
    const last = lastLook.get(propertyId) ?? 0;
    if (Date.now() - last < HEARTBEAT_MS) return;
    if (lastLook.size > 1000) lastLook.clear();
  }
  lastLook.set(propertyId, Date.now());
  const run = () => runWatch({ propertyId }).then(() => undefined, (e) => logError('agent/watch', `Watch for ${propertyId} failed:`, e));
  try {
    after(run);
  } catch {
    void run();
  }
}
