import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceSummary, renderEvidenceText, stripeEvidenceFields, type EvidenceInput } from '../src/server/payments/evidence';

const input: EvidenceInput = {
  generatedAt: '2026-10-20T14:00:00.000Z',
  hotel: { name: 'Harbor Inn', address: '1 Pier Rd, Portland, ME', phone: '+1 207 555 0100', email: 'owner@harbor.test' },
  guest: { name: 'Jamie Smith', email: 'jamie@example.com', phone: null },
  booking: { code: 'ABC234', status: 'CHECKED_OUT', checkIn: '2026-10-10', checkOut: '2026-10-12', nights: 2, rooms: 1, guests: 2, roomType: 'King', totalPrice: 300, createdAt: '2026-09-30T10:00:00.000Z', notes: 'Late arrival\nQuiet room' },
  payments: [
    { amount: 150, currency: 'usd', status: 'SUCCEEDED', paidAt: '2026-09-30T10:01:00.000Z', cardholderName: 'Pat Jones', billingEmail: 'pat@example.com', billingCountry: 'US', cardCountry: 'US', cardBrand: 'visa', cardLast4: '4242', threeDSecure: 'authenticated', riskLevel: 'normal' },
  ],
  policy: { version: '2026-10-v1', hash: 'abc123', text: 'Free cancellation until 3 PM the day before.', acceptedAt: '2026-09-30T10:00:30.000Z', ip: '203.0.113.9', userAgent: 'Mozilla/5.0' },
  stay: { checkedInAt: '2026-10-10T20:15:00.000Z', roomNumber: '204', checkedOutAt: '2026-10-12T09:00:00.000Z' },
  checklist: [{ item: 'ID matches guest', at: '2026-10-10T20:14:00.000Z', by: 'Sam Lee' }],
  riskFlags: ['CARDHOLDER_DIFFERS'],
  history: [{ status: 'CONFIRMED', notes: 'Paid by card', at: '2026-09-30T10:01:00.000Z' }],
  dispute: { stripeId: 'dp_123', reason: 'fraudulent', amount: 150, currency: 'usd' },
};

test('the summary covers booking, payment, 3DS, policy acceptance, check-in and checklist', () => {
  const text = renderEvidenceText(buildEvidenceSummary(input));
  for (const expected of ['ABC234', 'Pat Jones', 'ending 4242', 'Completed: the cardholder’s bank verified', '203.0.113.9', 'abc123', 'room 204', 'ID matches guest', 'Sam Lee', 'CARDHOLDER_DIFFERS', 'dp_123']) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
  assert.ok(text.includes('Late arrival | Quiet room'));
});

test('the cardholder and the guest are reported separately', () => {
  const text = renderEvidenceText(buildEvidenceSummary(input));
  assert.ok(text.includes('Name: Jamie Smith'));
  assert.ok(text.includes('Cardholder name: Pat Jones'));
});

test('missing records are stated, not invented', () => {
  const text = renderEvidenceText(
    buildEvidenceSummary({ ...input, payments: [], policy: null, stay: { checkedInAt: null, roomNumber: null, checkedOutAt: null }, checklist: [], riskFlags: [] })
  );
  assert.ok(text.includes('No online payment is recorded'));
  assert.ok(text.includes('No policy acceptance is recorded'));
  assert.ok(text.includes('Checked in: not recorded'));
  assert.ok(text.includes('No risk flags were raised.'));
});

test('Stripe evidence fields carry the policy, the IP and the activity log, within limits', () => {
  const fields = stripeEvidenceFields(input, buildEvidenceSummary(input));
  assert.equal(fields.customer_name, 'Jamie Smith');
  assert.equal(fields.customer_email_address, 'jamie@example.com');
  assert.equal(fields.customer_purchase_ip, '203.0.113.9');
  assert.equal(fields.service_date, '2026-10-10 to 2026-10-12');
  assert.ok(fields.cancellation_policy_disclosure.includes('Free cancellation'));
  assert.ok(fields.access_activity_log.includes('room 204'));
  for (const v of Object.values(fields)) assert.ok(v.length <= 19_000);
});

test('without a recorded acceptance there is no policy or IP field', () => {
  const fields = stripeEvidenceFields({ ...input, policy: null }, buildEvidenceSummary({ ...input, policy: null }));
  assert.equal(fields.cancellation_policy_disclosure, undefined);
  assert.equal(fields.customer_purchase_ip, undefined);
});

test('very long fields are clipped', () => {
  const long = { ...input, booking: { ...input.booking, notes: 'x'.repeat(50_000) } };
  const fields = stripeEvidenceFields(long, buildEvidenceSummary(long));
  assert.ok(fields.uncategorized_text.length <= 19_000);
});
