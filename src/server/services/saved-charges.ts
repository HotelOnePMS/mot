/**
 * Saved charges: a hotel's usual extras with their price ("Pet fee", $50 per stay). Picked from when adding a charge
 * to a folio by hand, and used by the agent when someone asks for a charge by name without a price. Anyone who can set
 * the hotel's taxes and fees (charges.manage), or change folios there (folio.edit), can change the list; every change
 * goes in the activity log.
 */
import { prisma } from '@/lib/prisma';
import { roundMoney } from '@/lib/currency';
import { CARD_NUMBER_REFUSED, containsCardNumber } from '@/lib/desk-payments';
import { describeSavedCharge, isSavedChargeUnit, matchSavedCharge, type SavedChargeUnit, type SavedChargeView } from '@/lib/saved-charges';
import { assertPropertyAccess, can, canAtProperty, requirePermission, type Actor } from '../authz';
import { badRequest, forbidden, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { hotelLocale } from './hotels';

const MAX_SAVED = 100;

const view = (c: { id: string; name: string; amount: unknown; unit: string; note: string | null }): SavedChargeView => ({
  id: c.id,
  name: c.name,
  amount: Number(c.amount),
  unit: isSavedChargeUnit(c.unit) ? c.unit : 'STAY',
  note: c.note,
});

/** A hotel's saved charges, by name. No permission check: for code that already checked access. */
export async function savedChargesFor(propertyId: string): Promise<SavedChargeView[]> {
  const rows = await prisma.savedCharge.findMany({ where: { propertyId }, orderBy: { name: 'asc' } });
  return rows.map(view);
}

/** The saved charges, for staff who can see folios at this hotel. */
export async function listSavedCharges(actor: Actor, propertyId: string): Promise<SavedChargeView[]> {
  requirePermission(actor, 'folio.view');
  assertPropertyAccess(actor, propertyId);
  return savedChargesFor(propertyId);
}

/** Who may change the list: whoever sets the hotel's taxes and fees, or may change folios there. */
export async function mayManageSavedCharges(actor: Actor, propertyId: string): Promise<boolean> {
  return can(actor, 'charges.manage') || (await canAtProperty(actor, 'folio.edit', propertyId));
}

async function requireManage(actor: Actor, propertyId: string) {
  assertPropertyAccess(actor, propertyId);
  if (!(await mayManageSavedCharges(actor, propertyId))) {
    throw forbidden('Saved charges are changed by managers and owners, or staff the owner allowed to edit folios.');
  }
}

export interface SavedChargeInput {
  name: string;
  amount: number;
  unit?: SavedChargeUnit;
  note?: string | null;
}

function clean(input: SavedChargeInput, currency: string) {
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) throw badRequest('Say what the charge is for.');
  const note = input.note ? input.note.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null;
  if (containsCardNumber(name) || (note && containsCardNumber(note))) throw badRequest(CARD_NUMBER_REFUSED);
  const amount = roundMoney(input.amount, currency);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) throw badRequest('Enter a price between 0 and 100,000.');
  if (input.unit !== undefined && !isSavedChargeUnit(input.unit)) throw badRequest('A saved charge is per stay, per night or each.');
  return { name, amount, unit: input.unit, note };
}

/**
 * Save a usual charge, or change the one with this name (or id): "pet fee is always $50" sets the Pet fee to $50.
 * Returns it with what it was before (null when it's new).
 */
export async function saveSavedCharge(
  op: OpContext,
  propertyId: string,
  input: SavedChargeInput & { id?: string }
): Promise<{ saved: SavedChargeView; before: SavedChargeView | null }> {
  await requireManage(op.actor, propertyId);
  const { currency } = await hotelLocale(propertyId);
  const c = clean(input, currency);
  const existing = input.id
    ? await prisma.savedCharge.findFirst({ where: { id: input.id, propertyId } })
    : await prisma.savedCharge.findFirst({ where: { propertyId, name: { equals: c.name, mode: 'insensitive' } } });
  if (input.id && !existing) throw notFound('Saved charge');
  if (existing) {
    // Renamed onto another saved charge's name: that would be two with one name.
    if (existing.name.toLowerCase() !== c.name.toLowerCase()) {
      const clash = await prisma.savedCharge.findFirst({ where: { propertyId, name: { equals: c.name, mode: 'insensitive' }, id: { not: existing.id } }, select: { id: true } });
      if (clash) throw badRequest(`There's already a saved charge called “${c.name}”.`);
    }
    const before = view(existing);
    const row = await prisma.savedCharge.update({
      where: { id: existing.id },
      data: { name: c.name, amount: c.amount, ...(c.unit ? { unit: c.unit } : {}), ...(input.note !== undefined ? { note: c.note } : {}) },
    });
    const saved = view(row);
    await recordAudit(op, propertyId, 'SAVED_CHARGE_UPDATED', `Usual charge “${saved.name}” is now ${describeSavedCharge(saved, currency)} (was “${before.name}” ${describeSavedCharge(before, currency)})`, { savedChargeId: row.id, before, after: saved });
    return { saved, before };
  }
  if ((await prisma.savedCharge.count({ where: { propertyId } })) >= MAX_SAVED) throw badRequest(`A hotel can save up to ${MAX_SAVED} usual charges.`);
  const row = await prisma.savedCharge.create({ data: { propertyId, name: c.name, amount: c.amount, unit: c.unit ?? 'STAY', note: c.note, createdById: op.actor.userId } });
  const saved = view(row);
  await recordAudit(op, propertyId, 'SAVED_CHARGE_CREATED', `Saved the usual charge “${saved.name}”: ${describeSavedCharge(saved, currency)}`, { savedChargeId: row.id, after: saved });
  return { saved, before: null };
}

/** Remove a saved charge, by id or by name ("forget the pet fee"). Folios that already have it keep it. */
export async function deleteSavedCharge(op: OpContext, propertyId: string, which: { id?: string; name?: string }): Promise<SavedChargeView> {
  await requireManage(op.actor, propertyId);
  let row = which.id ? await prisma.savedCharge.findFirst({ where: { id: which.id, propertyId } }) : null;
  if (!row && which.name) {
    const all = await prisma.savedCharge.findMany({ where: { propertyId } });
    row = matchSavedCharge(all, which.name);
  }
  if (!row) throw notFound('Saved charge');
  await prisma.savedCharge.delete({ where: { id: row.id } });
  const gone = view(row);
  const { currency } = await hotelLocale(propertyId);
  await recordAudit(op, propertyId, 'SAVED_CHARGE_DELETED', `Removed the usual charge “${gone.name}” (${describeSavedCharge(gone, currency)})`, { savedChargeId: row.id, before: gone });
  return gone;
}
