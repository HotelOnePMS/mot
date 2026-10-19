/**
 * Front-desk check-in checklist for bookings carrying risk flags. Staff tick
 * items; who and when are stored with the booking (and go into dispute evidence).
 */
import { prisma } from '@/lib/prisma';
import { checklistRequirements, openChecklistItems, type ChecklistItem, type ChecklistRequirements } from '@/lib/risk';
import { requireStaff } from '../authz';
import { badRequest } from '../errors';
import { recordAudit } from '../services/audit';
import { getBookingForStaff } from '../services/bookings';
import { toBookingSummary } from '../services/mappers';

export interface ChecklistState {
  /** Null when the booking has no risk flags: nothing to check. */
  required: ChecklistRequirements | null;
  items: { item: ChecklistItem; label: string; required: boolean; done: boolean; at: string | null; by: string | null }[];
  open: ChecklistItem[];
}

const LABEL: Record<ChecklistItem, string> = {
  idMatched: 'Photo ID matches the guest’s name',
  cardShown: 'Card used to pay was shown',
  registrationSigned: 'Registration card signed',
};

const COLUMNS: Record<ChecklistItem, { at: 'idMatchedAt' | 'cardShownAt' | 'registrationSignedAt'; by: 'idMatchedById' | 'cardShownById' | 'registrationSignedById' }> = {
  idMatched: { at: 'idMatchedAt', by: 'idMatchedById' },
  cardShown: { at: 'cardShownAt', by: 'cardShownById' },
  registrationSigned: { at: 'registrationSignedAt', by: 'registrationSignedById' },
};

async function stateFor(bookingId: string, required: ChecklistRequirements | null): Promise<ChecklistState> {
  const row = await prisma.bookingChecklist.findUnique({ where: { bookingId } });
  const ids = row ? [row.idMatchedById, row.cardShownById, row.registrationSignedById].filter((id): id is string => !!id) : [];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const nameOf = (id: string | null | undefined) => {
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}`.trim() : null;
  };
  const all: ChecklistItem[] = ['idMatched', 'cardShown', 'registrationSigned'];
  const items = all
    .filter((item) => item !== 'cardShown' || required?.cardShown || (row && row[COLUMNS.cardShown.at]))
    .map((item) => {
      const at = row?.[COLUMNS[item].at] ?? null;
      return { item, label: LABEL[item], required: item !== 'cardShown' || !!required?.cardShown, done: !!at, at: at?.toISOString() ?? null, by: nameOf(row?.[COLUMNS[item].by]) };
    });
  const done = Object.fromEntries(items.map((i) => [i.item, i.done]));
  return { required, items, open: openChecklistItems(required, done) };
}

export async function getChecklist(bookingId: string): Promise<ChecklistState> {
  const actor = await requireStaff('booking.view');
  const booking = await getBookingForStaff(actor, bookingId);
  return stateFor(booking.id, checklistRequirements(toBookingSummary(booking).riskFlags));
}

/** Tick or untick one item. Needs the same role as checking a guest in. */
export async function setChecklistItem(bookingId: string, item: ChecklistItem, done: boolean): Promise<ChecklistState> {
  const actor = await requireStaff('booking.checkin');
  const booking = await getBookingForStaff(actor, bookingId);
  const required = checklistRequirements(toBookingSummary(booking).riskFlags);
  if (!required) throw badRequest('This booking has no risk flags, so there is no checklist.');
  if (item === 'cardShown' && !required.cardShown) throw badRequest('Showing the card is not required for this booking.');
  const col = COLUMNS[item];
  const values = done ? { [col.at]: new Date(), [col.by]: actor.userId } : { [col.at]: null, [col.by]: null };
  await prisma.bookingChecklist.upsert({ where: { bookingId: booking.id }, create: { bookingId: booking.id, ...values }, update: values });
  await recordAudit({ actor, source: 'classic' }, booking.propertyId, 'BOOKING_CHECKLIST', `${done ? 'Ticked' : 'Unticked'} “${LABEL[item]}” on ${booking.code ?? 'booking'}`, { bookingId: booking.id, item, done });
  return stateFor(booking.id, required);
}
