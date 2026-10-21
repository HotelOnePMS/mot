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

// ---------------------------------------------------------------------------
// Licence barcodes: subfiles, lost line breaks, odd numbers and older cards
// ---------------------------------------------------------------------------

test('an ID card subfile is an ID card whatever its first element, and wherever the scanner breaks the header', () => {
  const body = ['DCBNONE', 'DCDNONE', 'DBA08012031', 'DCSDOE', 'DACALEX', 'DADNONE', 'DBB01311990', 'DAJVA', 'DAQT12345678', 'DCGUSA'];
  const glued = ['@', '\u001e\rANSI 636000100002ID00410200ZV02410020IDDCAD', ...body].join('\n');
  const split = ['@', '\u001e\rANSI 636000100002ID00410200ZV02410020', 'IDDCAD', ...body].join('\n');
  for (const scan of [glued, split]) {
    const id = parseIdScan(scan, NOW)!;
    assert.equal(id.idType, 'NATIONAL_ID');
    assert.equal(id.documentNumber, 'T12345678');
    assert.equal(id.fullName, 'Alex Doe');
    assert.deepEqual(id.problems, []);
  }
});

test('a scan that lost its line breaks comes back empty with a hint, never a garbage number', () => {
  const oneLine = AAMVA_CA.replace(/\n/g, '');
  const id = parseIdScan(oneLine, NOW)!;
  assert.equal(id.format, 'AAMVA');
  assert.equal(id.documentNumber, '');
  assert.equal(id.lastName, '');
  assert.equal(id.dateOfBirth, null);
  assert.deepEqual(id.problems, ['Line breaks were lost. Scan into the box again, or set the scanner to send Enter after each line.']);
  // Line breaks turned into spaces are just as lost.
  assert.equal(parseIdScan(AAMVA_CA.replace(/\n/g, ' '), NOW)?.documentNumber, '');
});

test('a licence number that swallowed the next element, or is longer than the standard allows, is not used', () => {
  const swallowed = AAMVA_CA.replace('DAQF1234567\nDCSSAMPLE', 'DAQF1234567DCSSAMPLE');
  const id = parseIdScan(swallowed, NOW)!;
  assert.equal(id.documentNumber, '');
  assert.ok(id.problems.some((p) => /licence number didn’t scan cleanly/.test(p)));

  const tooLong = parseIdScan(AAMVA_CA.replace('DAQF1234567', 'DAQA1234567890123456789012345'), NOW)!;
  assert.equal(tooLong.documentNumber, '');
  assert.ok(tooLong.problems.some((p) => /licence number didn’t scan cleanly/.test(p)));
});

test('a number that happens to contain an element id the card has on its own line is kept', () => {
  // Washington numbers mix letters and digits; DAG is also on its own line, so nothing was swallowed.
  const id = parseIdScan(AAMVA_CA.replace('DAQF1234567', 'DAQWDLDAG123X4Y'), NOW)!;
  assert.equal(id.documentNumber, 'WDLDAG123X4Y');
  assert.deepEqual(id.problems, []);
});

test('a name shortened to fit the licence is flagged for staff to check', () => {
  const family = parseIdScan(AAMVA_CA.replace('DDEN', 'DDET'), NOW)!;
  assert.deepEqual(family.problems, ['The name is shortened on the licence. Check it against the card.']);
  const firstAndMiddle = parseIdScan(AAMVA_CA.replace('DDFN', 'DDFT').replace('DDGN', 'DDGT'), NOW)!;
  assert.deepEqual(firstAndMiddle.problems, ['The name is shortened on the licence. Check it against the card.']);
});

test('given names (DCT) keep every middle name, and a city named Lansing is not mistaken for the header', () => {
  const michigan = 'ANSI 636032030102DL00410205ZM02460027DLDCSLENNON\nDCTJOHN PAUL GEORGE\nDAQS123456789012\nDBB10091980\nDBA10092029\nDAG1 ABBEY RD\nDAILANSING\nDAJMI\nDAK489330000';
  const id = parseIdScan(michigan, NOW)!;
  assert.equal(id.firstName, 'John');
  assert.equal(id.middleName, 'Paul George');
  assert.equal(id.fullName, 'John Paul George Lennon');
  assert.equal(id.address?.city, 'Lansing');
  // No DCG: Michigan is a US state.
  assert.equal(id.country, 'US');
  assert.deepEqual(id.problems, []);
});

test('an early AAMVA card with no country element gets it from the state, and keeps its postal code', () => {
  const old = 'AAMVA6360000102DL00390188DLDAQ0123456789\nDAAPUBLIC,JOHN,Q\nDBA20280101\nDBB19700102\nDAJVA\nDAK232190000';
  const id = parseIdScan(old, NOW)!;
  assert.equal(id.idType, 'DRIVERS_LICENSE');
  assert.equal(id.documentNumber, '0123456789');
  assert.equal(id.fullName, 'John Q Public');
  assert.equal(id.dateOfBirth, '1970-01-02');
  assert.equal(id.expiry, '2028-01-01');
  assert.equal(id.region, 'VA');
  assert.equal(id.country, 'US');
  assert.equal(id.address?.postalCode, '23219');
  assert.equal(id.address?.country, 'US');
  assert.deepEqual(id.problems, []);
  // A province gives Canada.
  assert.equal(parseIdScan(old.replace('DAJVA', 'DAJBC').replace('DAK232190000', 'DAKV6B 1A1'), NOW)?.country, 'CA');
});

// ---------------------------------------------------------------------------
// MRZ: empty fields, long numbers, TD2, document codes, real-world vectors
// ---------------------------------------------------------------------------

