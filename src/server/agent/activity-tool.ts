/**
 * The hotel's logs for the agent: "who cancelled the Patel booking?", "what did Maria do last night?", "any refunds
 * this week?", "anything I should look at?". It searches the activity log (every change people, the agent and the
 * system made), a reservation's status history and, for those who may see channels, the channel sync log, with the
 * filters the question implies. Then it sums the entries up (by kind, person, source and day) and marks what deserves
 * a second look: money handed back or taken off, payments marked paid another way, check-outs still owing, ID views,
 * access changes, exports, failed channel syncs, and patterns across them (one person's many refunds, one stay's
 * several discounts).
 *
 * Reading the log changes nothing. It is for roles that may see the activity log (activity.view); the channel sync
 * log also needs channels.view.
 */
import { z } from 'zod/v4';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ActivityItem, AgentBlock, AgentContextState } from '@/lib/agent/blocks';
import { BOOKING_STATUS } from '@/lib/status';
import { can } from '../authz';
import { addDaysISO, diffDays, formatDay } from '../dates';
import { hotelLocale } from '../services/hotels';
import { personName } from '../services/mappers';
import { zonedStartOfDay } from '../services/reports';
import type { ResolvedBooking } from './folio-plan';
import { guestOf, memoryOf } from './folio-plan';
import { HarnessInputError } from './input-error';
import type { ToolCtx } from './tools';

