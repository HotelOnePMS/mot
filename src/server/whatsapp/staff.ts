/**
 * The staff agent on WhatsApp. Owners, managers and front desk message the
 * hotel's staff number and get the same agent as the console: the same
 * tools, the same permissions and hotel access (read fresh on every message,
 * with the hotel's agent access applied), the same audit log. Changes are
 * never made straight away: the agent's signed plan is sent as a message and
 * runs only when the person replies YES, through the same confirmPlan the
 * console uses.
 *
 * Who is writing comes from the sender's number, which Meta vouches for in a
 * signed webhook, and that number was linked by sending a one-time code from
 * the signed-in console (link.ts). The always-on agent (agent/watch.ts) sends
 * alerts into the same chat; their numbered actions are answered here.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AgentBlock, AgentContextState } from '@/lib/agent/blocks';
import { isStaffRole } from '@/lib/routes';
import { actorForLinkedChannel, scopeProperties, type Actor } from '../authz';
import { confirmPlan, runAgent } from '../agent/engine';
import { agentActor, canUseWhatsApp, loadPolicy } from '../agent/policy';
import { watchSoon } from '../agent/watch';
import { sendAccountEmail } from '../email';
import { DomainError } from '../errors';
import { logError } from '../log';
import { publicSiteUrl } from '../public-url';
import { recordAudit } from '../services/audit';
import { markReadAndTyping, sendText, type InboundMessage, type WhatsAppConfig } from './cloud';
import { HOTEL_CHOICE, readChoice, renderBlocks } from './format';
import { auditLink, linkByCode, maskNumber, parseLinkCommand, unlink } from './link';

export type ChannelCommand =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'pick'; n: number }
  | { kind: 'hotels' }
  | { kind: 'switch'; name: string }
  | { kind: 'unlink' }
  | { kind: 'alerts'; on: boolean }
  | { kind: 'details' }
  | { kind: 'help' };

/** Replies the chat handles itself; everything else goes to the agent. */
export function parseChannelCommand(text: string): ChannelCommand | null {
  const t = text.trim().replace(/[.!\s]+$/, '');
  if (/^(yes|y|yep|yeah|confirm|go ahead|do it)$/i.test(t)) return { kind: 'yes' };
  if (/^(no|n|nope|cancel|don[’']?t)$/i.test(t)) return { kind: 'no' };
  if (/^[1-9]$/.test(t)) return { kind: 'pick', n: Number(t) };
  if (/^(hotels|my hotels|which hotel|switch hotels?)\??$/i.test(t)) return { kind: 'hotels' };
  const sw = /^switch to\s+(.{2,80})$/i.exec(t);
  if (sw) return { kind: 'switch', name: sw[1].trim() };
  if (/^unlink$/i.test(t)) return { kind: 'unlink' };
  const alerts = /^(?:alerts|notifications)\s+(on|off)$/i.exec(t) ?? /^(mute|unmute)(?: alerts)?$/i.exec(t);
  if (alerts) return { kind: 'alerts', on: /^(on|unmute)$/i.test(alerts[1]) };
  // The alert template's quick reply ("Show me"), or asking after an alert.
  if (/^(details|show me|view|see details)$/i.test(t)) return { kind: 'details' };
  if (/^(help|menu|\?)$/i.test(t)) return { kind: 'help' };
  return null;
}

const MAX_RECENT = 12;

type Link = NonNullable<Awaited<ReturnType<typeof loadLink>>>;
type Hotel = { id: string; name: string; currency: string };
type Reply = (text: string) => Promise<void>;

const loadLink = (number: string) => prisma.staffWhatsAppLink.findUnique({ where: { number } });

/** Handles one inbound message: at most once per message id, never throws. */
export async function handleInbound(cfg: WhatsAppConfig, msg: InboundMessage): Promise<void> {
  try {
    await prisma.whatsAppInboundMessage.create({ data: { id: msg.id } });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return; // a retried delivery
    throw e;
  }
  if (Math.random() < 0.02) {
    await prisma.whatsAppInboundMessage.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } } }).catch(() => undefined);
  }
  const reply: Reply = (text) => sendText(cfg, msg.from, text);
  try {
    await respond(cfg, msg, reply);
  } catch (e) {
    if (e instanceof DomainError) {
      await reply(`⚠️ ${e.message}`).catch((err) => logError('whatsapp', 'Reply failed:', err));
      return;
    }
    logError('whatsapp', 'Handling a staff message failed:', e);
    await reply('Something went wrong on our side. Please try again in a moment.').catch(() => undefined);
  }
}

