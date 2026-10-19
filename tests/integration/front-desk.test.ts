import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO, atNoonUTC } from '@/server/dates';
import { INTEGRATION_GUEST_DOMAIN } from '@/server/concierge/booking';
import { closeBusinessDay, nightAuditPreview } from '@/server/services/nightAudit';
import { createDeskReservation } from '@/server/services/reservations';
import { actorFor, makeHotel, makeUser } from './fixtures';

describe('new reservation at the desk', () => {
  it('books a walk-in and checks them straight in', async () => {
    const h = await makeHotel();
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const actor = await actorFor(desk.id);
    const b = await createDeskReservation(
      { actor, source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 2, rooms: 1, guest: { firstName: 'Rosa', lastName: 'Diaz', email: 'rosa@example.org' }, checkInNow: true },
    );
    expect(b.status).toBe('CHECKED_IN');
    expect(b.room?.number).toBeDefined();
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id }, include: { user: true } });
    expect(row.source).toBe('FRONT_DESK');
    expect(row.createdById).toBe(desk.id);
    // A new guest gets a record of their own; their email stays on the booking.
    expect(row.user.email.endsWith(`@${INTEGRATION_GUEST_DOMAIN}`)).toBe(true);
    expect(row.user.isActive).toBe(false);
    expect(row.guestEmail).toBe('rosa@example.org');
  });

  it('puts the booking in an existing guest’s trips', async () => {
    const h = await makeHotel();
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const guest = await makeUser({ role: 'CUSTOMER', email: `guest-${Date.now()}@example.org` });
    const b = await createDeskReservation(
      { actor: await actorFor(desk.id), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: addDaysISO(h.today, 2), checkOut: addDaysISO(h.today, 4), guests: 1, rooms: 1, guest: { firstName: 'X', lastName: 'Y', email: guest.email.toUpperCase() } },
    );
    expect(b.status).toBe('CONFIRMED');
    expect(b.guest.id).toBe(guest.id);
  });

  it('refuses to check in a guest who isn’t arriving today', async () => {
    const h = await makeHotel();
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    await expect(
      createDeskReservation(
        { actor: await actorFor(desk.id), source: 'classic' },
        { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: addDaysISO(h.today, 1), checkOut: addDaysISO(h.today, 2), guests: 1, rooms: 1, guest: { firstName: 'A', lastName: 'B' }, checkInNow: true },
      ),
    ).rejects.toThrow(/arriving today/);
  });

  it('leaves no guest record behind when the room type is sold out', async () => {
    const h = await makeHotel({ rooms: 1 });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const actor = await actorFor(desk.id);
    const stay = { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: addDaysISO(h.today, 5), checkOut: addDaysISO(h.today, 6), guests: 1, rooms: 1 };
    await createDeskReservation({ actor, source: 'classic' }, { ...stay, guest: { firstName: 'First', lastName: 'Guest' } });
    const before = await prisma.user.count();
    await expect(createDeskReservation({ actor, source: 'classic' }, { ...stay, guest: { firstName: 'Second', lastName: 'Guest' } })).rejects.toThrow(/sold out/);
    expect(await prisma.user.count()).toBe(before);
  });

  it('keeps staff out of other hotels', async () => {
    const [mine, theirs] = await Promise.all([makeHotel(), makeHotel()]);
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [mine.property.id] });
    await expect(
      createDeskReservation(
        { actor: await actorFor(desk.id), source: 'classic' },
        { propertyId: theirs.property.id, roomTypeId: theirs.roomType.id, checkIn: theirs.today, checkOut: addDaysISO(theirs.today, 1), guests: 1, rooms: 1, guest: { firstName: 'A', lastName: 'B' } },
      ),
    ).rejects.toThrow(/access/);
  });
});

describe('night audit', () => {
  it('marks no-shows, saves the report and closes the day once', async () => {
    const h = await makeHotel({ rooms: 2 });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const guest = await makeUser({ role: 'CUSTOMER' });
    // Due today, never arrived.
    const due = await prisma.booking.create({
      data: { userId: guest.id, propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: atNoonUTC(h.today), checkOut: atNoonUTC(addDaysISO(h.today, 2)), guests: 1, rooms: 1, totalPrice: 200, subtotalPrice: 200, status: 'CONFIRMED', code: `T${Date.now().toString(36).slice(-5).toUpperCase()}` },
    });
    const actor = await actorFor(desk.id);
    const preview = await nightAuditPreview(actor, h.property.id, h.today);
    expect(preview.businessDate).toBe(h.today);
    expect(preview.noShows.map((b) => b.id)).toContain(due.id);
    expect(preview.closed).toBeNull();

    const record = await closeBusinessDay({ actor, source: 'classic' }, h.property.id, { businessDate: h.today, noShowBookingIds: [due.id], flagOccupiedRooms: true, notes: 'Quiet night' });
    expect(record.summary.noShowsMarked).toHaveLength(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('NO_SHOW');

    const after = await nightAuditPreview(actor, h.property.id, h.today);
    expect(after.closed?.notes).toBe('Quiet night');
    await expect(closeBusinessDay({ actor, source: 'classic' }, h.property.id, { businessDate: h.today, noShowBookingIds: [], flagOccupiedRooms: false })).rejects.toThrow(/already closed/);
  });

  it('can’t close a day that hasn’t happened', async () => {
    const h = await makeHotel();
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    await expect(nightAuditPreview(await actorFor(desk.id), h.property.id, addDaysISO(h.today, 1))).rejects.toThrow(/hasn’t happened/);
  });
});
