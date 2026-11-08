/**
 * Guests, for the agent: the hotel's do-not-rent list (is this guest on it and why, add someone with a reason, take
 * them off) and the messages guests left with the voice line, WhatsApp or the booking page assistant (what's waiting,
 * mark one handled).
 *
 * Reading changes nothing; adding, removing and marking are steps the person confirms.
 */
import { prisma } from '@/lib/prisma';
import type { DoNotRentEntry } from '@/lib/dto';
import { emailKey, phoneKey } from '@/lib/doNotRent';
import { can } from '../authz';
import { checkDoNotRent, listDoNotRent } from '../services/doNotRent';
import { listGuestRequests, requestChannel } from '../services/guestRequests';
import { hotelLocale } from '../services/hotels';
import { guestOf, memoryOf, type ResolvedBooking } from './folio-plan';
import { HarnessInputError } from './input-error';
import type { PlanOutput, ToolCtx } from './tools';

type ReadOut = { blocks: []; forModel: string; isError?: boolean; memory?: ReturnType<typeof memoryOf> };

const refused = (text: string): PlanOutput => ({ steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text }] });
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const day = (iso: string) => iso.slice(0, 10);

const entryFacts = (e: DoNotRentEntry) => ({ name: e.guestName, email: e.email ?? undefined, phone: e.phone ?? undefined, reason: e.reason, addedBy: e.createdBy.name, addedOn: day(e.createdAt) });

/** Entries whose name has every word the person gave ("okafor", "james ok"). */
function byName(list: DoNotRentEntry[], name: string): DoNotRentEntry[] {
  const want = norm(name).split(' ').filter(Boolean);
  return list.filter((e) => {
    const words = norm(e.guestName).split(' ');
    return want.every((w) => words.some((x) => x.startsWith(w)));
  });
}

export interface DnrLookup {
  name?: string;
  email?: string;
  phone?: string;
}

/** Is this guest on the list (by their reservation's email and phone, or details given), or the whole list. */
export async function doNotRentRead(ctx: ToolCtx, stay: ResolvedBooking | null, a: DnrLookup): Promise<ReadOut> {
  if (!can(ctx.actor, 'dnr.view')) return { blocks: [], forModel: 'The do-not-rent list isn’t part of this person’s role: say so.', isError: true };
  if (stay) {
    const guest = guestOf(stay);
    const match = await checkDoNotRent(ctx.actor, ctx.propertyId, { email: stay.user.email, phone: stay.user.phone });
    return {
      blocks: [],
      forModel: match
        ? JSON.stringify({ onTheList: true, guest, reservation: stay.code, entry: { name: match.guestName, reason: match.reason, addedBy: match.createdBy.name, addedOn: day(match.createdAt) } })
        : JSON.stringify({ onTheList: false, guest, reservation: stay.code, checked: [stay.user.email && 'email', stay.user.phone && 'phone'].filter(Boolean) }),
      memory: memoryOf(stay),
    };
  }
  if (a.email || a.phone) {
    if (!emailKey(a.email) && !phoneKey(a.phone)) throw new HarnessInputError('Give a full email address or a phone number with at least 7 digits.');
    const match = await checkDoNotRent(ctx.actor, ctx.propertyId, { email: a.email, phone: a.phone });
    return { blocks: [], forModel: JSON.stringify(match ? { onTheList: true, entry: { name: match.guestName, reason: match.reason, addedBy: match.createdBy.name, addedOn: day(match.createdAt) } } : { onTheList: false }) };
  }
  const list = await listDoNotRent(ctx.actor, ctx.propertyId);
  if (a.name) {
    const found = byName(list, a.name);
    return {
      blocks: [],
      forModel: JSON.stringify({
        matchedOn: 'name only (the list matches guests by email and phone, so a different person can share a name)',
        onTheList: found.length > 0,
        entries: found.slice(0, 10).map(entryFacts),
      }),
    };
  }
  return { blocks: [], forModel: JSON.stringify({ count: list.length, entries: list.slice(0, 40).map(entryFacts), ...(list.length > 40 ? { more: list.length - 40 } : {}) }) };
}

export interface DnrChange extends DnrLookup {
  action: 'add' | 'remove';
  reason?: string;
}

