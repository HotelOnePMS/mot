/**
 * Entity resolution: turn "the Smiths", "#P6T5CS", "room 201", "them" or
 * "Rosa" into concrete records at this property — or a clarifying question
 * when more than one thing matches. Nothing is guessed silently.
 */
import { prisma } from '@/lib/prisma';
import type { AgentBlock, AgentContextState } from '@/lib/agent/blocks';
import type { ISODate } from '@/lib/dto';
import { BOOKING_STATUS } from '@/lib/status';
import type { Actor } from '../authz';
import { formatDay, toISODate } from '../dates';
import { bookingInclude, personName, type BookingWithRelations } from '../services/mappers';
import type { GuestRef } from './nlu';

export interface ResolveCtx {
  actor: Actor;
  propertyId: string;
  propertyName: string;
  today: ISODate;
  memory: AgentContextState;
  /** Original message — used to build "did you mean" commands. */
  message: string;
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; block: AgentBlock };

export type BookingPurpose = 'checkIn' | 'checkOut' | 'upcoming' | 'any';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .trim();

function singular(token: string): string[] {
  const t = token.replace(/'s$/, '');
  const out = [t];
  if (/ies$/.test(t)) out.push(t.replace(/ies$/, 'y'));
  if (/es$/.test(t)) out.push(t.replace(/es$/, ''));
  if (/s$/.test(t)) out.push(t.replace(/s$/, ''));
  return out;
}

function nameScore(query: string, first: string, last: string): number {
  const q = norm(query);
  const f = norm(first);
  const l = norm(last);
  const full = `${f} ${l}`;
  if (q === full) return 100;
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const tok of tokens) {
    const variants = singular(tok);
    if (variants.includes(l)) score = Math.max(score, tokens.length > 1 ? 85 : 75);
    else if (variants.includes(f)) score = Math.max(score, 65);
    else if (variants.some((v) => v.length >= 3 && (l.startsWith(v) || f.startsWith(v)))) score = Math.max(score, 45);
  }
  if (tokens.length > 1 && tokens.every((tok) => singular(tok).some((v) => v === f || v === l))) score = 95;
  return score;
}

function relevance(b: BookingWithRelations, purpose: BookingPurpose, today: ISODate): { boost: number; eligible: boolean } {
  const checkIn = toISODate(b.checkIn);
  const checkOut = toISODate(b.checkOut);
  const inHouse = b.status === 'CHECKED_IN';
  const arrivingToday = (b.status === 'CONFIRMED' || b.status === 'PENDING') && checkIn <= today && checkOut > today;
  const upcoming = (b.status === 'CONFIRMED' || b.status === 'PENDING') && checkIn > today;
  switch (purpose) {
    case 'checkIn':
      return { boost: arrivingToday ? 30 : upcoming ? -10 : -30, eligible: arrivingToday };
    case 'checkOut':
      return { boost: inHouse ? (checkOut <= today ? 35 : 25) : -30, eligible: inHouse };
    case 'upcoming':
      return { boost: arrivingToday || inHouse ? 25 : upcoming ? 10 : -30, eligible: arrivingToday || inHouse || upcoming };
    default:
      return { boost: inHouse || arrivingToday ? 20 : upcoming ? 8 : -5, eligible: true };
  }
}

function describe(b: BookingWithRelations, today: ISODate): string {
  const checkIn = toISODate(b.checkIn);
  const checkOut = toISODate(b.checkOut);
  if (b.status === 'CHECKED_IN') return `In house${b.room ? ` · room ${b.room.roomNumber}` : ''} · leaves ${formatDay(checkOut)}`;
  if (checkIn === today) return `Arrives today · ${b.roomType.name}`;
  return `${BOOKING_STATUS[b.status as keyof typeof BOOKING_STATUS]?.label ?? b.status} · ${formatDay(checkIn)}–${formatDay(checkOut)} · ${b.roomType.name}`;
}

