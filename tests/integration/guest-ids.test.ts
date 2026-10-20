import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO, atNoonUTC } from '@/server/dates';
import { transitionBooking } from '@/server/services/bookings';
import { addGuestId, deleteGuestId, listGuestIds, purgeExpiredGuestIds, readGuestIdImage, setGuestIdSettings } from '@/server/services/guestIds';
import { createDeskReservation } from '@/server/services/reservations';
import { actorFor, makeHotel, makeUser } from './fixtures';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;

async function arrival() {
  const h = await makeHotel();
  const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
  const ctx = { actor: await actorFor(desk.id), source: 'classic' as const };
  const b = await createDeskReservation(ctx, {
    propertyId: h.property.id,
    roomTypeId: h.roomType.id,
    checkIn: h.today,
    checkOut: addDaysISO(h.today, 2),
    guests: 1,
    rooms: 1,
    guest: { firstName: 'Jane', lastName: 'Doe' },
  });
  return { h, desk, ctx, b };
}

describe('guest ID photos', () => {
  it('stores the photo encrypted, serves it back to staff, and logs each view', async () => {
    const { h, ctx, b } = await arrival();
    const state = await addGuestId(ctx, b.id, { image, type: 'DRIVERS_LICENSE', side: 'FRONT', nameOnId: 'Jane Doe', numberLast4: 'D1234567' });
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0]).toMatchObject({ type: 'DRIVERS_LICENSE', numberLast4: '4567', nameOnId: 'Jane Doe' });

    const row = await prisma.guestIdDocument.findUniqueOrThrow({ where: { id: state.documents[0].id } });
    expect(Buffer.from(row.encrypted).includes(JPEG)).toBe(false);

    const img = await readGuestIdImage(ctx, row.id);
    expect(img.mimeType).toBe('image/jpeg');
    expect(img.bytes.equals(JPEG)).toBe(true);
    const views = await prisma.agentAuditLog.count({ where: { propertyId: h.property.id, action: 'GUEST_ID_VIEWED' } });
    expect(views).toBe(1);
  });

  it('keeps them away from other hotels and housekeeping', async () => {
    const { ctx, b } = await arrival();
    const { documents } = await addGuestId(ctx, b.id, { image, type: 'PASSPORT', side: 'FRONT' });
    const other = await makeHotel();
    const outsider = await makeUser({ role: 'OWNER', propertyIds: [other.property.id] });
    const outsiderCtx = { actor: await actorFor(outsider.id), source: 'classic' as const };
    await expect(readGuestIdImage(outsiderCtx, documents[0].id)).rejects.toThrow();
    await expect(listGuestIds(outsiderCtx.actor, b.id)).rejects.toThrow();

    const hk = await makeUser({ role: 'HOUSEKEEPER', propertyIds: [b.propertyId] });
    await expect(readGuestIdImage({ actor: await actorFor(hk.id), source: 'classic' }, documents[0].id)).rejects.toThrow(/roles/);
  });

  it('refuses check-in without an ID when the hotel requires one', async () => {
    const { h, ctx, b } = await arrival();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    await setGuestIdSettings({ actor: await actorFor(owner.id), source: 'classic' }, h.property.id, { requireGuestId: true, guestIdRetentionDays: 30 });
    await expect(transitionBooking(ctx, b.id, 'CHECKED_IN')).rejects.toThrow(/ID before check-in/);
    await expect(
      createDeskReservation(ctx, { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: 'W', lastName: 'K' }, checkInNow: true }),
    ).rejects.toThrow(/ID before check-in/);

    await addGuestId(ctx, b.id, { image, type: 'DRIVERS_LICENSE', side: 'FRONT' });
    const r = await transitionBooking(ctx, b.id, 'CHECKED_IN');
    expect(r.to).toBe('CHECKED_IN');
  });

  it('only owners and managers change the rules', async () => {
    const { h, ctx } = await arrival();
    await expect(setGuestIdSettings(ctx, h.property.id, { requireGuestId: true, guestIdRetentionDays: 1 })).rejects.toThrow(/roles/);
  });

  it('deletes photos after the retention period, but not while the guest is still in', async () => {
    const { h, ctx, b } = await arrival();
    const { documents } = await addGuestId(ctx, b.id, { image, type: 'DRIVERS_LICENSE', side: 'FRONT' });
    // The stay ended 10 days ago.
    await prisma.booking.update({ where: { id: b.id }, data: { checkIn: atNoonUTC(addDaysISO(h.today, -12)), checkOut: atNoonUTC(addDaysISO(h.today, -10)), status: 'CHECKED_IN' } });
    expect(await purgeExpiredGuestIds({ propertyIds: [h.property.id] })).toBe(0);

    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CHECKED_OUT' } });
    expect(await purgeExpiredGuestIds({ propertyIds: [h.property.id] })).toBe(0); // kept 30 days by default

    const owner = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
    await setGuestIdSettings({ actor: await actorFor(owner.id), source: 'classic' }, h.property.id, { requireGuestId: false, guestIdRetentionDays: 7 });
    expect(await prisma.guestIdDocument.findUnique({ where: { id: documents[0].id } })).toBeNull();
  });

  it('lets the desk delete a bad photo', async () => {
    const { ctx, b } = await arrival();
    const { documents } = await addGuestId(ctx, b.id, { image, type: 'OTHER', side: 'BACK' });
    const after = await deleteGuestId(ctx, documents[0].id);
    expect(after.documents).toHaveLength(0);
  });
});
