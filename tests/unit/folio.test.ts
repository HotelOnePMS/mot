import { test } from 'vitest';
import assert from 'node:assert/strict';
import { toMinorUnits } from '../../src/lib/currency';
import { folioTotals, stayLines, type FolioLine } from '../../src/lib/folio';

const stay = { totalPrice: 479.4, subtotalPrice: 420, charges: null as unknown, roomTypeName: 'Deluxe King', nights: 3, rooms: 1, currency: 'USD' };

/** The lines' sum in minor units, so a float can't hide a missing cent. */
const sumMinor = (lines: readonly FolioLine[], currency: string) => lines.reduce((s, l) => s + toMinorUnits(l.amount, currency), 0);
const brief = (lines: readonly FolioLine[]) => lines.map((l) => [l.key, l.kind, l.label, l.detail, l.amount]);

test('the room and each tax or fee add up to the total, to the cent', () => {
  const lines = stayLines({
    ...stay,
    charges: [
      { name: 'Sales tax', kind: 'PERCENT', rate: 12, amount: 50.4 },
      { name: 'City fee', kind: 'PER_ROOM_NIGHT', rate: 3, amount: 9 },
    ],
  });
  assert.deepEqual(brief(lines), [
    ['room', 'ROOM', 'Deluxe King', '3 nights', 420],
    ['tax-0', 'TAX', 'Sales tax', null, 50.4],
    ['tax-1', 'TAX', 'City fee', null, 9],
  ]);
  assert.ok(lines.every((l) => l.section === 'CHARGES' && l.at === null));
  assert.equal(sumMinor(lines, 'USD'), 47940);
  assert.equal(folioTotals(lines, 'USD').charges, 479.4);
});

test('the room line absorbs charges JSON that doesn’t match the total (OTA and older bookings)', () => {
  const lines = stayLines({ ...stay, totalPrice: 250, subtotalPrice: 200, charges: [{ name: 'VAT', amount: 33.33 }] });
  assert.deepEqual(brief(lines), [
    ['room', 'ROOM', 'Deluxe King', '3 nights', 216.67],
    ['tax-0', 'TAX', 'VAT', null, 33.33],
  ]);
  assert.equal(sumMinor(lines, 'USD'), 25000);

  // Float sums that miss by a hair still land exactly.
  const floaty = stayLines({ ...stay, totalPrice: 100.3, subtotalPrice: 100, charges: [{ name: 'A', amount: 0.1 }, { name: 'B', amount: 0.2 }] });
  assert.equal(floaty[0].amount, 100);
  assert.equal(sumMinor(floaty, 'USD'), 10030);
  assert.equal(folioTotals(floaty, 'USD').balance, 100.3);

  // More tax than the whole stay is wrong data: never a negative room line.
  const wrong = stayLines({ ...stay, totalPrice: 300, subtotalPrice: 250, charges: [{ name: 'Tax', amount: 900 }] });
  assert.deepEqual(brief(wrong), [
    ['room', 'ROOM', 'Deluxe King', '3 nights', 250],
    ['tax-0', 'TAX', 'Taxes and fees', null, 50],
  ]);
});

test('a currency without decimals adds up in whole yen', () => {
  const lines = stayLines({
    ...stay,
    totalPrice: 34851,
    subtotalPrice: 31500,
    charges: [
      { name: 'Consumption tax', kind: 'PERCENT', rate: 10, amount: 3150 },
      { name: 'Accommodation tax', kind: 'PER_GUEST_NIGHT', rate: 66.87, amount: 200.6 },
    ],
    currency: 'JPY',
  });
  assert.deepEqual(
    lines.map((l) => l.amount),
    [31500, 3150, 201],
  );
  assert.equal(sumMinor(lines, 'JPY'), 34851);
  assert.equal(folioTotals(lines, 'JPY').charges, 34851);
});

