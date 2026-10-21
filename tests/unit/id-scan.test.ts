import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ageOn, looksLikeAamva, looksLikeMrz, mrzCheckDigit, mrzCountry, parseIdScan, titleCase } from '../../src/lib/id-scan';

const NOW = new Date('2026-10-21T12:00:00Z');

// A California licence as a PDF417 reader returns it (AAMVA 2016 layout).
const AAMVA_CA = [
  '@',
  '\u001e\rANSI 636014090102DL00410279ZC03200024DLDAQF1234567',
  'DCSSAMPLE',
  'DDEN',
  'DACJANE',
  'DDFN',
  'DADMARIE',
  'DDGN',
  'DCAC',
  'DCBNONE',
  'DCDNONE',
  'DBD01152020',
  'DBB06151990',
  'DBA06152028',
  'DBC2',
  'DAU065 IN',
  'DAG123 MAIN ST',
  'DAISACRAMENTO',
  'DAJCA',
  'DAK958140000  ',
  'DCGUSA',
  'DDAF',
  '\rZCZCA',
].join('\n');

test('a US licence barcode fills in the name, number, dates and address', () => {
  const id = parseIdScan(AAMVA_CA, NOW)!;
  assert.equal(id.format, 'AAMVA');
  assert.equal(id.idType, 'DRIVERS_LICENSE');
  assert.equal(id.documentNumber, 'F1234567');
  assert.equal(id.firstName, 'Jane');
  assert.equal(id.middleName, 'Marie');
  assert.equal(id.lastName, 'Sample');
  assert.equal(id.fullName, 'Jane Marie Sample');
  assert.equal(id.dateOfBirth, '1990-06-15');
  assert.equal(id.expiry, '2028-06-15');
  assert.equal(id.country, 'US');
  assert.equal(id.region, 'CA');
  assert.equal(id.sex, 'F');
  assert.deepEqual(id.address, { line1: '123 Main St', city: 'Sacramento', region: 'CA', postalCode: '95814', country: 'US' });
  assert.deepEqual(id.problems, []);
});

test('a keyboard-wedge scanner that drops control characters and sends Enter as CR still parses', () => {
  const typed = AAMVA_CA.replace(/[\u001e]/g, '').replace(/\n/g, '\r');
  const id = parseIdScan(typed, NOW)!;
  assert.equal(id.documentNumber, 'F1234567');
  assert.equal(id.lastName, 'Sample');
  assert.equal(id.expiry, '2028-06-15');
});

test('Canadian licences use CCYYMMDD dates and keep the postal code as printed', () => {
  const ontario = 'ANSI 636012080002DL00410266ZO03070008DLDAQS1234-56789-01234\nDCSSMITH\nDACJOHN\nDADNONE\nDBB19850704\nDBA20300704\nDAG10 KING ST W\nDAITORONTO\nDAJON\nDAKM5H 1A1\nDCGCAN';
  const id = parseIdScan(ontario, NOW)!;
  assert.equal(id.dateOfBirth, '1985-07-04');
  assert.equal(id.expiry, '2030-07-04');
  assert.equal(id.middleName, null);
  assert.equal(id.country, 'CA');
  assert.equal(id.address?.postalCode, 'M5H 1A1');
});

test('state ID cards (subfile ID) and version-1 full names', () => {
  const card = 'ANSI 636015010001ID00290160IDDAQ12345678\nDAAPUBLIC,JOHN,Q\nDBB01021970\nDBA01022030\nDAJTX';
  const id = parseIdScan(card, NOW)!;
  assert.equal(id.idType, 'NATIONAL_ID');
  assert.equal(id.lastName, 'Public');
  assert.equal(id.firstName, 'John');
  assert.equal(id.middleName, 'Q');
});

// ICAO 9303 part 4 specimen passport.
const TD3 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';

test('a passport MRZ parses with every check digit verified', () => {
  const id = parseIdScan(TD3, NOW)!;
  assert.equal(id.format, 'MRZ');
  assert.equal(id.idType, 'PASSPORT');
  assert.equal(id.documentNumber, 'L898902C3');
  assert.equal(id.lastName, 'Eriksson');
  assert.equal(id.firstName, 'Anna');
  assert.equal(id.middleName, 'Maria');
  assert.equal(id.dateOfBirth, '1974-08-12');
  assert.equal(id.expiry, '2012-04-15');
  assert.equal(id.sex, 'F');
  // UTO is ICAO's fictional Utopia: no real country.
  assert.equal(id.country, null);
  assert.deepEqual(id.problems, []);
});

test('a misread MRZ character is caught by the check digits', () => {
  const misread = TD3.replace('L898902C3', 'L898902G3');
  const id = parseIdScan(misread, NOW)!;
  assert.ok(id.problems.some((p) => /passport number/.test(p)));
});

test('the MRZ also parses as one unbroken run, with spaces, in lower case', () => {
  const run = TD3.replace('\n', '').toLowerCase().replace(/(.{11})/g, '$1 ');
  assert.equal(parseIdScan(run, NOW)?.documentNumber, 'L898902C3');
});

// ICAO 9303 part 5 specimen ID card.
const TD1 = 'I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<';

test('an ID card MRZ (three lines of 30) parses with its check digits', () => {
  const id = parseIdScan(TD1, NOW)!;
  assert.equal(id.idType, 'NATIONAL_ID');
  assert.equal(id.documentNumber, 'D23145890');
  assert.equal(id.fullName, 'Anna Maria Eriksson');
  assert.equal(id.dateOfBirth, '1974-08-12');
  assert.equal(id.expiry, '2012-04-15');
  assert.deepEqual(id.problems, []);
});

test('check digits, country codes and helpers', () => {
  assert.equal(mrzCheckDigit('L898902C3'), 6);
  assert.equal(mrzCheckDigit('740812'), 2);
  assert.equal(mrzCountry('D<<'), 'DE');
  assert.equal(mrzCountry('GBR'), 'GB');
  assert.equal(mrzCountry('USA'), 'US');
  assert.equal(mrzCountry('UTO'), null);
  assert.equal(titleCase("O'NEIL-SMITH"), "O'Neil-Smith");
  assert.equal(ageOn('2008-10-22', '2026-10-21'), 17);
  assert.equal(ageOn('2008-10-21', '2026-10-21'), 18);
});

test('anything else is not an ID', () => {
  assert.equal(parseIdScan('hello world', NOW), null);
  assert.equal(parseIdScan('', NOW), null);
  assert.ok(!looksLikeAamva('DAQ but no header'));
  assert.ok(!looksLikeMrz('P<UTO'));
});
