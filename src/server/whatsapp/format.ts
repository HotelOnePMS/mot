/**
 * The agent's blocks as WhatsApp text. The console draws cards, tables and
 * plans; WhatsApp gets the same facts as short lines, with *bold* in
 * WhatsApp's own markup. Commands the console offers as buttons (follow-ups,
 * clarifying options, booking actions) become numbered replies: the person
 * answers "2" and the chat sends that command.
 */
import type { AgentBlock, QuickAction } from '@/lib/agent/blocks';
import type { BookingSummary } from '@/lib/dto';
import { formatDateRange, formatMoney } from '@/lib/format';
import { RISK_FLAG_INFO } from '@/lib/risk';

export interface RenderOptions {
  /** The hotel's currency, for amounts that don't carry their own. */
  currency: string;
  /** This deployment's address, so console links can be absolute. */
  siteUrl: string | null;
  /** Numbered replies already offered just above (an alert shown first): this message's numbers follow on from them. */
  offered?: string[];
}

export interface Rendered {
  text: string;
  /** Commands for numbered replies, in order ("1" is the first), including any already offered. */
  choices: string[];
  /** A plan is waiting for YES. */
  planToken: string | null;
}

/**
 * Numbered replies can carry where they apply: "#hotel:<id>" picks a hotel,
 * "#at:<id>|<command>" runs a command at that hotel (an alert about one of
 * the person's other hotels). Anything else is a command for the current hotel.
 */
export const HOTEL_CHOICE = '#hotel:';
const AT_CHOICE = '#at:';
export const choiceAt = (propertyId: string, command: string) => `${AT_CHOICE}${propertyId}|${command}`;
/** Numbered replies tied to a hotel (an alert's fixes): they act there whichever hotel the chat is on, so they outlive a switch. */
export const hotelBound = (choices: string[]) => choices.filter((c) => c.startsWith(AT_CHOICE));

export function readChoice(choice: string): { hotel: string } | { at: string | null; command: string } {
  if (choice.startsWith(HOTEL_CHOICE)) return { hotel: choice.slice(HOTEL_CHOICE.length) };
  if (choice.startsWith(AT_CHOICE)) {
    const rest = choice.slice(AT_CHOICE.length);
    const bar = rest.indexOf('|');
    if (bar > 0) return { at: rest.slice(0, bar), command: rest.slice(bar + 1) };
  }
  return { at: null, command: choice };
}

/** At most nine numbered replies, so each is a single digit. */
const MAX_CHOICES = 9;
const MAX_LIST = 10;

/** Console markdown → WhatsApp: **bold** → *bold*, [label](href) → label: href. */
export function toWhatsAppMarkup(text: string, siteUrl: string | null = null): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => `${label}: ${absolute(href, siteUrl)}`);
}

function absolute(href: string, siteUrl: string | null): string {
  return href.startsWith('/') && siteUrl ? `${siteUrl}${href}` : href;
}

const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');

function more(total: number, shown: number): string[] {
  return total > shown ? [`…and ${total - shown} more`] : [];
}

function bookingLine(b: BookingSummary): string {
  const room = b.room ? `room ${b.room.number}` : b.roomType.name;
  const flags = b.riskFlags.length ? ' ⚠️' : '';
  return `• ${b.guest.name} (${b.code}) — ${room}, ${formatDateRange(b.checkIn, b.checkOut)}, ${words(b.status)}${flags}`;
}

