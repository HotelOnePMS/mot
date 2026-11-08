/**
 * Cleaning up what OCR reads from a passport's or ID card's machine-readable
 * zone, before it goes to the MRZ parser.
 *
 * The camera scanner reads the MRZ with general-purpose OCR, which knows
 * nothing about the format: it reads "0" for "O", "K" for a filler, drops or
 * adds a filler in a long run. Every MRZ position has a known kind (letters,
 * digits, or either), so most misreads can be put right from the position
 * alone, and the check digits settle the rest: a read is only used when every
 * one of them passes. Names have no check digit, so the scanner also waits
 * for two reads that agree before it fills the form.
 *
 * Pure functions, no imports beyond the parser: tested on their own.
 */

import { parseMrz, type ScannedId } from './id-scan';

// What OCR confuses, one way and the other.
const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', J: '1', Z: '2', S: '5', B: '8', G: '6', T: '7', A: '4' };
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '4': 'A', '5': 'S', '6': 'G', '7': 'T', '8': 'B' };

/** Letters (A), digits (N), or either (X), per position. Fillers are allowed anywhere. */
type Mask = string;
const rep = (c: string, n: number) => c.repeat(n);

// ICAO 9303 layouts. Position 1 of a card's document code can be a digit ("C1" on a US green card).
const LAYOUTS: { lengths: number[]; masks: Mask[] }[] = [
  // TD3, passports.
  {
    lengths: [44, 44],
    masks: [rep('A', 44), rep('X', 9) + 'N' + rep('A', 3) + rep('N', 7) + 'A' + rep('N', 7) + rep('X', 14) + 'NN'],
  },
  // TD2, older cards and visas.
  {
    lengths: [36, 36],
    masks: ['AX' + rep('A', 34), rep('X', 9) + 'N' + rep('A', 3) + rep('N', 7) + 'A' + rep('N', 7) + rep('X', 7) + 'N'],
  },
  // TD1, ID cards, residence permits, EADs and green cards.
  {
    lengths: [30, 30, 30],
    masks: ['AX' + rep('A', 3) + rep('X', 9) + 'N' + rep('X', 15), rep('N', 7) + 'A' + rep('N', 7) + rep('A', 3) + rep('X', 11) + 'N', rep('A', 30)],
  },
];

/** Raw OCR text → candidate MRZ lines: upper-case, spaces gone, look-alikes of the filler turned into one. */
function candidateLines(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[«‹]/g, '<<')
    .replace(/[(\[{]/g, '<')
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, ''))
    .filter((l) => l.length >= 24);
}

/**
 * Ways to fit a line to its length, most likely first: grow or shrink its
 * longest run of fillers (where OCR loses or gains them most), or drop stray
 * characters at either end (the edge of the page, a shadow) or put back fillers lost at the end.
 */
function fits(line: string, length: number): string[] {
  const diff = length - line.length;
  if (diff === 0) return [line];
  if (Math.abs(diff) > 4) return [];
  const out: string[] = [];
  let best: { at: number; len: number } | null = null;
  for (const m of line.matchAll(/<{2,}/g)) if (!best || m[0].length > best.len) best = { at: m.index!, len: m[0].length };
  if (best && best.len + diff >= 1) out.push(line.slice(0, best.at) + '<'.repeat(best.len + diff) + line.slice(best.at + best.len));
  if (diff < 0) {
    for (let head = 0; head <= -diff; head++) out.push(line.slice(head, head + length));
  } else {
    out.push(line + '<'.repeat(diff));
  }
  return [...new Set(out)];
}

/** Every combination of one fit per line. */
function fitAll(lines: string[], lengths: number[]): string[][] {
  return lines.reduce<string[][]>((acc, l, i) => acc.flatMap((prefix) => fits(l, lengths[i]).map((f) => [...prefix, f])), [[]]);
}

/** Letters and digits put right for what each position can hold. */
function applyMask(line: string, mask: Mask): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const kind = mask[i];
    out += kind === 'N' ? TO_DIGIT[c] ?? c : kind === 'A' ? TO_LETTER[c] ?? c : c;
  }
  return out;
}

