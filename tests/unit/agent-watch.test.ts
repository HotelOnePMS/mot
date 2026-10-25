import { describe, expect, it } from 'vitest';
import type { AgentBlock } from '@/lib/agent/blocks';
import { alertMessage, roundMessage, withHeld, type Notice } from '@/server/agent/watch';
import { choiceAt } from '@/server/whatsapp/format';

const harbor = { id: 'p1', name: 'Harbor Inn', currency: 'USD' };
const bay = { id: 'p2', name: 'Bay Lodge', currency: 'USD' };

/** A brief whose alerts each offer a command at the hotel (as briefFor leaves them). */
const brief = (hotelId: string, commands: string[]): AgentBlock[] => [
  { type: 'text', text: 'Here’s the hotel right now.' },
  { type: 'alerts', items: commands.map((c, i) => ({ id: `a${i}`, tone: 'info' as const, title: `Alert ${c}`, command: choiceAt(hotelId, c) })) },
];
const fix = (key: string, command: string): Notice => ({ key, kind: 'frontdesk', urgent: false, title: `Title ${key}`, action: { label: command, command } });
const message = (key: string): Notice => ({ key, kind: 'guestRequests', urgent: false, title: `Message ${key}`, href: '/admin/voice#messages' });

describe('one message a round', () => {
  it('numbers the briefs and alerts of several hotels straight through', () => {
    const m = roundMessage(
      [
        { hotel: harbor, brief: brief('p1', ['assign rooms']), notices: [fix('n1', 'check out Smith')] },
        { hotel: bay, brief: brief('p2', ['assign rooms']), notices: [message('n2')] },
      ],
      'https://hotelone.site'
    );
    expect(m.choices).toEqual([choiceAt('p1', 'assign rooms'), choiceAt('p2', 'assign rooms'), choiceAt('p1', 'check out Smith')]);
    expect(m.text).toMatch(/Good morning — Harbor Inn[\s\S]*\(reply 1\)[\s\S]*Good morning — Bay Lodge[\s\S]*\(reply 2\)[\s\S]*Reply \*3\* to: check out Smith/);
    expect(m.text).toContain('https://hotelone.site/admin/voice#messages');
    expect(m.hotels).toBe('Harbor Inn and 1 more hotel');
    expect(m.summary).toBe('your morning briefs are ready; Title n1; Message n2');
  });

  it('numbers nine replies at most, and shows the rest as commands to send', () => {
    const m = roundMessage([{ hotel: harbor, brief: brief('p1', ['a', 'b', 'c', 'd', 'e', 'f', 'g']), notices: [fix('n1', 'one'), fix('n2', 'two'), fix('n3', 'three')] }], null, 0, [], 'p1');
    expect(m.choices).toHaveLength(9);
    expect(m.text).toContain('Reply *8* to: one');
    expect(m.text).toContain('Reply *9* to: two');
    expect(m.text).toContain('Send “three”');
    expect(m.hotels).toBe('Harbor Inn');
  });

  it('says how many alerts come next, with no numbers to replace when there are none', () => {
    const m = roundMessage([{ hotel: harbor, notices: [message('n1')] }, { hotel: bay, notices: [] }], null, 3);
    expect(m.text).toContain('…and 3 more. I’ll send them in my next message.');
    expect(m.text).not.toContain('brief me');
    expect(m.text).not.toContain('Bay Lodge');
    expect(m.choices).toEqual([]);
    expect(m.hotels).toBe('Harbor Inn');
    expect(m.summary).toBe('Message n1; 3 more');
  });

  it('numbers on from an alert the person hasn’t read yet, and keeps its replies first', () => {
    const unread = [choiceAt('p1', 'assign rooms'), choiceAt('p1', 'check out Smith')];
    const m = roundMessage([{ hotel: harbor, brief: brief('p1', ['assign rooms', 'confirm Lee']), notices: [fix('n1', 'check out Jones')] }], null, 0, unread);
    // The same fix at the same hotel keeps its number.
    expect(m.text).toContain('Alert assign rooms (reply 1)');
    expect(m.text).toContain('Alert confirm Lee (reply 3)');
    expect(m.text).toContain('Reply *4* to: check out Jones');
    expect(m.choices).toEqual([...unread, choiceAt('p1', 'confirm Lee'), choiceAt('p1', 'check out Jones')]);
    // The template still describes only what's new.
    expect(m.summary).toBe('your morning brief is ready; Title n1');
  });

  it('counts an unread alert’s replies towards the nine', () => {
    const unread = Array.from({ length: 8 }, (_, i) => choiceAt('p1', `fix ${i}`));
    const m = roundMessage([{ hotel: harbor, notices: [fix('n1', 'one'), fix('n2', 'two')] }], null, 0, unread, 'p1');
    expect(m.text).toContain('Reply *9* to: one');
    expect(m.text).toContain('Send “two”');
    expect(m.choices).toEqual([...unread, choiceAt('p1', 'one')]);

    const full = roundMessage([{ hotel: harbor, brief: brief('p1', ['assign rooms']), notices: [fix('n1', 'one')] }], null, 0, [...unread, choiceAt('p1', 'fix 8')], 'p1');
    expect(full.text).not.toMatch(/reply \d|Reply \*/);
    expect(full.text).toContain('Send “one”');
    expect(full.choices).toHaveLength(9);
  });

  it('past nine, tells them to switch hotel first for an alert about another hotel', () => {
    const unread = Array.from({ length: 9 }, (_, i) => choiceAt('p1', `fix ${i}`));
    // The chat is on Harbor Inn: a command sent as text would run there.
    const m = roundMessage([{ hotel: harbor, notices: [fix('n1', 'one')] }, { hotel: bay, notices: [fix('n2', 'two')] }], null, 0, unread, 'p1');
    expect(m.text).toContain('Send “one”');
    expect(m.text).toContain('Send “switch to Bay Lodge”, then “two”');
    // Not knowing which hotel the chat is on, every one says so.
    expect(roundMessage([{ hotel: harbor, notices: [fix('n1', 'one')] }], null, 0, unread).text).toContain('Send “switch to Harbor Inn”, then “one”');
  });

  it('adds a round to an unread alert, numbering on, and starts over when it wouldn’t fit', () => {
    const first = roundMessage([{ hotel: harbor, notices: [fix('n1', 'one')] }], null);
    const both = withHeld({ text: first.text, choices: first.choices }, [{ hotel: harbor, notices: [fix('n2', 'two')] }], null, 0, 'p1');
    expect(both.text).toMatch(/Reply \*1\* to: one[\s\S]*Reply \*2\* to: two/);
    expect(both.choices).toEqual([choiceAt('p1', 'one'), choiceAt('p1', 'two')]);
    expect(both.summary).toBe('Title n2');

    // Past nine numbers, the newest round replaces it, numbered from 1, so its fixes still have numbers.
    const nine = { text: 'Earlier alerts', choices: Array.from({ length: 9 }, (_, i) => choiceAt('p1', `fix ${i}`)) };
    const fresh = withHeld(nine, [{ hotel: harbor, notices: [fix('n3', 'three')] }], null, 0, 'p1');
    expect(fresh.text).not.toContain('Earlier alerts\n');
    expect(fresh.text).toContain('left out to keep this short');
    expect(fresh.text).toContain('Reply *1* to: three');
    expect(fresh.choices).toEqual([choiceAt('p1', 'three')]);

    // So does a held alert that has grown too long.
    const long = withHeld({ text: 'x'.repeat(12_000), choices: [] }, [{ hotel: harbor, notices: [message('n4')] }], null, 0, 'p1');
    expect(long.text.length).toBeLessThan(1000);
    expect(long.text).toContain('Message n4');

    // Nothing unread: just the round.
    expect(withHeld(null, [{ hotel: harbor, notices: [fix('n5', 'five')] }], null, 0, 'p1').text).toBe(roundMessage([{ hotel: harbor, notices: [fix('n5', 'five')] }], null, 0, [], 'p1').text);
  });

  it('continues an alert’s numbers from the ones already used', () => {
    const m = alertMessage('Harbor Inn', [fix('n1', 'check out Smith')], null, 'p1', { numbered: 2 });
    expect(m.text).toContain('Reply *3* to: check out Smith');
    expect(m.choices).toEqual([choiceAt('p1', 'check out Smith')]);
  });
});
