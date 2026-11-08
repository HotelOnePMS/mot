import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { AgentBlock } from '@/lib/agent/blocks';
import { addDaysISO } from '@/server/dates';
import { confirmPlan } from '@/server/agent/engine';
import { runHarness } from '@/server/agent/harness';
import { askForReport } from '@/server/agent/report-agent';
import { signPlan } from '@/server/agent/plan';
import { answerFromSkills } from '@/server/agent/skills';
import { editFolio, getFolio } from '@/server/services/folio';
import { createDeskReservation } from '@/server/services/reservations';
import { saveSavedCharge } from '@/server/services/saved-charges';
import { actorFor, makeHotel, makeUser } from './fixtures';
import { drain, firstMessage, scriptedClient, toolResults } from './scripted-client';

/** A hotel (Queen, 100 a night, 12% tax), its owner, and Aisha Patel staying two nights: 200 + 24. */
async function setup(opts: { role?: 'OWNER' | 'MANAGER' | 'FRONT_DESK' } = {}) {
  const h = await makeHotel({ rooms: 3, basePrice: 100, charges: [{ name: 'Occupancy tax', kind: 'PERCENT', amount: 12 }] });
  const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
  const ownerActor = await actorFor(owner.id);
  const user = opts.role && opts.role !== 'OWNER' ? await makeUser({ role: opts.role, propertyIds: [h.property.id] }) : owner;
  const actor = await actorFor(user.id);
  const b = await createDeskReservation(
    { actor: ownerActor, source: 'classic' },
    { propertyId: h.property.id, roomTypeId: h.roomType.id, checkIn: h.today, checkOut: addDaysISO(h.today, 2), guests: 2, rooms: 1, guest: { firstName: 'Aisha', lastName: 'Patel' } },
  );
  const ctx = (message: string) => ({ actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message });
  const confirm = async (steps: Awaited<ReturnType<typeof drain>>['result']['steps']) => {
    const { token } = signPlan({ userId: actor.userId, propertyId: h.property.id, title: 'Plan', steps });
    return confirmPlan(actor, token);
  };
  return { h, owner: ownerActor, actor, b, ctx, confirm };
}

const blocksOf = (events: { type: string; block?: AgentBlock }[]) => events.filter((e) => e.type === 'block').map((e) => e.block!);

