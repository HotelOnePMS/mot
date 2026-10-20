import { test } from 'vitest';
import assert from 'node:assert/strict';
import { linesFromParams, normalizeLines, setLineParams, splitParty } from '../../src/lib/booking-lines';

test('the party fills each room type in order, at least one guest each', () => {
  assert.deepEqual(splitParty(5, [{ rooms: 1, capacity: 2 }, { rooms: 1, capacity: 4 }]), [2, 3]);
  assert.deepEqual(splitParty(2, [{ rooms: 1, capacity: 2 }, { rooms: 1, capacity: 4 }]), [1, 1]);
  assert.deepEqual(splitParty(3, [{ rooms: 2, capacity: 2 }]), [3]);
});

test('a party that does not fit, or is smaller than the room types, has no split', () => {
  assert.equal(splitParty(7, [{ rooms: 1, capacity: 2 }, { rooms: 1, capacity: 4 }]), null);
  assert.equal(splitParty(1, [{ rooms: 1, capacity: 2 }, { rooms: 1, capacity: 4 }]), null);
  assert.equal(splitParty(1, []), null);
});

test('lines merge repeats of a room type and survive the URL', () => {
  const lines = normalizeLines([
    { roomTypeId: 'a', rooms: 1 },
    { roomTypeId: 'b', rooms: 2 },
    { roomTypeId: 'a', rooms: 1 },
  ]);
  assert.deepEqual(lines, [
    { roomTypeId: 'a', rooms: 2 },
    { roomTypeId: 'b', rooms: 2 },
  ]);
  const q = setLineParams(new URLSearchParams(), lines);
  assert.equal(q.get('rooms'), '4');
  assert.deepEqual(linesFromParams(q), lines);
  // One room type keeps the familiar single-room link.
  assert.equal(setLineParams(new URLSearchParams(), [{ roomTypeId: 'a', rooms: 3 }]).toString(), 'roomTypeId=a&rooms=3');
});
