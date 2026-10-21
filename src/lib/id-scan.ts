/**
 * Reading a guest's photo ID from a scan, so the desk doesn't retype it.
 *
 * Two formats cover almost every ID a hotel sees:
 * - AAMVA PDF417, the barcode on the back of US and Canadian driver's
 *   licenses and ID cards. A desk scanner (or the camera) reads it as text:
 *   one element per line, "DCS" family name, "DAQ" licence number, and so on.
 *   Keyboard-wedge scanners often drop the control characters and turn line
 *   feeds into Enter, so the parser is lenient about both.
 * - ICAO 9303 MRZ, the two or three lines of <<< at the bottom of passports
 *   (TD3, 2 × 44) and ID cards (TD1, 3 × 30), with check digits.
 *
 * Pure functions, no imports: the check-in form parses on the device and
 * nothing leaves it until staff save.
 */

export type ScannedIdType = 'DRIVERS_LICENSE' | 'NATIONAL_ID' | 'PASSPORT' | 'OTHER';

export interface ScannedId {
  format: 'AAMVA' | 'MRZ';
  idType: ScannedIdType;
  documentNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  /** "Jane Marie Sample", as people write it. */
  fullName: string;
  /** Calendar days, YYYY-MM-DD. */
  dateOfBirth: string | null;
  expiry: string | null;
  /** Two-letter country that issued the ID (null when the code has no country, e.g. a specimen). */
  country: string | null;
  /** State or province (AAMVA only). */
  region: string | null;
  sex: 'M' | 'F' | 'X' | null;
  /** Two-letter nationality (MRZ only). */
  nationality: string | null;
  address: { line1: string; city: string; region: string; postalCode: string; country: string | null } | null;
  /** Empty when every check digit (MRZ) and required field is right. */
  problems: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function isoDay(y: number, m: number, d: number): string | null {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** "JANE" → "Jane", "O'NEIL-SMITH" → "O'Neil-Smith". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function joinName(first: string, middle: string | null, last: string): string {
  return [first, middle, last].filter((p) => p && p.trim()).join(' ');
}

// ---------------------------------------------------------------------------
// AAMVA (PDF417 on North American licenses)
// ---------------------------------------------------------------------------

const AAMVA_ELEMENTS = ['DAA', 'DAB', 'DAC', 'DAD', 'DAG', 'DAH', 'DAI', 'DAJ', 'DAK', 'DAQ', 'DBA', 'DBB', 'DBC', 'DBD', 'DCG', 'DCS', 'DCT', 'DCU', 'DDE', 'DDF', 'DDG'];
const ELEMENT_RE = new RegExp(`^(${AAMVA_ELEMENTS.join('|')})(.*)$`);
// The subfile ("DL" licence or "ID" card) starts right after the header, glued to its first element.
const SUBFILE_RE = new RegExp(`(DL|ID)(${AAMVA_ELEMENTS.join('|')})`, 'g');

/** AAMVA dates: MMDDCCYY in the USA, CCYYMMDD in Canada. A month is never 19 or 20, so the first two digits tell them apart. */
function aamvaDate(v: string | undefined): string | null {
  const s = (v ?? '').replace(/\D/g, '');
  if (s.length !== 8) return null;
  const head = Number(s.slice(0, 2));
  return head === 19 || head === 20 ? isoDay(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8))) : isoDay(Number(s.slice(4, 8)), Number(s.slice(0, 2)), Number(s.slice(2, 4)));
}