describe('the agent and the folio', () => {
  it('"make the room and tax together $50": reads the folio, plans one split, and it lands to the cent', async () => {
    const { b, ctx, confirm } = await setup();
    const { client, create } = scriptedClient([
      [{ type: 'tool_use', id: 't1', name: 'get_folio', input: { guest: { name: 'patel' } } }],
      [{ type: 'tool_use', id: 't2', name: 'edit_folio', input: { guest: { code: b.code }, edits: [{ op: 'set_total', lines: ['room', 'charge:0'], amount: 50 }] } }],
      [{ type: 'text', text: 'Room and tax together $50 is ready to confirm.' }],
    ]);
    const { events, result } = await drain(runHarness(ctx('make the room change and tax together 50$ for patel'), { client }));

    // The person sees the live folio; the model gets each line's ref and the tax's percentage.
    expect(blocksOf(events).find((x) => x.type === 'folio')).toMatchObject({ bookingId: b.id, guestName: 'Aisha Patel', total: 224 });
    const folio = JSON.parse(toolResults(create, 1)[0].content);
    expect(folio.lines).toEqual([
      { ref: 'room', type: 'room', name: 'Queen', amount: 200 },
      { ref: 'charge:0', type: 'tax or fee', name: 'Occupancy tax', amount: 24, percentOfRoom: 12 },
    ]);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].summary).toBe(`Make room + “Occupancy tax” on Aisha Patel’s folio (${b.code}) come to $50.00 (was $224.00)`);
    expect(result.steps[0].detail).toBe('room $44.64, “Occupancy tax” $5.36 · stay total $224.00 → $50.00');
    // Planning changes nothing.
    expect(Number((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).totalPrice)).toBe(224);

    const done = await confirm(result.steps);
    expect(done.blocks[0]).toMatchObject({ type: 'result', ok: true, lines: [expect.stringMatching(/^✓ Made room \+ “Occupancy tax”/)] });
    expect(done.blocks.find((x) => x.type === 'folio')).toMatchObject({ bookingId: b.id, total: 50 });
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect([Number(after.totalPrice), Number(after.subtotalPrice)]).toEqual([50, 44.64]);
  });

  it('asks how much when a charge has no usual price, instead of guessing', async () => {
    const { b, ctx } = await setup();
    const { client, create } = scriptedClient([
      [{ type: 'tool_use', id: 't1', name: 'edit_folio', input: { guest: { code: b.code }, edits: [{ op: 'add_charge', name: 'Pet fee' }] } }],
      [{ type: 'text', text: 'How much is the pet fee?' }],
    ]);
    const { events, result } = await drain(runHarness(ctx('add pet fee to patel'), { client }));
    expect(firstMessage(create)).toContain('no usual charges saved yet');
    expect(toolResults(create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/no usual price for “Pet fee”.*Ask the person how much/) });
    expect(result.steps).toHaveLength(0);
    expect(blocksOf(events).at(-1)).toEqual({ type: 'text', text: 'How much is the pet fee?' });
  });

  it('"pet fee is always $50, add one to Patel": remembers the price and uses it in the same plan', async () => {
    const { h, b, ctx, confirm } = await setup();
    const { client } = scriptedClient([
      [
        { type: 'tool_use', id: 't1', name: 'save_charge', input: { name: 'pet fee', amount: 50 } },
        { type: 'tool_use', id: 't2', name: 'edit_folio', input: { guest: { name: 'Patel' }, edits: [{ op: 'add_charge', name: 'pet fee' }] } },
      ],
      [{ type: 'text', text: 'Saved the pet fee at $50 and added one to Aisha Patel, ready to confirm.' }],
    ]);
    const { result } = await drain(runHarness(ctx('pet fee is always 50$, add it to patel'), { client }));
    expect(result.steps.map((s) => s.summary)).toEqual(['Remember Pet fee as $50.00 per stay', `Add Pet fee $50.00 to Aisha Patel’s folio (${b.code})`]);
    expect(result.steps[1].detail).toBe('usual price $50.00 per stay · stay total $224.00 → $274.00');

    const done = await confirm(result.steps);
    expect(done.blocks[0]).toMatchObject({ ok: true, lines: ['✓ Remembered Pet fee as $50.00 per stay', `✓ Added Pet fee $50.00 to Aisha Patel’s folio (${b.code})`] });
    expect(await prisma.savedCharge.findMany({ where: { propertyId: h.property.id }, select: { name: true, amount: true, unit: true } })).toEqual([{ name: 'Pet fee', amount: expect.anything(), unit: 'STAY' }]);
    expect(Number((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).totalPrice)).toBe(274);

    // Next time, the usual price is known up front and used without asking.
    const next = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'edit_folio', input: { guest: { code: b.code }, edits: [{ op: 'add_charge', name: 'Pet fees', quantity: 2 }] } }]]);
    const again = await drain(runHarness(ctx('add 2 pet fees for patel'), { client: next.client }));
    expect(firstMessage(next.create)).toContain('The hotel’s usual charges: Pet fee $50.00 per stay.');
    expect(again.result.steps[0].summary).toBe(`Add Pet fee × 2 $100.00 to Aisha Patel’s folio (${b.code})`);

    // "It's $60 now": the same saved charge changes price.
    const change = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'save_charge', input: { name: 'Pets', amount: 60 } }]]);
    const changed = await drain(runHarness(ctx('pet fee is 60 now'), { client: change.client }));
    expect(changed.result.steps[0].summary).toBe('Change the usual Pet fee to $60.00 per stay (was $50.00 per stay)');
  });

  it('prices a per-night usual charge for the stay', async () => {
    const { h, owner, b, ctx } = await setup();
    await saveSavedCharge({ actor: owner, source: 'classic' }, h.property.id, { name: 'Rollaway bed', amount: 20, unit: 'NIGHT' });
    const { client } = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'edit_folio', input: { guest: { code: b.code }, edits: [{ op: 'add_charge', name: 'rollaway bed' }] } }]]);
    const { result } = await drain(runHarness(ctx('add a rollaway for patel'), { client }));
    expect(result.steps[0].summary).toBe(`Add Rollaway bed $40.00 to Aisha Patel’s folio (${b.code})`);
    expect(result.steps[0].detail).toMatch(/^usual price \$20\.00 per night × 2 nights/);
  });

  it('plans several changes against the folio as each leaves it: indexes shift, nothing goes stale', async () => {
    const { b, owner, ctx, confirm } = await setup();
    await editFolio({ actor: owner, source: 'classic' }, b.id, { target: 'addCharge', name: 'Parking', amount: 15 });
    const { client } = scriptedClient([
      [
        {
          type: 'tool_use',
          id: 't1',
          name: 'edit_folio',
          input: {
            guest: { code: b.code },
            edits: [
              { op: 'remove_charge', line: 'charge:0' },
              { op: 'set_line', line: 'charge:1', amount: 20, name: 'Valet parking' },
              { op: 'add_charge', name: 'Minibar', amount: 8 },
              { op: 'set_line', line: 'room', amount: 180 },
            ],
            reason: 'Guest asked',
          },
        },
      ],
    ]);
    const { result } = await drain(runHarness(ctx('drop the tax, parking is 20 valet, add minibar 8, room 180'), { client }));
    expect(result.steps.map((s) => (s.args as { edit: { target: string; index?: number } }).edit)).toMatchObject([
      { target: 'removeCharge', index: 0, expected: { name: 'Occupancy tax', amount: 24 } },
      { target: 'charge', index: 0, expected: { name: 'Parking', amount: 15 } },
      { target: 'addCharge', name: 'Minibar' },
      { target: 'room', expected: { label: 'Queen', amount: 200 } },
    ]);
    const done = await confirm(result.steps);
    expect(done.blocks[0]).toMatchObject({ ok: true });
    const folio = await getFolio(owner, b.id);
    expect(folio.lines.filter((l) => l.section === 'CHARGES').map((l) => [l.label, l.amount])).toEqual([
      ['Queen', 180],
      ['Valet parking', 20],
      ['Minibar', 8],
    ]);
  });

  it('turns a bad line ref back to the model and plans nothing from that call', async () => {
    const { b, ctx } = await setup();
    const { client, create } = scriptedClient([
      [{ type: 'tool_use', id: 't1', name: 'edit_folio', input: { guest: { code: b.code }, edits: [{ op: 'add_charge', name: 'Minibar', amount: 8 }, { op: 'remove_charge', line: 'charge:7' }] } }],
    ]);
    const { result } = await drain(runHarness(ctx('remove the spa charge'), { client }));
    expect(toolResults(create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/there’s no charge:7 on this folio/) });
    expect(result.steps).toHaveLength(0);
  });

  it('keeps role limits: no folio changes or discounts for staff the owner hasn’t allowed', async () => {
    const { b, ctx } = await setup({ role: 'FRONT_DESK' });
    const { client, create } = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'edit_folio', input: { guest: { code: b.code }, edits: [{ op: 'add_charge', name: 'Pet fee', amount: 50 }] } }]]);
    const { result } = await drain(runHarness(ctx('add pet fee to patel'), { client }));
    expect(toolResults(create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/can’t change folios/) });
    expect(result.steps).toHaveLength(0);
  });

  it('knows the reservation on screen: "add a minibar charge to this guest"', async () => {
    const { b, ctx } = await setup();
    const { client, create } = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'edit_folio', input: { guest: { code: b.code }, edits: [{ op: 'add_charge', name: 'Minibar', amount: 12 }] } }]]);
    const { result } = await drain(runHarness(ctx('add minibar 12 to this guest'), { client, page: `/admin/bookings/${b.id}` }));
    expect(firstMessage(create)).toContain(`On screen: the reservation of Aisha Patel (#${b.code})`);
    expect(result.memory.lastBookingId).toBe(b.id);
    expect(result.steps[0].summary).toMatch(/^Add Minibar \$12\.00 to Aisha Patel’s folio/);

    // Another hotel's reservation id in the page path tells the model nothing about it.
    const other = await setup();
    const leak = scriptedClient([[{ type: 'text', text: 'Which guest?' }]]);
    const r = await drain(runHarness(ctx('this guest'), { client: leak.client, page: `/admin/bookings/${other.b.id}` }));
    expect(firstMessage(leak.create)).toContain('On screen: the Reservations page.');
    expect(firstMessage(leak.create)).not.toContain(other.b.code);
    expect(r.result.memory.lastBookingId).toBeUndefined();
  });

  it('remembers a policy as a staff answer the agent finds later', async () => {
    const { h, actor, ctx, confirm } = await setup();
    const { client } = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'remember', input: { question: 'Until when is late check-out free?', answer: 'Late check-out is free until 1pm; after that it’s $25.' } }]]);
    const { result } = await drain(runHarness(ctx('remember late checkout is free till 1pm, then 25'), { client }));
    expect(result.steps[0]).toMatchObject({ tool: 'remember', summary: 'Remember: “Until when is late check-out free?” Late check-out is free until 1pm; after that it’s $25.' });
    const done = await confirm(result.steps);
    expect(done.blocks[0]).toMatchObject({ ok: true });
    const skill = await prisma.agentSkill.findFirstOrThrow({ where: { propertyId: h.property.id, kind: 'ANSWER', title: 'Until when is late check-out free?' } });
    expect(skill).toMatchObject({ status: 'ACTIVE', audience: 'STAFF', source: 'LEARNED' });
    const ans = await answerFromSkills(actor, h.property.id, 'until when is late check-out free?');
    expect(ans?.blocks[0]).toMatchObject({ type: 'text', text: 'Late check-out is free until 1pm; after that it’s $25.' });
  });
});

