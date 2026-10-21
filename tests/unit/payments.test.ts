import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  allocateCents,
  bookingPaymentStatus,
  cancellationPolicyText,
  effectivePolicy,
  paymentAmountDue,
  platformFeeCents,
  refundableCents,
  reservationShares,
  suggestedRefundCents,
} from '../../src/lib/payments';

const nights = [12000, 15000, 15000]; // $120, $150, $150 → $420 for one room

test('pay at property charges nothing online', () => {
  const r = paymentAmountDue({ policy: 'PAY_AT_PROPERTY', depositNights: 1, nightlyCents: nights, rooms: 1, totalCents: 42000 });
  assert.deepEqual(r, { dueNowCents: 0, balanceCents: 42000, kind: 'NONE' });
});

test('deposit is the first N nights, per room', () => {
  assert.deepEqual(paymentAmountDue({ policy: 'DEPOSIT', depositNights: 1, nightlyCents: nights, rooms: 1, totalCents: 42000 }), {
    dueNowCents: 12000,
    balanceCents: 30000,
    kind: 'DEPOSIT',
  });
  assert.equal(paymentAmountDue({ policy: 'DEPOSIT', depositNights: 2, nightlyCents: nights, rooms: 2, totalCents: 84000 }).dueNowCents, 54000);
});

test('deposit never exceeds the total and becomes a full payment when it covers the stay', () => {
  const r = paymentAmountDue({ policy: 'DEPOSIT', depositNights: 5, nightlyCents: nights, rooms: 1, totalCents: 42000 });
  assert.deepEqual(r, { dueNowCents: 42000, balanceCents: 0, kind: 'FULL' });
});

test('deposit nights default to 1 for bad input', () => {
  assert.equal(paymentAmountDue({ policy: 'DEPOSIT', depositNights: 0, nightlyCents: nights, rooms: 1, totalCents: 42000 }).dueNowCents, 12000);
  assert.equal(paymentAmountDue({ policy: 'DEPOSIT', depositNights: Number.NaN, nightlyCents: nights, rooms: 1, totalCents: 42000 }).dueNowCents, 12000);
});

test('full prepayment charges the whole total', () => {
  assert.deepEqual(paymentAmountDue({ policy: 'FULL_PREPAYMENT', depositNights: 1, nightlyCents: nights, rooms: 1, totalCents: 42000 }), {
    dueNowCents: 42000,
    balanceCents: 0,
    kind: 'FULL',
  });
});

test('a zero total is never charged', () => {
  assert.equal(paymentAmountDue({ policy: 'FULL_PREPAYMENT', depositNights: 1, nightlyCents: [], rooms: 1, totalCents: 0 }).kind, 'NONE');
});

test('effective policy falls back to pay at property without a working Stripe account', () => {
  assert.equal(effectivePolicy({ policy: 'DEPOSIT', stripeConfigured: true, chargesEnabled: true }), 'DEPOSIT');
  assert.equal(effectivePolicy({ policy: 'DEPOSIT', stripeConfigured: false, chargesEnabled: true }), 'PAY_AT_PROPERTY');
  assert.equal(effectivePolicy({ policy: 'FULL_PREPAYMENT', stripeConfigured: true, chargesEnabled: false }), 'PAY_AT_PROPERTY');
});

test('platform fee is a percentage, rounded, capped, and off by default', () => {
  assert.equal(platformFeeCents(10000, 2.5), 250);
  assert.equal(platformFeeCents(999, 2.5), 25);
  assert.equal(platformFeeCents(10000, 0), 0);
  assert.equal(platformFeeCents(10000, -3), 0);
  assert.equal(platformFeeCents(10000, Number.NaN), 0);
  assert.equal(platformFeeCents(10000, 500), 10000);
});

test('refunds: nothing suggested after the deadline, the remainder before it', () => {
  assert.equal(refundableCents(12000, 2000), 10000);
  assert.equal(refundableCents(12000, 20000), 0);
  assert.equal(suggestedRefundCents({ paidCents: 12000, refundedCents: 2000, deadlinePassed: false }), 10000);
  assert.equal(suggestedRefundCents({ paidCents: 12000, refundedCents: 0, deadlinePassed: true }), 0);
});

test('booking payment status follows the money', () => {
  assert.equal(bookingPaymentStatus({ totalCents: 42000, paidCents: 0, refundedCents: 0 }), 'AWAITING_PAYMENT');
  assert.equal(bookingPaymentStatus({ totalCents: 42000, paidCents: 12000, refundedCents: 0 }), 'DEPOSIT_PAID');
  assert.equal(bookingPaymentStatus({ totalCents: 42000, paidCents: 42000, refundedCents: 0 }), 'PAID');
  assert.equal(bookingPaymentStatus({ totalCents: 42000, paidCents: 42000, refundedCents: 1000 }), 'PARTIALLY_REFUNDED');
  assert.equal(bookingPaymentStatus({ totalCents: 42000, paidCents: 12000, refundedCents: 12000 }), 'REFUNDED');
});

