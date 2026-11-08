/**
 * Reading a guest's photo ID from a scan, so the desk doesn't retype it.
 *
 * Two formats cover almost every ID a hotel sees:
 * - AAMVA PDF417, the barcode on the back of US and Canadian driver's
 *   licenses and ID cards. A desk scanner (or the camera) reads it as text:
 *   a header naming the subfile ("DL" licence or "ID" card), then one
 *   element per line, "DCS" family name, "DAQ" licence number, and so on.
 *   Keyboard-wedge scanners often drop the control characters and turn line
 *   feeds into Enter, so the parser is lenient about both. When the line
 *   feeds are lost altogether the elements run together and can't be told
 *   apart reliably, so the scan comes back empty with a hint instead of a
 *   licence number that is really half the barcode.
 * - ICAO 9303 MRZ, the lines of <<< at the bottom of passports (TD3, 2 × 44)
 *   and ID cards, residence permits and crew cards (TD1, 3 × 30, and the
 *   older TD2, 2 × 36). Every check digit is verified, so a misread
 *   character shows up as a problem for staff to look at, never as a quiet
 *   mistake.
 *
 * Pure functions, no imports: the check-in form parses on the device and
 * nothing leaves it until staff save.
 */

export type ScannedIdType = 'DRIVERS_LICENSE' | 'NATIONAL_ID' | 'PASSPORT' | 'OTHER';

export interface ScannedId {
  format: 'AAMVA' | 'MRZ';
  idType: ScannedIdType;
  /** Empty when the scan has no number staff can trust (see problems). */
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
// "ANSI " ("AAMVA" on early cards), the issuer's IIN and version digits, then one designator per subfile: type, offset, length.
const HEADER_RE = /(?:ANSI|AAMVA) ?\d{6,}((?:[A-Z]{2}\d{8})*)/;
// The subfile ("DL" licence or "ID" card) starts glued to its first element id, whatever that element is.
const SUBFILE_AT_START_RE = /^(DL|ID)(?=D[A-Z]{2})/;
const SUBFILE_ANYWHERE_RE = /(DL|ID)(?=D[A-Z]{2})/;
// Elements that come after DAQ on a card. One of them inside the licence number means the line break before it was lost.
const FOLLOWING_ELEMENTS = [...AAMVA_ELEMENTS.filter((id) => id !== 'DAQ'), 'DAU', 'DAY', 'DCA', 'DCB', 'DCD', 'DCF'];
// The longest licence number the standard allows.
const MAX_LICENCE_NUMBER = 25;

const LOST_LINE_BREAKS = 'Line breaks were lost. Scan into the box again, or set the scanner to send Enter after each line.';

const CANADA = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));
const USA = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA ' +
    'WA WV WI WY DC PR AS GU MP VI'
  ).split(' '),
);

/** "VA" → "US", "ON" → "CA": older cards have no country element, but the state or province gives it away. */
function regionCountry(region: string | null): string | null {
  if (!region) return null;
  return USA.has(region) ? 'US' : CANADA.has(region) ? 'CA' : null;
}

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

/** Where the subfile starts on the header line: right after the designators, or past whatever a scanner mangled there. */
function subfileOnHeaderLine(rest: string): RegExpExecArray | null {
  const atStart = SUBFILE_AT_START_RE.exec(rest);
  if (atStart || /^D[A-Z]{2}/.test(rest)) return atStart;
  return SUBFILE_ANYWHERE_RE.exec(rest);
}

