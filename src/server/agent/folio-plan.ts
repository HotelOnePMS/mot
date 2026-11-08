/**
 * The agent's folio tools: what get_folio shows the model, and the planner behind edit_folio.
 *
 * A plan's folio changes run one after another once the person confirms, and each is checked against what the folio
 * held when it was planned (FolioEdit `expected`, so nothing is changed on top of someone else's edit). So the planner
 * keeps a copy of the folio, applies each change to it in order, and writes every step against the folio as the steps
 * before it will have left it. The model names lines as get_folio showed them ("room", "charge:<n>"), even after an
 * earlier change in the same plan moved them.
 *
 * Charges asked for by name without an amount use the hotel's usual price for them (saved charges), including one
 * saved earlier in the same plan ("pet fee is always $50, add one to Patel"). With no usual price the model is told to
 * ask the person instead of guessing.
 */
import { z } from 'zod/v4';
import type { AgentBlock, AgentContextState } from '@/lib/agent/blocks';
import { currencyDigits, roundMoney, toMinorUnits } from '@/lib/currency';
import { splitTotal, type FolioEdit, type FolioEditTarget, type FolioView } from '@/lib/folio';
import { describeSavedCharge, findSavedCharge, type SavedChargeView } from '@/lib/saved-charges';
import { money } from '@/lib/status';
import { can, canAtProperty } from '../authz';
import { getFolio } from '../services/folio';
import { HarnessInputError } from './input-error';
import type { PlanStep } from './plan';
import type { resolveBooking } from './resolve';
import type { PlanOutput, ToolCtx } from './tools';

export type ResolvedBooking = Extract<Awaited<ReturnType<typeof resolveBooking>>, { ok: true }>['value'];

// ---------------------------------------------------------------------------
// Tool input
// ---------------------------------------------------------------------------

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const lineRef = z.string().regex(/^(room|charge:\d{1,3})$/, 'Use a line ref from get_folio: "room" or "charge:<n>".');

export const folioOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_charge'),
    name: z.string().min(1).max(80).describe('What it’s for, as it should read on the folio, e.g. "Pet fee".'),
    amount: z.number().positive().max(100_000).optional().describe('Price of one, in the hotel’s currency. Leave out to use the hotel’s usual price for this charge.'),
    quantity: z.number().int().min(1).max(50).optional().describe('How many (two pets → 2). Default 1.'),
    date: day.optional().describe('The day it’s for, when that matters.'),
  }),
  z.object({
    op: z.literal('set_line'),
    line: lineRef,
    amount: z.number().min(0).max(1_000_000).optional().describe('The line’s new amount.'),
    name: z.string().min(1).max(120).optional().describe('New description (for "room": what the room line reads).'),
    date: day.nullable().optional().describe('Charges only: the day it’s for; null clears it.'),
  }),
  z.object({ op: z.literal('remove_charge'), line: z.string().regex(/^charge:\d{1,3}$/, 'Use a charge ref from get_folio: "charge:<n>".') }),
  z.object({
    op: z.literal('set_total'),
    lines: z.array(lineRef).min(1).max(51).describe('The lines that together should come to `amount`, e.g. ["room", "charge:0"] for “room and tax together”.'),
    amount: z.number().positive().max(1_000_000),
  }),
  z.object({
    op: z.literal('discount'),
    amount: z.number().positive().max(1_000_000).describe('How much to take off the stay.'),
    reason: z.string().min(3).max(200).describe('Why, as the folio should say it ("AC broken", "left a night early").'),
  }),
]);

export type FolioOp = z.infer<typeof folioOpSchema>;

// ---------------------------------------------------------------------------
// The folio as the plan will leave it
// ---------------------------------------------------------------------------

interface SimCharge {
  /** The ref get_folio showed for it (charge:<n>); null for a charge this plan adds. */
  orig: string | null;
  name: string;
  minor: number;
  /** Percentage of the room (it moves with the room in set_total), or null for a fixed amount. */
  percent: number | null;
  date: string | null;
}

interface FolioSim {
  currency: string;
  nights: number;
  roomLabel: string;
  roomMinor: number;
  charges: SimCharge[];
  /** Allowances on the folio now and the ones this plan adds (minor units). */
  allowanceMinor: number;
  saved: SavedChargeView[];
}

/** What the writes of one message (or one advisor turn) have planned so far. */
export interface WriteState {
  folios: Map<string, FolioSim>;
  /** Usual charges this plan saves: later folio charges by that name use their price. */
  savedCharges: SavedChargeView[];
}

export const newWriteState = (): WriteState => ({ folios: new Map(), savedCharges: [] });

const cloneSim = (s: FolioSim): FolioSim => ({ ...s, charges: s.charges.map((c) => ({ ...c })) });
const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

