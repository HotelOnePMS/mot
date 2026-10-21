import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AgentBlock } from '@/lib/agent/blocks';
import { inboundMessages, splitText, templateText, verifySignature } from '@/server/whatsapp/cloud';
import { choiceAt, readChoice, renderBlocks, toWhatsAppMarkup } from '@/server/whatsapp/format';
import { maskNumber, normalizeCode, parseLinkCommand } from '@/server/whatsapp/link';
import { parseChannelCommand } from '@/server/whatsapp/staff';

const secret = 'app-secret';
const sign = (body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const payload = (messages: unknown[], phoneNumberId = 'PNID') => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, messages } }] }],
});

describe('webhook signatures', () => {
  it('accepts Meta’s signature of the exact body', () => {
    const body = JSON.stringify(payload([]));
    expect(verifySignature(body, sign(body), secret)).toBe(true);
  });

  it('refuses a changed body, another secret or a malformed header', () => {
    const body = JSON.stringify(payload([]));
    expect(verifySignature(`${body} `, sign(body), secret)).toBe(false);
    expect(verifySignature(body, sign(body), 'other-secret')).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, 'sha1=abc', secret)).toBe(false);
  });
});

describe('inbound messages', () => {
  it('reads text, button and list replies for our number only', () => {
    const p = payload([
      { id: 'wamid.1', from: '15551230000', type: 'text', text: { body: '  who’s arriving today? ' } },
      { id: 'wamid.2', from: '15551230000', type: 'button', button: { text: 'Show me' } },
      { id: 'wamid.3', from: '15551230000', type: 'interactive', interactive: { list_reply: { title: 'Option' } } },
      { id: 'wamid.4', from: '15551230000', type: 'image' },
    ]);
    expect(inboundMessages(p, 'PNID')).toEqual([
      { id: 'wamid.1', from: '15551230000', text: 'who’s arriving today?', type: 'text' },
      { id: 'wamid.2', from: '15551230000', text: 'Show me', type: 'button' },
      { id: 'wamid.3', from: '15551230000', text: 'Option', type: 'interactive' },
      { id: 'wamid.4', from: '15551230000', text: null, type: 'image' },
    ]);
    expect(inboundMessages(p, 'ANOTHER_NUMBER')).toEqual([]);
  });

  it('reads reactions, and a reaction taken back, as reactions with no text', () => {
    const p = payload([
      { id: 'wamid.5', from: '15551230000', type: 'reaction', reaction: { message_id: 'wamid.plan', emoji: '👍' } },
      { id: 'wamid.6', from: '15551230000', type: 'reaction', reaction: { message_id: 'wamid.plan', emoji: '' } },
      { id: 'wamid.7', from: '15551230000', type: 'reaction', reaction: { message_id: 'wamid.plan' } },
    ]);
    expect(inboundMessages(p, 'PNID')).toStrictEqual([
      { id: 'wamid.5', from: '15551230000', text: null, type: 'reaction', emoji: '👍' },
      { id: 'wamid.6', from: '15551230000', text: null, type: 'reaction', emoji: '' },
      { id: 'wamid.7', from: '15551230000', text: null, type: 'reaction', emoji: '' },
    ]);
  });

  it('ignores status updates and other objects', () => {
    expect(inboundMessages({ object: 'page', entry: [] }, 'PNID')).toEqual([]);
    expect(inboundMessages({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PNID' }, statuses: [{}] } }] }] }, 'PNID')).toEqual([]);
    expect(inboundMessages(payload([{ id: 'x', from: 'not-a-number', text: { body: 'hi' } }]), 'PNID')).toEqual([]);
  });
});

describe('message text', () => {
  it('splits long replies on paragraph boundaries', () => {
    const para = 'x'.repeat(3000);
    const parts = splitText(`${para}\n\n${para}`);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
  });

  it('flattens template variables', () => {
    expect(templateText('*Two* things:\n1. a\t b      c')).toBe('Two things: · 1. a · b   c');
    expect(templateText('y'.repeat(2000)).length).toBe(900);
  });

  it('converts console markdown', () => {
    expect(toWhatsAppMarkup('**Room 204** is [ready](/admin/rooms)', 'https://hotelone.site')).toBe('*Room 204* is ready: https://hotelone.site/admin/rooms');
  });
});

describe('linking codes', () => {
  it('reads LINK commands however the code is typed', () => {
    expect(parseLinkCommand('LINK AB3D-K7MQ')).toBe('AB3DK7MQ');
    expect(parseLinkCommand('link ab3d k7mq')).toBe('AB3DK7MQ');
    expect(parseLinkCommand('link me up')).toBeNull();
    expect(parseLinkCommand('check in Smith')).toBeNull();
    expect(normalizeCode('ab3d-k7mq')).toBe('AB3DK7MQ');
  });

  it('masks numbers', () => {
    expect(maskNumber('18315550100')).toBe('+1 ••• 0100');
    expect(maskNumber('447946000000')).toBe('+44 ••• 0000');
  });
});

describe('chat commands', () => {
  it('handles confirmations, numbers and settings in the chat', () => {
    expect(parseChannelCommand('YES')).toEqual({ kind: 'yes' });
    expect(parseChannelCommand('yes!')).toEqual({ kind: 'yes' });
    expect(parseChannelCommand('cancel')).toEqual({ kind: 'no' });
    expect(parseChannelCommand('2')).toEqual({ kind: 'pick', n: 2 });
    expect(parseChannelCommand('switch to Harbor Inn')).toEqual({ kind: 'switch', name: 'Harbor Inn' });
    expect(parseChannelCommand('alerts off')).toEqual({ kind: 'alerts', on: false });
    expect(parseChannelCommand('unmute')).toEqual({ kind: 'alerts', on: true });
    expect(parseChannelCommand('Show me')).toEqual({ kind: 'details' });
    expect(parseChannelCommand('UNLINK')).toEqual({ kind: 'unlink' });
  });

  it('reads the usual ways of saying yes and no', () => {
    for (const t of ['yes please', 'Yes, go ahead', 'yes do it', 'yes!', 'Yep', 'confirm', 'confirm it', 'go ahead please', 'ok, go ahead', 'Yes 👍']) expect(parseChannelCommand(t), t).toEqual({ kind: 'yes' });
    for (const t of ['no thanks', 'No, cancel', 'nope', 'cancel that', 'don’t']) expect(parseChannelCommand(t), t).toEqual({ kind: 'no' });
  });

  it('takes thanks and OKs as acknowledgements, never as YES', () => {
    for (const t of ['ok', 'OK.', 'okay', 'sure', 'thanks', 'Thank you!', 'thanks 🙏', 'great, thanks', 'perfect', 'cool', 'got it', 'ok thank you so much', '👍', '🙏🏽', '👌👌']) {
      expect(parseChannelCommand(t), t).toEqual({ kind: 'ack' });
    }
  });

  it('reads the hotel’s name without trailing punctuation', () => {
    expect(parseChannelCommand('switch to Harbor Inn?')).toEqual({ kind: 'switch', name: 'Harbor Inn' });
    expect(parseChannelCommand('Switch to harbor inn downtown!')).toEqual({ kind: 'switch', name: 'harbor inn downtown' });
    expect(parseChannelCommand('switch to ??')).toEqual({ kind: 'hotels' });
  });

  it('leaves everything else to the agent', () => {
    expect(parseChannelCommand('yes check in Smith')).toBeNull();
    expect(parseChannelCommand('ok check in Smith')).toBeNull();
    expect(parseChannelCommand('thanks, who’s arriving today?')).toBeNull();
    expect(parseChannelCommand('good morning')).toBeNull();
    expect(parseChannelCommand('10')).toBeNull();
    expect(parseChannelCommand('who’s arriving today?')).toBeNull();
  });

  it('carries the hotel with an alert’s numbered reply', () => {
    expect(readChoice(choiceAt('p1', 'check out Smith'))).toEqual({ at: 'p1', command: 'check out Smith' });
    expect(readChoice('#hotel:p2')).toEqual({ hotel: 'p2' });
    expect(readChoice('brief me')).toEqual({ at: null, command: 'brief me' });
  });
});

describe('agent blocks as WhatsApp text', () => {
  const opts = { currency: 'USD', siteUrl: 'https://hotelone.site' };

  it('asks for YES on a plan and offers no competing numbers', () => {
    const blocks: AgentBlock[] = [
      { type: 'plan', plan: { token: 'tok', title: 'Check in Rosa Diaz → 101', steps: [{ summary: 'Check in Rosa Diaz → 101' }], warnings: ['Room 101 is still dirty'], risk: 'medium', confirmLabel: 'Confirm', expiresAt: '' } },
      { type: 'suggestions', items: ['who else is arriving today?'] },
    ];
    const r = renderBlocks(blocks, opts);
    expect(r.planToken).toBe('tok');
    expect(r.text).toContain('Reply *YES*');
    expect(r.text).toContain('⚠️ Room 101 is still dirty');
    expect(r.choices).toEqual([]);
  });

  it('numbers clarifying options and follow-ups in one sequence', () => {
    const blocks: AgentBlock[] = [
      { type: 'clarify', question: 'Which **Smith**?', options: [{ label: 'Jordan Smith', command: 'check in ABC123' }, { label: 'Ana Smith', command: 'check in XYZ789' }] },
      { type: 'suggestions', items: ['brief me', 'check in ABC123'] },
    ];
    const r = renderBlocks(blocks, opts);
    expect(r.choices).toEqual(['check in ABC123', 'check in XYZ789', 'brief me']);
    expect(r.text).toContain('Which *Smith*?');
    expect(r.text).toContain('1. Jordan Smith');
    expect(r.text).toContain('3. brief me');
    expect(r.planToken).toBeNull();
  });

  it('numbers its replies after ones already offered above it', () => {
    const r = renderBlocks([{ type: 'suggestions', items: ['brief me', 'who’s arriving today?'] }], { ...opts, offered: [choiceAt('p1', 'assign rooms')] });
    expect(r.text).toContain('2. brief me');
    expect(r.text).toContain('3. who’s arriving today?');
    expect(r.choices).toEqual([choiceAt('p1', 'assign rooms'), 'brief me', 'who’s arriving today?']);
  });

  it('makes console links absolute', () => {
    const r = renderBlocks([{ type: 'navigate', label: 'Open full activity log', href: '/admin/activity' }], opts);
    expect(r.text).toBe('Open full activity log: https://hotelone.site/admin/activity');
  });
});
