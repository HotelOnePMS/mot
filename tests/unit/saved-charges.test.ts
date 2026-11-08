import { test } from 'vitest';
import assert from 'node:assert/strict';
import { describeSavedCharge, findSavedCharge, matchSavedCharge, savedChargeTotal } from '../../src/lib/saved-charges';

const list = [
  { id: '1', name: 'Pet fee', amount: 50, unit: 'STAY' as const, note: null },
  { id: '2', name: 'Rollaway bed', amount: 20, unit: 'NIGHT' as const, note: null },
  { id: '3', name: 'Late check-out', amount: 25, unit: 'STAY' as const, note: null },
  { id: '4', name: 'Water bottle', amount: 3, unit: 'ITEM' as const, note: null },
];

test('a usual charge is found by its name however it’s typed', () => {
  assert.equal(findSavedCharge(list, 'pet fee')?.id, '1');
  assert.equal(findSavedCharge(list, 'PET FEES')?.id, '1');
  assert.equal(findSavedCharge(list, 'pets')?.id, '1');
  assert.equal(findSavedCharge(list, 'the pet charge')?.id, '1');
  assert.equal(findSavedCharge(list, 'late check out')?.id, '3');
});

test('finding is strict: another charge that shares a word is not the one asked for', () => {
  assert.equal(findSavedCharge(list, 'pet deposit'), null);
  assert.equal(findSavedCharge(list, 'rollaway'), null);
  // The looser match (used where a person picks from a list) also takes a name it contains.
  assert.equal(matchSavedCharge(list, 'rollaway')?.id, '2');
  assert.equal(findSavedCharge([...list, { id: '5', name: 'Pet Fee', amount: 60, unit: 'STAY' as const, note: null }], 'pet fee'), null, 'two with one name: neither');
});

test('a usual charge comes to its price per stay, per night of the stay, or each, times how many', () => {
  assert.equal(savedChargeTotal(list[0], { nights: 3 }), 50);
  assert.equal(savedChargeTotal(list[0], { nights: 3 }, 2), 100);
  assert.equal(savedChargeTotal(list[1], { nights: 3 }), 60);
  assert.equal(savedChargeTotal(list[1], { nights: 3 }, 2), 120);
  assert.equal(savedChargeTotal(list[3], { nights: 3 }, 4), 12);
  assert.equal(savedChargeTotal({ amount: 1000, unit: 'NIGHT' }, { nights: 2 }, 1, 'JPY'), 2000);
  assert.equal(describeSavedCharge(list[0], 'USD'), '$50.00 per stay');
  assert.equal(describeSavedCharge(list[1], 'USD'), '$20.00 per night');
});