async function respond(cfg: WhatsAppConfig, msg: InboundMessage, reply: Reply): Promise<void> {
  const site = publicSiteUrl();
  const securityPage = site ? `${site}/account/security` : 'Account → Security in the console';

  const code = msg.text ? parseLinkCommand(msg.text) : null;
  if (code) {
    const out = await linkByCode(msg.from, code);
    if (!out.ok) {
      await reply(
        out.reason === 'taken'
          ? 'This WhatsApp number is already linked to another account. Unlink it there first (send UNLINK from this phone), then try again.'
          : `That code didn’t work: it may have expired or already been used. Get a new one at ${securityPage}.`
      );
      return;
    }
    await prisma.staffWhatsAppLink.update({ where: { userId: out.userId }, data: { lastInboundAt: new Date() } });
    const linked = await actorForLinkedChannel(out.userId, out.sessionVersion);
    if (linked) {
      await auditLink(linked, null, 'WHATSAPP_LINKED', `Linked WhatsApp ${maskNumber(msg.from)}`);
      // Like a new sign-in alert: if someone else got hold of the code, the owner of the account finds out.
      await sendAccountEmail({ to: linked.email, name: out.firstName, kind: 'WHATSAPP_LINKED', url: site ? `${site}/account/security` : '/account/security', detail: maskNumber(msg.from) });
    }
    await reply(
      `✅ Linked, ${out.firstName}! Ask me about your hotel or tell me what to do — I always ask before changing anything. I’ll also message you here when something needs your attention (send *ALERTS OFF* to stop that).\n\nTry “brief me”, “who’s arriving today?” or *HELP*.`
    );
    return;
  }

  const link = await loadLink(msg.from);
  if (!link?.linkedAt) {
    await reply(`Hi! This number is the hotel team’s assistant. To use it, link your phone at ${securityPage}.`);
    return;
  }
  const person = await actorForLinkedChannel(link.userId, link.sessionVersion);
  if (!person) {
    // Account turned off, or signed out everywhere since the link was made.
    await prisma.staffWhatsAppLink.update({ where: { userId: link.userId }, data: { number: null, linkedAt: null, pendingPlan: null, choices: [] } });
    await reply(`This phone’s link to your account has ended (for example after “sign out everywhere” or a password change). Link it again at ${securityPage}.`);
    return;
  }
  await prisma.staffWhatsAppLink.update({ where: { userId: link.userId }, data: { lastInboundAt: new Date() } });
  const blocked = accountProblem(person, securityPage);
  if (blocked) {
    await reply(blocked);
    return;
  }
  await markReadAndTyping(cfg, msg.id);
  if (!msg.text) {
    await reply('I can only read text messages for now.');
    return;
  }

  const hotels = await prisma.property.findMany({ where: scopeProperties(person), orderBy: { createdAt: 'asc' }, select: { id: true, name: true, currency: true }, take: 50 });
  let hotel = hotels.find((h) => h.id === link.propertyId) ?? hotels[0];
  if (!hotel) {
    await reply('No hotel is assigned to your account yet. Ask the owner to add you to one.');
    return;
  }

  let message = msg.text.slice(0, 600);
  const cmd = parseChannelCommand(message);
  if (cmd?.kind === 'pick') {
    const choice = link.choices[cmd.n - 1];
    if (!choice) {
      await reply('I don’t have an option with that number. What would you like to do?');
      return;
    }
    const picked = readChoice(choice);
    if ('hotel' in picked) {
      const h = hotels.find((x) => x.id === picked.hotel);
      if (h) return switchHotel(person, link, h, reply);
      await reply('You no longer have access to that hotel. Send *HOTELS* to see yours.');
      return;
    }
    if (picked.at && picked.at !== hotel.id) {
      // An alert about another of their hotels: act there.
      const h = hotels.find((x) => x.id === picked.at);
      if (!h) {
        await reply('You no longer have access to that hotel. Send *HOTELS* to see yours.');
        return;
      }
      hotel = h;
      link.memory = {};
    }
    message = picked.command;
  }
  switch (cmd?.kind) {
    case 'no':
      await prisma.staffWhatsAppLink.update({ where: { userId: link.userId }, data: { pendingPlan: null, choices: [] } });
      await reply(link.pendingPlan ? 'Cancelled — nothing was changed.' : 'OK. What would you like to do?');
      return;
    case 'unlink':
      await unlink(person, 'whatsapp');
      await reply('Unlinked. This phone can’t reach your account any more. You can link it again from the console.');
      return;
    case 'details':
      if (link.lastAlert) {
        await reply(link.lastAlert);
        return;
      }
      break;
    case 'alerts':
      await prisma.staffWhatsAppLink.update({ where: { userId: link.userId }, data: { alertsOff: !cmd.on } });
      await reply(cmd.on ? '🔔 Alerts are on. I’ll message you when something needs your attention.' : '🔕 Alerts are off. I’ll only answer when you message me. Send *ALERTS ON* to turn them back on.');
      return;
    case 'hotels': {
      if (hotels.length < 2) {
        await reply(`You have one hotel: *${hotel.name}*.`);
        return;
      }
      const shown = hotels.slice(0, 9);
      await prisma.staffWhatsAppLink.update({ where: { userId: link.userId }, data: { choices: shown.map((h) => `${HOTEL_CHOICE}${h.id}`), pendingPlan: null } });
      await reply([`You’re working on *${hotel.name}*. Reply with a number to switch:`, ...shown.map((h, i) => `${i + 1}. ${h.name}`), hotels.length > 9 ? 'Or send “switch to” and the hotel’s name.' : ''].filter(Boolean).join('\n'));
      return;
    }
    case 'switch': {
      const q = cmd.name.toLowerCase();
      const matches = hotels.filter((h) => h.name.toLowerCase().includes(q));
      if (matches.length !== 1) {
        await reply(matches.length ? `More than one hotel matches “${cmd.name}”: ${matches.map((h) => h.name).join(', ')}.` : `None of your hotels is called “${cmd.name}”. Send *HOTELS* to see them.`);
        return;
      }
      return switchHotel(person, link, matches[0], reply);
    }
  }

  watchSoon(hotel.id, { heartbeat: true });
  // Everything from here acts at the hotel, with its agent access (runAgent and confirmPlan apply it too).
  if (!canUseWhatsApp(await agentActor(person, hotel.id, await loadPolicy(hotel.id)))) {
    await reply(
      `The agent on WhatsApp is off for your role at *${hotel.name}*. The owner can turn it on under Agent access.${hotels.length > 1 ? ' Send *HOTELS* to switch hotel.' : ''}`
    );
    return;
  }
  if (cmd?.kind === 'yes') return confirmPending(person, link, hotel, reply);

  const help = cmd?.kind === 'help';
  const blocks: AgentBlock[] = [];
  let memory: AgentContextState = (link.memory ?? {}) as AgentContextState;
  for await (const event of runAgent({ actor: person, propertyId: hotel.id, message: help ? 'help' : message, memory, recent: link.recent, channel: 'whatsapp' })) {
    if (event.type === 'block') blocks.push(event.block);
    else if (event.type === 'context') memory = event.context;
    else if (event.type === 'error') blocks.push({ type: 'error', text: event.message });
  }
  const rendered = renderBlocks(blocks, { currency: hotel.currency, siteUrl: site });
  const tasks = await bridgeResults(blocks);
  const header = hotels.length > 1 ? `_${hotel.name}_\n\n` : '';
  const footer = help
    ? '\n\n*On WhatsApp:* reply *YES* or *NO* to a change I propose, a number to pick an option, *HOTELS* to switch hotel, *ALERTS OFF* to stop alerts, *UNLINK* to disconnect this phone.'
    : '';
  await prisma.staffWhatsAppLink.update({
    where: { userId: link.userId },
    data: {
      propertyId: hotel.id,
      memory: memory as Prisma.InputJsonValue,
      recent: [...link.recent, message].slice(-MAX_RECENT),
      // A new message replaces any plan still waiting: YES only ever confirms the latest one shown.
      pendingPlan: rendered.planToken,
      choices: rendered.choices,
    },
  });
  await reply(`${header}${rendered.text}${tasks}${footer}`);
}

