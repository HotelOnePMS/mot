/**
 * Parse "101-110, 201, 203-205" into room numbers. Ranges keep the width
 * of their start ("01-03" → 01, 02, 03). Returns null with a message when
 * the input can't be understood.
 */
export function parseRoomNumbers(input: string, max = 200): { numbers: string[] } | { error: string } {
  const out: string[] = [];
  for (const raw of input.split(/[,\s]+/).filter(Boolean)) {
    const range = raw.match(/^([A-Za-z]*)(\d+)\s*[-–]\s*\1?(\d+)$/);
    if (range) {
      const [, prefix, a, b] = range;
      const from = Number(a);
      const to = Number(b);
      if (to < from) return { error: `“${raw}” runs backwards.` };
      if (to - from + 1 > max) return { error: `“${raw}” is more than ${max} rooms.` };
      for (let n = from; n <= to; n++) out.push(prefix + String(n).padStart(a.length, '0'));
    } else if (/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(raw)) {
      out.push(raw);
    } else {
      return { error: `“${raw}” isn’t a room number.` };
    }
  }
  const unique = [...new Set(out)];
  if (unique.length > max) return { error: `That’s ${unique.length} rooms — add up to ${max} at a time.` };
  return { numbers: unique };
}
