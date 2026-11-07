import { test } from 'vitest';
import assert from 'node:assert/strict';
import { REGISTRATION_VERSION, registrationCardText, type RegistrationCardInput } from '../../src/lib/registration-card';

const card: RegistrationCardInput = {
  hotelName: 'Harbor Inn',
  hotelAddress: '12 Pier Road, Portland ME',
  bookingCode: 'HX7K2P',
  guestName: 'Ana Ruiz',
  guestAddress: 'Calle Mayor 4, Madrid',
  checkIn: '2026-11-02',
  checkOut: '2026-11-05',
  nights: 3,
  guests: 2,
  roomNumber: '204',
  roomTypeName: 'Deluxe King',
  currency: 'USD',
  stayTotal: 412.5,
  paid: 100,
  balance: 312.5,
  deposits: [{ kind: 'CARD_CHARGE', amount: 200, cardBrand: 'visa', cardLast4: '4242' }],
  id: { typeLabel: 'Passport', country: 'Spain', last4: '7781' },
  checkOutTime: 'by 11:00 AM',
};

const paragraphs = (i: RegistrationCardInput) => registrationCardText(i).split('\n\n');

test('the card has six paragraphs: hotel, guest, stay, deposit, agreement, signature', () => {
  const p = paragraphs(card);
  assert.equal(p.length, 6);
  assert.equal(p[0], 'Guest registration · Harbor Inn, 12 Pier Road, Portland ME\nReservation HX7K2P.');
  assert.equal(p[1], 'Ana Ruiz, Calle Mayor 4, Madrid. Photo ID: Passport issued in Spain, number ending 7781.');
  assert.equal(
    p[2],
    '2026-11-02 to 2026-11-05 (3 nights), room 204 (Deluxe King), 2 guests. Room and taxes: $412.50. Paid so far: $100.00. Balance to pay: $312.50.',
  );
  assert.match(p[4], /^I agree to check out by 11:00 AM, unless the hotel agrees otherwise\./);
  assert.match(p[4], /cleaning after smoking, which may be taken from the deposit or charged to my card\./);
  assert.match(p[4], /the room’s maximum number of guests/);
  assert.match(p[4], /except as the law requires\.$/);
  assert.equal(p[5], 'The information above is correct. I agree to sign electronically, and my electronic signature has the same effect as my handwritten one.');
  assert.equal(REGISTRATION_VERSION, '2026-10-v1');
});

test('the same stay always produces the same wording (it is hashed)', () => {
  assert.equal(registrationCardText(card), registrationCardText({ ...card, deposits: card.deposits.map((d) => ({ ...d })), id: { ...card.id } }));
});

test('a deposit charged to a card names the brand and last four digits', () => {
  assert.equal(paragraphs(card)[3], 'Security deposit: $200.00 charged to Visa ending 4242, refunded after check-out less any charges.');
  const noDigits = paragraphs({ ...card, deposits: [{ kind: 'CARD_CHARGE', amount: 200, cardBrand: null, cardLast4: null }] })[3];
  assert.equal(noDigits, 'Security deposit: $200.00 charged to card, refunded after check-out less any charges.');
});

test('a deposit recorded another way is returned at check-out', () => {
  assert.equal(paragraphs({ ...card, deposits: [{ kind: 'OTHER', amount: 80, cardBrand: null, cardLast4: null }] })[3], 'Security deposit: $80.00, returned at check-out less any charges.');
});

test('a card hold says it is released after check-out', () => {
  const p = paragraphs({ ...card, deposits: [{ kind: 'CARD_HOLD', amount: 150, cardBrand: 'amex', cardLast4: '1005' }] });
  assert.equal(p[3], 'Security deposit: a hold of $150.00 on American Express ending 1005. It is released after check-out, less any charges.');
});

test('a cash deposit is returned at check-out', () => {
  const p = paragraphs({ ...card, deposits: [{ kind: 'CASH', amount: 100, cardBrand: 'visa', cardLast4: '4242' }] });
  assert.equal(p[3], 'Security deposit: $100.00 in cash, returned at check-out less any charges.');
});

