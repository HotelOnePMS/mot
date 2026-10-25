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
 * the agent on WhatsApp there. Each situation is recorded once per hotel
 * (AgentNotice, unique per hotel and key) and claimed for each person
 * (sentTo) just before their message goes out, so overlapping runs never send
 * it to them twice, and a send that fails hands it back for the next round.
 * A person gets one message a round, whatever their hotels have for them.
 * Non-urgent alerts wait out the night (22:00–07:00 hotel time; front desk
 * and housekeeping alerts until the 08:00 brief, which lists them); the brief
 * goes out between 08:00 and 11:00.
 *
 * Runs from /api/cron/agent-watch (every 15 minutes or so), and right away
 * for one hotel when something urgent happens (watchSoon).
 */
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { NoticeKind } from '@/lib/agent/access';
import type { AgentBlock } from '@/lib/agent/blocks';
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
  /** When it happened, for newest first; without one it's about right now (the front desk, a channel). */
  at?: Date;
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
/** Alerts in one message; the rest come in the next. */
const MAX_NOTICES = 6;
/** Numbered replies in one message, so each is a single digit. */
const MAX_CHOICES = 9;
/** Guest messages, disputes and PMS work looked at per round, newest first (ones a person already had are skipped). */
const MAX_FOUND = 50;
/** Alerts the morning brief lists itself. */
const FOLDED_INTO_BRIEF = new Set<NoticeKind>(['frontdesk', 'housekeeping']);