/** Add a guest to the list (from their reservation, or the details given) with the reason, or take them off it. */
export async function planDoNotRent(ctx: ToolCtx, stay: ResolvedBooking | null, a: DnrChange): Promise<PlanOutput> {
  if (!can(ctx.actor, 'dnr.manage')) return refused('Your role can’t change the do-not-rent list.');
  const name = stay ? guestOf(stay) : a.name?.replace(/\s+/g, ' ').trim();
  const email = stay ? stay.user.email : a.email?.trim() || null;
  const phone = stay ? stay.user.phone : a.phone?.trim() || null;
  if (a.action === 'add') {
    if (!name) throw new HarnessInputError('Say who: their reservation (name, room or code), or their name with an email or phone.');
    if (!emailKey(email) && !phoneKey(phone)) throw new HarnessInputError(`There’s no email or phone for ${name}: ask for one, so the list can recognise them next time.`);
    const reason = a.reason?.replace(/\s+/g, ' ').trim() ?? '';
    if (reason.length < 3) throw new HarnessInputError(`Ask why ${name} shouldn’t be rented to again: the next shift sees the reason.`);
    if (reason.length > 1000) throw new HarnessInputError('Keep the reason under 1000 characters.');
    const existing = await checkDoNotRent(ctx.actor, ctx.propertyId, { email, phone });
    if (existing) throw new HarnessInputError(`${existing.guestName} is already on the list (${existing.reason}).`);
    return {
      steps: [
        {
          tool: 'add_do_not_rent',
          args: { propertyId: ctx.propertyId, guestName: name, email: emailKey(email), phone: phone ?? null, reason, ...(stay ? { bookingId: stay.id } : {}) },
          summary: `Add ${name} to the do-not-rent list`,
          detail: `“${reason.length > 120 ? `${reason.slice(0, 119)}…` : reason}” · recognised by ${[emailKey(email) && 'email', phoneKey(phone) && 'phone'].filter(Boolean).join(' and ')} on future bookings`,
        },
      ],
      warnings: [],
      risk: 'medium',
      ...(stay ? { memory: memoryOf(stay) } : {}),
    };
  }
  // Remove: the entry for this guest's email or phone, or the one entry with that name.
  let entry: { id: string; guestName: string; reason: string; createdBy: { name: string }; createdAt: string } | null = null;
  if (emailKey(email) || phoneKey(phone)) entry = await checkDoNotRent(ctx.actor, ctx.propertyId, { email, phone });
  if (!entry && name) {
    const found = byName(await listDoNotRent(ctx.actor, ctx.propertyId), name);
    if (found.length > 1) throw new HarnessInputError(`Several entries match “${name}”: ${found.map((e) => `${e.guestName} (${e.email ?? e.phone ?? 'no contact'})`).join('; ')}. Ask which one, by email or phone.`);
    entry = found[0] ?? null;
  }
  if (!entry) throw new HarnessInputError(`${name ?? 'That guest'} isn’t on the do-not-rent list.`);
  return {
    steps: [
      {
        tool: 'remove_do_not_rent',
        args: { id: entry.id },
        summary: `Take ${entry.guestName} off the do-not-rent list`,
        detail: `Added by ${entry.createdBy.name} on ${day(entry.createdAt)}: “${entry.reason.length > 100 ? `${entry.reason.slice(0, 99)}…` : entry.reason}”`,
      },
    ],
    warnings: [],
    risk: 'medium',
    ...(stay ? { memory: memoryOf(stay) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Guest messages
// ---------------------------------------------------------------------------

export async function guestRequestsRead(ctx: ToolCtx, status: 'open' | 'handled' | 'all'): Promise<ReadOut> {
  if (!can(ctx.actor, 'requests.view')) return { blocks: [], forModel: 'Guest messages aren’t part of this person’s role: say so.', isError: true };
  const want = status === 'open' ? 'NEW' : status === 'handled' ? 'DONE' : 'ALL';
  const [rows, { timezone }] = await Promise.all([listGuestRequests(ctx.actor, ctx.propertyId, want, 40), hotelLocale(ctx.propertyId)]);
  const at = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const open = want === 'NEW' ? rows.length : await prisma.guestRequest.count({ where: { propertyId: ctx.propertyId, status: 'NEW' } });
  return {
    blocks: [],
    forModel: JSON.stringify({
      open,
      shown: rows.length,
      requests: rows.map((r) => ({
        id: r.id,
        from: r.name,
        phone: r.phone ?? undefined,
        email: r.email ?? undefined,
        via: requestChannel(r.source),
        received: at.format(r.createdAt).replace(',', ''),
        status: r.status === 'NEW' ? 'open' : 'handled',
        message: r.message.length > 400 ? `${r.message.slice(0, 399)}…` : r.message,
      })),
      note: 'Calling back or replying happens outside the system; mark a message handled with mark_guest_request once it’s dealt with.',
    }),
  };
}

export async function planGuestRequest(ctx: ToolCtx, a: { request_id?: string; from?: string; status: 'handled' | 'open' }): Promise<PlanOutput> {
  if (!can(ctx.actor, 'requests.view')) return refused('Guest messages aren’t part of your role.');
  const want = a.status === 'handled' ? 'DONE' : 'NEW';
  let row = a.request_id ? await prisma.guestRequest.findFirst({ where: { id: a.request_id, propertyId: ctx.propertyId } }) : null;
  if (!row && a.from) {
    // By who left it: among the ones not already in that state.
    const rows = await prisma.guestRequest.findMany({ where: { propertyId: ctx.propertyId, status: want === 'DONE' ? 'NEW' : 'DONE' }, orderBy: { createdAt: 'desc' }, take: 100 });
    const words = norm(a.from).split(' ').filter(Boolean);
    const found = rows.filter((r) => {
      const n = norm(r.name).split(' ');
      return words.every((w) => n.some((x) => x.startsWith(w)));
    });
    if (found.length > 1) throw new HarnessInputError(`${found.length} messages are from “${a.from}”. Call list_guest_requests and pass the request_id of the one meant.`);
    row = found[0] ?? null;
  }
  if (!row) throw new HarnessInputError('No such guest message here. Call list_guest_requests for the ids.');
  if (row.status === want) throw new HarnessInputError(`${row.name}’s message is already ${a.status}.`);
  const preview = row.message.length > 90 ? `${row.message.slice(0, 89)}…` : row.message;
  return {
    steps: [{ tool: 'mark_guest_request', args: { requestId: row.id, status: want }, summary: `Mark ${row.name}’s message ${a.status === 'handled' ? 'handled' : 'open again'}`, detail: `“${preview}”` }],
    warnings: [],
    risk: 'low',
  };
}