/** What an entry is about, in the words a manager would use. */
export const ACTIVITY_KINDS = ['reservations', 'folio', 'payments', 'rates', 'rooms', 'guests', 'team', 'settings', 'reports', 'agent', 'channels'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_HELP =
  'Only these kinds of entries: reservations (bookings made, changed, confirmed, checked in or out, cancelled, no-shows, notes, night audit), ' +
  'folio (charges, discounts, folio edits, usual charges), payments (payments, refunds, deposits, card checks, disputes, payment settings), ' +
  'rates (nightly prices, pricing settings), rooms (room status, out of order, housekeeping, rooms and room types), ' +
  'guests (do-not-rent list, guest IDs, guest requests), team (people, roles, permissions, API keys), settings (the hotel, voice line, connections, saved answers), ' +
  'reports (exports), agent (what people asked the agent, plans it carried out; left out unless asked for), channels (the booking channels’ sync log). Omit for everything.';

type KindRule = { prefixes: string[]; actions: string[] };

const KIND_RULES: Record<Exclude<ActivityKind, 'settings' | 'channels'>, KindRule> = {
  reservations: { prefixes: ['BOOKING_'], actions: ['CHECKOUT_WITH_BALANCE', 'REGISTRATION_SIGNED', 'NIGHT_AUDIT'] },
  folio: { prefixes: ['FOLIO_', 'SAVED_CHARGE_'], actions: [] },
  payments: { prefixes: ['PAYMENT_', 'PAYMENTS_', 'CARD_AUTH_', 'DISPUTE_'], actions: ['DEPOSIT_WAIVED'] },
  rates: { prefixes: ['RATES_'], actions: ['PRICING_SETTINGS'] },
  rooms: { prefixes: ['ROOM_', 'HOUSEKEEPING_'], actions: [] },
  guests: { prefixes: ['DNR_', 'GUEST_'], actions: [] },
  team: { prefixes: ['TEAM_', 'PERMISSION_', 'AGENT_KEY_'], actions: ['ONBOARDED'] },
  reports: { prefixes: ['REPORT_'], actions: [] },
  agent: { prefixes: [], actions: ['COMMAND', 'PLAN_EXECUTED', 'MODE_SWITCH'] },
};

const RULED = Object.entries(KIND_RULES) as [Exclude<ActivityKind, 'settings' | 'channels'>, KindRule][];

/** The kind of an activity log action ("FOLIO_EDIT" → folio); anything unlisted is a setting. */
export function kindOf(action: string): ActivityKind {
  for (const [kind, r] of RULED) if (r.actions.includes(action) || r.prefixes.some((p) => action.startsWith(p))) return kind;
  return 'settings';
}

const ruleWhere = (r: KindRule): Prisma.AgentAuditLogWhereInput[] => [
  ...(r.actions.length ? [{ action: { in: r.actions } }] : []),
  ...r.prefixes.map((p) => ({ action: { startsWith: p } })),
];

/** The log rows for some kinds, as a database filter. */
function kindsWhere(kinds: ActivityKind[]): Prisma.AgentAuditLogWhereInput {
  const or: Prisma.AgentAuditLogWhereInput[] = [];
  for (const k of kinds) {
    if (k === 'settings') or.push({ NOT: { OR: RULED.flatMap(([, r]) => ruleWhere(r)) } });
    else if (k !== 'channels') or.push(...ruleWhere(KIND_RULES[k]));
  }
  return or.length ? { OR: or } : { id: '' };
}

const SOURCES = { agent: 'agent', screens: 'classic', system: 'system' } as const;

/** The tool's input, with the harness's own guest reference and date types. */
export const activityQuerySchema = <G extends z.ZodType, D extends z.ZodType<string>>({ guest, date }: { guest: G; date: D }) =>
  z.object({
    from: date.optional().describe('First day, YYYY-MM-DD, on the hotel’s clock. Default: a week ago (for one guest, since they booked).'),
    to: date.optional().describe('Last day, INCLUSIVE. Default: today.'),
    kinds: z.array(z.enum(ACTIVITY_KINDS)).max(ACTIVITY_KINDS.length).optional().describe(ACTIVITY_KIND_HELP),
    person: z.string().max(80).optional().describe('Only what this team member did: their name or part of it ("Maria").'),
    guest: guest.optional().describe('Only what happened to this guest’s reservation (and the other rooms booked with it).'),
    room_number: z.string().max(20).optional().describe('Only entries about this room, and the stays in it during those days.'),
    text: z.string().min(2).max(80).optional().describe('Words the entries must contain, e.g. "refund", "pet fee", "late check-out", a confirmation code.'),
    source: z.enum(['agent', 'screens', 'system']).optional().describe('agent: changes made through you (the agent); screens: clicked in the console by hand; system: automatic (payments, webhooks, nightly jobs).'),
    worth_checking: z
      .boolean()
      .optional()
      .describe(
        'Only entries worth a second look: refunds, discounts, payments marked paid another way, payments edited or removed, charges taken off or lowered, check-outs still owing, check-ins without the deposit, ' +
          'do-not-rent changes, ID views, access and payment-setting changes, deletions, exports, failed plans and failed channel syncs.'
      ),
  });

export interface ActivityQuery {
  from?: string;
  to?: string;
  kinds?: ActivityKind[];
  person?: string;
  room_number?: string;
  text?: string;
  source?: 'agent' | 'screens' | 'system';
  worth_checking?: boolean;
}

/** One log entry as the agent reads it. */
interface Entry extends ActivityItem {
  kind: ActivityKind;
  /** The hotel's clock: "2026-11-07 23:14". */
  local: string;
  hour: number;
  bookingId?: string;
  code?: string;
  moneyOut?: boolean;
}

type Detail = { source?: 'agent' | 'classic' | 'system'; summary?: string; message?: string; bookingId?: string; roomId?: string; target?: string; ok?: boolean; to?: string } & Record<string, unknown>;

function parseDetail(raw: string | null): Detail {
  if (!raw) return {};
  try {
    const d = JSON.parse(raw);
    return d && typeof d === 'object' ? (d as Detail) : {};
  } catch {
    return { summary: raw };
  }
}

/** "room $80.00 (was $100.00)": did any amount go down? */
function lowered(summary: string): boolean {
  const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''));
  for (const m of summary.matchAll(/([-−]?[^\s(]*\d[\d.,]*)\s*(?:[A-Z]{3})?\s*\(was\s+([-−]?[^\s)]*\d[\d.,]*)/g)) {
    const [now, was] = [num(m[1]), num(m[2])];
    if (Number.isFinite(now) && Number.isFinite(was) && now < was) return true;
  }
  return false;
}