function replaceRef(message: string, name: string | undefined, code: string): string {
  if (name) {
    const re = new RegExp(`\\b(the\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(message)) return message.replace(re, code);
  }
  return `${message} (${code})`;
}

const PURPOSE_WORD: Record<BookingPurpose, string> = {
  checkIn: 'arriving today',
  checkOut: 'in house',
  upcoming: 'upcoming or in house',
  any: 'at this property',
};

export async function resolveBooking(ctx: ResolveCtx, ref: GuestRef, purpose: BookingPurpose): Promise<Resolved<BookingWithRelations>> {
  const base = { propertyId: ctx.propertyId };

  if (ref.pronoun && ctx.memory.lastBookingId) {
    const b = await prisma.booking.findFirst({ where: { ...base, id: ctx.memory.lastBookingId }, include: bookingInclude });
    if (b) return { ok: true, value: b };
  }
  if (ref.pronoun && !ref.name && !ref.code && !ref.roomNumber) {
    return { ok: false, block: { type: 'error', text: 'Who do you mean? Mention the guest’s name, room or confirmation code.' } };
  }

  if (ref.code) {
    const code = ref.code.toUpperCase();
    const b = await prisma.booking.findFirst({
      where: { ...base, OR: [{ code }, { id: ref.code }, { id: ref.code.toLowerCase() }] },
      include: bookingInclude,
    });
    if (b) return { ok: true, value: b };
    if (!ref.name) {
      return { ok: false, block: { type: 'error', text: `I couldn’t find reservation ${code} at ${ctx.propertyName}. Try the guest’s name instead.` } };
    }
  }

  if (ref.roomNumber) {
    const room = await prisma.room.findFirst({ where: { ...base, roomNumber: ref.roomNumber } });
    if (!room) return { ok: false, block: { type: 'error', text: `There’s no room ${ref.roomNumber} at ${ctx.propertyName}.` } };
    const inRoom = await prisma.booking.findMany({
      where: { roomId: room.id, status: { in: ['CHECKED_IN', 'CONFIRMED', 'PENDING'] } },
      include: bookingInclude,
      orderBy: { checkIn: 'asc' },
    });
    const pick =
      purpose === 'checkIn'
        ? inRoom.find((b) => b.status !== 'CHECKED_IN' && toISODate(b.checkIn) <= ctx.today)
        : inRoom.find((b) => b.status === 'CHECKED_IN') ?? inRoom[0];
    if (pick) return { ok: true, value: pick };
    return { ok: false, block: { type: 'error', text: `Nobody is ${purpose === 'checkIn' ? 'arriving into' : 'staying in'} room ${ref.roomNumber} right now.` } };
  }

  if (!ref.name) {
    return { ok: false, block: { type: 'error', text: 'Which guest? Give me a name, room number or confirmation code.' } };
  }

  const tokens = norm(ref.name)
    .split(/\s+/)
    .flatMap(singular)
    .filter((t) => t.length >= 2);
  const candidates = await prisma.booking.findMany({
    where: {
      ...base,
      status: purpose === 'any' ? undefined : { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
      user: {
        OR: tokens.flatMap((t) => [
          { firstName: { startsWith: t, mode: 'insensitive' as const } },
          { lastName: { startsWith: t, mode: 'insensitive' as const } },
        ]),
      },
    },
    include: bookingInclude,
    orderBy: { checkIn: 'desc' },
    take: 60,
  });

  const scored = candidates
    .map((b) => {
      const s = nameScore(ref.name!, b.user.firstName, b.user.lastName);
      const r = relevance(b, purpose, ctx.today);
      return { b, score: s ? s + r.boost : 0, nameScore: s, eligible: r.eligible };
    })
    .filter((x) => x.nameScore >= 45)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { ok: false, block: { type: 'error', text: `I couldn’t find a guest called “${ref.name}” at ${ctx.propertyName}.` } };
  }
  const eligible = scored.filter((x) => x.eligible);
  const people = new Set(scored.map((x) => x.b.userId));
  if (eligible.length === 0 && people.size === 1) {
    const top = scored[0].b;
    const why =
      purpose === 'checkIn'
        ? toISODate(top.checkIn) > ctx.today
          ? `isn’t due until ${formatDay(toISODate(top.checkIn), 'weekday')}`
          : top.status === 'CHECKED_IN'
            ? `is already checked in${top.room ? ` (room ${top.room.roomNumber})` : ''}`
            : `isn’t arriving today (${BOOKING_STATUS[top.status as keyof typeof BOOKING_STATUS]?.label.toLowerCase() ?? top.status})`
        : purpose === 'checkOut'
          ? top.status === 'CHECKED_IN' ? 'can’t be checked out yet' : `isn’t in house (${BOOKING_STATUS[top.status as keyof typeof BOOKING_STATUS]?.label.toLowerCase() ?? top.status})`
          : `has no ${PURPOSE_WORD[purpose]} reservation`;
    return {
      ok: false,
      block: {
        type: 'clarify',
        question: `${personName(top.user)} ${why}.`,
        options: [{ label: 'Open reservation', hint: `${top.code} · ${describe(top, ctx.today)}`, command: `show reservation ${top.code}` }],
      },
    };
  }
  if (eligible.length === 0) {
    const top = scored[0].b;
    return {
      ok: false,
      block: {
        type: 'clarify',
        question: `${personName(top.user)} isn’t ${PURPOSE_WORD[purpose]}. Did you mean one of these?`,
        options: scored.slice(0, 4).map((x) => ({
          label: personName(x.b.user),
          hint: `${x.b.code} · ${describe(x.b, ctx.today)}`,
          command: `show reservation ${x.b.code}`,
        })),
      },
    };
  }
  const best = eligible[0];
  const rivals = eligible.filter((x) => x.b.userId !== best.b.userId && best.score - x.score < 15);
  if (rivals.length > 0) {
    return {
      ok: false,
      block: {
        type: 'clarify',
        question: `More than one guest matches “${ref.name}”. Which one?`,
        options: [best, ...rivals].slice(0, 5).map((x) => ({
          label: personName(x.b.user),
          hint: `${x.b.code} · ${describe(x.b, ctx.today)}`,
          command: replaceRef(ctx.message, ref.name, x.b.code ?? x.b.id),
        })),
      },
    };
  }
  return { ok: true, value: best.b };
}

export async function resolveRoom(ctx: ResolveCtx, roomNumber: string) {
  const room = await prisma.room.findFirst({
    where: { propertyId: ctx.propertyId, roomNumber: { equals: roomNumber, mode: 'insensitive' } },
    include: { roomType: { select: { id: true, name: true } } },
  });
  if (!room) return { ok: false as const, block: { type: 'error', text: `There’s no room ${roomNumber} at ${ctx.propertyName}.` } as AgentBlock };
  return { ok: true as const, value: room };
}

export async function resolveTeamMember(ctx: ResolveCtx, name: string) {
  const people = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['HOUSEKEEPER', 'MANAGER'] },
      assignedProperties: { some: { propertyId: ctx.propertyId } },
      OR: [
        { firstName: { startsWith: name, mode: 'insensitive' } },
        { lastName: { startsWith: name, mode: 'insensitive' } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  if (people.length === 1) return { ok: true as const, value: people[0] };
  if (people.length === 0) {
    return { ok: false as const, block: { type: 'error', text: `There’s nobody called ${name} on the housekeeping team here.` } as AgentBlock };
  }
  return {
    ok: false as const,
    block: {
      type: 'clarify',
      question: `Which ${name}?`,
      options: people.map((p) => ({ label: personName(p), hint: p.role.toLowerCase(), command: ctx.message.replace(new RegExp(`\\b${name}\\b`, 'i'), personName(p)) })),
    } as AgentBlock,
  };
}

export async function resolveRoomTypes(ctx: ResolveCtx, hint?: string) {
  const all = await prisma.roomType.findMany({
    where: { propertyId: ctx.propertyId, isActive: true },
    select: { id: true, name: true, basePrice: true, totalRooms: true },
    orderBy: { basePrice: 'asc' },
  });
  if (!hint) return all;
  const h = norm(hint);
  const hit = all.filter((rt) => norm(rt.name).includes(h) || h.includes(norm(rt.name)) || norm(rt.name).split(' ').some((w) => w.length > 3 && h.includes(w)));
  return hit.length ? hit : all;
}