export const isQuietHour = (hour: number) => hour >= QUIET_FROM || hour < QUIET_UNTIL;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const briefKey = (today: string) => `brief:${today}`;

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
    prisma.guestRequest.findMany({ where: { propertyId, status: 'NEW', createdAt: { gte: since(24) } }, orderBy: { createdAt: 'desc' }, take: MAX_FOUND }),
    prisma.dispute.findMany({
      where: { propertyId, status: { in: ['needs_response', 'warning_needs_response'] }, evidenceSubmittedAt: null, closedAt: null, createdAt: { gte: since(24 * 14) } },
      orderBy: { createdAt: 'desc' },
      take: MAX_FOUND,
    }),
    prisma.bridgeTask.findMany({
      where: { propertyId, status: { in: ['FAILED', 'NEEDS_HELP'] }, OR: [{ finishedAt: { gte: since(24) } }, { finishedAt: null, createdAt: { gte: since(24) } }] },
      include: { connection: { select: { system: true } } },
      orderBy: [{ finishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: MAX_FOUND,
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
      at: r.createdAt,
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
      at: d.createdAt,
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
      at: t.finishedAt ?? t.createdAt,
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

/**
 * One hotel's alerts: what happened, and the fixes as numbered replies.
 * `numbered` is how many numbers the message used before these; past nine in
 * all, a fix is shown as the command to send instead.
 */
export function alertMessage(
  hotelName: string,
  notices: Notice[],
  siteUrl: string | null,
  propertyId: string,
  opts: { numbered?: number } = {}
): { text: string; summary: string; choices: string[] } {
  const numbered = opts.numbered ?? 0;
  const choices: string[] = [];
  const lines: string[] = [`🔔 *${hotelName}*${notices.length > 1 ? ` — ${notices.length} things need you` : ''}`];
  for (const n of notices) {
    const icon = n.urgent ? '🔴' : n.kind === 'guestRequests' ? '💬' : '🟠';
    lines.push('', `${icon} *${n.title}*${n.detail ? `\n${n.detail}` : ''}`);
    if (n.action && numbered + choices.length < MAX_CHOICES) {
      choices.push(choiceAt(propertyId, n.action.command));
      lines.push(`Reply *${numbered + choices.length}* to: ${n.action.label}`);
    } else if (n.action) {
      lines.push(`Send “${n.action.command}”`);
    } else if (n.href) {
      lines.push(siteUrl ? `${siteUrl}${n.href}` : `Open ${n.href} in the console`);
    }
  }
  const summary = notices.map((n) => n.title).join('; ');
  return { text: lines.join('\n'), summary, choices };
}

export interface RoundSection {
  hotel: { id: string; name: string; currency: string };
  /** The morning brief's blocks, their commands already tied to the hotel. */
  brief?: AgentBlock[];
  notices: Notice[];
}

/**
 * Everything one person gets this round, across their hotels, as one
 * message: the morning briefs, then each hotel's alerts, numbered straight
 * through (at most nine numbered replies). `more` alerts didn't fit and
 * come in the next message. `offered` are the numbered replies of an alert
 * the person hasn't read yet: this message's numbers follow on from them,
 * and `choices` includes them. `hotels` and `summary` are the alert
 * template's two variables.
 */
export function roundMessage(
  sections: RoundSection[],
  siteUrl: string | null,
  more = 0,
  offered: string[] = []
): { text: string; summary: string; choices: string[]; hotels: string } {
  const used = sections.filter((s) => s.brief?.length || s.notices.length);
  const briefs = used.filter((s) => s.brief?.length);
  const parts: string[] = [];
  let choices = [...offered];
  if (briefs.length) {
    // Rendered together so the numbers run on from one hotel's brief to the next (the overview shows no amounts, so any hotel's currency will do).
    const blocks = briefs.flatMap((s): AgentBlock[] => [{ type: 'text', text: `☀️ **Good morning — ${s.hotel.name}**` }, ...(s.brief ?? [])]);
    const r = renderBlocks(blocks, { currency: briefs[0].hotel.currency, siteUrl, offered: choices });
    parts.push(r.text);
    choices = r.choices;
  }
  for (const s of used) {
    if (!s.notices.length) continue;
    const m = alertMessage(s.hotel.name, s.notices, siteUrl, s.hotel.id, { numbered: choices.length });
    parts.push(m.text);
    choices.push(...m.choices);
  }
  if (more) parts.push(`…and ${more} more. I’ll send ${more === 1 ? 'it' : 'them'} in my next message.`);
  const summary = [
    ...(briefs.length ? [briefs.length > 1 ? 'your morning briefs are ready' : 'your morning brief is ready'] : []),
    ...used.flatMap((s) => s.notices.map((n) => n.title)),
    ...(more ? [`${more} more`] : []),
  ].join('; ');
  const names = used.map((s) => s.hotel.name);
  const hotels = names.length > 1 ? `${names[0]} and ${names.length - 1} more hotel${names.length > 2 ? 's' : ''}` : (names[0] ?? '');
  return { text: parts.join('\n\n'), summary, choices, hotels };
}

interface Recipient {
  link: { userId: string; number: string; lastInboundAt: Date | null; propertyId: string | null };
  person: Actor;
}

type Hotel = { id: string; name: string; timezone: string | null; currency: string };

/** What one person may still hear about at one hotel this round. */
interface Pending {
  r: Recipient;
  hotel: Hotel;
  /** Their agent actor at the hotel: the brief is read with it. */
  actor: Actor;
  today: string;
  /** The morning brief is due and they haven't had it. */
  brief: boolean;
  /** Alerts they haven't had. */
  notices: Notice[];
}

export interface WatchReport {
  hotels: number;
  /** Situations seen for the first time (a hotel's morning brief counts as one). */
  notices: number;
  messages: number;
  skipped?: string;
}

/**
 * Looks over every hotel with someone linked on WhatsApp (or just one) and
 * sends each person what's new for them, in one message. Safe to run as
 * often as you like.
 */
export async function runWatch(opts: { propertyId?: string; now?: Date } = {}): Promise<WatchReport> {
  const cfg = whatsAppConfig();
  if (!cfg) return { hotels: 0, notices: 0, messages: 0, skipped: 'WhatsApp is not configured' };
  const now = opts.now ?? new Date();
  const links = await prisma.staffWhatsAppLink.findMany({
    where: {
      number: { not: null },
      linkedAt: { not: null },
      alertsOff: false,
      // For one hotel, only the people who work there: assigned to it, or administering its organization (as actorFromUser counts it).
      ...(opts.propertyId
        ? {
            user: {
              OR: [
                { assignedProperties: { some: { propertyId: opts.propertyId } } },
                { organizations: { some: { role: 'ADMIN', organization: { properties: { some: { id: opts.propertyId } } } } } },
              ],
            },
          }
        : {}),
    },
    select: { userId: true, number: true, lastInboundAt: true, propertyId: true, sessionVersion: true, authMethod: true },
  });
  const recipients: Recipient[] = [];
  for (const l of links) {
    const person = await actorForLinkedChannel(l.userId, l.sessionVersion, l.authMethod);
    // Platform admins see every hotel: they aren't sent every hotel's alerts.
    if (person && person.propertyIds !== 'ALL' && !person.mustChangePassword && !person.mfaSetupRequired) recipients.push({ link: { ...l, number: l.number! }, person });
  }
  const hotelIds = [...new Set(recipients.flatMap((r) => r.person.propertyIds as string[]))].filter((id) => !opts.propertyId || id === opts.propertyId);
  if (!hotelIds.length) return { hotels: 0, notices: 0, messages: 0 };
  const hotels = await prisma.property.findMany({ where: { id: { in: hotelIds } }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, timezone: true, currency: true } });

  const report: WatchReport = { hotels: hotels.length, notices: 0, messages: 0 };
  // Records only need to outlive the situations they cover (a day, or a dispute's two weeks).
  if (!opts.propertyId) await prisma.agentNotice.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 3600_000) } } }).catch(() => undefined);
  // What each person may hear about, from all their hotels, so they get one message.
  const rounds = new Map<string, Pending[]>();
  for (const hotel of hotels) {
    try {
      const seen = await lookAt(hotel, recipients.filter((r) => hasPropertyAccess(r.person, hotel.id)), now);
      report.notices += seen.recorded;
      for (const p of seen.pending) rounds.set(p.r.link.userId, [...(rounds.get(p.r.link.userId) ?? []), p]);
    } catch (e) {
      logError('agent/watch', `Watching ${hotel.id} failed:`, e);
    }
  }
  const site = publicSiteUrl();
  for (const pending of rounds.values()) {
    try {
      if (await sendRound(cfg, pending[0].r, pending, site, now)) report.messages++;
    } catch (e) {
      logError('agent/watch', `Alerts for ${pending[0].r.link.userId} failed:`, e);
    }
  }
  return report;
}

