import { describe, expect, it } from 'vitest';
import type { BookingStatus, BookingSummary } from '@/lib/dto';
import { CAPABILITIES } from '@/server/agent/policy';
import { codeRef, parseMessage, type Intent } from '@/server/agent/nlu';
import { parseShortcutArgs } from '@/server/agent/skills';
import { bookingActions, planWrite } from '@/server/agent/tools';
import type { Actor, Permission } from '@/server/authz';
import { planTask } from '@/server/pms/intent';
import { fillPlaceholders } from '@/server/skills';

const TODAY = '2026-10-19';
/** About 1 booking in 6 has a code without a digit; some codes spell words the parser knows ("DEPART", "SEARCH"). */
const CODES = ['ABCDEF', 'DEPART', 'SEARCH', 'K7Q2MD', '234567', 'TENANT', 'TENANTS', 'GUESET', 'CUSTMER', 'PEPLE'];

function booking(code: string, status: BookingStatus, checkIn: string, checkOut: string): BookingSummary {
  return {
    id: 'b1',
    code,
    reservationCode: null,
    status,
    propertyId: 'p1',
    propertyName: 'Harbor Inn',
    guest: { id: 'g1', name: 'Grace Okafor', email: 'grace@example.com', phone: null },
    checkIn,
    checkOut,
    nights: 1,
    guests: 2,
    rooms: 1,
    roomType: { id: 'rt1', name: 'Queen' },
    room: null,
    totalPrice: 100,
    currency: 'USD',
    paymentStatus: 'UNPAID',
    amountPaid: 0,
    riskFlags: [],
    notes: null,
    createdAt: `${TODAY}T09:00:00.000Z`,
  };
}

/** The one intent a command parses to. */
function only(command: string): Intent {
  const intents = parseMessage(command, TODAY);
  expect(intents, command).toHaveLength(1);
  return intents[0];
}

const KIND_BY_LABEL: Record<string, Intent['kind']> = {
  Confirm: 'confirm',
  'Check in': 'checkIn',
  'Choose room': 'suggestRooms',
  'Check out': 'checkOut',
  'Add note': 'note',
  'No-show': 'noShow',
  Cancel: 'cancel',
};

describe('commands the agent offers name the booking by its code', () => {
  it('every quick action on a booking reads back as that booking’s code, with no name', () => {
    for (const code of CODES) {
      const states = [booking(code, 'PENDING', TODAY, '2026-10-20'), booking(code, 'CONFIRMED', '2026-10-25', '2026-10-27'), booking(code, 'CHECKED_IN', '2026-10-17', '2026-10-20')];
      const labels = new Set<string>();
      for (const b of states) {
        for (const a of bookingActions(b, TODAY)) {
          labels.add(a.label);
          // "Add note" fills the box; the person types the note after it.
          const command = a.mode === 'prefill' ? `${a.command}late arrival` : a.command;
          const intent = only(command);
          expect(intent.kind, command).toBe(KIND_BY_LABEL[a.label]);
          expect('ref' in intent && intent.ref, command).toEqual({ code });
        }
      }
      expect([...labels].sort()).toEqual(Object.keys(KIND_BY_LABEL).sort());
    }
  });

  it('reads the other offered commands the same way', () => {
    for (const code of CODES) {
      const ref = codeRef(code);
      expect(only(`show reservation ${ref}`), code).toEqual({ kind: 'find', ref: { code } });
      expect(only(`assign room 204 to ${ref}`), code).toMatchObject({ kind: 'assignRoom', ref: { code }, roomNumber: '204' });
      expect(only(`check in ${ref} to room 204`), code).toMatchObject({ kind: 'checkIn', ref: { code }, roomNumber: '204' });
      const move = only(`move ${ref} to another room`);
      expect(move, code).toMatchObject({ kind: 'assignRoom', ref: { code } });
      expect('roomNumber' in move && move.roomNumber, code).toBeFalsy();
      expect('ref' in move && move.ref.name, code).toBeUndefined();
    }
  });

  it('keeps the code when a shortcut runs for it', () => {
    const parameters = { type: 'object' as const, properties: { guest: { type: 'string' as const } }, required: ['guest'] };
    for (const code of CODES) {
      const args = parseShortcutArgs(`for ${codeRef(code)}`, parameters);
      const step = fillPlaceholders('late-checkout', 'add a note to {guest}: late checkout', args);
      expect(only(step), code).toEqual({ kind: 'note', ref: { code }, text: 'Late checkout' });
    }
  });

  it('a PMS-bridged hotel reads "#CODE" as a code too', () => {
    for (const code of CODES) {
      const ref = codeRef(code);
      const plan = (instruction: string) => planTask({ kind: 'ACTION', instruction }, TODAY);
      expect(plan(`check in ${ref}`), code).toMatchObject({ operation: 'check_in', ref: { confirmationCode: code } });
      expect(plan(`check in ${ref} to room 204`), code).toMatchObject({ operation: 'check_in', args: { room_number: '204' }, ref: { confirmationCode: code } });
      expect(plan(`check out ${ref}`), code).toMatchObject({ operation: 'check_out', ref: { confirmationCode: code } });
      expect(plan(`assign room 204 to ${ref}`), code).toMatchObject({ operation: 'assign_room', args: { room_number: '204' }, ref: { confirmationCode: code } });
      expect(plan(`add a note to ${ref}: late arrival`), code).toMatchObject({ operation: 'add_reservation_note', args: { note: 'late arrival' }, ref: { confirmationCode: code } });
      expect(plan(`show reservation ${ref}`), code).toMatchObject({ operation: 'get_reservation', args: { confirmation_code: code, guest_name: undefined } });
    }
    // Without "#", a word is still a name there.
    expect(planTask({ kind: 'ACTION', instruction: 'check in Moreno' }, TODAY)).toMatchObject({ ref: { guestName: 'Moreno' } });
  });
});