/** Why this account can't use the console's agent right now (and where to fix it), or null. The console's requireStaff rules. */
function accountProblem(actor: Actor, securityPage: string): string | null {
  if (!isStaffRole(actor.role)) return 'This number is for hotel staff.';
  if (actor.mustChangePassword) return `Choose a new password in the console first: ${securityPage}`;
  if (actor.mfaSetupRequired) return `Your organization requires two-step sign-in. Set it up first: ${securityPage}`;
  return null;
}

async function confirmPending(actor: Actor, link: Link, hotel: Hotel, reply: Reply): Promise<void> {
  if (!link.pendingPlan) {
    await reply('There’s nothing waiting for confirmation. What would you like to do?');
    return;
  }
  // Cleared first, so a second YES can't run it again (confirmPlan also refuses a plan that already ran).
  const { count } = await prisma.staffWhatsAppLink.updateMany({ where: { userId: link.userId, pendingPlan: link.pendingPlan }, data: { pendingPlan: null, choices: [] } });
  if (!count) return;
  const result = await confirmPlan(actor, link.pendingPlan, { channel: 'whatsapp' });
  const rendered = renderBlocks(result.blocks, { currency: hotel.currency, siteUrl: publicSiteUrl() });
  const memory = { ...((link.memory ?? {}) as AgentContextState), ...result.context };
  await prisma.staffWhatsAppLink.update({ where: { userId: link.userId }, data: { memory: memory as Prisma.InputJsonValue, choices: rendered.choices } });
  await reply(`${rendered.text}${await bridgeResults(result.blocks)}`);
}

