import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mrzCheckDigit, parseIdScan } from '../../src/lib/id-scan';
import { readMrzOcr } from '../../src/lib/mrz-ocr';

const NOW = new Date('2026-10-21T12:00:00Z');

// ICAO 9303 specimens.
const TD3 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
const TD1 = 'I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<';

// A US work permit (EAD) shaped card: TD1, issued by the USA, check digits computed.
function usCard(code: string): string {
  const number = 'SRC123456';
  const l1 = `${code}USA${number}${mrzCheckDigit(number)}<<<<<<<<<<<<<<<`;
  const l2body = `900115${mrzCheckDigit('900115')}M281231${mrzCheckDigit('281231')}MEX<<<<<<<<<<<`;
  const l2 = l2body + mrzCheckDigit(l1.slice(5, 30) + l2body.slice(0, 7) + l2body.slice(8, 15) + l2body.slice(18, 29));
  return [l1, l2, 'GARCIA<LOPEZ<<MARIA<ELENA<<<<<'].join('\n');
}

test('a clean OCR read of a passport passes straight through', () => {
  const read = readMrzOcr(TD3, NOW)!;
  assert.equal(read.text, TD3);
  assert.equal(read.scan.documentNumber, 'L898902C3');
  assert.equal(read.scan.fullName, 'Anna Maria Eriksson');
});

test('OCR noise around the MRZ is ignored, and spaces inside it are dropped', () => {
  const noisy = `PASSPORT  UTOPIA\nSurname ERIKSSON\n${TD3.replace('ERIKSSON<<', 'ERIK SSON<<')}\n`;
  assert.equal(readMrzOcr(noisy, NOW)?.text, TD3);
});

test('digits read as letters and letters read as digits are put right by position', () => {
  // O for 0 in the dates, 1 for I in the name, 5 for S in the issuer.
  const ocr = TD3.replace('7408122', '74O8l22').replace('ANNA<MARIA', 'ANNA<MAR1A').replace('P<UTO', 'P<UT0').replace('1204159', 'l2O4159');
  const read = readMrzOcr(ocr, NOW)!;
  assert.equal(read.text, TD3);
  assert.deepEqual(read.scan.problems, []);
});

test('a document number misread with a look-alike is fixed by its check digits', () => {
  // The number is letters and digits, so position alone can't tell O from 0 there.
  const read = readMrzOcr(TD3.replace('L898902C3', 'L8989O2C3'), NOW)!;
  assert.equal(read.scan.documentNumber, 'L898902C3');
  assert.deepEqual(read.scan.problems, []);
});

test('a filler lost or gained in a long run is put back', () => {
  const [l1, l2] = TD3.split('\n');
  assert.equal(readMrzOcr(`${l1.replace('<<<<<<<<', '<<<<<<<')}\n${l2}`, NOW)?.text, TD3);
  assert.equal(readMrzOcr(`${l1}\n${l2.replace('B<<<<<', 'B<<<<<<')}`, NOW)?.text, TD3);
});

test('fillers misread as letters after a name are cleaned up', () => {
  const ocr = TD3.replace('MARIA<<<<<<<<<<<<<<<<<<<', 'MARIA<<<<K<<<<<<C<<<<<<<');
  assert.equal(readMrzOcr(ocr, NOW)?.scan.fullName, 'Anna Maria Eriksson');
});

test('an ID card MRZ (three lines) reads too', () => {
  const read = readMrzOcr(TD1.replace('7408122', '74O8122'), NOW)!;
  assert.equal(read.text, TD1);
  assert.equal(read.scan.documentNumber, 'D23145890');
});

test('a US work permit or green card reads as another government ID', () => {
  for (const code of ['IA', 'C1']) {
    const card = usCard(code);
    const direct = parseIdScan(card, NOW)!;
    assert.deepEqual(direct.problems, [], code);
    assert.equal(direct.idType, 'OTHER', code);
    assert.equal(direct.country, 'US');
    assert.equal(direct.nationality, 'MX');
    assert.equal(direct.fullName, 'Maria Elena Garcia Lopez');
    const read = readMrzOcr(card.replace('900115', '9OO115'), NOW)!;
    assert.equal(read.text, card, code);
  }
});

test('a read with a check digit that still fails is not used', () => {
  // A real digit wrong in the date of birth: nothing can tell which one.
  assert.equal(readMrzOcr(TD3.replace('7408122', '7408132'), NOW), null);
  assert.equal(readMrzOcr('nothing to see here', NOW), null);
  assert.equal(readMrzOcr(TD3.split('\n')[0], NOW), null);
});

test('a look-alike in the optional data is fixed by its check digit too', () => {
  // The Z of the personal number read as a 7: the personal and overall check digits catch it.
  const read = readMrzOcr(TD3.replace('ZE184226B', '7E184226B').replace('UTO7408122', 'UT07408122'), NOW)!;
  assert.equal(read.text, TD3);
});

test('a stray character before the first line is dropped', () => {
  const card = usCard('IA');
  assert.equal(readMrzOcr(`T${card}`, NOW)?.text, card);
  // The serifed I of the document code read as a T.
  assert.equal(readMrzOcr(card.replace(/^IA/, 'TA'), NOW)?.text, card);
});
