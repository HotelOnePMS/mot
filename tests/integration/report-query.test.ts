import { describe, expect, it } from 'vitest';
import { addDaysISO } from '@/server/dates';
import { recordCashPayment } from '@/server/payments/desk';
import { addAllowance, editFolio } from '@/server/services/folio';
import { runQuery } from '@/server/services/report-query';
import { createDeskReservation } from '@/server/services/reservations';
import { transitionBooking } from '@/server/services/bookings';
import { actorFor, makeHotel, makeUser } from './fixtures';

/** Two rooms at 100 with 10% tax. Ana stays two nights with a pet fee and pays cash; Ben's one night is cancelled. */
async function setup() {
  const h = await makeHotel({ rooms: 2, basePrice: 100, charges: [{ name: 'Sales tax', kind: 'PERCENT', amount: 10 }] });
  const ownerUser = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
  const owner = { actor: await actorFor(ownerUser.id), source: 'classic' as const };
  const desk = { actor: await actorFor((await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] })).id), source: 'classic' as const };
  const ana = await createDeskReservation(desk, { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 2), guests: 2, rooms: 1, guest: { firstName: 'Ana', lastName: 'Lima' } });
  await editFolio(owner, ana.id, { target: 'addCharge', name: 'Pet fee', amount: 50, date: h.today });
  await addAllowance(owner, ana.id, { amount: 20, reason: 'Noisy room' });
  await recordCashPayment(desk, ana.id, { kind: 'PAYMENT', amount: 100 });
  const ben = await createDeskReservation(desk, { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: 'Ben', lastName: 'Okafor' } });
  await transitionBooking(desk, ben.id, 'CANCELLED');
  return { h, owner, desk, ana, ben };
}

describe('custom reports on the hotel’s data', () => {
  it('reservations: every one in the range, with the folio’s room, taxes, extras, allowances and balance', async () => {
    const { h, desk, ana } = await setup();
    const r = await runQuery(desk.actor, h.property.id, {
      dataset: 'reservations',
      from: h.today,
      to: h.today,
      columns: ['guest', 'status', 'nights', 'roomRevenue', 'taxes', 'extras', 'extraCharges', 'total', 'allowances', 'paid', 'balance'],
      sort: [{ key: 'guest' }],
    });
    expect(r.rows).toEqual([
      { guest: 'Ana Lima', status: 'Confirmed', nights: 2, roomRevenue: 200, taxes: 20, extras: 50, extraCharges: 'Pet fee', total: 270, allowances: 20, paid: 100, balance: 150 },
      { guest: 'Ben Okafor', status: 'Cancelled', nights: 1, roomRevenue: 100, taxes: 10, extras: 0, extraCharges: null, total: 110, allowances: 0, paid: 0, balance: 0 },
    ]);
    expect(r.title).toBe('Reservations');
    expect(ana.code).toBeTruthy();
  });

  it('nights: occupancy and revenue per night, cancelled stays left out', async () => {
    const { h, desk } = await setup();
    const r = await runQuery(desk.actor, h.property.id, { dataset: 'nights', from: h.today, to: addDaysISO(h.today, 2), groupBy: [{ field: 'date' }], metrics: [{ fn: 'occupancy' }, { fn: 'adr' }, { fn: 'sum', field: 'roomRevenue' }] });
    expect(r.rows).toEqual([
      { date: h.today, occupancy: 50, adr: 100, sum_roomRevenue: 100 },
      { date: addDaysISO(h.today, 1), occupancy: 50, adr: 100, sum_roomRevenue: 100 },
      { date: addDaysISO(h.today, 2), occupancy: 0, adr: 0, sum_roomRevenue: 0 },
    ]);
    expect(r.totals).toMatchObject({ occupancy: 33.3, sum_roomRevenue: 200 });
  });

  it('charges: every folio line by type, an allowance negative', async () => {
    const { h, desk } = await setup();
    const r = await runQuery(desk.actor, h.property.id, { dataset: 'charges', from: h.today, to: h.today, groupBy: [{ field: 'type' }], metrics: [{ fn: 'sum', field: 'amount' }, { fn: 'count' }], sort: [{ key: 'type' }] });
    expect(r.rows).toEqual([
      { type: 'Allowance', sum_amount: -20, count: 1 },
      { type: 'Extra charge', sum_amount: 50, count: 1 },
      { type: 'Room', sum_amount: 200, count: 1 },
      { type: 'Tax or fee', sum_amount: 20, count: 1 },
    ]);
    const pets = await runQuery(desk.actor, h.property.id, { dataset: 'charges', from: h.today, to: h.today, filters: [{ field: 'name', op: 'contains', value: 'pet' }], columns: ['guest', 'name', 'amount'] });
    expect(pets.rows).toEqual([{ guest: 'Ana Lima', name: 'Pet fee', amount: 50 }]);
  });

  it('payments: what was taken, by method', async () => {
    const { h, desk } = await setup();
    const r = await runQuery(desk.actor, h.property.id, { dataset: 'payments', from: h.today, to: h.today, groupBy: [{ field: 'method' }], metrics: [{ fn: 'sum', field: 'amount' }, { fn: 'count' }] });
    expect(r.rows).toEqual([{ method: 'Cash', sum_amount: 100, count: 1 }]);
  });

  it('keeps housekeeping and other hotels out, and says what’s wrong with a query', async () => {
    const { h } = await setup();
    const housekeeper = await actorFor((await makeUser({ role: 'HOUSEKEEPER', propertyIds: [h.property.id] })).id);
    await expect(runQuery(housekeeper, h.property.id, { dataset: 'reservations', from: h.today, to: h.today })).rejects.toMatchObject({ status: 403 });
    const other = await setup();
    await expect(runQuery(other.desk.actor, h.property.id, { dataset: 'reservations', from: h.today, to: h.today })).rejects.toMatchObject({ status: 403 });
    await expect(runQuery(other.desk.actor, other.h.property.id, { dataset: 'reservations', from: h.today, to: h.today, metrics: [{ fn: 'occupancy' }] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/occupancy is for the nights dataset/) });
  });
});