const ACCESS = new Set([
  'PERMISSION_GRANT',
  'PERMISSION_REVOKE',
  'TEAM_ROLE_CHANGE',
  'TEAM_ADD',
  'TEAM_INVITE',
  'TEAM_ACTIVATE',
  'TEAM_DEACTIVATE',
  'TEAM_PROPERTIES_CHANGE',
  'TEAM_PASSWORD_RESET',
  'TEAM_EMAIL_CHANGE',
  'AGENT_KEY_CREATE',
  'AGENT_KEY_REVOKE',
]);
const PAYMENT_SETTINGS = new Set(['PAYMENTS_DEPOSIT_POLICY', 'PAYMENTS_POLICY', 'PAYMENTS_READER_ADDED', 'PAYMENTS_READER_REMOVED', 'PAYMENTS_CONNECT']);
const DELETIONS = new Set(['ROOM_DELETE', 'ROOM_TYPE_DELETE', 'ORG_HOTEL_REMOVED', 'TEAM_DELETE', 'SKILL_DELETE', 'HOUSEKEEPING_DELETE']);

/** Why an entry deserves a second look (and whether money left the hotel's books), or nothing. */
export function flagOf(action: string, d: Detail, summary: string): { flag: string; moneyOut?: boolean } | null {
  switch (action) {
    case 'PAYMENT_REFUND':
      return { flag: 'Money handed back', moneyOut: true };
    case 'FOLIO_ALLOWANCE':
      return { flag: 'Money taken off a stay', moneyOut: true };
    case 'FOLIO_ALLOWANCE_REMOVED':
      return { flag: 'A discount was removed' };
    case 'PAYMENT_OTHER':
      return { flag: 'Marked paid another way (no card or cash in the system)', moneyOut: true };
    case 'CHECKOUT_WITH_BALANCE':
      return { flag: 'Checked out still owing', moneyOut: true };
    case 'DEPOSIT_WAIVED':
      return { flag: 'Checked in without the security deposit' };
    case 'DNR_ADD':
      return { flag: 'Added to the do-not-rent list' };
    case 'DNR_REMOVE':
      return { flag: 'Taken off the do-not-rent list' };
    case 'GUEST_ID_VIEWED':
    case 'CARD_AUTH_ID_VIEWED':
      return { flag: 'Opened a guest’s ID' };
    case 'REPORT_EXPORTED':
      return { flag: 'Data exported' };
    case 'PLAN_EXECUTED':
      return d.ok === false ? { flag: 'A confirmed change partly failed' } : null;
    case 'FOLIO_EDIT':
      if (d.target === 'payment' || d.target === 'removePayment') return { flag: 'A recorded payment was changed or removed', moneyOut: true };
      if (d.target === 'removeCharge') return { flag: 'A charge was taken off', moneyOut: true };
      return lowered(summary) ? { flag: 'A folio amount was lowered', moneyOut: true } : null;
    default:
      if (ACCESS.has(action)) return { flag: 'Who can do what changed' };
      if (PAYMENT_SETTINGS.has(action)) return { flag: 'Payment settings changed' };
      if (DELETIONS.has(action)) return { flag: 'Something was deleted' };
      return null;
  }
}

const KIND_WORDS: Record<ActivityKind, string> = {
  reservations: 'Reservations',
  folio: 'Folios',
  payments: 'Payments',
  rates: 'Rates',
  rooms: 'Rooms',
  guests: 'Guests',
  team: 'Team',
  settings: 'Settings',
  reports: 'Reports',
  agent: 'Agent',
  channels: 'Channels',
};

const CHANNEL_NAMES: Record<string, string> = { EXPEDIA: 'Expedia', BOOKING_COM: 'Booking.com' };

