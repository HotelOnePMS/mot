import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import type { AgentEvent } from '@/lib/agent/blocks';
import { addDaysISO, dayOfWeek } from '@/server/dates';
import { confirmPlan } from '@/server/agent/engine';
import { createDeskReservation } from '@/server/services/reservations';
import { runHarness, type HarnessResult } from '@/server/agent/harness';
import { signPlan } from '@/server/agent/plan';
import { nightlyRates } from '@/server/services/inventory';
import { actorFor, makeHotel, makeUser } from './fixtures';

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };

/** A stand-in for the Anthropic client that replays a scripted conversation and records what it was sent. */
function scriptedClient(rounds: Block[][]) {
  const sent: unknown[][] = [];
  const create = vi.fn(async (params: { messages: unknown[] }) => {
    const i = create.mock.calls.length - 1;
    const content = rounds[i] ?? [{ type: 'text', text: 'Done.' }];
    // The harness keeps appending to one array: copy what this round saw.
    sent.push([...params.messages]);
    return { content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create: Object.assign(create, { sent }) };
}

async function drain(gen: AsyncGenerator<AgentEvent, HarnessResult>) {
  const events: AgentEvent[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done) return { events, result: r.value };
    events.push(r.value);
  }
}

/** The tool_result blocks the harness sent back on a given round. */
function toolResults(create: ReturnType<typeof scriptedClient>['create'], round: number) {
  const messages = create.sent[round] as { role: string; content: unknown }[];
  return messages[messages.length - 1].content as { tool_use_id: string; content: string; is_error?: boolean }[];
}

describe('model-driven agent harness', () => {
  it('turns a pasted rate table into one plan that sets exact prices once confirmed', async () => {
    const h = await makeHotel({ basePrice: 189 });
    const king = await prisma.roomType.create({ data: { propertyId: h.property.id, name: 'Ocean King', capacity: 2, basePrice: 347, totalRooms: 1, amenities: [] } });
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
    const actor = await actorFor(manager.id);
    const ctx = { actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message: 'make these changes' };

    const from = addDaysISO(h.today, 7);
    const to = addDaysISO(h.today, 20);
    const fri = [addDaysISO(h.today, 10), addDaysISO(h.today, 11)];
    const { client, create } = scriptedClient([
      [{ type: 'text', text: 'Checking room types.' }, { type: 'tool_use', id: 't1', name: 'list_room_types', input: {} }],
      [
        {
          type: 'tool_use',
          id: 't2',
          name: 'set_rates',
          input: {
            changes: [
              { room_type: 'Queen', from, to, weekdays: [0, 1, 2, 3, 4], price: 169 },
              { room_type: 'ocean king', nights: fri, price: 312 },
            ],
          },
        },
      ],
      [{ type: 'text', text: 'Both rate changes are ready for you to confirm.' }],
    ]);

    const { events, result } = await drain(runHarness(ctx, { client }));
    expect(create).toHaveBeenCalledTimes(3);
    expect(JSON.parse(toolResults(create, 1)[0].content).roomTypes.map((r: { name: string }) => r.name)).toEqual(['Queen', 'Ocean King']);
    expect(toolResults(create, 2)[0].content).toMatch(/NOT done yet/);

    // Nothing changed yet: planning never writes.
    expect(await prisma.roomTypeRate.count({ where: { roomTypeId: { in: [h.roomType.id, king.id] } } })).toBe(0);
    expect(result.steps.map((s) => s.tool)).toEqual(['set_rates', 'set_rates']);
    expect(result.steps[0].summary).toMatch(/Queen .*\$189 → \$169/);
    expect(result.steps[1].summary).toMatch(/Ocean King .*\$347 → \$312/);
    expect(events.at(-1)).toEqual({ type: 'block', block: { type: 'text', text: 'Both rate changes are ready for you to confirm.' } });

    const { token } = signPlan({ userId: actor.userId, propertyId: h.property.id, title: 'Update rates', steps: result.steps });
    const confirmed = await confirmPlan(actor, token);
    expect(confirmed.blocks[0]).toMatchObject({ type: 'result', ok: true });

    const queen = await nightlyRates(prisma, h.roomType.id, from, addDaysISO(to, 1));
    for (const n of queen) expect(n.price).toBe(dayOfWeek(n.date) <= 4 ? 169 : 189);
    const kingRates = await nightlyRates(prisma, king.id, fri[0], addDaysISO(fri[1], 2));
    expect(kingRates.map((n) => n.price)).toEqual([312, 312, 347]);
  });

  it('hands bad input back to the model instead of guessing', async () => {
    const h = await makeHotel();
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
    const actor = await actorFor(manager.id);
    const ctx = { actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message: 'set penthouse to 500' };
    const { client, create } = scriptedClient([
      [{ type: 'tool_use', id: 't1', name: 'set_rates', input: { changes: [{ room_type: 'Penthouse', from: addDaysISO(h.today, 1), to: addDaysISO(h.today, 2), price: 500 }] } }],
      [{ type: 'text', text: 'There is no Penthouse here.' }],
    ]);
    const { result } = await drain(runHarness(ctx, { client }));
    const [r] = toolResults(create, 1);
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/No single room type matches “Penthouse”.*Queen/);
    expect(result.steps).toHaveLength(0);
  });

  it('keeps role limits: front desk cannot plan rate changes', async () => {
    const h = await makeHotel();
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const actor = await actorFor(desk.id);
    const ctx = { actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message: 'lower rates' };
    const { client, create } = scriptedClient([
      [{ type: 'tool_use', id: 't1', name: 'set_rates', input: { changes: [{ room_type: 'Queen', from: addDaysISO(h.today, 1), to: addDaysISO(h.today, 2), percent: -10 }] } }],
    ]);
    const { result } = await drain(runHarness(ctx, { client }));
    expect(toolResults(create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/managers and owners/) });
    expect(result.steps).toHaveLength(0);
  });

  it('plans a reservation and a check-in through the same tools', async () => {
    const h = await makeHotel({ rooms: 3 });
    const manager = await makeUser({ role: 'MANAGER', propertyIds: [h.property.id] });
    const actor = await actorFor(manager.id);
    const ctx = { actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message: 'book Ana Lima tonight and check her in' };
    const { client } = scriptedClient([
      [
        {
          type: 'tool_use',
          id: 't1',
          name: 'create_reservation',
          input: { room_type: 'Queen', check_in: h.today, check_out: addDaysISO(h.today, 2), guests: 2, first_name: 'Ana', last_name: 'Lima', email: 'ana@example.org' },
        },
      ],
    ]);
    const { result } = await drain(runHarness(ctx, { client }));
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].summary).toMatch(/Book Ana Lima · Queen/);
    const { token } = signPlan({ userId: actor.userId, propertyId: h.property.id, title: 'Book', steps: result.steps });
    const confirmed = await confirmPlan(actor, token);
    expect(confirmed.blocks[0]).toMatchObject({ type: 'result', ok: true });
    expect(confirmed.blocks.find((b) => b.type === 'booking')).toBeDefined();
  });

  it('follows up on what it just showed: "yeah add ped fee to patel" becomes a confirmed folio charge', async () => {
    const h = await makeHotel({ rooms: 3, basePrice: 347 });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const actor = await actorFor(owner.id);
    const b = await createDeskReservation(
      { actor, source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 2, rooms: 1, guest: { firstName: 'Aisha', lastName: 'Patel' } },
    );
    const lastReply = `Arrivals today:\n- Aisha Patel (#${b.code}) · Queen · no room · ${h.today}→${addDaysISO(h.today, 1)} · confirmed`;
    const ctx = { actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message: 'yreah add ped fee to patel' };
    const { client, create } = scriptedClient([
      [{ type: 'tool_use', id: 't1', name: 'edit_folio', input: { guest: { name: 'patel' }, edits: [{ op: 'add_charge', name: 'Pet fee', amount: 50 }] } }],
      [{ type: 'text', text: 'A $50 pet fee for Aisha Patel is ready to confirm.' }],
    ]);
    const { result } = await drain(runHarness(ctx, { client, recent: ['add pet fee to the todays adrrival guy'], lastReply }));

    // The model saw the earlier ask and what the agent showed, not just the bare follow-up.
    const first = (create.sent[0][0] as { content: string }).content;
    expect(first).toContain('add pet fee to the todays adrrival guy');
    expect(first).toContain(`Aisha Patel (#${b.code})`);
    expect(first).toMatch(/yreah add ped fee to patel$/);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].summary).toMatch(/Add Pet fee \$50\.00 to Aisha Patel’s folio/);
    const before = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });

    const { token } = signPlan({ userId: actor.userId, propertyId: h.property.id, title: 'Pet fee', steps: result.steps });
    const confirmed = await confirmPlan(actor, token);
    expect(confirmed.blocks[0]).toMatchObject({ type: 'result', ok: true });
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(Number(after.totalPrice)).toBeCloseTo(Number(before.totalPrice) + 50);
    expect(JSON.stringify(after.charges)).toContain('Pet fee');
  });

  it('refuses folio charges for a role the owner has not allowed', async () => {
    const h = await makeHotel();
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const desk = await makeUser({ role: 'FRONT_DESK', propertyIds: [h.property.id] });
    const b = await createDeskReservation(
      { actor: await actorFor(owner.id), source: 'classic' },
      { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 1), guests: 1, rooms: 1, guest: { firstName: 'Aisha', lastName: 'Patel' } },
    );
    const actor = await actorFor(desk.id);
    const ctx = { actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message: 'add pet fee to patel' };
    const { client, create } = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'edit_folio', input: { guest: { code: b.code }, edits: [{ op: 'add_charge', name: 'Pet fee', amount: 50 }] } }]]);
    const { result } = await drain(runHarness(ctx, { client }));
    expect(toolResults(create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/can’t change folios/) });
    expect(result.steps).toHaveLength(0);
  });
});