test('a deposit taken in parts lists each part as it was taken', () => {
  const p = paragraphs({
    ...card,
    deposits: [
      { kind: 'CASH', amount: 100, cardBrand: null, cardLast4: null },
      { kind: 'CARD_HOLD', amount: 50, cardBrand: 'visa', cardLast4: '4242' },
    ],
  });
  assert.equal(p[3], 'Security deposits: $100.00 in cash, returned at check-out; a hold of $50.00 on Visa ending 4242, released after check-out; each less any charges.');
});

test('no deposit says so', () => {
  assert.equal(paragraphs({ ...card, deposits: [] })[3], 'No security deposit was taken.');
});

test('allowances show between the charges and what was paid', () => {
  assert.match(paragraphs({ ...card, allowances: 50, balance: 262.5 })[2], /Room and taxes: \$412\.50\. Allowances: \$50\.00 off\. Paid so far: \$100\.00\. Balance to pay: \$262\.50\.$/);
  assert.doesNotMatch(paragraphs({ ...card, allowances: 0 })[2], /Allowances/);
});

test('the balance reads as due, as a credit, or as settled', () => {
  assert.match(paragraphs(card)[2], /Balance to pay: \$312\.50\.$/);
  assert.match(paragraphs({ ...card, paid: 450, balance: -37.5 })[2], /Paid so far: \$450\.00\. Credit of \$37\.50\.$/);
  assert.match(paragraphs({ ...card, paid: 412.5, balance: 0 })[2], /Nothing left to pay for the room\.$/);
  // Less than a cent either way is settled, never "$0.00".
  assert.match(paragraphs({ ...card, balance: 0.001 })[2], /Nothing left to pay for the room\.$/);
  assert.match(paragraphs({ ...card, balance: -0.004 })[2], /Nothing left to pay for the room\.$/);
});

test('amounts use the hotel’s currency', () => {
  const p = paragraphs({ ...card, currency: 'JPY', stayTotal: 45000, paid: 45000, balance: 0, deposits: [{ kind: 'CASH', amount: 10000, cardBrand: null, cardLast4: null }] });
  assert.match(p[2], /Room and taxes: ¥45,000\. Paid so far: ¥45,000\./);
  assert.equal(p[3], 'Security deposit: ¥10,000 in cash, returned at check-out less any charges.');
});

test('one night and one guest are singular', () => {
  const p = paragraphs({ ...card, checkOut: '2026-11-03', nights: 1, guests: 1 });
  assert.match(p[2], /^2026-11-02 to 2026-11-03 \(1 night\), room 204 \(Deluxe King\), 1 guest\./);
});

test('without addresses or an ID country those parts are left out', () => {
  const p = paragraphs({ ...card, hotelAddress: '', guestAddress: null, id: { typeLabel: 'Driver’s license', country: null, last4: '0042' } });
  assert.equal(p[0], 'Guest registration · Harbor Inn\nReservation HX7K2P.');
  assert.equal(p[1], 'Ana Ruiz. Photo ID: Driver’s license, number ending 0042.');
  assert.equal(paragraphs({ ...card, guestAddress: '  ' })[1].startsWith('Ana Ruiz. Photo ID'), true);
});

test('only the last four of the ID number ever appear', () => {
  const full = '123456789012';
  const text = registrationCardText({ ...card, id: { ...card.id, last4: full.slice(-4) } });
  assert.match(text, /number ending 9012\./);
  assert.ok(!text.includes(full));
  assert.doesNotMatch(text, /\d{12}/);
  // Even a caller that passes the whole number by mistake shows four characters.
  const leaked = registrationCardText({ ...card, id: { ...card.id, last4: full } });
  assert.ok(!leaked.includes(full));
  assert.match(leaked, /number ending 9012\./);
});

test('a newline in free text can’t add a paragraph', () => {
  const p = paragraphs({ ...card, guestAddress: 'Calle Mayor 4\n\nMadrid', hotelAddress: '12 Pier Road\nPortland ME' });
  assert.equal(p.length, 6);
  assert.match(p[0], /^Guest registration · Harbor Inn, 12 Pier Road Portland ME\n/);
  assert.match(p[1], /^Ana Ruiz, Calle Mayor 4 Madrid\. /);
});