/** What each person at this hotel may still hear about: found now, not waiting for the morning, and not sent to them yet. */
async function lookAt(hotel: Hotel, recipients: Recipient[], now: Date): Promise<{ recorded: number; pending: Pending[] }> {
  if (!recipients.length) return { recorded: 0, pending: [] };
  const { timezone } = localeOf(hotel);
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
  if (!audience.length) return { recorded: 0, pending: [] };

  const quiet = isQuietHour(hour);
  const wanted = new Set(audience.flatMap((a) => [...a.kinds]));
  // Front desk and housekeeping alerts wait for the brief hour, so the people who get the brief hear about them once, in it.
  const waits = (n: Notice) => !n.urgent && (quiet || (FOLDED_INTO_BRIEF.has(n.kind) && hour < BRIEF_HOUR));
  const found = (await noticesFor(hotel.id, today, now)).filter((n) => wanted.has(n.kind) && !waits(n));
  // The morning brief: once a day for each person who gets it, 08:00–11:00 hotel time.
  const brief: Notice | null = hour >= BRIEF_HOUR && hour < BRIEF_UNTIL && wanted.has('brief') ? { key: briefKey(today), kind: 'brief', urgent: false, title: `Morning brief ${today}` } : null;
  const all = brief ? [...found, brief] : found;
  if (!all.length) return { recorded: 0, pending: [] };
  // Each situation is recorded once per hotel; sentTo says who has had it.
  const { count } = await prisma.agentNotice.createMany({ data: all.map((n) => ({ propertyId: hotel.id, key: n.key, kind: n.kind, title: clip(n.title, 300) })), skipDuplicates: true });
  const rows = await prisma.agentNotice.findMany({ where: { propertyId: hotel.id, key: { in: all.map((n) => n.key) } }, select: { key: true, sentTo: true } });
  const told = new Map(rows.map((n) => [n.key, n.sentTo]));
  const isNew = (r: Recipient, n: Notice) => !told.get(n.key)?.includes(r.link.userId);
  const pending = audience.flatMap(({ r, kinds, actor }): Pending[] => {
    const p = { r, hotel, actor, today, brief: !!brief && kinds.has('brief') && isNew(r, brief), notices: found.filter((n) => kinds.has(n.kind) && isNew(r, n)) };
    return p.brief || p.notices.length ? [p] : [];
  });
  return { recorded: count, pending };
}

