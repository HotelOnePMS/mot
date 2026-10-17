/**
 * Turn the agent's UI blocks into a compact, speakable summary for the voice
 * backend. The screen shows the full blocks; the voice only needs the gist,
 * plus whether a plan is waiting for confirmation.
 */
import type { AgentBlock } from './blocks';
import { fmtDay } from '../format';
import { money } from '../status';

const list = (xs: string[], max = 5) => (xs.length > max ? `${xs.slice(0, max).join('; ')}; and ${xs.length - max} more` : xs.join('; '));

export function speakBlocks(blocks: AgentBlock[]): { summary: string; plan_pending: boolean; plan_title?: string } {
  const parts: string[] = [];
  let plan: { title: string } | undefined;
  for (const b of blocks) {
    switch (b.type) {
      case 'text':
        parts.push(b.text);
        break;
      case 'stats':
        parts.push(b.items.map((i) => `${i.label}: ${i.value}`).join(', '));
        break;
      case 'bookings':
        parts.push(
          b.items.length
            ? `${b.title} (${b.items.length}): ${list(b.items.map((x) => `${x.guest.name}, ${x.roomType.name}${x.room ? ` room ${x.room.number}` : ', no room yet'}, ${x.status.toLowerCase().replace('_', ' ')}`))}`
            : b.emptyText ?? `${b.title}: none`
        );
        break;
      case 'booking':
        parts.push(
          `${b.booking.guest.name}, ${b.booking.code}: ${b.booking.roomType.name}${b.booking.room ? ` room ${b.booking.room.number}` : ''}, ${fmtDay(b.booking.checkIn, 'weekday')} to ${fmtDay(b.booking.checkOut, 'weekday')}, ${b.booking.status.toLowerCase().replace('_', ' ')}`
        );
        break;
      case 'rooms':
        parts.push(`${b.title}: ${b.rooms.length} room${b.rooms.length === 1 ? '' : 's'}${b.rooms.length ? ` — ${list(b.rooms.map((r) => `${r.number} ${r.status.toLowerCase()}`), 8)}` : ''}`);
        break;
      case 'roomOptions':
        parts.push(`Best rooms for ${b.guestName}: ${list(b.options.slice(0, 3).map((o) => `${o.room.number} (${o.reasons.slice(0, 2).join(', ')})`))}`);
        break;
      case 'availability':
        parts.push(
          `Availability ${fmtDay(b.checkIn, 'weekday')} to ${fmtDay(b.checkOut, 'weekday')}: ${list(b.items.map((i) => `${i.name} ${i.available} left at ${money(i.averageNightly, { cents: false })} a night`))}`
        );
        break;
      case 'occupancy':
        parts.push(`${b.title}: ${b.averagePct}% average occupancy, ${money(b.revenue, { cents: false })} revenue, ADR ${money(b.adr, { cents: false })}`);
        break;
      case 'forecast':
        parts.push(list(b.periods.map((p) => `${p.label}: ${p.occupancyPct}% — ${p.recommendation}`)));
        break;
      case 'housekeeping':
        parts.push(`${b.title}: ${b.tasks.filter((t) => t.status === 'PENDING').length} to clean, ${b.tasks.filter((t) => t.status === 'IN_PROGRESS').length} in progress`);
        break;
      case 'alerts':
        if (b.items.length) parts.push(`Needs attention: ${list(b.items.map((a) => a.title))}`);
        break;
      case 'plan':
        plan = { title: b.plan.title };
        parts.push(`Plan waiting for confirmation — ${b.plan.title}: ${list(b.plan.steps.map((s) => s.summary))}${b.plan.warnings.length ? `. Warnings: ${b.plan.warnings.join('; ')}` : ''}`);
        break;
      case 'result':
        parts.push(`${b.ok ? 'Done' : 'Not done'} — ${b.title}${b.lines.length ? `: ${list(b.lines)}` : ''}`);
        break;
      case 'clarify':
        parts.push(`Question: ${b.question} Options: ${b.options.map((o) => o.label).join(', ')}`);
        break;
      case 'navigate':
        parts.push(`Opened ${b.label}`);
        break;
      case 'error':
        parts.push(`Problem: ${b.text}`);
        break;
      case 'bridgeTask':
        parts.push(`Sent to ${b.system}. The operator is working on it — the result will appear on screen in a minute.`);
        break;
      default:
        break;
    }
  }
  return { summary: parts.join('\n').slice(0, 2500) || 'Done.', plan_pending: !!plan, plan_title: plan?.title };
}