/** In a name, three fillers in a row end it: whatever OCR saw after them is fillers misread. */
function cleanNameTail(name: string): string {
  const end = name.indexOf('<<<');
  return end < 0 ? name : name.slice(0, end) + '<'.repeat(name.length - end);
}

/** Where the name sits in each layout, as [line, start]. */
function withCleanName(lines: string[]): string[] {
  const out = [...lines];
  if (lines.length === 3) out[2] = cleanNameTail(lines[2]);
  else out[0] = lines[0].slice(0, 5) + cleanNameTail(lines[0].slice(5));
  return out;
}

// What a letter-or-digit position could have been misread from.
const LOOKALIKES: Record<string, string[]> = {
  '0': ['O', 'D'], O: ['0'], D: ['0'], Q: ['0'],
  '1': ['I'], I: ['1'], L: ['1'],
  '2': ['Z'], Z: ['2', '7'], '7': ['Z', 'T'], T: ['7'],
  '5': ['S'], S: ['5'], '8': ['B'], B: ['8'], '6': ['G'], G: ['6'], '4': ['A'], A: ['4'],
};
// At most this many characters changed in one read: more, and the check digits could be talked into a wrong number.
const MAX_CHANGES = 2;

/**
 * Document numbers and the optional data mix letters and digits, so position
 * can't tell "O" from "0" there. Try look-alikes, fewest changes first, until
 * the check digits pass. Every such field is covered by a check digit and by
 * the composite one, so a wrong guess that fixes one still fails the other.
 */
function* lookalikeVariants(lines: string[], masks: Mask[]): Generator<string[]> {
  yield lines;
  const spots: { line: number; at: number; alts: string[] }[] = [];
  lines.forEach((l, li) => {
    for (let i = 0; i < l.length; i++) if (masks[li][i] === 'X' && LOOKALIKES[l[i]]) spots.push({ line: li, at: i, alts: LOOKALIKES[l[i]] });
  });
  const change = (base: string[], spot: (typeof spots)[number], c: string) => {
    const out = [...base];
    out[spot.line] = out[spot.line].slice(0, spot.at) + c + out[spot.line].slice(spot.at + 1);
    return out;
  };
  // Exactly `left` more changes, at spots from `start` on.
  function* exactly(base: string[], start: number, left: number): Generator<string[]> {
    for (let i = start; i < spots.length; i++)
      for (const c of spots[i].alts) {
        const next = change(base, spots[i], c);
        if (left === 1) yield next;
        else yield* exactly(next, i + 1, left - 1);
      }
  }
  // Every single change before any pair.
  for (let n = 1; n <= MAX_CHANGES; n++) yield* exactly(lines, 0, n);
}

export interface MrzOcrRead {
  scan: ScannedId;
  /** The MRZ as corrected, one line per row: two reads that agree on it are the same document read the same way. */
  text: string;
}

/**
 * The MRZ in some OCR text, corrected, when every check digit passes. Null
 * when no layout fits or a check digit still fails: the scanner reads the next
 * frame instead of filling the form with a guess.
 */
export function readMrzOcr(text: string, now: Date = new Date()): MrzOcrRead | null {
  const lines = candidateLines(text);
  for (const layout of LAYOUTS) {
    const n = layout.lengths.length;
    // The MRZ is the bottom of the document: try the last lines first.
    for (let end = lines.length; end >= n; end--) {
      for (const fitted of fitAll(lines.slice(end - n, end), layout.lengths)) {
        const masked = withCleanName(fitted.map((l, i) => applyMask(l, layout.masks[i])));
        // A card's document code starts with I, A or C. OCR reads the serifed I as a T or an L often enough to be worth fixing.
        if (n > 1 && layout.lengths[0] !== 44 && /^[TLJ]/.test(masked[0])) masked[0] = 'I' + masked[0].slice(1);
        for (const variant of lookalikeVariants(masked, layout.masks)) {
          const joined = variant.join('\n');
          const scan = parseMrz(joined, now);
          if (scan && scan.problems.length === 0 && scan.documentNumber) return { scan, text: joined };
        }
      }
    }
  }
  return null;
}
