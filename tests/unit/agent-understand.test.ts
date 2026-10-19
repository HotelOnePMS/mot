import { describe, expect, it } from 'vitest';
import { parseMessage } from '@/server/agent/nlu';
import { guessActions } from '@/server/agent/understand';

const TODAY = '2026-10-19';
const kinds = (m: string) => parseMessage(m, TODAY).map((i) => i.kind);
const first = (m: string) => parseMessage(m, TODAY).find((i) => i.kind !== 'howTo')!;

describe('plain-language requests', () => {
  it('reads "how do I take a customer out of the hotel" as a check-out with an explanation', () => {
    expect(kinds('how do i take a customer out of the hotel')).toEqual(['howTo', 'checkOut']);
    expect(kinds('how to trake acustomer out of hotel')).toEqual(['howTo', 'checkOut']);
    // Nobody named: the agent asks which guest instead of guessing.
    expect(first('how do i take a customer out of the hotel')).toEqual({ kind: 'checkOut', ref: {} });
  });

  it('asks about a guest at the desk, or picks the action when the reason is given', () => {
    expect(parseMessage('customer is at tahe fromnt desk', TODAY)).toEqual([{ kind: 'atDesk', ref: {} }]);
    expect(parseMessage('Grace Okafor is at the front desk', TODAY)).toEqual([{ kind: 'atDesk', ref: { name: 'Grace Okafor' } }]);
    expect(kinds('the guest is at the front desk with their bags')).toEqual(['checkOut']);
  });

  it('maps described situations to actions', () => {
    expect(first('Smith is leaving')).toMatchObject({ kind: 'checkOut', ref: { name: 'Smith' } });
    expect(first('settle the bill for room 204')).toMatchObject({ kind: 'checkOut', ref: { roomNumber: '204' } });
    expect(first('chek out rom 204')).toMatchObject({ kind: 'checkOut', ref: { roomNumber: '204' } });
    expect(first('Mr Smith has arrived')).toMatchObject({ kind: 'checkIn', ref: { name: 'Smith' } });
    expect(first('give the Smiths their keys')).toMatchObject({ kind: 'checkIn', ref: { name: 'Smiths' } });
    expect(first('Smith didnt show up')).toMatchObject({ kind: 'noShow', ref: { name: 'Smith' } });
    expect(first('room 203 is ready')).toMatchObject({ kind: 'roomStatus', roomNumbers: ['203'], status: 'CLEAN' });
    expect(first('room 106 is broken ac leaking')).toMatchObject({ kind: 'outOfOrder', roomNumber: '106', reason: 'broken ac leaking' });
    expect(first('a customer wants a room for 2 nights')).toMatchObject({ kind: 'availability' });
  });

  it('keeps a request without "how" as a plain action', () => {
    expect(kinds('i want to check out Smith')).toEqual(['checkOut']);
  });

  it('leaves questions and existing commands alone', () => {
    expect(kinds('who is leaving today?')).toEqual(['departures']);
    expect(kinds('who has arrived today?')).toEqual(['arrivals']);
    expect(kinds('how do I use this')).toEqual(['help']);
    expect(kinds('take room 106 out of service')).toEqual(['outOfOrder']);
    expect(kinds('check in the Smiths, give them a quiet room on a high floor and note it\'s their anniversary')).toEqual(['checkIn', 'note']);
  });

  it('offers likely actions when nothing matched', () => {
    expect(guessActions('the person with luggage').map((g) => g.label)).toContain('Check a guest out');
  });
});