function aamvaPostal(v: string | undefined, country: string | null): string {
  const s = (v ?? '').trim().replace(/\s+/g, ' ');
  if (country === 'US' || /^\d{9}$/.test(s)) {
    const digits = s.replace(/\D/g, '');
    if (digits.length === 9) return digits.endsWith('0000') ? digits.slice(0, 5) : `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return s;
}

export function looksLikeAamva(text: string): boolean {
  return /ANSI\s?\d{6}|AAMVA/.test(text) && /DAQ|DCS|DAA/.test(text);
}

export function parseAamva(text: string): ScannedId | null {
  if (!looksLikeAamva(text)) return null;
  const fields: Record<string, string> = {};
  let subfile: 'DL' | 'ID' | null = null;
  for (const raw of text.split(/\r\n|\r|\n|\u001e/)) {
    // Scanners vary: strip control characters, keep the text.
    let line = raw.replace(/[\u0000-\u001f\u007f]/g, '').trimEnd();
    if (!line) continue;
    if (/ANSI|AAMVA/.test(line)) {
      const starts = [...line.matchAll(SUBFILE_RE)];
      const last = starts[starts.length - 1];
      if (!last || last.index === undefined) continue;
      subfile = last[1] as 'DL' | 'ID';
      line = line.slice(last.index + 2);
    }
    const m = ELEMENT_RE.exec(line);
    if (m && !(m[1] in fields)) fields[m[1]] = m[2].trim();
  }

  // Version 1 cards put the whole name in DAA ("FAMILY,GIVEN,MIDDLE"); later ones split it.
  let last = fields.DCS ?? fields.DAB ?? '';
  let first = fields.DAC ?? '';
  let middle = fields.DAD ?? '';
  if (!first && fields.DCT) [first, middle = middle] = fields.DCT.split(/[,\s]+/, 2);
  if ((!last || !first) && fields.DAA) {
    const parts = fields.DAA.split(/,|\$/).map((p) => p.trim());
    last ||= parts[0] ?? '';
    first ||= parts[1] ?? '';
    middle ||= parts[2] ?? '';
  }
  const cleanMiddle = middle && !/^(NONE|N\/?A|UNAVL)$/i.test(middle) ? titleCase(middle) : null;
  const country = fields.DCG === 'USA' ? 'US' : fields.DCG === 'CAN' ? 'CA' : null;
  const region = fields.DAJ?.trim().toUpperCase() || null;
  const problems: string[] = [];
  if (!fields.DAQ) problems.push('No licence number in the scan.');
  if (!last || !first) problems.push('The name is incomplete in the scan.');
  const sex = fields.DBC === '1' || fields.DBC === 'M' ? 'M' : fields.DBC === '2' || fields.DBC === 'F' ? 'F' : fields.DBC === '9' || fields.DBC === 'X' ? 'X' : null;
  const addressCountry = country ?? (/^[A-Z]\d[A-Z]/.test(fields.DAK ?? '') ? 'CA' : null);
  return {
    format: 'AAMVA',
    idType: subfile === 'ID' ? 'NATIONAL_ID' : 'DRIVERS_LICENSE',
    documentNumber: (fields.DAQ ?? '').replace(/\s+/g, ''),
    firstName: titleCase(first),
    middleName: cleanMiddle,
    lastName: titleCase(last),
    fullName: joinName(titleCase(first), cleanMiddle, titleCase(last)),
    dateOfBirth: aamvaDate(fields.DBB),
    expiry: aamvaDate(fields.DBA),
    country: addressCountry,
    region,
    sex,
    nationality: null,
    address: fields.DAG
      ? {
          line1: titleCase([fields.DAG, fields.DAH].filter(Boolean).join(', ')),
          city: titleCase(fields.DAI ?? ''),
          region: region ?? '',
          postalCode: aamvaPostal(fields.DAK, addressCountry),
          country: addressCountry,
        }
      : null,
    problems,
  };
}

// ---------------------------------------------------------------------------
// ICAO 9303 machine-readable zone (passports and ID cards)
// ---------------------------------------------------------------------------

const MRZ_CHAR_VALUE = (c: string) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
const WEIGHTS = [7, 3, 1];

/** The ICAO check digit of a field. */
export function mrzCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += MRZ_CHAR_VALUE(field[i]) * WEIGHTS[i % 3];
  return sum % 10;
}

const checks = (field: string, digit: string) => digit !== '<' && mrzCheckDigit(field) === Number(digit);

// ISO 3166 alpha-3 → alpha-2, plus the MRZ's own codes (D for Germany, GBD… British nationals, RKS Kosovo).
const ISO3 = (
  'AND:AD ARE:AE AFG:AF ATG:AG AIA:AI ALB:AL ARM:AM AGO:AO ARG:AR AUT:AT AUS:AU ABW:AW AZE:AZ BIH:BA BRB:BB BGD:BD BEL:BE BFA:BF BGR:BG BHR:BH ' +
  'BDI:BI BEN:BJ BMU:BM BRN:BN BOL:BO BRA:BR BHS:BS BTN:BT BWA:BW BLR:BY BLZ:BZ CAN:CA COD:CD CAF:CF COG:CG CHE:CH CIV:CI CHL:CL CMR:CM CHN:CN ' +
  'COL:CO CRI:CR CUB:CU CPV:CV CYP:CY CZE:CZ DEU:DE D:DE DJI:DJ DNK:DK DMA:DM DOM:DO DZA:DZ ECU:EC EST:EE EGY:EG ERI:ER ESP:ES ETH:ET FIN:FI FJI:FJ ' +
  'FSM:FM FRA:FR GAB:GA GBR:GB GBD:GB GBN:GB GBO:GB GBP:GB GBS:GB GRD:GD GEO:GE GHA:GH GMB:GM GIN:GN GNQ:GQ GRC:GR GTM:GT GNB:GW GUY:GY HKG:HK ' +
  'HND:HN HRV:HR HTI:HT HUN:HU IDN:ID IRL:IE ISR:IL IND:IN IRQ:IQ IRN:IR ISL:IS ITA:IT JAM:JM JOR:JO JPN:JP KEN:KE KGZ:KG KHM:KH KIR:KI COM:KM ' +
  'KNA:KN KOR:KR KWT:KW CYM:KY KAZ:KZ LAO:LA LBN:LB LCA:LC LIE:LI LKA:LK LBR:LR LSO:LS LTU:LT LUX:LU LVA:LV LBY:LY MAR:MA MCO:MC MDA:MD MNE:ME ' +
  'MDG:MG MHL:MH MKD:MK MLI:ML MMR:MM MNG:MN MAC:MO MRT:MR MLT:MT MUS:MU MDV:MV MWI:MW MEX:MX MYS:MY MOZ:MZ NAM:NA NER:NE NGA:NG NIC:NI NLD:NL ' +
  'NOR:NO NPL:NP NRU:NR NZL:NZ OMN:OM PAN:PA PER:PE PNG:PG PHL:PH PAK:PK POL:PL PRI:PR PSE:PS PRT:PT PLW:PW PRY:PY QAT:QA ROU:RO SRB:RS RUS:RU ' +
  'RWA:RW SAU:SA SLB:SB SYC:SC SDN:SD SWE:SE SGP:SG SVN:SI SVK:SK SLE:SL SMR:SM SEN:SN SOM:SO SUR:SR SSD:SS STP:ST SLV:SV SYR:SY SWZ:SZ TCD:TD ' +
  'TGO:TG THA:TH TJK:TJ TLS:TL TKM:TM TUN:TN TON:TO TUR:TR TTO:TT TUV:TV TWN:TW TZA:TZ UKR:UA UGA:UG USA:US URY:UY UZB:UZ VAT:VA VCT:VC VEN:VE ' +
  'VNM:VN VUT:VU WSM:WS RKS:XK XKX:XK YEM:YE ZAF:ZA ZMB:ZM ZWE:ZW'
)
  .split(' ')
  .reduce<Record<string, string>>((m, pair) => {
    const [a3, a2] = pair.split(':');
    m[a3] = a2;
    return m;
  }, {});

/** "USA" → "US", "D<<" → "DE"; null for codes with no country (UTO specimens, UNO, stateless XXA…). */
export function mrzCountry(code: string): string | null {
  return ISO3[code.replace(/</g, '')] ?? null;
}

/** YYMMDD → YYYY-MM-DD. Birth dates are in the past; expiry dates are this century unless clearly old. */
function mrzDate(v: string, kind: 'birth' | 'expiry', now: Date): string | null {
  if (!/^\d{6}$/.test(v)) return null;
  const yy = Number(v.slice(0, 2));
  const thisYear = now.getUTCFullYear() % 100;
  const century = kind === 'birth' ? (yy > thisYear ? 1900 : 2000) : yy >= 70 ? 1900 : 2000;
  return isoDay(century + yy, Number(v.slice(2, 4)), Number(v.slice(4, 6)));
}

function mrzNames(field: string): { first: string; middle: string | null; last: string } {
  const [surname = '', given = ''] = field.replace(/<+$/, '').split('<<');
  const givenParts = given.split('<').filter(Boolean).map(titleCase);
  return { last: titleCase(surname.replace(/</g, ' ')), first: givenParts[0] ?? '', middle: givenParts.slice(1).join(' ') || null };
}

const SEX = (c: string): ScannedId['sex'] => (c === 'M' || c === 'F' || c === 'X' ? c : null);

/** MRZ lines from scanner text: upper-cased, spaces removed; one unbroken run of 88 or 90 characters is split too. */
function mrzLines(text: string): string[] {
  const cleaned = text.toUpperCase().replace(/[^\S\r\n]/g, '').replace(/[«‹]/g, '<');
  let lines = cleaned.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => /^[A-Z0-9<]+$/.test(l) && l.length >= 28);
  if (lines.length === 1) {
    const one = lines[0];
    if (one.length === 88) lines = [one.slice(0, 44), one.slice(44)];
    else if (one.length === 90) lines = [one.slice(0, 30), one.slice(30, 60), one.slice(60)];
  }
  return lines;
}

export function looksLikeMrz(text: string): boolean {
  const lines = mrzLines(text);
  return (lines.length === 2 && lines.every((l) => l.length === 44)) || (lines.length === 3 && lines.every((l) => l.length === 30));
}

export function parseMrz(text: string, now: Date = new Date()): ScannedId | null {
  const lines = mrzLines(text);
  const problems: string[] = [];
  if (lines.length === 2 && lines.every((l) => l.length === 44)) {
    const [l1, l2] = lines;
    if (l1[0] !== 'P') return null;
    const number = l2.slice(0, 9);
    if (!checks(number, l2[9])) problems.push('The passport number’s check digit doesn’t match. Rescan, or check the number by eye.');
    if (!checks(l2.slice(13, 19), l2[19])) problems.push('The date of birth’s check digit doesn’t match.');
    if (!checks(l2.slice(21, 27), l2[27])) problems.push('The expiry date’s check digit doesn’t match.');
    const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
    if (l2[43] !== '<' && !checks(composite, l2[43])) problems.push('The passport’s overall check digit doesn’t match.');
    const n = mrzNames(l1.slice(5));
    return {
      format: 'MRZ',
      idType: 'PASSPORT',
      documentNumber: number.replace(/</g, ''),
      firstName: n.first,
      middleName: n.middle,
      lastName: n.last,
      fullName: joinName(n.first, n.middle, n.last),
      dateOfBirth: mrzDate(l2.slice(13, 19), 'birth', now),
      expiry: mrzDate(l2.slice(21, 27), 'expiry', now),
      country: mrzCountry(l1.slice(2, 5)),
      region: null,
      sex: SEX(l2[20]),
      nationality: mrzCountry(l2.slice(10, 13)),
      address: null,
      problems,
    };
  }
  if (lines.length === 3 && lines.every((l) => l.length === 30)) {
    const [l1, l2, l3] = lines;
    if (!/^[IAC]/.test(l1)) return null;
    let number = l1.slice(5, 14);
    let numberCheck = l1[14];
    let numberField = number;
    // Numbers longer than nine characters continue in the optional field, ending with their check digit.
    if (numberCheck === '<') {
      const rest = l1.slice(15, 30).replace(/<+$/, '');
      numberField = number + rest.slice(0, -1);
      number = numberField;
      numberCheck = rest.slice(-1);
    }
    if (!checks(numberField, numberCheck)) problems.push('The ID number’s check digit doesn’t match. Rescan, or check the number by eye.');
    if (!checks(l2.slice(0, 6), l2[6])) problems.push('The date of birth’s check digit doesn’t match.');
    if (!checks(l2.slice(8, 14), l2[14])) problems.push('The expiry date’s check digit doesn’t match.');
    const composite = l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29);
    if (!checks(composite, l2[29])) problems.push('The ID card’s overall check digit doesn’t match.');
    const n = mrzNames(l3);
    return {
      format: 'MRZ',
      idType: 'NATIONAL_ID',
      documentNumber: number.replace(/</g, ''),
      firstName: n.first,
      middleName: n.middle,
      lastName: n.last,
      fullName: joinName(n.first, n.middle, n.last),
      dateOfBirth: mrzDate(l2.slice(0, 6), 'birth', now),
      expiry: mrzDate(l2.slice(8, 14), 'expiry', now),
      country: mrzCountry(l1.slice(2, 5)),
      region: null,
      sex: SEX(l2[7]),
      nationality: mrzCountry(l2.slice(15, 18)),
      address: null,
      problems,
    };
  }
  return null;
}

/** Whatever was scanned: a licence barcode or a passport/ID card MRZ. Null when it is neither. */
export function parseIdScan(text: string, now: Date = new Date()): ScannedId | null {
  if (!text || text.length > 5000) return null;
  return looksLikeAamva(text) ? parseAamva(text) : parseMrz(text, now);
}

/** Whole years between a date of birth and a day (both YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, day: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!b || !d) return null;
  let age = Number(d[1]) - Number(b[1]);
  if (Number(d[2]) < Number(b[2]) || (d[2] === b[2] && Number(d[3]) < Number(b[3]))) age--;
  return age;
}
