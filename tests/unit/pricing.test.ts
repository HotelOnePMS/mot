import { describe, expect, it } from 'vitest';
import { priceStay } from '@/server/services/pricing';

describe('priceStay', () => {
  it('without taxes the total is the room charges', () => {
    const p = priceStay({ nightly: [100, 120], rooms: 2, guests: 3, charges: [], currency: 'USD' });
    expect(p).toEqual({ subtotal: 440, charges: [], chargesTotal: 0, total: 440 });
  });

  it('applies every kind of charge', () => {
    const p = priceStay({
      nightly: [100, 100, 150],
      rooms: 2,
      guests: 3,
      currency: 'USD',
      charges: [
        { name: 'Sales tax', kind: 'PERCENT', amount: 12.5 },
        { name: 'Resort fee', kind: 'PER_ROOM_NIGHT', amount: 15 },
        { name: 'City tax', kind: 'PER_GUEST_NIGHT', amount: 2.5 },
        { name: 'Cleaning', kind: 'PER_STAY', amount: 40 },
      ],
    });
    expect(p.subtotal).toBe(700); // (100 + 100 + 150) × 2 rooms
    expect(p.charges.map((c) => [c.name, c.amount])).toEqual([
      ['Sales tax', 87.5],
      ['Resort fee', 90], // 15 × 2 rooms × 3 nights
      ['City tax', 22.5], // 2.5 × 3 guests × 3 nights
      ['Cleaning', 80], // 40 × 2 rooms
    ]);
    expect(p.chargesTotal).toBe(280);
    expect(p.total).toBe(980);
  });

  it('rounds each line so the lines add up to the total', () => {
    const p = priceStay({ nightly: [99.99, 99.99, 99.99], rooms: 1, guests: 1, currency: 'USD', charges: [{ name: 'VAT', kind: 'PERCENT', amount: 7.25 }] });
    expect(p.charges[0].amount).toBe(21.75);
    expect(p.total).toBe(Number((p.subtotal + p.charges[0].amount).toFixed(2)));
  });

  it('uses whole yen', () => {
    const p = priceStay({ nightly: [12345], rooms: 1, guests: 2, currency: 'JPY', charges: [{ name: 'Consumption tax', kind: 'PERCENT', amount: 10 }] });
    expect(p.charges[0].amount).toBe(1235);
    expect(p.total).toBe(13580);
  });

  it('skips zero or negative charges', () => {
    const p = priceStay({ nightly: [100], rooms: 1, guests: 1, currency: 'USD', charges: [{ name: 'Free', kind: 'PER_STAY', amount: 0 }] });
    expect(p.charges).toEqual([]);
    expect(p.total).toBe(100);
  });
});