const MAX_DAYS = 92;
const MAX_ROWS = 4000;
const SHOWN = 25;
const FOR_MODEL = 50;

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/** Every room booked together with this one (a reservation of several room types). */
async function stayIds(b: ResolvedBooking): Promise<string[]> {
  if (!b.groupCode) return [b.id];
  const lines = await prisma.booking.findMany({ where: { propertyId: b.propertyId, groupCode: b.groupCode }, select: { id: true }, take: 20 });
  return [...new Set([b.id, ...lines.map((l) => l.id)])];
}

export interface ActivityOut {
  blocks: AgentBlock[];
  forModel: string;
  memory?: Partial<AgentContextState>;
  isError?: boolean;
}

/** Search the logs and sum them up. `stay` is the reservation the person named, already resolved. */
export async function searchActivity(ctx: ToolCtx, q: ActivityQuery, stay: ResolvedBooking | null): Promise<ActivityOut> {
  if (!can(ctx.actor, 'activity.view')) {
    return { blocks: [], forModel: 'The activity log is for managers and owners, and this person’s role can’t see it: say so.', isError: true };
  }
  const { timezone } = await hotelLocale(ctx.propertyId);
  const today = ctx.today;
  const since = stay ? localDay(stay.createdAt, timezone) : null;
  const to = q.to ?? today;
  const from = q.from ?? (q.to ? addDaysISO(q.to, -6) : (since ?? addDaysISO(today, -6)));
  if (from > to) throw new HarnessInputError('`from` must not be after `to` (both inclusive).');
  if (diffDays(from, to) + 1 > MAX_DAYS) throw new HarnessInputError(`Search at most ${MAX_DAYS} days at a time; narrow from/to.`);
  const start = zonedStartOfDay(from, timezone);
  const end = zonedStartOfDay(addDaysISO(to, 1), timezone);

  // Narrow in the database where we can: the days, the reservation, the room, the words, the kinds.
  const and: Prisma.AgentAuditLogWhereInput[] = [];
  const ids = stay ? await stayIds(stay) : [];
  if (ids.length) and.push({ OR: ids.map((id) => ({ detail: { contains: `"bookingId":"${id}"` } })) });
  let room: { id: string; roomNumber: string } | null = null;
  let roomStays: string[] = [];
  if (q.room_number) {
    room = await prisma.room.findFirst({ where: { propertyId: ctx.propertyId, roomNumber: q.room_number.trim() }, select: { id: true, roomNumber: true } });
    if (!room) throw new HarnessInputError(`There’s no room ${q.room_number} at this hotel.`);
    const stays = await prisma.booking.findMany({
      where: { propertyId: ctx.propertyId, roomId: room.id, checkIn: { lt: end }, checkOut: { gt: start } },
      select: { id: true },
      take: 40,
    });
    roomStays = stays.map((s) => s.id);
    and.push({
      OR: [
        { detail: { contains: `"roomId":"${room.id}"` } },
        { detail: { contains: `Room ${room.roomNumber}`, mode: 'insensitive' } },
        ...roomStays.map((id) => ({ detail: { contains: `"bookingId":"${id}"` } })),
      ],
    });
  }
  if (q.text) and.push({ OR: [{ detail: { contains: q.text, mode: 'insensitive' } }, { action: { contains: q.text.replace(/\s+/g, '_'), mode: 'insensitive' } }] });
  // What people asked the agent is noise for most questions (each change it made is logged on its own): only when asked for.
  const kinds = q.kinds?.length ? [...new Set(q.kinds)] : null;
  if (kinds) and.push(kindsWhere(kinds));
  else and.push({ NOT: kindsWhere(['agent']) });

  const rows = await prisma.agentAuditLog.findMany({
    where: { propertyId: ctx.propertyId, createdAt: { gte: start, lt: end }, AND: and },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
    select: { id: true, action: true, detail: true, createdAt: true, user: { select: { id: true, firstName: true, lastName: true } } },
  });
  const truncated = rows.length === MAX_ROWS;

  const clock = localClock(timezone);
  let entries: Entry[] = rows.map((r) => {
    const d = parseDetail(r.detail);
    const summary = String(
      d.summary ??
        (r.action === 'MODE_SWITCH' && d.to ? `Switched default interface to ${d.to === 'AGENTIC' ? 'Agentic' : 'Classic'}` : r.action === 'COMMAND' && d.message ? `Asked: “${d.message}”` : r.action)
    );
    const f = flagOf(r.action, d, summary);
    const { local, hour } = clock(r.createdAt);
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      user: { id: r.user.id, name: personName(r.user) },
      action: r.action,
      source: d.source ?? (r.action === 'COMMAND' ? 'agent' : 'classic'),
      summary,
      kind: kindOf(r.action),
      local,
      hour,
      ...(typeof d.bookingId === 'string' ? { bookingId: d.bookingId } : {}),
      ...(f ? { flag: f.flag, moneyOut: !!f.moneyOut } : {}),
    };
  });

  // The words in what the entry says, not in the log's field names ("source", "bookingId"): "refund" finds "Refunded".
  const words = q.text ? textMatcher(q.text) : null;
  if (words) entries = entries.filter((e) => words(e.summary) || words(e.action.replace(/_/g, ' ')));

  // A room number in a summary: "Room 1" must not match "Room 12".
  if (room) {
    const roomWord = new RegExp(`\\broom ${room.roomNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');
    const stays = new Set(roomStays);
    entries = entries.filter((e) => (e.bookingId && stays.has(e.bookingId)) || roomWord.test(e.summary) || rows.find((r) => r.id === e.id)?.detail?.includes(`"roomId":"${room!.id}"`));
  }

  // Status history: changes the log has no row for (online bookings, payments confirming them, imports).
  if (ids.length && (!kinds || kinds.includes('reservations')) && !q.person && (!q.source || q.source === 'system')) {
    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId: { in: ids }, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, bookingId: true, status: true, notes: true, createdAt: true },
    });
    for (const h of history) {
      const logged = entries.some((e) => e.action === `BOOKING_${h.status}` && e.bookingId === h.bookingId && Math.abs(Date.parse(e.at) - h.createdAt.getTime()) < 5 * 60_000);
      if (logged) continue;
      const summary = `Reservation ${BOOKING_STATUS[h.status]?.label.toLowerCase() ?? h.status.toLowerCase()}${h.notes ? `: ${h.notes}` : ''}`;
      if (words && !words(summary)) continue;
      const { local, hour } = clock(h.createdAt);
      entries.push({ id: `h:${h.id}`, at: h.createdAt.toISOString(), user: { id: 'system', name: 'Reservation history' }, action: `STATUS_${h.status}`, source: 'system', summary, kind: 'reservations', local, hour, bookingId: h.bookingId });
    }
  }

  // The channel sync log: failures by default, everything when the person asks about channels.
  const channelsAsked = !!kinds?.includes('channels');
  if (can(ctx.actor, 'channels.view') && (!kinds || channelsAsked) && !stay && !room && !q.person && (!q.source || q.source === 'system')) {
    const logs = await prisma.channelSyncLog.findMany({
      where: {
        connection: { propertyId: ctx.propertyId },
        createdAt: { gte: start, lt: end },
        ...(channelsAsked && !q.worth_checking ? {} : { status: 'FAILED' }),
        ...(q.text ? { message: { contains: q.text, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { id: true, action: true, status: true, message: true, createdAt: true, connection: { select: { channel: true } } },
    });
    for (const l of logs) {
      const channel = CHANNEL_NAMES[l.connection.channel] ?? l.connection.channel;
      const { local, hour } = clock(l.createdAt);
      entries.push({
        id: `c:${l.id}`,
        at: l.createdAt.toISOString(),
        user: { id: 'system', name: channel },
        action: `CHANNEL_${l.action}`,
        source: 'system',
        summary: `${channel} ${l.action.toLowerCase().replace(/_/g, ' ')}: ${l.message}`.slice(0, 300),
        kind: 'channels',
        local,
        hour,
        ...(l.status === 'FAILED' ? { flag: 'Channel sync failed' } : {}),
      });
    }
  }

  // Who did it, and how.
  let person: string | null = null;
  if (q.person) {
    const want = norm(q.person).split(' ').filter(Boolean);
    const named = (n: string) => {
      const words = norm(n).split(' ');
      return want.every((w) => words.some((x) => x.startsWith(w)));
    };
    const people = [...new Set(entries.map((e) => e.user.name))];
    const match = people.filter(named);
    if (!match.length) {
      const seen = people.filter((p) => p !== 'Reservation history' && !Object.values(CHANNEL_NAMES).includes(p));
      return {
        blocks: [],
        forModel: `Nobody called “${q.person}” has entries ${windowWords(from, to, today)}${seen.length ? `. People with entries then: ${seen.slice(0, 15).join(', ')}` : ''}. Say so, or try a wider window.`,
      };
    }
    entries = entries.filter((e) => match.includes(e.user.name));
    person = match.length === 1 ? match[0] : q.person;
  }
  if (q.source) entries = entries.filter((e) => e.source === SOURCES[q.source!]);

  // Money taken off at night stands out more.
  for (const e of entries) if (e.moneyOut && e.hour < 5) e.flag = `${e.flag}, overnight`;

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const flagged = entries.filter((e) => e.flag);
  const list = q.worth_checking ? flagged : entries;

  // Codes for the reservations the entries are about, for the model to name them.
  const bookingIds = [...new Set(list.slice(0, FOR_MODEL).flatMap((e) => (e.bookingId ? [e.bookingId] : [])))];
  if (bookingIds.length) {
    const codes = await prisma.booking.findMany({ where: { id: { in: bookingIds }, propertyId: ctx.propertyId }, select: { id: true, code: true } });
    const byId = new Map(codes.map((c) => [c.id, c.code ?? undefined]));
    for (const e of list) if (e.bookingId) e.code = byId.get(e.bookingId);
  }

  const patterns = findPatterns(flagged);
  const title = q.worth_checking ? 'Worth a look' : stay ? `Activity · ${guestOf(stay)}` : 'Activity';
  const description = [
    stay ? `#${stay.code}` : '',
    person ?? '',
    room ? `Room ${room.roomNumber}` : '',
    kinds ? kinds.map((k) => KIND_WORDS[k]).join(', ') : '',
    q.text ? `“${q.text}”` : '',
    q.source ? { agent: 'by the agent', screens: 'by hand', system: 'automatic' }[q.source] : '',
    rangeWords(from, to, today),
  ]
    .filter(Boolean)
    .join(' · ');

  const block: AgentBlock = {
    type: 'activity',
    title,
    description,
    items: list.slice(0, SHOWN).map((e) => ({ id: e.id, at: e.at, user: e.user, action: e.action, source: e.source, summary: e.summary, ...(e.flag ? { flag: e.flag } : {}) })),
    total: list.length,
    href: '/admin/activity',
  };

  const count = <K extends string>(keys: K[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const days = diffDays(from, to) + 1;
  const facts = {
    window: { from, to, timezone, days },
    filters: { guest: stay ? `${guestOf(stay)} (#${stay.code})` : undefined, person: person ?? undefined, room: room?.roomNumber, kinds: kinds ?? undefined, text: q.text, source: q.source, worthChecking: q.worth_checking || undefined },
    total: list.length,
    ...(truncated ? { note: `Only the latest ${MAX_ROWS} log rows were read: narrow the days or filters for a complete count.` } : {}),
    byKind: count(list.map((e) => e.kind)),
    byPerson: Object.entries(count(list.map((e) => e.user.name)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, n]) => ({ name, entries: n, worthChecking: list.filter((e) => e.user.name === name && e.flag).length || undefined })),
    bySource: count(list.map((e) => ({ agent: 'agent', classic: 'screens', system: 'system' })[e.source])),
    ...(days <= 31 && list.length ? { byDay: count(list.map((e) => e.local.slice(0, 10))) } : {}),
    worthChecking: q.worth_checking ? undefined : { count: flagged.length, latest: flagged.slice(0, 15).map(forModel) },
    patterns: patterns.length ? patterns : undefined,
    entries: list.slice(0, FOR_MODEL).map(forModel),
    ...(list.length > FOR_MODEL ? { more: `${list.length - FOR_MODEL} older entries not listed: narrow the filters to see them.` } : {}),
    shownToPerson: `A card with the latest ${Math.min(SHOWN, list.length)} of these entries${q.worth_checking ? '' : ' (those worth a look marked)'} and a link to the activity log.`,
  };
  const text = JSON.stringify(facts, (_k, v) => (v === undefined || v === '' ? undefined : v));
  return { blocks: [block], forModel: text, memory: stay ? memoryOf(stay) : undefined };
}

/** Whether a text has the words, each from the start of a word: "refund" in "Refunded", "ac" in "AC broken" but not in "TRACK". */
function textMatcher(text: string): (s: string) => boolean {
  const re = new RegExp(`\\b${norm(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  return (s) => re.test(norm(s));
}

function forModel(e: Entry) {
  return {
    at: e.local,
    who: e.user.name,
    what: e.summary.length > 180 ? `${e.summary.slice(0, 179)}…` : e.summary,
    kind: e.kind,
    via: ({ agent: 'agent', classic: 'screens', system: 'system' } as const)[e.source],
    reservation: e.code,
    flag: e.flag,
  };
}

/** Patterns worth naming: one person's many refunds or discounts, one stay's several, many ID views, repeated sync failures. */
function findPatterns(flagged: Entry[]): string[] {
  const out: string[] = [];
  const money = flagged.filter((e) => e.moneyOut && e.user.id !== 'system');
  const byPerson = new Map<string, number>();
  for (const e of money) byPerson.set(e.user.name, (byPerson.get(e.user.name) ?? 0) + 1);
  for (const [name, n] of byPerson) if (n >= 3) out.push(`${name} made ${n} of the refunds, discounts, “paid another way” payments or lowered amounts.`);
  const byStay = new Map<string, Entry[]>();
  for (const e of money) if (e.bookingId) byStay.set(e.bookingId, [...(byStay.get(e.bookingId) ?? []), e]);
  for (const list of byStay.values()) {
    if (list.length < 2) continue;
    const who = [...new Set(list.map((e) => e.user.name))];
    out.push(`Reservation #${list[0].code ?? list[0].bookingId} had ${list.length} money-reducing entries (${who.join(', ')}).`);
  }
  const ids = new Map<string, number>();
  for (const e of flagged) if (e.action === 'GUEST_ID_VIEWED' || e.action === 'CARD_AUTH_ID_VIEWED') ids.set(e.user.name, (ids.get(e.user.name) ?? 0) + 1);
  for (const [name, n] of ids) if (n >= 5) out.push(`${name} opened ${n} guest IDs.`);
  const sync = new Map<string, number>();
  for (const e of flagged) if (e.kind === 'channels') sync.set(e.user.name, (sync.get(e.user.name) ?? 0) + 1);
  for (const [channel, n] of sync) if (n >= 3) out.push(`${channel} failed to sync ${n} times.`);
  return out.slice(0, 8);
}

function localClock(timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return (d: Date) => {
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return { local: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`, hour: Number(p.hour) };
  };
}

const localDay = (d: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function rangeWords(from: string, to: string, today: string): string {
  if (from === to) return from === today ? 'Today' : from === addDaysISO(today, -1) ? 'Yesterday' : formatDay(from);
  return `${formatDay(from)} to ${to === today ? 'today' : formatDay(to)}`;
}

function windowWords(from: string, to: string, today: string): string {
  const r = rangeWords(from, to, today);
  return from === to ? r.toLowerCase() : `from ${r}`;
}
