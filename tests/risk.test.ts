import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklistRequirements, computeRiskFlags, namesMatch, normalizeCountry, openChecklistItems } from '../src/lib/risk';

test('names match in any order, with middle names, initials, accents and punctuation', () => {
  assert.ok(namesMatch('Jamie Smith', 'Jamie Smith'));
  assert.ok(namesMatch('Jamie Smith', 'SMITH, Jamie Lee'));
  assert.ok(namesMatch('J. Smith', 'Jamie Smith'));
  assert.ok(namesMatch('José Álvarez', 'jose alvarez'));
  assert.ok(namesMatch('Smith', 'Jamie Smith'));
});

test('different people do not match', () => {
  assert.ok(!namesMatch('Jamie Smith', 'Alex Smith'));
  assert.ok(!namesMatch('Jamie Smith', 'Acme Travel Ltd'));
  assert.ok(!namesMatch('', 'Jamie Smith'));
  assert.ok(!namesMatch(null, 'Jamie Smith'));
});

test('countries are normalised', () => {
  assert.equal(normalizeCountry('us'), 'US');
  assert.equal(normalizeCountry('United States'), 'US');
  assert.equal(normalizeCountry('  '), null);
  assert.equal(normalizeCountry('Narnia'), null);
});

const clean = { cardholderName: 'Jamie Smith', cardCountry: 'US', billingCountry: 'US', threeDSecure: 'authenticated', riskLevel: 'normal' };

test('a clean payment raises no flags', () => {
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: clean, guestCountry: 'US', totalAmount: 300 }), []);
});

test('pay-at-property bookings only get the amount flag', () => {
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', totalAmount: 300 }), []);
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', totalAmount: 5000 }), ['HIGH_AMOUNT']);
});

test('cardholder differing from the guest is flagged; unknown cardholder is not', () => {
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, cardholderName: 'Pat Jones' }, totalAmount: 300 }), ['CARDHOLDER_DIFFERS']);
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, cardholderName: null }, totalAmount: 300 }), []);
});

test('card country differing from billing or guest country is flagged', () => {
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, cardCountry: 'GB' }, totalAmount: 300 }), ['COUNTRY_MISMATCH']);
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, billingCountry: null }, guestCountry: 'Canada', totalAmount: 300 }), ['COUNTRY_MISMATCH']);
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, cardCountry: null }, guestCountry: 'CA', totalAmount: 300 }), []);
});

test('high amount uses the threshold (default 1000, configurable)', () => {
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: clean, totalAmount: 1000 }), ['HIGH_AMOUNT']);
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: clean, totalAmount: 999 }), []);
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: clean, totalAmount: 600, highAmountThreshold: 500 }), ['HIGH_AMOUNT']);
});

test('Stripe risk levels map to one flag each', () => {
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, riskLevel: 'elevated' }, totalAmount: 100 }), ['RISK_ELEVATED']);
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, riskLevel: 'highest' }, totalAmount: 100 }), ['RISK_HIGHEST']);
  assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, riskLevel: 'not_assessed' }, totalAmount: 100 }), []);
});

test('3D Secure: authenticated and acknowledged attempts are fine, everything else is flagged', () => {
  for (const ok of ['authenticated', 'attempt_acknowledged']) {
    assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, threeDSecure: ok }, totalAmount: 100 }), []);
  }
  for (const bad of ['failed', 'not_supported', 'exempted', 'not_attempted', null]) {
    assert.deepEqual(computeRiskFlags({ guestName: 'Jamie Smith', payment: { ...clean, threeDSecure: bad }, totalAmount: 100 }), ['THREE_DS_NOT_COMPLETED']);
  }
});

test('checklist exists only for flagged bookings, and asks for the card on card-related flags', () => {
  assert.equal(checklistRequirements([]), null);
  assert.deepEqual(checklistRequirements(['THREE_DS_NOT_COMPLETED']), { idMatched: true, cardShown: false, registrationSigned: true });
  assert.equal(checklistRequirements(['CARDHOLDER_DIFFERS'])?.cardShown, true);
  assert.equal(checklistRequirements(['HIGH_AMOUNT'])?.cardShown, true);
});

test('open checklist items shrink as staff tick them', () => {
  const req = checklistRequirements(['CARDHOLDER_DIFFERS']);
  assert.deepEqual(openChecklistItems(req, {}), ['idMatched', 'cardShown', 'registrationSigned']);
  assert.deepEqual(openChecklistItems(req, { idMatched: true, cardShown: true }), ['registrationSigned']);
  assert.deepEqual(openChecklistItems(null, {}), []);
});
