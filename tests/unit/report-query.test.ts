import { test } from 'vitest';
import assert from 'node:assert/strict';
import { checkQuery, decodeQuery, encodeQuery, queryTitle, shapeReport, type QueryRow, type ReportQuery } from '../../src/lib/report-query';

const night = (date: string, roomType: string, roomRevenue: number, extra: Partial<QueryRow> = {}): QueryRow => ({
  date,
  code: 'ABC123',
  guest: 'Guest',
  status: 'Confirmed',
  roomType,
  room: null,
  source: 'Website',
  paymentMethod: 'At the property',
  rooms: 1,
  roomRevenue,
  taxes: 0,
  ...extra,
});

const inventory = { roomTypes: [{ name: 'Queen', rooms: 2 }, { name: 'King', rooms: 1 }] };

test('occupancy, ADR and RevPAR by weekday, every weekday shown and cancelled stays left out', () => {
  // 2026-11-02 is a Monday.
  const rows = [
    night('2026-11-02', 'Queen', 100),
    night('2026-11-02', 'Queen', 100),
    night('2026-11-02', 'King', 200),
    night('2026-11-03', 'Queen', 100),
    night('2026-11-04', 'King', 999, { status: 'Cancelled' }),
  ];
  const q: ReportQuery = {
    dataset: 'nights',
    from: '2026-11-02',
    to: '2026-11-08',
    groupBy: [{ field: 'date', by: 'weekday' }],
    metrics: [{ fn: 'occupancy' }, { fn: 'adr' }, { fn: 'revpar' }],
  };
  const r = shapeReport(rows, q, inventory);
  assert.deepEqual(
    r.columns.map((c) => [c.key, c.format]),
    [
      ['date', 'text'],
      ['occupancy', 'percent'],
      ['adr', 'money'],
      ['revpar', 'money'],
    ]
  );
  assert.deepEqual(
    r.rows.map((x) => [x.date, x.occupancy, x.adr, x.revpar]),
    [
      ['Mon', 100, 133.33, 133.33],
      ['Tue', 33.3, 100, 33.33],
      ['Wed', 0, 0, 0],
      ['Thu', 0, 0, 0],
      ['Fri', 0, 0, 0],
      ['Sat', 0, 0, 0],
      ['Sun', 0, 0, 0],
    ]
  );
  assert.deepEqual(r.totals, { date: 'Total', occupancy: 19, adr: 125, revpar: 23.81 });
  assert.equal(r.matched, 4);
});

test('occupancy by room type counts only that room type’s rooms', () => {
  const rows = [night('2026-11-02', 'Queen', 100), night('2026-11-02', 'King', 200), night('2026-11-03', 'King', 200)];
  const r = shapeReport(rows, { dataset: 'nights', from: '2026-11-02', to: '2026-11-03', groupBy: [{ field: 'roomType' }], metrics: [{ fn: 'occupancy' }, { fn: 'sum', field: 'roomRevenue' }] }, inventory);
  assert.deepEqual(
    r.rows.map((x) => [x.roomType, x.occupancy, x.sum_roomRevenue]),
    [
      ['King', 100, 400],
      ['Queen', 25, 100],
    ]
  );
});

test('extra charges by month: a text filter, empty months shown, a total row', () => {
  const charge = (date: string, name: string, amount: number, status = 'Checked out'): QueryRow => ({ date, type: 'Extra charge', name, amount, code: 'X', guest: 'G', status, roomType: 'Queen', room: '101', source: 'Website', checkIn: date, checkOut: date });
  const rows = [charge('2026-01-04', 'Pet fee', 50), charge('2026-01-20', 'Pet fee × 2', 100), charge('2026-02-02', 'Minibar', 12), charge('2026-03-09', 'Pet fee', 50, 'Cancelled')];
  const q: ReportQuery = { dataset: 'charges', from: '2026-01-01', to: '2026-03-31', filters: [{ field: 'name', op: 'contains', value: 'PET FEE' }], groupBy: [{ field: 'date', by: 'month' }], metrics: [{ fn: 'sum', field: 'amount' }, { fn: 'count' }] };
  const r = shapeReport(rows, q);
  assert.deepEqual(
    r.rows.map((x) => [x.date, x.sum_amount, x.count]),
    [
      ['2026-01', 150, 2],
      ['2026-02', 0, 0],
      ['2026-03', 0, 0],
    ]
  );
  assert.deepEqual(r.totals, { date: 'Total', sum_amount: 150, count: 2 });
  assert.equal(queryTitle(q), 'Folio charges by month');
});