/**
 * One person's message this round. Each brief and alert in it is claimed for
 * them just before sending, and handed back if the send fails, so the next
 * round tries again; alerts that didn't fit stay unclaimed for the next one.
 */
async function sendRound(cfg: WhatsAppConfig, r: Recipient, pending: Pending[], site: string | null, now: Date): Promise<boolean> {
  const inWindow = !!r.link.lastInboundAt && now.getTime() - r.link.lastInboundAt.getTime() < WINDOW_MS;
  const template = inWindow ? null : cfg.alertTemplate;
  // WhatsApp won't deliver a free-form message now, and there's no template to use: it all waits until they write.
  if (!inWindow && !template) return false;
  const userId = r.link.userId;
  const claimed: { propertyId: string; keys: string[] }[] = [];
  const claim = async (propertyId: string, keys: string[]) => {
    const won = await claimFor(userId, propertyId, keys);
    if (won.length) claimed.push({ propertyId, keys: won });
    return won;
  };
  let delivered = false;
  try {
    const briefs = new Map<string, AgentBlock[]>();
    for (const p of pending) {
      if (!p.brief) continue;
      const blocks = await briefFor(p.actor, p.hotel, p.today);
      if (blocks && (await claim(p.hotel.id, [briefKey(p.today)])).length) briefs.set(p.hotel.id, blocks);
    }
    // Front desk and housekeeping alerts are in the brief where it goes out; the rest take the message's places, urgent first, then newest.
    const folded = (p: Pending, n: Notice) => briefs.has(p.hotel.id) && FOLDED_INTO_BRIEF.has(n.kind);
    const candidates = pending.flatMap((p) => p.notices.filter((n) => !folded(p, n)).map((n) => ({ p, n })));
    candidates.sort((a, b) => Number(b.n.urgent) - Number(a.n.urgent) || (b.n.at ?? now).getTime() - (a.n.at ?? now).getTime());
    const chosen = candidates.slice(0, MAX_NOTICES);
    const sections: RoundSection[] = [];
    for (const p of pending) {
      const theirs = chosen.filter((c) => c.p === p).map((c) => c.n);
      const won = new Set(await claim(p.hotel.id, [...theirs, ...p.notices.filter((n) => folded(p, n))].map((n) => n.key)));
      sections.push({ hotel: { id: p.hotel.id, name: p.hotel.name, currency: localeOf(p.hotel).currency }, brief: briefs.get(p.hotel.id), notices: theirs.filter((n) => won.has(n.key)) });
    }
    // Nothing to send: an overlapping run already sent it, or the brief couldn't be read.
    if (!claimed.length) return false;
    delivered = await deliver(cfg, r, sections, site, candidates.length - chosen.length, template);
    return delivered;
  } finally {
    if (!delivered) for (const c of claimed) await release(userId, c.propertyId, c.keys);
  }
}