describe('custom reports from plain words', () => {
  it('the agent builds a report and shows the table, with the numbers from the hotel’s data', async () => {
    const { h, owner, b, ctx } = await setup();
    await editFolio({ actor: owner, source: 'classic' }, b.id, { target: 'addCharge', name: 'Pet fee', amount: 50, date: h.today });
    const { client, create } = scriptedClient([
      [
        {
          type: 'tool_use',
          id: 't1',
          name: 'run_report',
          input: { dataset: 'charges', title: 'Pet fees', from: h.today, to: h.today, filters: [{ field: 'name', op: 'contains', value: 'pet' }], metrics: [{ fn: 'sum', field: 'amount' }, { fn: 'count' }] },
        },
      ],
      [{ type: 'text', text: 'One pet fee today, $50.' }],
    ]);
    const { events } = await drain(runHarness(ctx('how much did we make in pet fees today'), { client }));
    const report = blocksOf(events).find((x) => x.type === 'report');
    expect(report).toMatchObject({ type: 'report', title: 'Pet fees', rows: [{ sum_amount: 50, count: 1 }], csvHref: expect.stringContaining('/api/admin/reports/query?') });
    expect(JSON.parse(toolResults(create, 1)[0].content)).toMatchObject({ rows: [{ sum_amount: 50, count: 1 }] });

    // A query the engine can't run goes back to the model to fix.
    const bad = scriptedClient([[{ type: 'tool_use', id: 't1', name: 'run_report', input: { dataset: 'charges', from: h.today, to: h.today, metrics: [{ fn: 'occupancy' }] } }]]);
    await drain(runHarness(ctx('occupancy of pet fees'), { client: bad.client }));
    expect(toolResults(bad.create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/occupancy is for the nights dataset/) });
  });

  it('the Reports page’s box: plain words to a query, retrying a query that can’t run', async () => {
    const { h, owner } = await setup();
    const { client, create } = scriptedClient([
      [{ type: 'tool_use', id: 't1', name: 'run_report', input: { dataset: 'nights', from: h.today, to: addDaysISO(h.today, 1), group_by: [{ field: 'date' }], metrics: [{ fn: 'occupancy' }, { fn: 'sum', field: 'petFees' }] } }],
      [
        { type: 'text', text: 'Occupancy for today and tomorrow.' },
        { type: 'tool_use', id: 't2', name: 'run_report', input: { dataset: 'nights', title: 'Occupancy', from: h.today, to: addDaysISO(h.today, 1), group_by: [{ field: 'date' }], metrics: [{ fn: 'occupancy' }] } },
      ],
    ]);
    const out = await askForReport(owner, h.property.id, 'occupancy today and tomorrow', { client });
    expect(create).toHaveBeenCalledTimes(2);
    expect(toolResults(create, 1)[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/“petFees” isn’t a field of nights/) });
    expect(out.note).toBe('Occupancy for today and tomorrow.');
    // Three rooms, Aisha Patel in one of them both nights.
    expect(out.result?.rows).toEqual([
      { date: h.today, occupancy: 33.3 },
      { date: addDaysISO(h.today, 1), occupancy: 33.3 },
    ]);

    // Too vague to be a report: the model's question comes back instead.
    const vague = scriptedClient([[{ type: 'text', text: 'Which dates should it cover?' }]]);
    expect(await askForReport(owner, h.property.id, 'the usual', { client: vague.client })).toEqual({ query: null, result: null, note: 'Which dates should it cover?' });
  });
});