/** A licence or ID card barcode, as text. Null when it isn't one. */
export function parseAamva(text: string): ScannedId | null {
  if (!looksLikeAamva(text)) return null;
  const fields: Record<string, string> = {};
  const seen = new Set<string>();
  let headerFound = false;
  let designated: 'DL' | 'ID' | null = null;
  let subfile: 'DL' | 'ID' | null = null;
  let elementLines = 0;
  let elementIds = 0;
  for (const raw of text.split(/\r\n|\r|\n|\u001e/)) {
    // Scanners vary: strip control characters, keep the text.
    let line = raw.replace(/[\u0000-\u001f\u007f]/g, '').trimEnd();
    const header = headerFound ? null : HEADER_RE.exec(line);
    if (header) {
      headerFound = true;
      // The designators say which subfile the card has; the subfile itself says it again.
      designated = (/(DL|ID)\d{8}/.exec(header[1])?.[1] as 'DL' | 'ID' | undefined) ?? null;
      line = line.slice(header.index + header[0].length);
    }
    if (!subfile && elementLines === 0) {
      const start = header ? subfileOnHeaderLine(line) : SUBFILE_AT_START_RE.exec(line);
      if (start) {
        subfile = start[1] as 'DL' | 'ID';
        line = line.slice(start.index + 2);
      }
    }
    if (!line) continue;
    if (/^D[A-Z]{2}/.test(line)) {
      elementLines++;
      seen.add(line.slice(0, 3));
    }
    elementIds += line.match(/D[A-Z]{2}/g)?.length ?? 0;
    const m = ELEMENT_RE.exec(line);
    if (m && !(m[1] in fields)) fields[m[1]] = m[2].trim();
  }

  const idType: ScannedIdType = (subfile ?? designated) === 'ID' ? 'NATIONAL_ID' : 'DRIVERS_LICENSE';
  // Every element on one line: the first one would swallow the rest. Nothing in it can be trusted.
  if (elementLines <= 1 && elementIds >= 3) {
    return {
      format: 'AAMVA',
      idType,
      documentNumber: '',
      firstName: '',
      middleName: null,
      lastName: '',
      fullName: '',
      dateOfBirth: null,
      expiry: null,
      country: null,
      region: null,
      sex: null,
      nationality: null,
      address: null,
      problems: [LOST_LINE_BREAKS],
    };
  }

  // Version 1 cards put the whole name in DAA ("FAMILY,GIVEN,MIDDLE"); later ones split it.
  let last = fields.DCS ?? fields.DAB ?? '';
  let first = fields.DAC ?? '';
  let middle = fields.DAD ?? '';
  // Versions 2 and 3 have "given names" (DCT): the first word is the first name, the rest are middle names.
  if (!first && fields.DCT) {
    const given = fields.DCT.split(/[,\s]+/).filter(Boolean);
    first = given[0] ?? '';
    middle ||= given.slice(1).join(' ');
  }
  if ((!last || !first) && fields.DAA) {
    const parts = fields.DAA.split(/,|\$/).map((p) => p.trim());
    last ||= parts[0] ?? '';
    first ||= parts[1] ?? '';
    middle ||= parts[2] ?? '';
  }
  const cleanMiddle = middle && !/^(NONE|N\/?A|UNAVL)$/i.test(middle) ? titleCase(middle) : null;
  const region = fields.DAJ?.trim().toUpperCase() || null;
  // DCG names the country; without it, the state or province (or a Canadian postal code) does.
  const country = (fields.DCG && mrzCountry(fields.DCG)) || regionCountry(region) || (/^[A-Z]\d[A-Z]/.test(fields.DAK ?? '') ? 'CA' : null);

  const number = (fields.DAQ ?? '').replace(/\s+/g, '');
  // Another element inside the number, one that never got a line of its own, is a line break the scanner lost.
  const garbled = number.length > MAX_LICENCE_NUMBER || FOLLOWING_ELEMENTS.some((id) => number.indexOf(id, 1) > 0 && !seen.has(id));
  const problems: string[] = [];
  if (!number) problems.push('No licence number in the scan.');
  else if (garbled) problems.push('The licence number didn’t scan cleanly. Scan again, or type it from the card.');
  if (!last || !first) problems.push('The name is incomplete in the scan.');
  // DDE, DDF and DDG say whether the family, first and middle names were cut to fit the card.
  if ([fields.DDE, fields.DDF, fields.DDG].includes('T')) problems.push('The name is shortened on the licence. Check it against the card.');
  const sex = fields.DBC === '1' || fields.DBC === 'M' ? 'M' : fields.DBC === '2' || fields.DBC === 'F' ? 'F' : fields.DBC === '9' || fields.DBC === 'X' ? 'X' : null;
  return {
    format: 'AAMVA',
    idType,
    documentNumber: garbled ? '' : number,
    firstName: titleCase(first),
    middleName: cleanMiddle,
    lastName: titleCase(last),
    fullName: joinName(titleCase(first), cleanMiddle, titleCase(last)),
    dateOfBirth: aamvaDate(fields.DBB),
    expiry: aamvaDate(fields.DBA),
    country,
    region,
    sex,
    nationality: null,
    address:
      fields.DAG || fields.DAI || fields.DAK
        ? {
            line1: titleCase([fields.DAG, fields.DAH].filter(Boolean).join(', ')),
            city: titleCase(fields.DAI ?? ''),
            region: region ?? '',
            postalCode: aamvaPostal(fields.DAK, country),
            country,
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

// A check digit is a digit: a filler, a letter or nothing at all never passes.
const checks = (field: string, digit: string | undefined) => /^\d$/.test(digit ?? '') && mrzCheckDigit(field) === Number(digit);

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

/** MRZ lines from scanner text: upper-cased, spaces removed; one unbroken run of 72, 88 or 90 characters is split too. */
function mrzLines(text: string): string[] {
  const cleaned = text.toUpperCase().replace(/[^\S\r\n]/g, '').replace(/[«‹]/g, '<');
  let lines = cleaned.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => /^[A-Z0-9<]+$/.test(l) && l.length >= 28);
  if (lines.length === 1) {
    const one = lines[0];
    if (one.length === 72) lines = [one.slice(0, 36), one.slice(36)];
    else if (one.length === 88) lines = [one.slice(0, 44), one.slice(44)];
    else if (one.length === 90) lines = [one.slice(0, 30), one.slice(30, 60), one.slice(60)];
  }
  return lines;
}

// Line lengths of TD3 (passports), TD2 and TD1 (cards).
const MRZ_SHAPES = ['44,44', '36,36', '30,30,30'];
const mrzShape = (lines: string[]) => lines.map((l) => l.length).join(',');

export function looksLikeMrz(text: string): boolean {
  return MRZ_SHAPES.includes(mrzShape(mrzLines(text)));
}

/**
 * TD1 and TD2 codes: I… is an identity card, except IR; AR, CR and other A or C + letter codes are residence permits and crew cards.
 * The US issues no national ID card: a US-issued card with an MRZ is a work permit (EAD), a green card or a passport card.
 */
const cardType = (code: string, issuer: string): ScannedIdType => (issuer === 'USA' || /^(IR|[AC][A-Z])/.test(code) ? 'OTHER' : 'NATIONAL_ID');

/**
 * A card number longer than nine characters has a filler where its check
 * digit should be and goes on at the start of the optional data, up to the
 * next filler. The last character of that run is the check digit.
 */
function cardNumber(principal: string, check: string, optional: string): { number: string; check: string } {
  if (check !== '<') return { number: principal, check };
  const run = optional.split('<')[0];
  return { number: principal + run.slice(0, -1), check: run.slice(-1) };
}

/** The fields every MRZ layout has, cut out of its lines. */
interface MrzFields {
  idType: ScannedIdType;
  issuer: string;
  name: string;
  number: string;
  numberCheck: string;
  nationality: string;
  birth: string;
  birthCheck: string;
  sex: string;
  expiry: string;
  expiryCheck: string;
  /** Passports only. */
  personal?: { field: string; check: string };
  composite: { field: string; check: string } | null;
}

const NUMBER_LABEL: Record<ScannedIdType, string> = { PASSPORT: 'passport number', NATIONAL_ID: 'ID number', DRIVERS_LICENSE: 'licence number', OTHER: 'document number' };
const DOCUMENT_LABEL: Record<ScannedIdType, string> = { PASSPORT: 'passport', NATIONAL_ID: 'ID card', DRIVERS_LICENSE: 'licence', OTHER: 'document' };

function readMrz(f: MrzFields, now: Date): ScannedId {
  const problems: string[] = [];
  const documentNumber = f.number.replace(/</g, '');
  if (!documentNumber) problems.push('No document number in the scan.');
  else if (!checks(f.number, f.numberCheck)) problems.push(`The ${NUMBER_LABEL[f.idType]}’s check digit doesn’t match. Rescan, or check the number by eye.`);
  if (!checks(f.birth, f.birthCheck)) problems.push('The date of birth’s check digit doesn’t match.');
  if (!checks(f.expiry, f.expiryCheck)) problems.push('The expiry date’s check digit doesn’t match.');
  // A passport with no personal number may leave its check digit as a filler.
  if (f.personal && f.personal.check !== '<' && !checks(f.personal.field, f.personal.check)) problems.push('The personal number’s check digit doesn’t match.');
  if (f.composite && !checks(f.composite.field, f.composite.check)) problems.push(`The ${DOCUMENT_LABEL[f.idType]}’s overall check digit doesn’t match.`);
  const n = mrzNames(f.name);
  return {
    format: 'MRZ',
    idType: f.idType,
    documentNumber,
    firstName: n.first,
    middleName: n.middle,
    lastName: n.last,
    fullName: joinName(n.first, n.middle, n.last),
    dateOfBirth: mrzDate(f.birth, 'birth', now),
    expiry: mrzDate(f.expiry, 'expiry', now),
    country: mrzCountry(f.issuer),
    region: null,
    sex: SEX(f.sex),
    nationality: mrzCountry(f.nationality),
    address: null,
    problems,
  };
}

/** A passport or ID card MRZ (TD3, TD2 or TD1). Null when it isn't one, or is a visa. */
export function parseMrz(text: string, now: Date = new Date()): ScannedId | null {
  const lines = mrzLines(text);
  const shape = mrzShape(lines);
  if (shape === '44,44') {
    const [l1, l2] = lines;
    if (l1[0] !== 'P') return null;
    return readMrz(
      {
        idType: 'PASSPORT',
        issuer: l1.slice(2, 5),
        name: l1.slice(5),
        number: l2.slice(0, 9),
        numberCheck: l2[9],
        nationality: l2.slice(10, 13),
        birth: l2.slice(13, 19),
        birthCheck: l2[19],
        sex: l2[20],
        expiry: l2.slice(21, 27),
        expiryCheck: l2[27],
        personal: { field: l2.slice(28, 42), check: l2[42] },
        composite: l2[43] === '<' ? null : { field: l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), check: l2[43] },
      },
      now,
    );
  }
  if (shape === '36,36') {
    const [l1, l2] = lines;
    if (!/^[IAC]/.test(l1)) return null;
    const { number, check } = cardNumber(l2.slice(0, 9), l2[9], l2.slice(28, 35));
    return readMrz(
      {
        idType: cardType(l1, l1.slice(2, 5)),
        issuer: l1.slice(2, 5),
        name: l1.slice(5),
        number,
        numberCheck: check,
        nationality: l2.slice(10, 13),
        birth: l2.slice(13, 19),
        birthCheck: l2[19],
        sex: l2[20],
        expiry: l2.slice(21, 27),
        expiryCheck: l2[27],
        composite: { field: l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 35), check: l2[35] },
      },
      now,
    );
  }
  if (shape === '30,30,30') {
    const [l1, l2, l3] = lines;
    if (!/^[IAC]/.test(l1)) return null;
    const { number, check } = cardNumber(l1.slice(5, 14), l1[14], l1.slice(15, 30));
    return readMrz(
      {
        idType: cardType(l1, l1.slice(2, 5)),
        issuer: l1.slice(2, 5),
        name: l3,
        number,
        numberCheck: check,
        nationality: l2.slice(15, 18),
        birth: l2.slice(0, 6),
        birthCheck: l2[6],
        sex: l2[7],
        expiry: l2.slice(8, 14),
        expiryCheck: l2[14],
        composite: { field: l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29), check: l2[29] },
      },
      now,
    );
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