test('top guests by spend: group, sort by a metric, keep the first rows', () => {
  const res = (guest: string, total: number, status = 'Checked out'): QueryRow => ({ code: guest.slice(0, 3), guest, status, total, nights: 1 });
  const rows = [res('Ana Lima', 300), res('Ben Okafor', 120), res('Ana Lima', 200), res('Cy Patel', 410), res('Dee No', 900, 'No-show')];
  const r = shapeReport(rows, {
    dataset: 'reservations',
    from: '2026-01-01',
    to: '2026-12-31',
    filters: [{ field: 'status', op: 'not_in', value: ['No-show', 'Cancelled'] }],
    groupBy: [{ field: 'guest' }],
    metrics: [{ fn: 'sum', field: 'total' }, { fn: 'count' }],
    sort: [{ key: 'sum_total', dir: 'desc' }],
    limit: 2,
  });
  assert.deepEqual(
    r.rows.map((x) => [x.guest, x.sum_total, x.count]),
    [
      ['Ana Lima', 500, 2],
      ['Cy Patel', 410, 1],
    ]
  );
  // The total row covers every matching reservation, not only the rows kept.
  assert.deepEqual(r.totals, { guest: 'Total', sum_total: 1030, count: 4 });
});

test('a plain list: its columns, sorted, with money summed and a count in the first column', () => {
  const rows: QueryRow[] = [
    { code: 'B2', guest: 'Ben', status: 'In house', checkIn: '2026-11-05', total: 200, balance: 50 },
    { code: 'A1', guest: 'Ana', status: 'Checked in', checkIn: '2026-11-03', total: 100, balance: 0 },
    { code: 'C3', guest: 'Cy', status: 'Confirmed', checkIn: '2026-11-04', total: 50, balance: 50 },
  ];
  const r = shapeReport(rows, { dataset: 'reservations', from: '2026-11-01', to: '2026-11-30', columns: ['code', 'guest', 'total', 'balance'], filters: [{ field: 'status', op: 'eq', value: 'in house' }] });
  assert.deepEqual(r.columns.map((c) => c.key), ['code', 'guest', 'total', 'balance']);
  // "In house" is "Checked in"; the list is in arrival order.
  assert.deepEqual(r.rows, [
    { code: 'A1', guest: 'Ana', total: 100, balance: 0 },
    { code: 'B2', guest: 'Ben', total: 200, balance: 50 },
  ]);
  assert.deepEqual(r.totals, { code: '2 reservations', guest: null, total: 300, balance: 50 });
});

test('a query that can’t run says what to fix', () => {
  const base = { dataset: 'reservations' as const, from: '2026-11-01', to: '2026-11-30' };
  assert.deepEqual(checkQuery(base), []);
  assert.match(checkQuery({ ...base, from: '2026-12-01' }).join(' '), /from is after to/);
  assert.match(checkQuery({ ...base, metrics: [{ fn: 'sum', field: 'petFee' }] }).join(' '), /“petFee” isn’t a field of reservations/);
  assert.match(checkQuery({ ...base, metrics: [{ fn: 'occupancy' }] }).join(' '), /occupancy is for the nights dataset/);
  assert.match(checkQuery({ ...base, groupBy: [{ field: 'total' }] }).join(' '), /grouping by an amount/);
  assert.match(checkQuery({ ...base, filters: [{ field: 'guest', op: 'gt', value: 'A' }] }).join(' '), /guest is text/);
  assert.match(checkQuery({ ...base, from: '2025-01-01' }).join(' '), /at most 366 days/);
});

test('a report survives a link (base64url JSON), accents and symbols included', () => {
  const q: ReportQuery = { dataset: 'charges', title: 'Café · pet fees', from: '2026-01-01', to: '2026-01-31', filters: [{ field: 'name', op: 'contains', value: 'pet' }] };
  const s = encodeQuery(q);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeQuery(s), q);
});