describe('refusals point to Agent access', () => {
  const actor = (revoked: Permission[]): Actor => ({
    userId: 'u1',
    role: 'FRONT_DESK',
    name: 'Test',
    email: 't@example.com',
    propertyIds: ['p1'],
    orgAdminOf: [],
    orgIds: [],
    mfaEnabled: false,
    emailVerified: true,
    mfaSetupRequired: false,
    overrides: { granted: [], revoked },
  });
  const ctx = (revoked: Permission[]) => ({ actor: actor(revoked), propertyId: 'p1', propertyName: 'Harbor Inn', today: TODAY, memory: {}, message: '' });
  const ref = { code: 'ABCDEF' };
  const prefs = { tags: [] };
  const cases: [Permission, Intent, string][] = [
    ['booking.checkin', { kind: 'checkIn', ref, prefs }, 'Your role can’t check guests in.'],
    ['booking.checkout', { kind: 'checkOut', ref }, 'Your role can’t check guests out.'],
    ['booking.assignRoom', { kind: 'assignRoom', ref, prefs }, 'Your role can’t assign rooms.'],
    ['booking.assignRoom', { kind: 'assignArrivals', prefs }, 'Your role can’t assign rooms.'],
    ['booking.note', { kind: 'note', ref, text: 'Late arrival' }, 'Your role can’t add notes.'],
    ['room.status', { kind: 'roomStatus', roomNumbers: ['204'], status: 'CLEAN' }, 'Your role can’t change room status.'],
    ['room.outOfOrder', { kind: 'outOfOrder', roomNumber: '204' }, 'Your role can’t take rooms out of order.'],
    ['room.outOfOrder', { kind: 'backInService', roomNumber: '204' }, 'Your role can’t return rooms to service.'],
    ['housekeeping.assign', { kind: 'assignCleaning', roomNumbers: ['204'] }, 'Your role can’t assign housekeeping.'],
    ['housekeeping.assign', { kind: 'autoAssignCleaning' }, 'Your role can’t assign housekeeping.'],
    ['rates.write', { kind: 'adjustRates', percent: 10, ranges: [] }, 'Rate changes are made by managers and owners.'],
  ];

  it('says where the owner changes a permission an Agent access switch controls', async () => {
    for (const [perm, intent, text] of cases) {
      expect(CAPABILITIES.some((c) => c.perms.includes(perm)), perm).toBe(true);
      const out = await planWrite(ctx([perm]), intent);
      expect(out.steps).toEqual([]);
      expect(out.blocks, intent.kind).toEqual([{ type: 'error', text: `${text} The owner can change this under Agent access.` }]);
    }
  });
});