function simFrom(f: FolioView): FolioSim {
  const room = f.edits.room;
  if (!room || room.type !== 'room') throw new HarnessInputError('This folio can’t be changed.');
  const charges = Object.values(f.edits)
    .filter((e): e is Extract<FolioEditTarget, { type: 'charge' }> => e.type === 'charge')
    .sort((a, b) => a.index - b.index);
  const minor = (n: number) => toMinorUnits(n, f.currency);
  return {
    currency: f.currency,
    nights: f.nights,
    roomLabel: room.label,
    roomMinor: minor(room.amount),
    charges: charges.map((c) => ({ orig: `charge:${c.index}`, name: c.name, minor: minor(c.amount), percent: c.percent, date: c.date })),
    allowanceMinor: minor(f.totals.allowances),
    saved: f.savedCharges,
  };
}

export const guestOf = (b: ResolvedBooking) => `${b.user.firstName} ${b.user.lastName}`.trim();
export const memoryOf = (b: ResolvedBooking): Partial<AgentContextState> => ({ lastBookingId: b.id, lastBookingCode: b.code ?? undefined, lastGuestName: guestOf(b), lastRoomNumber: b.room?.roomNumber });
const refused = (text: string): PlanOutput => ({ steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text }] });

/**
 * Plan a list of folio changes for one reservation. Every step is a FolioEdit (or an allowance) written against the
 * folio as the steps before it leave it. Nothing is planned unless every change is valid.
 */
