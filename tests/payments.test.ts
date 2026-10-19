import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingPaymentStatus,
  cancellationPolicyText,
  effectivePolicy,
  paymentAmountDue,
  platformFeeCents,
  refundableCents,
  suggestedRefundCents,
} from '../src/lib/payments';

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
