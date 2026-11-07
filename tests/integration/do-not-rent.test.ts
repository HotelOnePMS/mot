import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { arrivalsOn } from '@/server/services/bookings';
import { addDoNotRent, checkDoNotRent, listDoNotRent, removeDoNotRent } from '@/server/services/doNotRent';
import { frontDeskSummary } from '@/server/services/frontdesk';
import { createDeskReservation } from '@/server/services/reservations';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';

describe('Do Not Rent list', () => {
  it('flags a returning guest on email or phone, with who added them and why', async () => {
    const h = await makeHotel();
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const actor = await actorFor(desk.id);
    const ctx = { actor, source: 'classic' as const };
    const email = `trouble-${uid()}@example.org`;

    const entry = await addDoNotRent(ctx, { propertyId: h.property.id, guestName: 'Rex Trouble', email: email.toUpperCase(), phone: '+1 (555) 010-2030', reason: 'Smoked in 102' });
    expect(entry.email).toBe(email);
    expect(entry.createdBy.id).toBe(desk.id);

    // A walk-in booked with only the phone, written differently, is still recognised.
    expect(await checkDoNotRent(actor, h.property.id, { phone: '555.010.2030' })).toMatchObject({ id: entry.id, reason: 'Smoked in 102' });
    const b = await createDeskReservation(ctx, {
      propertyId: h.property.id,
      roomTypeId: h.roomType.id,
      checkIn: h.today,
      checkOut: addDaysISO(h.today, 1),
      guests: 1,
      rooms: 1,
      guest: { firstName: 'Rex', lastName: 'T', email },
    });
    expect(b.doNotRent?.id).toBe(entry.id);
    const [arrival] = (await arrivalsOn(h.property.id, h.today)).filter((a) => a.id === b.id);
    expect(arrival.doNotRent?.reason).toBe('Smoked in 102');
    const summary = await frontDeskSummary(actor, h.property.id, h.today);
    expect(summary.alerts.find((a) => a.id === 'dnr')?.detail).toContain('Smoked in 102');

    // Adding them twice is refused; removing takes them off and stops the warning.
    await expect(addDoNotRent(ctx, { propertyId: h.property.id, guestName: 'Rex', phone: '5550102030', reason: 'again' })).rejects.toThrow(/already/);
    await removeDoNotRent(ctx, entry.id);
    expect(await listDoNotRent(actor, h.property.id)).toEqual([]);
    expect((await arrivalsOn(h.property.id, h.today)).find((a) => a.id === b.id)?.doNotRent).toBeNull();
    const log = await prisma.agentAuditLog.findMany({ where: { propertyId: h.property.id, action: { in: ['DNR_ADD', 'DNR_REMOVE'] } } });
    expect(log).toHaveLength(2);
  });

  it('keeps each hotel’s list to itself', async () => {
    const [mine, theirs] = await Promise.all([makeHotel(), makeHotel()]);
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [mine.property.id] });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [mine.property.id, theirs.property.id] });
    const email = `elsewhere-${uid()}@example.org`;
    await addDoNotRent({ actor: await actorFor(owner.id), source: 'classic' }, { propertyId: theirs.property.id, guestName: 'Elsewhere', email, reason: 'Damage' });
    expect(await checkDoNotRent(await actorFor(owner.id), mine.property.id, { email })).toBeNull();
    await expect(listDoNotRent(await actorFor(desk.id), theirs.property.id)).rejects.toThrow(/access/);
  });

  it('needs a note and a way to recognise the guest', async () => {
    const h = await makeHotel();
    const ctx = { actor: await actorFor((await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] })).id), source: 'classic' as const };
    await expect(addDoNotRent(ctx, { propertyId: h.property.id, guestName: 'No Contact', reason: 'x' })).rejects.toThrow(/email or phone/);
    await expect(addDoNotRent(ctx, { propertyId: h.property.id, guestName: 'No Note', email: 'a@b.co', reason: '  ' })).rejects.toThrow(/note/);
  });

  it('is off limits to housekeeping', async () => {
    const h = await makeHotel();
    const hk = await makeUser({ role: 'HOUSEKEEPER', propertyIds: [h.property.id] });
    await expect(listDoNotRent(await actorFor(hk.id), h.property.id)).rejects.toThrow(/roles/);
  });
});