export async function planFolioEdits(ctx: ToolCtx, b: ResolvedBooking, ops: FolioOp[], reason: string | undefined, state: WriteState): Promise<PlanOutput> {
  if (!(await canAtProperty(ctx.actor, 'folio.edit', ctx.propertyId))) return refused('Your role can’t change folios here. The owner can allow it under Settings → Permissions.');
  if (b.status === 'CANCELLED' || b.status === 'NO_SHOW') throw new HarnessInputError(`${b.code} is ${b.status === 'NO_SHOW' ? 'a no-show' : 'cancelled'}; reinstate it before changing its folio.`);
  const known = state.folios.get(b.id);
  const sim = cloneSim(known ?? simFrom(await getFolio(ctx.actor, b.id)));
  const { currency } = sim;
  const digits = currencyDigits(currency);
  const amountOf = (minor: number) => (minor === 0 ? 0 : minor / 10 ** digits);
  const minorOf = (n: number) => toMinorUnits(roundMoney(n, currency), currency);
  const fmt = (minor: number) => money(amountOf(minor), { currency });
  const totalOf = () => sim.roomMinor + sim.charges.reduce((s, c) => s + c.minor, 0);
  const guest = guestOf(b);
  const code = b.code ?? b.id;
  const why = reason?.trim() ? { reason: clean(reason, 200) } : {};
  const steps: PlanStep[] = [];
  const warnings: string[] = [];
  let risk: PlanOutput['risk'] = 'low';

  const indexOf = (ref: string, which: string) => {
    const i = sim.charges.findIndex((c) => c.orig === ref);
    if (i < 0) throw new HarnessInputError(`${which}: there’s no ${ref} on this folio${known ? ' (or this plan already removed it)' : ''}. Call get_folio for its lines.`);
    return i;
  };
  const push = (edit: FolioEdit, summary: string, before: number, note?: string) =>
    steps.push({
      tool: 'edit_folio',
      args: { bookingId: b.id, edit: { ...edit, ...why } },
      summary,
      detail: [note, `stay total ${fmt(before)} → ${fmt(totalOf())}`].filter(Boolean).join(' · '),
    });

  for (const [n, op] of ops.entries()) {
    const which = `edits[${n}]`;
    const before = totalOf();
    switch (op.op) {
      case 'add_charge': {
        const qty = op.quantity ?? 1;
        let name = clean(op.name, 80);
        let eachMinor: number;
        let note: string | undefined;
        if (op.amount !== undefined) {
          eachMinor = minorOf(op.amount);
        } else {
          // Strict on purpose: "pet fee" never quietly becomes a saved "Pet deposit"; the model sees the list and asks.
          const usual = findSavedCharge(state.savedCharges, name) ?? findSavedCharge(sim.saved, name);
          if (!usual) {
            const list = [...state.savedCharges, ...sim.saved.filter((c) => !state.savedCharges.some((p) => p.name.toLowerCase() === c.name.toLowerCase()))];
            throw new HarnessInputError(
              `${which}: the hotel has no usual price for “${name}”${list.length ? ` (its usual charges: ${list.map((c) => `${c.name} ${describeSavedCharge(c, currency)}`).join('; ')})` : ''}. ` +
                'Ask the person how much it is; don’t guess. If they say it always costs that, also call save_charge so it’s remembered.'
            );
          }
          name = usual.name;
          eachMinor = minorOf(usual.amount * (usual.unit === 'NIGHT' ? Math.max(1, sim.nights) : 1));
          note = `usual price ${describeSavedCharge(usual, currency)}${usual.unit === 'NIGHT' ? ` × ${sim.nights} night${sim.nights === 1 ? '' : 's'}` : ''}`;
        }
        const minor = eachMinor * qty;
        if (minor <= 0) throw new HarnessInputError(`${which}: the amount must be above zero.`);
        if (sim.charges.length >= 50) throw new HarnessInputError('This folio already has 50 charges.');
        const label = qty > 1 ? clean(`${name} × ${qty}`, 80) : name;
        sim.charges.push({ orig: null, name: label, minor, percent: null, date: op.date ?? null });
        push({ target: 'addCharge', name: label, amount: amountOf(minor), date: op.date ?? null }, `Add ${label} ${fmt(minor)} to ${guest}’s folio (${code})`, before, note);
        break;
      }
      case 'set_line': {
        if (op.amount === undefined && op.name === undefined && op.date === undefined) throw new HarnessInputError(`${which}: say what to change: amount, name or date.`);
        const parts: string[] = [];
        if (op.line === 'room') {
          if (op.date !== undefined) throw new HarnessInputError(`${which}: the room line has no date.`);
          const expected = { label: sim.roomLabel, amount: amountOf(sim.roomMinor) };
          if (op.name !== undefined) {
            const label = clean(op.name, 120);
            if (label !== sim.roomLabel) parts.push(`reads “${label}” (was “${sim.roomLabel}”)`);
            sim.roomLabel = label;
          }
          if (op.amount !== undefined) {
            const minor = minorOf(op.amount);
            if (minor !== sim.roomMinor) parts.push(`${fmt(minor)} (was ${fmt(sim.roomMinor)})`);
            sim.roomMinor = minor;
          }
          if (!parts.length) throw new HarnessInputError(`${which}: the room line already is that.`);
          push({ target: 'room', expected, ...(op.name !== undefined ? { label: op.name } : {}), ...(op.amount !== undefined ? { amount: op.amount } : {}) }, `Change the room line on ${guest}’s folio (${code}): ${parts.join(', ')}`, before);
        } else {
          const i = indexOf(op.line, which);
          const c = sim.charges[i];
          const expected = { name: c.name, amount: amountOf(c.minor) };
          const was = c.name;
          if (op.name !== undefined) {
            const name = clean(op.name, 80);
            if (name !== c.name) parts.push(`renamed “${name}”`);
            c.name = name;
          }
          if (op.amount !== undefined) {
            const minor = minorOf(op.amount);
            if (minor <= 0) throw new HarnessInputError(`${which}: to take a charge off, use remove_charge.`);
            if (minor !== c.minor) {
              parts.push(`${fmt(minor)} (was ${fmt(c.minor)})`);
              // A percentage tax changed by hand is a fixed amount from then on.
              c.percent = null;
            }
            c.minor = minor;
          }
          if (op.date !== undefined && op.date !== c.date) {
            parts.push(`dated ${op.date ?? 'none'} (was ${c.date ?? 'none'})`);
            c.date = op.date;
          }
          if (!parts.length) throw new HarnessInputError(`${which}: “${was}” already is that.`);
          push(
            { target: 'charge', index: i, expected, ...(op.name !== undefined ? { name: op.name } : {}), ...(op.amount !== undefined ? { amount: op.amount } : {}), ...(op.date !== undefined ? { date: op.date } : {}) },
            `Change “${was}” on ${guest}’s folio (${code}): ${parts.join(', ')}`,
            before
          );
        }
        risk = 'medium';
        break;
      }
      case 'remove_charge': {
        const i = indexOf(op.line, which);
        const [c] = sim.charges.splice(i, 1);
        push({ target: 'removeCharge', index: i, expected: { name: c.name, amount: amountOf(c.minor) } }, `Remove “${c.name}” ${fmt(c.minor)} from ${guest}’s folio (${code})`, before);
        risk = 'medium';
        break;
      }
      case 'set_total': {
        const lines = [...new Set(op.lines)];
        const parts = lines.map((ref) => {
          if (ref === 'room') return { ref: 'room', minor: sim.roomMinor, scales: true, name: 'room', charge: null as SimCharge | null };
          const i = indexOf(ref, which);
          const c = sim.charges[i];
          return { ref: `charge:${i}`, minor: c.minor, scales: c.percent !== null, name: `“${c.name}”`, charge: c };
        });
        const expected = Object.fromEntries(parts.map((p) => [p.ref, amountOf(p.minor)]));
        const total = minorOf(op.amount);
        const split = splitTotal(parts, total);
        const was = parts.reduce((s, p) => s + p.minor, 0);
        if (parts.every((p) => split.get(p.ref) === p.minor)) throw new HarnessInputError(`${which}: those lines already come to ${fmt(total)}.`);
        for (const p of parts) {
          const next = split.get(p.ref)!;
          if (!p.charge) {
            sim.roomMinor = next;
            continue;
          }
          // A percentage tax that moved with the room is still that percentage of it; anything else is now fixed.
          if (next !== p.charge.minor && !(p.scales && lines.includes('room'))) p.charge.percent = null;
          p.charge.minor = next;
        }
        // A line split down to nothing is dropped, as the folio does.
        for (let i = sim.charges.length - 1; i >= 0; i--) if (sim.charges[i].minor <= 0) sim.charges.splice(i, 1);
        push(
          { target: 'setTotal', refs: parts.map((p) => p.ref), amount: amountOf(total), expected },
          `Make ${parts.map((p) => p.name).join(' + ')} on ${guest}’s folio (${code}) come to ${fmt(total)} (was ${fmt(was)})`,
          before,
          parts.map((p) => `${p.name} ${fmt(split.get(p.ref)!)}`).join(', ')
        );
        risk = 'medium';
        break;
      }
      case 'discount': {
        if (!can(ctx.actor, 'folio.adjust')) throw new HarnessInputError('Taking money off a stay is for managers and owners. Say so; don’t plan it.');
        const minor = minorOf(op.amount);
        const left = totalOf() - sim.allowanceMinor;
        if (minor > left) throw new HarnessInputError(`${which}: at most ${fmt(Math.max(0, left))} can be taken off this stay (what’s left of its charges).`);
        sim.allowanceMinor += minor;
        steps.push({
          tool: 'folio_allowance',
          args: { bookingId: b.id, amount: amountOf(minor), reason: clean(op.reason, 200) },
          summary: `Take ${fmt(minor)} off ${guest}’s stay (${code}): “${clean(op.reason, 200)}”`,
          detail: 'an allowance: the charges stay as they are, the stay costs less',
        });
        risk = 'medium';
        break;
      }
    }
  }
  if (sim.charges.length > 50) throw new HarnessInputError('A folio holds at most 50 charges.');
  if (amountOf(totalOf()) > 1_000_000) throw new HarnessInputError('The stay would cost more than 1,000,000.');
  state.folios.set(b.id, sim);
  return { steps, warnings, risk, memory: memoryOf(b) };
}

