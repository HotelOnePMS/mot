import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  cardAuthorizationText,
  cardDigitsMatch,
  checksOutcome,
  effectiveStatus,
  evaluateChecks,
  joinNames,
  splitNames,
  typedSignatureMatches,
} from '../../src/lib/card-authorization';

const stay = {
  hotelName: 'Harbor Inn',
  bookingCode: 'HX7K2P',
  guestNames: ['Ana Ruiz'],
  checkIn: '2026-11-02',
  checkOut: '2026-11-05',
  amount: 412.5,
  currency: 'USD',
  coversIncidentals: false,
  incidentalsLimit: null,
  paidCard: null,
};

test('the wording names the guests, the stay, the amount and the card, never the signer', () => {
  const text = cardAuthorizationText(stay);
  assert.match(text, /authorize Harbor Inn to charge it for the stay of Ana Ruiz \(reservation HX7K2P, 2026-11-02 to 2026-11-05\)/);
  assert.match(text, /room charges and taxes of \$412\.50\./);
  assert.match(text, /the card whose details I entered/);
  assert.match(text, /this guest, not me/);
  assert.doesNotMatch(text, /incidental/);
});

test('incidentals, a limit and an online card change the wording', () => {
  const text = cardAuthorizationText({ ...stay, guestNames: ['Ana Ruiz', 'Leo Ruiz'], coversIncidentals: true, incidentalsLimit: 200, paidCard: { brand: 'visa' } });
  assert.match(text, /the Visa card used to pay for this reservation/);
  assert.match(text, /incidental charges the guests make during the stay of up to \$200\.00/);
  assert.match(text, /already charged to this card .* part of this total/);
  assert.match(text, /Ana Ruiz and Leo Ruiz/);
  assert.match(text, /these guests, not me/);
});

test('the same request always produces the same wording (it is hashed)', () => {
  assert.equal(cardAuthorizationText(stay), cardAuthorizationText({ ...stay }));
});

test('names split on commas, semicolons and lines, without duplicates', () => {
  assert.deepEqual(splitNames(' Ana  Ruiz, leo ruiz;\nAna Ruiz ,, Leo Ruiz'), ['Ana Ruiz', 'leo ruiz']);
  assert.equal(splitNames(Array.from({ length: 15 }, (_, i) => `Guest ${i}`).join(',')).length, 10);
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
});

test('an unsigned link past its date reads as expired; other states keep theirs', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  assert.equal(effectiveStatus({ status: 'PENDING', expiresAt: '2026-11-01T11:59:59Z' }, now), 'EXPIRED');
  assert.equal(effectiveStatus({ status: 'PENDING', expiresAt: '2026-11-02T00:00:00Z' }, now), 'PENDING');
  assert.equal(effectiveStatus({ status: 'SIGNED', expiresAt: '2026-10-01T00:00:00Z' }, now), 'SIGNED');
});

test('card digits must match the card that paid; anything goes when none did', () => {
  assert.ok(cardDigitsMatch('4242', '4242'));
  assert.ok(cardDigitsMatch('4242', '•••• 4242'));
  assert.ok(!cardDigitsMatch('4242', '4241'));
  assert.ok(cardDigitsMatch(null, '1881'));
});

const signed = { name: 'Pat Jones', email: 'pat@example.org', cardBrand: null, cardLast4: '4242', billingCountry: 'US' };

test('everything matching the online payment and the request passes', () => {
  const checks = evaluateChecks({
    expected: { cardholderName: 'Patricia Jones', cardBrand: 'visa', cardLast4: '4242' },
    payment: { cardholderName: 'PAT JONES', billingCountry: 'US', billingEmail: 'Pat@Example.org' },
    signed,
  });
  assert.deepEqual(
    checks.map((c) => [c.key, c.result]),
    [
      ['CARD_DIGITS', 'MATCH'],
      ['NAME_ON_CARD', 'MATCH'],
      ['NAME_EXPECTED', 'MISMATCH'],
      ['BILLING_COUNTRY', 'MATCH'],
      ['BILLING_EMAIL', 'MATCH'],
    ],
  );
  // "Patricia" vs "Pat" is not the same token: staff see it and decide.
  assert.equal(checksOutcome(checks), 'REVIEW');
});

test('someone other than the cardholder signing is flagged', () => {
  const checks = evaluateChecks({
    expected: { cardholderName: 'Pat Jones', cardBrand: 'visa', cardLast4: '4242' },
    payment: { cardholderName: 'Pat Jones', billingCountry: 'US', billingEmail: null },
    signed: { ...signed, name: 'Sam Lee', billingCountry: 'GB' },
  });
  const by = Object.fromEntries(checks.map((c) => [c.key, c.result]));
  assert.equal(by.NAME_ON_CARD, 'MISMATCH');
  assert.equal(by.NAME_EXPECTED, 'MISMATCH');
  assert.equal(by.BILLING_COUNTRY, 'MISMATCH');
  assert.equal(by.BILLING_EMAIL, undefined);
  assert.equal(checksOutcome(checks), 'REVIEW');
});

test('without an online payment the card digits are a reminder for the desk, not a failure', () => {
  const checks = evaluateChecks({ expected: { cardholderName: 'Pat Jones', cardBrand: null, cardLast4: null }, payment: null, signed: { ...signed, cardBrand: 'amex', cardLast4: '1005' } });
  assert.deepEqual(
    checks.map((c) => [c.key, c.result]),
    [
      ['CARD_DIGITS', 'UNVERIFIED'],
      ['NAME_EXPECTED', 'MATCH'],
    ],
  );
  assert.match(checks[0].detail, /American Express ends in 1005/);
  assert.equal(checksOutcome(checks), 'MATCH');
});

test('a typed signature is the signer’s full name', () => {
  assert.ok(typedSignatureMatches(' pat  JONES ', 'Pat Jones'));
  assert.ok(!typedSignatureMatches('PJ', 'Pat Jones'));
  assert.ok(!typedSignatureMatches('', ''));
});
