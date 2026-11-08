import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { getFolio } from '@/server/services/folio';
import { createDeskReservation } from '@/server/services/reservations';
import { deleteSavedCharge, listSavedCharges, saveSavedCharge } from '@/server/services/saved-charges';
import { setPermissionGrant } from '@/server/services/permissions';
import { actorFor, makeHotel, makeUser } from './fixtures';

async function setup() {
  const h = await makeHotel();
  const as = async (role: 'OWNER' | 'MANAGER' | 'FRONT_DESK' | 'HOUSEKEEPER') => ({ actor: await actorFor((await makeUser({ role, propertyIds: [h.property.id] })).id), source: 'classic' as const });
  return { h, owner: await as('OWNER'), manager: await as('MANAGER'), desk: await as('FRONT_DESK'), housekeeper: await as('HOUSEKEEPER') };
}

describe('the hotel’s usual charges', () => {
  it('saves one, changes its price by name however it’s typed, and removes it, all in the activity log', async () => {
    const { h, manager } = await setup();
    const first = await saveSavedCharge(manager, h.property.id, { name: 'Pet fee', amount: 50 });
    expect(first).toMatchObject({ before: null, saved: { name: 'Pet fee', amount: 50, unit: 'STAY', note: null } });
    const changed = await saveSavedCharge(manager, h.property.id, { name: 'PET FEE', amount: 60, unit: 'ITEM', note: 'per pet' });
    expect(changed.saved).toMatchObject({ id: first.saved.id, name: 'PET FEE', amount: 60, unit: 'ITEM', note: 'per pet' });
    expect(changed.before).toMatchObject({ amount: 50, unit: 'STAY' });
    await saveSavedCharge(manager, h.property.id, { name: 'Rollaway bed', amount: 20, unit: 'NIGHT' });
    expect((await listSavedCharges(manager.actor, h.property.id)).map((c) => c.name)).toEqual(['PET FEE', 'Rollaway bed']);

    // Renaming onto another's name would make two with one name.
    await expect(saveSavedCharge(manager, h.property.id, { id: first.saved.id, name: 'rollaway bed', amount: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(saveSavedCharge(manager, h.property.id, { name: 'Card 4242 4242 4242 4242', amount: 5 })).rejects.toMatchObject({ status: 400 });
    await expect(saveSavedCharge(manager, h.property.id, { name: 'Free', amount: 0 })).rejects.toMatchObject({ status: 400 });

    await deleteSavedCharge(manager, h.property.id, { name: 'pets' });
    expect((await listSavedCharges(manager.actor, h.property.id)).map((c) => c.name)).toEqual(['Rollaway bed']);
    const log = await prisma.agentAuditLog.findMany({ where: { propertyId: h.property.id, action: { startsWith: 'SAVED_CHARGE' } }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => l.action)).toEqual(['SAVED_CHARGE_CREATED', 'SAVED_CHARGE_UPDATED', 'SAVED_CHARGE_CREATED', 'SAVED_CHARGE_DELETED']);
  });

  it('front desk sees them; changes them only once the owner lets them edit folios; housekeeping neither', async () => {
    const { h, owner, desk, housekeeper } = await setup();
    await saveSavedCharge(owner, h.property.id, { name: 'Pet fee', amount: 50 });
    expect(await listSavedCharges(desk.actor, h.property.id)).toHaveLength(1);
    await expect(listSavedCharges(housekeeper.actor, h.property.id)).rejects.toMatchObject({ status: 403 });
    await expect(saveSavedCharge(desk, h.property.id, { name: 'Late check-out', amount: 25 })).rejects.toMatchObject({ status: 403 });
    await setPermissionGrant(owner, h.property.id, { permission: 'folio.edit', role: 'FRONT_DESK', granted: true });
    await expect(saveSavedCharge(desk, h.property.id, { name: 'Late check-out', amount: 25 })).resolves.toMatchObject({ before: null });

    // Another hotel's staff can't touch them.
    const other = await setup();
    await expect(saveSavedCharge(other.owner, h.property.id, { name: 'Pet fee', amount: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it('the folio offers them to whoever can edit it', async () => {
    const { h, owner, desk } = await setup();
    await saveSavedCharge(owner, h.property.id, { name: 'Pet fee', amount: 50 });
    const b = await createDeskReservation(desk, { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 3), guests: 1, rooms: 1, guest: { firstName: 'Ana', lastName: 'Lima' } });
    const folio = await getFolio(owner.actor, b.id);
    expect(folio).toMatchObject({ canEdit: true, canSaveCharges: true, nights: 3, savedCharges: [{ name: 'Pet fee', amount: 50 }] });
    expect(await getFolio(desk.actor, b.id)).toMatchObject({ canEdit: false, canSaveCharges: false, savedCharges: [] });
  });
});