export function renderBlocks(blocks: AgentBlock[], opts: RenderOptions): Rendered {
  const out: string[] = [];
  const choices: string[] = [...(opts.offered ?? [])];
  let planToken: string | null = null;

  /** Adds a numbered reply and returns its number, or null when there are already nine. */
  const offer = (command: string): number | null => {
    const known = choices.indexOf(command);
    if (known >= 0) return known + 1;
    if (choices.length >= MAX_CHOICES) return null;
    choices.push(command);
    return choices.length;
  };
  // Past nine numbers, an option shows the command to send instead, so a question still has its answers.
  const offerLines = (items: { label: string; command: string }[]): string[] =>
    items.map((i) => {
      const n = offer(i.command);
      return n ? `${n}. ${i.label}` : `• ${i.label}: send “${i.command}”`;
    });
  const sendable = (actions: QuickAction[]) => actions.filter((a) => a.mode !== 'prefill').map((a) => ({ label: a.label, command: a.command }));

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        out.push(toWhatsAppMarkup(block.text, opts.siteUrl));
        break;
      case 'error':
        out.push(`⚠️ ${toWhatsAppMarkup(block.text, opts.siteUrl)}`);
        break;
      case 'stats':
        out.push(block.items.map((i) => `*${i.label}:* ${i.value}${i.hint ? ` (${i.hint})` : ''}`).join('\n'));
        break;
      case 'bookings': {
        const lines = block.items.slice(0, MAX_LIST).map(bookingLine);
        out.push([`*${block.title}*`, ...(lines.length ? lines : [block.emptyText ?? 'None.']), ...more(block.items.length, lines.length)].join('\n'));
        break;
      }
      case 'booking': {
        const b = block.booking;
        const lines = [
          `*${b.guest.name}* — ${b.code}, ${words(b.status)}`,
          `${formatDateRange(b.checkIn, b.checkOut, { year: true })} · ${b.nights} night${b.nights === 1 ? '' : 's'} · ${b.guests} guest${b.guests === 1 ? '' : 's'}`,
          `${b.roomType.name}${b.room ? `, room ${b.room.number}` : ', no room assigned'}`,
          `Total ${formatMoney(b.totalPrice, b.currency)}${b.amountPaid ? `, paid ${formatMoney(b.amountPaid, b.currency)}` : ''} (${words(b.paymentStatus)})`,
          ...(b.guest.phone ? [`Phone ${b.guest.phone}`] : []),
          ...(b.notes ? [`Notes: ${b.notes}`] : []),
          ...b.riskFlags.map((f) => `⚠️ ${RISK_FLAG_INFO[f].label}`),
        ];
        const actions = offerLines(sendable(block.actions));
        out.push([...lines, ...actions].join('\n'));
        break;
      }
      case 'rooms': {
        const lines = block.rooms.slice(0, MAX_LIST * 2).map((r) => {
          const state = r.isOutOfOrder ? `out of order${r.outOfOrderReason ? ` (${r.outOfOrderReason})` : ''}` : words(r.status);
          const who = r.current ? `, ${r.current.guestName} until ${formatDateRange(r.current.checkOut, r.current.checkOut)}` : r.arriving ? `, ${r.arriving.guestName} arriving` : '';
          return `• ${r.number} ${r.roomType.name} — ${state}${who}`;
        });
        out.push([`*${block.title}*`, ...(lines.length ? lines : ['None.']), ...more(block.rooms.length, lines.length)].join('\n'));
        break;
      }
      case 'roomOptions': {
        const lines = block.options.slice(0, 3).map((o) => `• ${o.room.number}${o.ready ? '' : ' (not ready)'} — ${o.reasons.slice(0, 2).join(', ')}`);
        out.push([`*${block.title}* for ${block.guestName} (${block.bookingCode})`, ...lines].join('\n'));
        break;
      }
      case 'availability': {
        const lines = block.items.map((i) => `• ${i.name}: ${i.available} of ${i.total} free, ${formatMoney(i.averageNightly, opts.currency)}/night (${formatMoney(i.totalPrice, opts.currency)} total)`);
        out.push([`*Availability ${formatDateRange(block.checkIn, block.checkOut)}*, ${block.guests} guest${block.guests === 1 ? '' : 's'}`, ...(lines.length ? lines : ['Nothing free.'])].join('\n'));
        break;
      }
      case 'occupancy': {
        const days = block.days.slice(0, 14).map((d) => `• ${formatDateRange(d.date, d.date, { weekday: true })}: ${Math.round(d.occupancyPct)}% (${d.roomsSold}/${d.totalRooms})`);
        out.push(
          [
            `*${block.title}*`,
            `Average ${Math.round(block.averagePct)}% · revenue ${formatMoney(block.revenue, opts.currency)} · ADR ${formatMoney(block.adr, opts.currency)}`,
            ...days,
            ...more(block.days.length, days.length),
          ].join('\n')
        );
        break;
      }
      case 'forecast': {
        const lines = block.periods.flatMap((p) => {
          const line = `• *${p.label}* (${formatDateRange(p.from, p.to)}): ${Math.round(p.occupancyPct)}% booked, ADR ${formatMoney(p.adr, opts.currency)} — ${p.recommendation}`;
          const n = p.action && p.action.mode !== 'prefill' ? offer(p.action.command) : null;
          return n && p.action ? [line, `${n}. ${p.action.label}`] : [line];
        });
        out.push([`*${block.title}*`, ...lines].join('\n'));
        break;
      }
      case 'housekeeping': {
        const lines = block.tasks.slice(0, MAX_LIST * 2).map((t) => `• ${t.room.number} — ${words(t.status)}${t.assignee ? `, ${t.assignee.name}` : ', unassigned'}${t.priority > 0 ? ' (priority)' : ''}`);
        out.push([`*${block.title}*`, ...(lines.length ? lines : ['Nothing to do.']), ...more(block.tasks.length, lines.length)].join('\n'));
        break;
      }
      case 'alerts': {
        const lines = block.items.slice(0, MAX_LIST).flatMap((a) => {
          const icon = a.tone === 'danger' ? '🔴' : a.tone === 'warning' ? '🟠' : '🔵';
          const n = a.command ? offer(a.command) : null;
          return [`${icon} ${a.title}${a.detail ? ` — ${a.detail}` : ''}${n ? ` (reply ${n})` : ''}`];
        });
        if (lines.length) out.push(lines.join('\n'));
        break;
      }
      case 'plan': {
        const p = block.plan;
        planToken = p.token;
        out.push(
          [
            `*Please confirm: ${p.title}*`,
            ...p.steps.map((s, i) => `${p.steps.length > 1 ? `${i + 1})` : '•'} ${s.summary}${s.detail ? ` — ${s.detail}` : ''}`),
            ...p.warnings.map((w) => `⚠️ ${w}`),
            p.risk === 'high' ? '🔴 This one is hard to undo.' : '',
            `Reply *YES* to go ahead or *NO* to cancel. This expires in 10 minutes.`,
          ]
            .filter(Boolean)
            .join('\n')
        );
        break;
      }
      case 'result':
        out.push([`${block.ok ? '✅' : '⚠️'} *${block.title}*`, ...block.lines].join('\n'));
        break;
      case 'activity': {
        const lines = block.items.slice(0, MAX_LIST).map((a) => `• ${a.user.name}: ${a.summary}`);
        out.push(['*Recent activity*', ...(lines.length ? lines : ['Nothing yet.'])].join('\n'));
        break;
      }
      case 'clarify': {
        out.push([toWhatsAppMarkup(block.question, opts.siteUrl), ...offerLines(block.options.map((o) => ({ label: o.hint ? `${o.label} (${o.hint})` : o.label, command: o.command })))].join('\n'));
        break;
      }
      case 'navigate':
        out.push(`${block.label}${block.description ? ` — ${block.description}` : ''}: ${absolute(block.href, opts.siteUrl)}`);
        break;
      case 'bridgeTask':
        out.push(`📨 Sent to ${block.system}: “${block.instruction}”`);
        break;
      case 'suggestions':
        // Rendered last, after everything else has had its numbers.
        break;
    }
  }

  // A pending plan wants YES or NO; numbered follow-ups would only compete with it.
  const suggestions = planToken ? [] : blocks.flatMap((b) => (b.type === 'suggestions' ? b.items : []));
  const tips = offerLines(suggestions.map((s) => ({ label: s, command: s })));
  if (tips.length) out.push(['_Reply with a number:_', ...tips].join('\n'));

  return { text: out.filter((s) => s.trim()).join('\n\n') || 'Done.', choices, planToken };
}
