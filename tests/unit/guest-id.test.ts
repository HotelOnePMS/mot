import { describe, expect, it } from 'vitest';
import { aamvaDate, ageOn, namesMatch, parseAamva } from '@/lib/aamva';
import { decodeIdImage } from '@/server/services/guestIds';
import { openBytes, sealBytes } from '@/server/vault';

// A trimmed AAMVA v8 licence barcode (California sample data).
const LICENCE = [
  '@',
  '\x1e\rANSI 636014080102DL00410288ZC03290024DLDAQD1234567',
  'DCSDOE',
  'DDEN',
  'DACJANE',
  'DDFN',
  'DADQUINN',
  'DBD08312019',
  'DBB01151990',
  'DBA01152027',
  'DBC2',
  'DAJCA',
  'DCGUSA',
  '',
].join('\n');

describe('licence barcode', () => {
  it('reads name, last four, expiry and birth date', () => {
    expect(parseAamva(LICENCE)).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
      fullName: 'Jane Doe',
      numberLast4: '4567',
      expiresOn: '2027-01-15',
      dateOfBirth: '1990-01-15',
      jurisdiction: 'CA',
    });
  });

  it('reads Canadian dates year first', () => {
    expect(aamvaDate('20290630', true)).toBe('2029-06-30');
    expect(aamvaDate('06302029')).toBe('2029-06-30');
    expect(aamvaDate('2029')).toBeNull();
  });

  it('falls back to the older name fields', () => {
    const old = '@\n\x1e\rANSI 636000030001DL00290190DLDAQ99887766\nDAASMITH,JOHN,Q\nDBA12312030\n';
    expect(parseAamva(old)).toMatchObject({ firstName: 'John', lastName: 'Smith', numberLast4: '7766', expiresOn: '2030-12-31' });
  });

  it('ignores other barcodes', () => {
    expect(parseAamva('https://example.com/ticket/123')).toBeNull();
  });

  it('works out age', () => {
    expect(ageOn('1990-01-15', '2026-01-14')).toBe(35);
    expect(ageOn('1990-01-15', '2026-01-15')).toBe(36);
  });
});

describe('name on ID vs the booking', () => {
  it('matches the same person, in any case or order', () => {
    expect(namesMatch('JANE QUINN DOE', 'Jane Doe')).toBe(true);
    expect(namesMatch('Doe Jane', 'jane doe')).toBe(true);
    expect(namesMatch('José Álvarez', 'Jose Alvarez')).toBe(true);
    expect(namesMatch('Rob Smith', 'Robert Smith')).toBe(true);
  });

  it('flags a different person', () => {
    expect(namesMatch('John Smith', 'Jane Doe')).toBe(false);
    expect(namesMatch('Mary Doe', 'Jane Doe')).toBe(false);
  });
});

describe('ID image upload', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  it('accepts a real JPEG', () => {
    const r = decodeIdImage(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.bytes.equals(jpeg)).toBe(true);
  });

  it('refuses other types, and files pretending to be images', () => {
    expect(() => decodeIdImage(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`)).toThrow(/JPEG, PNG or WebP/);
    expect(() => decodeIdImage(`data:image/png;base64,${jpeg.toString('base64')}`)).toThrow(/readable image/);
    expect(() => decodeIdImage(`data:image/jpeg;base64,${Buffer.alloc(2_600_000, 0xff).toString('base64')}`)).toThrow(/too large/);
  });
});

describe('encrypted ID storage', () => {
  it('round-trips, and only opens for the same reservation', () => {
    const data = Buffer.from('a photo');
    const sealed = sealBytes(data, 'guest-id:b1');
    expect(sealed.includes(data)).toBe(false);
    expect(openBytes(sealed, 'guest-id:b1').equals(data)).toBe(true);
    expect(() => openBytes(sealed, 'guest-id:b2')).toThrow();
  });
});