/** A TD1 middle line with its overall check digit worked out for the given first line. */
function td1Line2(l1: string, l2: string): string {
  return l2 + mrzCheckDigit(l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29));
}

test('an empty check digit never passes: an ID card with no number says so', () => {
  const l1 = 'I<UTO<<<<<<<<<<<<<<<<<<<<<<<<<';
  const scan = [l1, td1Line2(l1, '7408122F1204159UTO<<<<<<<<<<<'), 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'].join('\n');
  const id = parseIdScan(scan, NOW)!;
  assert.equal(id.documentNumber, '');
  assert.deepEqual(id.problems, ['No document number in the scan.']);
});

test('an ID number longer than nine characters continues in the optional data, up to its check digit', () => {
  const l1 = 'I<UTOD23145890<7349<ABC123<<<<';
  const scan = [l1, td1Line2(l1, '7408122F1204159UTO<<<<<<<<<<<'), 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'].join('\n');
  const id = parseIdScan(scan, NOW)!;
  assert.equal(id.documentNumber, 'D23145890734');
  assert.deepEqual(id.problems, []);
  // A wrong digit at the end of the run is caught.
  const wrong = l1.replace('7349', '7348');
  const bad = parseIdScan([wrong, td1Line2(wrong, '7408122F1204159UTO<<<<<<<<<<<'), 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'].join('\n'), NOW)!;
  assert.deepEqual(bad.problems, ['The ID number’s check digit doesn’t match. Rescan, or check the number by eye.']);
});

test('a passport’s personal number has its own check digit', () => {
  const [l1, l2] = TD3.split('\n');
  const badPersonal = l2.slice(0, 42) + '2';
  const scan = `${l1}\n${badPersonal}${mrzCheckDigit(badPersonal.slice(0, 10) + badPersonal.slice(13, 20) + badPersonal.slice(21, 43))}`;
  assert.deepEqual(parseIdScan(scan, NOW)!.problems, ['The personal number’s check digit doesn’t match.']);
});

// ICAO 9303 part 6 specimen TD2 card.
const TD2 = 'I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<\nD231458907UTO7408122F1204159<<<<<<<6';

test('an older ID card MRZ (two lines of 36) parses with its check digits', () => {
  const [, l2] = TD2.split('\n');
  assert.equal(mrzCheckDigit(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 35)), 6);
  const id = parseIdScan(TD2, NOW)!;
  assert.equal(id.idType, 'NATIONAL_ID');
  assert.equal(id.documentNumber, 'D23145890');
  assert.equal(id.fullName, 'Anna Maria Eriksson');
  assert.equal(id.dateOfBirth, '1974-08-12');
  assert.equal(id.expiry, '2012-04-15');
  assert.equal(id.sex, 'F');
  assert.deepEqual(id.problems, []);
  assert.ok(looksLikeMrz(TD2));
  assert.equal(parseIdScan(TD2.replace('\n', ''), NOW)?.documentNumber, 'D23145890');
  assert.ok(parseIdScan(TD2.replace('D231458907', 'D231458967'), NOW)!.problems.some((p) => /ID number/.test(p)));
});

test('residence permits and crew cards are other IDs; identity cards are national IDs', () => {
  const [, l2, l3] = TD1.split('\n');
  const td1 = (code: string) => parseIdScan([`${code}UTOD231458907<<<<<<<<<<<<<<<`, l2, l3].join('\n'), NOW)!;
  for (const code of ['IR', 'AR', 'CR', 'AC', 'CB']) {
    assert.equal(td1(code).idType, 'OTHER', code);
    assert.deepEqual(td1(code).problems, [], code);
  }
  for (const code of ['I<', 'ID', 'IP']) assert.equal(td1(code).idType, 'NATIONAL_ID', code);
  assert.equal(parseIdScan(TD2.replace('I<UTO', 'ARUTO'), NOW)?.idType, 'OTHER');
});

test('a German identity card and passport parse with every check digit', () => {
  const card = parseIdScan('IDD<<T220001293<<<<<<<<<<<<<<<\n6408125<2010315D<<<<<<<<<<<<<4\nMUSTERMANN<<ERIKA<<<<<<<<<<<<<', NOW)!;
  assert.equal(card.idType, 'NATIONAL_ID');
  assert.equal(card.documentNumber, 'T22000129');
  assert.equal(card.fullName, 'Erika Mustermann');
  assert.equal(card.dateOfBirth, '1964-08-12');
  assert.equal(card.expiry, '2020-10-31');
  assert.equal(card.sex, null);
  assert.equal(card.country, 'DE');
  assert.equal(card.nationality, 'DE');
  assert.deepEqual(card.problems, []);

  const passport = parseIdScan('P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<\nC01X00T478D<<6408125F2702283<<<<<<<<<<<<<<<4', NOW)!;
  assert.equal(passport.idType, 'PASSPORT');
  assert.equal(passport.documentNumber, 'C01X00T47');
  assert.equal(passport.fullName, 'Erika Mustermann');
  assert.equal(passport.country, 'DE');
  assert.equal(passport.nationality, 'DE');
  assert.equal(passport.dateOfBirth, '1964-08-12');
  assert.equal(passport.expiry, '2027-02-28');
  assert.equal(passport.sex, 'F');
  assert.deepEqual(passport.problems, []);
});

test('the letter O read instead of a zero fails the number and overall check digits', () => {
  const id = parseIdScan(TD3.replace('L898902C3', 'L8989O2C3'), NOW)!;
  assert.equal(id.documentNumber, 'L8989O2C3');
  assert.deepEqual(id.problems, [
    'The passport number’s check digit doesn’t match. Rescan, or check the number by eye.',
    'The passport’s overall check digit doesn’t match.',
  ]);
});
