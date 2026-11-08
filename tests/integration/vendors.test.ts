import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { setPermissionGrant } from '@/server/services/permissions';
import { addVendor, listVendors, removeVendor, updateVendor, vendorAccess } from '@/server/services/vendors';
import { actorFor, makeHotel, makeUser } from './fixtures';

const op = async (userId: string) => ({ actor: await actorFor(userId), source: 'classic' as const });

describe('Vendors', () => {
  it('owners add, change and remove vendors; every change is logged', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const ctx = await op(owner.id);

    const v = await addVendor(ctx, h.property.id, {
      name: 'Acme Linen',
      category: 'LINEN_LAUNDRY',
      contactName: 'Pat Doe',
      email: ' Orders@AcmeLinen.com ',
      phone: '+1 831 555 0199',
      website: 'acmelinen.com',
      accountNumber: 'HTL-0042',
    });
    expect(v).toMatchObject({ email: 'orders@acmelinen.com', website: 'https://acmelinen.com', status: 'ACTIVE', preferred: false });
    await expect(addVendor(ctx, h.property.id, { name: 'acme linen', category: 'OTHER' })).rejects.toThrow(/already/);
    await expect(addVendor(ctx, h.property.id, { name: 'Bad', category: 'OTHER', email: 'nope' })).rejects.toThrow(/email/);

    const changed = await updateVendor(ctx, v.id, { phone: '+1 831 555 0100', preferred: true, notes: 'Net 30' });
    expect(changed).toMatchObject({ phone: '+1 831 555 0100', preferred: true, notes: 'Net 30' });
    expect((await listVendors(ctx.actor, h.property.id)).map((x) => x.id)).toEqual([v.id]);

    await removeVendor(ctx, v.id);
    expect(await listVendors(ctx.actor, h.property.id)).toEqual([]);
    const log = await prisma.agentAuditLog.findMany({ where: { propertyId: h.property.id, action: { startsWith: 'VENDOR_' } }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => l.action)).toEqual(['VENDOR_ADD', 'VENDOR_UPDATE', 'VENDOR_REMOVE']);
    const update = JSON.parse(log[1].detail!);
    expect(update.changes.phone).toEqual({ from: '+1 831 555 0199', to: '+1 831 555 0100' });
    expect(update.alsoChanged).toEqual(['notes']);
  });

  it('other roles see vendors only when the owner allows it, and only managers can be allowed to change them', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const ownerOp = await op(owner.id);
    const v = await addVendor(ownerOp, h.property.id, { name: 'Coastal Plumbing', category: 'MAINTENANCE', phone: '831 555 0123' });

    // By default only the owner.
    const [mgr, fd] = [await actorFor(manager.id), await actorFor(desk.id)];
    await expect(listVendors(mgr, h.property.id)).rejects.toThrow(/owner/);
    await expect(listVendors(fd, h.property.id)).rejects.toThrow(/owner/);
    expect(await vendorAccess(fd, h.property.id)).toEqual({ view: false, manage: false });

    // The owner lets the front desk see the list: they can read contacts but not change anything.
    await setPermissionGrant(ownerOp, h.property.id, { permission: 'vendors.view', role: 'FRONT_DESK', granted: true });
    expect((await listVendors(fd, h.property.id))[0].phone).toBe('831 555 0123');
    await expect(updateVendor({ actor: fd, source: 'classic' }, v.id, { phone: '1' })).rejects.toThrow(/owner/);
    await expect(setPermissionGrant(ownerOp, h.property.id, { permission: 'vendors.manage', role: 'FRONT_DESK', granted: true })).rejects.toThrow();

    // Managers allowed to manage can also see, and can add, change and remove.
    await setPermissionGrant(ownerOp, h.property.id, { permission: 'vendors.manage', role: 'MANAGER', granted: true });
    expect(await vendorAccess(mgr, h.property.id)).toEqual({ view: true, manage: true });
    const mgrOp = { actor: mgr, source: 'classic' as const };
    await updateVendor(mgrOp, v.id, { contactName: 'Sam' });
    const added = await addVendor(mgrOp, h.property.id, { name: 'Sunrise Bakery', category: 'FOOD_BEVERAGE' });
    await removeVendor(mgrOp, added.id);

    // Taking it back stops them again.
    await setPermissionGrant(ownerOp, h.property.id, { permission: 'vendors.manage', role: 'MANAGER', granted: false });
    await expect(updateVendor(mgrOp, v.id, { contactName: 'Alex' })).rejects.toThrow(/owner/);
  });

  it('keeps each hotel’s vendors and permissions to itself', async () => {
    const [mine, theirs] = await Promise.all([makeHotel(), makeHotel()]);
    const owner = await makeUser({ role: 'OWNER', propertyIds: [mine.property.id, theirs.property.id] });
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [mine.property.id] });
    const ownerOp = await op(owner.id);
    await setPermissionGrant(ownerOp, mine.property.id, { permission: 'vendors.manage', role: 'MANAGER', granted: true });
    const v = await addVendor(ownerOp, theirs.property.id, { name: 'Elsewhere Supply', category: 'SUPPLIES' });
    const mgrOp = await op(manager.id);
    await expect(listVendors(mgrOp.actor, theirs.property.id)).rejects.toThrow(/access/);
    await expect(updateVendor(mgrOp, v.id, { name: 'Mine now' })).rejects.toThrow(/access/);
    await expect(removeVendor(mgrOp, v.id)).rejects.toThrow(/access/);
  });
});