test('policy text depends on the policy and never promises a dispute-free booking', () => {
  const texts = [
    cancellationPolicyText({ policy: 'PAY_AT_PROPERTY', depositNights: 1 }),
    cancellationPolicyText({ policy: 'DEPOSIT', depositNights: 2 }),
    cancellationPolicyText({ policy: 'FULL_PREPAYMENT', depositNights: 1 }),
  ];
  assert.equal(new Set(texts).size, 3);
  assert.match(texts[1], /deposit of 2 nights/);
  assert.match(cancellationPolicyText({ policy: 'DEPOSIT', depositNights: 1 }), /deposit of 1 night /);
  for (const t of texts) assert.doesNotMatch(t, /no disputes|chargeback.free|guaranteed/i);
});

test('one payment for several room types is shared out in whole cents that add up', () => {
  assert.deepEqual(allocateCents(30000, [100, 200]), [10000, 20000]);
  assert.deepEqual(allocateCents(10000, [1, 1, 1]), [3334, 3333, 3333]);
  assert.deepEqual(allocateCents(101, [0, 0]), [51, 50]);
  assert.deepEqual(allocateCents(0, [5, 7]), [0, 0]);
  assert.deepEqual(allocateCents(500, []), []);
});

test('refunds come off a cancelled room type first, so the rooms kept stay paid', () => {
  const lines = [
    { dueCents: 30000, cancelled: false },
    { dueCents: 20000, cancelled: true },
  ];
  assert.deepEqual(reservationShares({ paidCents: 50000, refundedCents: 0, lines }), [
    { paidCents: 30000, refundedCents: 0 },
    { paidCents: 20000, refundedCents: 0 },
  ]);
  assert.deepEqual(reservationShares({ paidCents: 50000, refundedCents: 20000, lines }), [
    { paidCents: 30000, refundedCents: 0 },
    { paidCents: 20000, refundedCents: 20000 },
  ]);
  // A refund beyond the cancelled room type's share spreads over the rest.
  assert.deepEqual(reservationShares({ paidCents: 50000, refundedCents: 26000, lines }), [
    { paidCents: 30000, refundedCents: 6000 },
    { paidCents: 20000, refundedCents: 20000 },
  ]);
  // Paid beyond what's owed now (an allowance lowered the room type kept): the credit is the kept room type's.
  assert.deepEqual(
    reservationShares({ paidCents: 80000, refundedCents: 60000, lines: [{ dueCents: 20000, owedCents: 15000, cancelled: false }, { dueCents: 60000, cancelled: true }] }),
    [
      { paidCents: 20000, refundedCents: 0 },
      { paidCents: 60000, refundedCents: 60000 },
    ],
  );
  // What a room type holds beyond what it costs now moves to the ones that still owe; only a real overpayment stays
  // as credit, on the room type it came from.
  const shares = (paidCents: number, refundedCents: number, owed: [number, number], due: [number, number] = [20000, 60000]) =>
    reservationShares({ paidCents, refundedCents, lines: [{ dueCents: due[0], owedCents: owed[0], cancelled: false }, { dueCents: due[1], owedCents: owed[1], cancelled: false }] }).map((s) => s.paidCents - s.refundedCents);
  assert.deepEqual(shares(80000, 0, [10000, 60000]), [20000, 60000]); // 100 off the Queen, all paid: the Queen holds the credit
  assert.deepEqual(shares(80000, 5000, [15000, 60000]), [15000, 60000]); // and refunding it settles both
  assert.deepEqual(shares(75000, 0, [15000, 60000], [10000, 30000]), [15000, 60000]); // deposits, then the rest: both paid
  assert.deepEqual(shares(40000, 0, [10000, 60000], [10000, 30000]), [10000, 30000]); // deposits paid, 100 off the Queen
  assert.deepEqual(shares(60000, 0, [0, 60000]), [0, 60000]); // a comped Queen: the payment is the Suite's
  // ...and handing back some of the Suite's cash leaves the comped Queen untouched (paid, nothing refunded).
  assert.deepEqual(reservationShares({ paidCents: 60000, refundedCents: 10000, lines: [{ dueCents: 20000, owedCents: 0, cancelled: false }, { dueCents: 60000, owedCents: 60000, cancelled: false }] }), [
    { paidCents: 0, refundedCents: 0 },
    { paidCents: 60000, refundedCents: 10000 },
  ]);
  // Deposits, a room type cancelled and refunded, then the rest paid at the desk: the room type kept is paid in full and
  // the cancelled one stays refunded (money beyond the deposits never goes to a cancelled room type).
  assert.deepEqual(reservationShares({ paidCents: 50000, refundedCents: 30000, lines: [{ dueCents: 10000, owedCents: 20000, cancelled: false }, { dueCents: 30000, cancelled: true }] }), [
    { paidCents: 20000, refundedCents: 0 },
    { paidCents: 30000, refundedCents: 30000 },
  ]);
  assert.deepEqual(reservationShares({ paidCents: 50000, refundedCents: 30000, lines: [{ dueCents: 10000, cancelled: false }, { dueCents: 30000, cancelled: true }] }), [
    { paidCents: 20000, refundedCents: 0 },
    { paidCents: 30000, refundedCents: 30000 },
  ]);
  // Nothing cancelled: in proportion, never more than was paid.
  assert.deepEqual(reservationShares({ paidCents: 1000, refundedCents: 5000, lines: [{ dueCents: 1, cancelled: false }, { dueCents: 1, cancelled: false }] }), [
    { paidCents: 500, refundedCents: 500 },
    { paidCents: 500, refundedCents: 500 },
  ]);
});