// ---------------------------------------------------------------------------
// get_folio
// ---------------------------------------------------------------------------

/** The folio for the model (lines by ref, totals, usual charges) and the live folio card for the person. */
export async function folioRead(ctx: ToolCtx, b: ResolvedBooking): Promise<{ blocks: AgentBlock[]; forModel: string; memory: Partial<AgentContextState> }> {
  const f = await getFolio(ctx.actor, b.id);
  const guest = guestOf(b);
  const percentOf = (ref: string) => {
    const e = f.edits[ref];
    return e && e.type === 'charge' ? e.percent : null;
  };
  const lines = f.lines
    .filter((l) => l.section === 'CHARGES' && l.ref && (l.kind === 'ROOM' || l.kind === 'TAX' || l.kind === 'CHARGE'))
    .map((l) => {
      const percent = percentOf(l.ref!);
      return {
        ref: l.ref,
        type: l.kind === 'ROOM' ? 'room' : l.kind === 'TAX' ? 'tax or fee' : 'extra charge',
        name: l.label,
        amount: l.amount,
        ...(percent !== null ? { percentOfRoom: percent } : {}),
        ...(l.kind === 'CHARGE' && l.at ? { date: l.at } : {}),
      };
    });
  const forModel = JSON.stringify({
    reservation: f.code,
    guest,
    status: f.status,
    currency: f.currency,
    nights: f.nights,
    rooms: f.rooms,
    lines,
    allowances: f.allowances.map((a) => ({ amount: a.amount, reason: a.reason })),
    totals: f.totals,
    canEdit: f.canEdit,
    ...(f.canEdit ? { usualCharges: f.savedCharges.map((c) => `${c.name}: ${describeSavedCharge(c, f.currency)}`) } : {}),
    shownToPerson: 'The person sees this folio as a card. Refer to lines by ref in edit_folio.',
  });
  return {
    blocks: [{ type: 'folio', bookingId: b.id, code: f.code, guestName: guest, currency: f.currency, total: f.totals.charges - f.totals.allowances, balance: f.totals.balance }],
    forModel,
    memory: memoryOf(b),
  };
}