test('a three-decimal currency adds up to the fils', () => {
  const lines = stayLines({ ...stay, totalPrice: 85.125, subtotalPrice: 77.386, charges: [{ name: 'Service charge', amount: 7.739 }], currency: 'KWD' });
  assert.deepEqual(
    lines.map((l) => l.amount),
    [77.386, 7.739],
  );
  assert.equal(sumMinor(lines, 'KWD'), 85125);
  assert.equal(folioTotals(lines, 'KWD').charges, 85.125);
});

test('missing or malformed charges leave just the room line', () => {
  for (const charges of [null, undefined, 'oops', 42, { VAT: 10 }, [], [{ name: 'VAT' }], [null, 5, { name: 'VAT', amount: '10' }]]) {
    const lines = stayLines({ ...stay, totalPrice: 300, subtotalPrice: null, charges });
    assert.deepEqual(brief(lines), [['room', 'ROOM', 'Deluxe King', '3 nights', 300]], JSON.stringify(charges));
  }
  // Subtotal equal to the total: nothing to split out.
  assert.equal(stayLines({ ...stay, totalPrice: 300, subtotalPrice: 300, charges: [] }).length, 1);
});

test('without usable charges, a subtotal below the total becomes one taxes-and-fees line', () => {
  for (const charges of [null, 'oops', [], [{ name: 'VAT', amount: 0 }]]) {
    const lines = stayLines({ ...stay, totalPrice: 300, subtotalPrice: 250, charges });
    assert.deepEqual(
      brief(lines),
      [
        ['room', 'ROOM', 'Deluxe King', '3 nights', 250],
        ['tax-0', 'TAX', 'Taxes and fees', null, 50],
      ],
      JSON.stringify(charges),
    );
  }
});

test('zero and negative taxes are skipped, and a tax without a name still shows', () => {
  const lines = stayLines({
    ...stay,
    totalPrice: 110,
    subtotalPrice: 100,
    charges: [
      { name: 'VAT', amount: 0 },
      { name: 'Credit', amount: -5 },
      { name: 'City fee', amount: 6 },
      { amount: 4 },
    ],
  });
  assert.deepEqual(brief(lines), [
    ['room', 'ROOM', 'Deluxe King', '3 nights', 100],
    ['tax-0', 'TAX', 'City fee', null, 6],
    ['tax-1', 'TAX', 'Taxes and fees', null, 4],
  ]);
});

test('nights and rooms read naturally on the room line', () => {
  const detail = (nights: number, rooms: number) => stayLines({ ...stay, nights, rooms })[0].detail;
  assert.equal(detail(1, 1), '1 night');
  assert.equal(detail(3, 1), '3 nights');
  assert.equal(detail(1, 2), '1 night × 2 rooms');
  assert.equal(detail(3, 2), '3 nights × 2 rooms');
});

const paymentLine = (key: string, kind: 'PAYMENT' | 'REFUND', amount: number): FolioLine => ({
  key,
  section: 'PAYMENTS',
  kind,
  label: key,
  detail: null,
  amount,
  at: '2026-11-03T18:00:00.000Z',
});

test('totals split charges, payments and refunds; overpaying leaves a credit', () => {
  const lines = [
    ...stayLines({ ...stay, totalPrice: 200, subtotalPrice: 180, charges: [{ name: 'Sales tax', amount: 20 }] }),
    paymentLine('stripe', 'PAYMENT', -150),
    paymentLine('cash', 'PAYMENT', -60.5),
    paymentLine('change', 'REFUND', 3),
  ];
  assert.deepEqual(folioTotals(lines, 'USD'), { charges: 200, paid: 210.5, refunded: 3, balance: -7.5 });
  assert.deepEqual(folioTotals([], 'USD'), { charges: 0, paid: 0, refunded: 0, balance: 0 });
});

test('a balance in a currency without decimals stays whole', () => {
  const lines = [...stayLines({ ...stay, totalPrice: 30000, subtotalPrice: 27273, charges: null, currency: 'JPY' }), paymentLine('cash', 'PAYMENT', -10000)];
  assert.equal(folioTotals(lines, 'JPY').balance, 20000);
});
