import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { DomainError } from '@/server/errors';
import { createBooking } from '@/server/services/bookings';
import { quoteStay } from '@/server/services/inventory';
import { makeHotel, makeUser } from './fixtures';

describe('booking engine', () => {
  it('prices in the hotel’s currency with its taxes and fees, and stores the breakdown', async () => {
    const h = await makeHotel({
      timezone: 'Europe/Lisbon',
      currency: 'EUR',
      basePrice: 120,
      charges: [
        { name: 'VAT', kind: 'PERCENT', amount: 6 },
        { name: 'City tax', kind: 'PER_GUEST_NIGHT', amount: 2 },
      ],
    });
    const guest = await makeUser({ role: 'CUSTOMER' });
    const checkIn = addDaysISO(h.today, 7);
    const quote = await quoteStay(prisma, { roomTypeId: h.roomType.id, checkIn, checkOut: addDaysISO(checkIn, 2), rooms: 1, guests: 2 });
    expect(quote.currency).toBe('EUR');
    expect(quote.subtotal).toBe(240);
    expect(quote.charges.map((c) => c.amount)).toEqual([14.4, 8]);
    expect(quote.total).toBe(262.4);

    const b = await createBooking({ userId: guest.id, propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn, checkOut: addDaysISO(checkIn, 2), guests: 2, rooms: 1, source: 'WEB' });
    expect(Number(b.totalPrice)).toBe(262.4);
    expect(Number(b.subtotalPrice)).toBe(240);
    expect(b.currency).toBe('EUR');
    expect(b.source).toBe('WEB');
    expect(b.charges).toEqual(quote.charges);
  });

  it('never sells the last room twice, even to two guests at the same moment', async () => {
    const h = await makeHotel({ rooms: 1 });
    const [a, b] = await Promise.all([makeUser({ role: 'CUSTOMER' }), makeUser({ role: 'CUSTOMER' })]);
    const checkIn = addDaysISO(h.today, 3);
    const stay = { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn, checkOut: addDaysISO(checkIn, 2), guests: 1, rooms: 1 };
    const results = await Promise.allSettled([createBooking({ ...stay, userId: a.id }), createBooking({ ...stay, userId: b.id })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(DomainError);
    expect((failed.reason as DomainError).status).toBe(409);
  });

  it('uses the hotel’s own "today" for check-in in the past', async () => {
    const h = await makeHotel({ timezone: 'Pacific/Kiritimati' }); // UTC+14: often a day ahead of the platform clock
    const guest = await makeUser({ role: 'CUSTOMER' });
    const yesterday = addDaysISO(h.today, -1);
    await expect(
      createBooking({ userId: guest.id, propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: yesterday, checkOut: h.today, guests: 1 }),
    ).rejects.toThrow(/past/);
  });
});