/** Marks these as sent to this person unless they already are (an overlapping run): returns the keys this run claimed. */
async function claimFor(userId: string, propertyId: string, keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    UPDATE agent_notices SET "sentTo" = array_append("sentTo", ${userId}::text)
    WHERE "propertyId" = ${propertyId} AND key = ANY(${keys}::text[]) AND NOT (${userId}::text = ANY(COALESCE("sentTo", '{}')))
    RETURNING key`;
  return rows.map((row) => row.key);
}

/** Hands claims back after a send that didn't go out, so the next round tries again. */
async function release(userId: string, propertyId: string, keys: string[]): Promise<void> {
  await prisma.$executeRaw`UPDATE agent_notices SET "sentTo" = array_remove("sentTo", ${userId}::text) WHERE "propertyId" = ${propertyId} AND key = ANY(${keys}::text[])`.catch((e) =>
    logError('agent/watch', `Handing back alerts for ${userId} failed:`, e)
  );
}

/** Today at a glance, read with the person's own agent access (a look-up: nothing is changed or logged as theirs). */
async function briefFor(actor: Actor, hotel: { id: string; name: string }, today: string): Promise<AgentBlock[] | null> {
  try {
    const out = await runRead({ actor, propertyId: hotel.id, propertyName: hotel.name, today, memory: {}, message: 'brief me' }, { kind: 'overview' });
    if (!out.blocks.length || out.blocks.every((b) => b.type === 'error')) return null;
    // Its numbered replies (the overview's alerts) act at this hotel, whichever hotel the chat is on.
    return out.blocks.map((b) => (b.type === 'alerts' ? { ...b, items: b.items.map((a) => (a.command ? { ...a, command: choiceAt(hotel.id, a.command) } : a)) } : b));
  } catch (e) {
    logError('agent/watch', 'Morning brief failed:', e);
    return null;
  }
}

/**
 * Sends inside the 24-hour window as a normal message; outside it, as the
 * approved alert template. Either way the chat keeps the whole message to
 * show (on the person's next message, after a template) and its numbered
 * replies, which replace the last ones only when it has some. Nothing is
 * kept for a send that failed.
 */
async function deliver(cfg: WhatsAppConfig, r: Recipient, sections: RoundSection[], site: string | null, more: number, template: WhatsAppConfig['alertTemplate']): Promise<boolean> {
  const userId = r.link.userId;
  const msg = roundMessage(sections, site, more);
  try {
    if (template) await sendTemplate(cfg, r.link.number, template, [msg.hotels, msg.summary]);
    else await sendText(cfg, r.link.number, msg.text);
  } catch (e) {
    logError('agent/watch', `Alert to ${userId} failed:`, e);
    return false;
  }
  await (template
    ? keepUnseen(userId, sections, site, more)
    : prisma.staffWhatsAppLink.update({ where: { userId }, data: { lastAlert: msg.text, alertUnseen: false, ...(msg.choices.length ? { choices: msg.choices } : {}) } })
  ).catch((e) => logError('agent/watch', `Saving the alert for ${userId} failed:`, e));
  return true;
}

/**
 * Keeps a template's whole message for the person's next message. While the
 * one before is still unread, this one is added after it, numbered on from
 * its replies, so the chat shows both and every number works. The template
 * itself carries no numbers, so they're worked out against what the chat
 * holds now, and again if it changes meanwhile (they wrote, or another round
 * added to it).
 */
async function keepUnseen(userId: string, sections: RoundSection[], site: string | null, more: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const link = await prisma.staffWhatsAppLink.findUnique({ where: { userId }, select: { lastAlert: true, alertUnseen: true, choices: true } });
    if (!link) return; // unlinked meanwhile
    const earlier = link.alertUnseen ? link.lastAlert : null;
    const msg = roundMessage(sections, site, more, earlier ? link.choices : []);
    const { count } = await prisma.staffWhatsAppLink.updateMany({
      where: { userId, lastAlert: link.lastAlert, alertUnseen: link.alertUnseen, choices: { equals: link.choices } },
      data: { lastAlert: earlier ? `${earlier}\n\n${msg.text}` : msg.text, alertUnseen: true, ...(msg.choices.length ? { choices: msg.choices } : {}) },
    });
    if (count) return;
  }
  throw new Error('the chat kept changing');
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