async function switchHotel(actor: Actor, link: Link, hotel: Hotel, reply: Reply): Promise<void> {
  await prisma.staffWhatsAppLink.update({ where: { userId: link.userId }, data: { propertyId: hotel.id, memory: {}, pendingPlan: null, choices: [] } });
  await recordAudit({ actor, source: 'agent' }, hotel.id, 'COMMAND', `Switched WhatsApp to ${hotel.name}`, { channel: 'whatsapp' });
  await reply(`Now working on *${hotel.name}*. What would you like to know?`);
}

/** Work sent to the hotel's own PMS: its outcome when it already finished (MCP look-ups take seconds). */
async function bridgeResults(blocks: AgentBlock[]): Promise<string> {
  const ids = blocks.flatMap((b) => (b.type === 'bridgeTask' ? [b.taskId] : []));
  if (!ids.length) return '';
  const tasks = await prisma.bridgeTask.findMany({ where: { id: { in: ids } }, select: { status: true, result: true, error: true } });
  const lines = tasks.map((t) => {
    const summary = (t.result as { summary?: string | null } | null)?.summary;
    if (t.status === 'DONE') return `✅ ${summary ?? 'Done.'}`;
    if (t.status === 'FAILED') return `⚠️ ${t.error ?? 'It didn’t work.'}`;
    if (t.status === 'NEEDS_HELP') return `✋ ${summary ?? 'It needs a person to look.'} Open the console to help.`;
    return '⏳ Still working on it — check the agent page in the console for the result.';
  });
  return `\n\n${lines.join('\n')}`;
}
