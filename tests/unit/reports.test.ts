import { describe, expect, it } from 'vitest';
import { can } from '@/server/authz';
import { canAccessConsolePath } from '@/lib/routes';
import { csvField, resolveColumns, reportFileName, specToQuery, summarize, toCsv, type SummaryBooking } from '@/lib/reports';

const types = [
  { id: 'q', name: 'Queen', totalRooms: 3 },
  { id: 'k', name: 'King', totalRooms: 1 },
];
const stay = (o: Partial<SummaryBooking>): SummaryBooking => ({
  id: Math.random().toString(36).slice(2),
  checkIn: '2026-10-01',
  checkOut: '2026-10-03',
  rooms: 1,
  roomCharges: 200,
  total: 220,
  roomTypeId: 'q',
  source: 'WEB',
  paymentMethod: 'PAY_AT_PROPERTY',
  ...o,
});

describe('summary report', () => {
  it('spreads a stay over its nights and keeps taxes out of ADR', () => {
    const { rows, totals } = summarize({ from: '2026-10-01', to: '2026-10-03', groupBy: 'date', roomTypes: types, bookings: [stay({})] });
    expect(rows.map((r) => r.group)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(rows[0]).toMatchObject({ roomNights: 1, available: 4, occupancy: 25, roomRevenue: 100, taxes: 10, totalRevenue: 110, adr: 100, revpar: 25, arrivals: 1, departures: 0 });
    // The departure day: no night sold, one departure.
    expect(rows[2]).toMatchObject({ roomNights: 0, departures: 1, roomRevenue: 0 });
    expect(totals).toMatchObject({ group: 'Total', roomNights: 2, available: 12, roomRevenue: 200, taxes: 20, adr: 100, arrivals: 1, departures: 1, reservations: 1 });
  });

  it('counts only the nights inside the range', () => {
    // $500 for 2 rooms over 5 nights: $100 a night for the booking.
    const { totals } = summarize({ from: '2026-10-02', to: '2026-10-02', groupBy: 'date', roomTypes: types, bookings: [stay({ checkIn: '2026-09-30', checkOut: '2026-10-05', roomCharges: 500, total: 500, rooms: 2 })] });
    expect(totals).toMatchObject({ roomNights: 2, roomRevenue: 100, arrivals: 0, departures: 0, occupancy: 50 });
  });

  it('groups by room type against that type’s own rooms', () => {
    const { rows } = summarize({
      from: '2026-10-01',
      to: '2026-10-02',
      groupBy: 'roomType',
      roomTypes: types,
      bookings: [stay({ roomTypeId: 'k', roomCharges: 400, total: 400 }), stay({ roomTypeId: 'q' })],
    });
    expect(rows.map((r) => r.group)).toEqual(['King', 'Queen']);
    expect(rows[0]).toMatchObject({ roomNights: 2, available: 2, occupancy: 100, roomRevenue: 400 });
    expect(rows[1]).toMatchObject({ roomNights: 2, available: 6, occupancy: 33.3 });
  });

  it('groups by source and payment method', () => {
    const bookings = [stay({ source: 'EXPEDIA', paymentMethod: 'CARD_ONLINE' }), stay({ source: 'FRONT_DESK' }), stay({ source: 'FRONT_DESK' })];
    const bySource = summarize({ from: '2026-10-01', to: '2026-10-01', groupBy: 'source', roomTypes: types, bookings });
    expect(bySource.rows.map((r) => [r.group, r.reservations])).toEqual([
      ['Front desk', 2],
      ['Expedia', 1],
    ]);
    const byMethod = summarize({ from: '2026-10-01', to: '2026-10-01', groupBy: 'paymentMethod', roomTypes: types, bookings });
    expect(byMethod.rows.map((r) => r.group).sort()).toEqual(['At the property', 'Card (online)']);
  });
});

describe('report CSV', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvField('Lopez, Maya')).toBe('"Lopez, Maya"');
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField(null)).toBe('');
    expect(csvField(12.5)).toBe('12.5');
    expect(csvField(-3)).toBe('-3');
  });

  it('neutralises spreadsheet formulas in text', () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvField('+1 555 0100')).toBe("'+1 555 0100");
    expect(csvField('@sum')).toBe("'@sum");
  });

  it('writes a header, rows and a totals line', () => {
    const cols = resolveColumns('list', ['guest', 'total']);
    const csv = toCsv(cols, [{ guest: 'Rosa Diaz', total: 120 }], { guest: null, total: 120 });
    expect(csv).toBe('Guest,Total\r\nRosa Diaz,120\r\nTotal,120\r\n');
  });
});

describe('report spec', () => {
  it('keeps known columns in catalogue order and falls back to all', () => {
    expect(resolveColumns('list', ['total', 'guest', 'nope']).map((c) => c.key)).toEqual(['guest', 'total']);
    expect(resolveColumns('summary', ['nope']).length).toBeGreaterThan(5);
  });

  it('builds the API query', () => {
    expect(
      specToQuery({ kind: 'list', from: '2026-10-01', to: '2026-10-02', dateField: 'checkIn', groupBy: 'date', roomTypes: ['a', 'b'], sources: [], statuses: ['CONFIRMED'], paymentMethods: [], columns: ['guest'] }),
    ).toEqual({ kind: 'list', from: '2026-10-01', to: '2026-10-02', dateField: 'checkIn', roomTypes: 'a,b', statuses: 'CONFIRMED', columns: 'guest' });
  });

  it('names the download after the hotel, report and dates', () => {
    expect(reportFileName('Harbor Inn & Suites', 'In house', '2026-10-01', '2026-10-01')).toBe('harbor-inn-suites-in-house-2026-10-01.csv');
    expect(reportFileName('Harbor', 'Revenue', '2026-10-01', '2026-10-07')).toBe('harbor-revenue-2026-10-01-to-2026-10-07.csv');
  });
});

describe('who can run reports', () => {
  it('is front desk and up, not housekeeping', () => {
    for (const role of ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] as const) {
      expect(can({ role }, 'reports.view')).toBe(true);
      expect(canAccessConsolePath(role, '/admin/reports')).toBe(true);
    }
    expect(can({ role: 'HOUSEKEEPER' }, 'reports.view')).toBe(false);
    expect(canAccessConsolePath('HOUSEKEEPER', '/admin/reports')).toBe(false);
  });
});
