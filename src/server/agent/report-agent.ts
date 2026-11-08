/**
 * The Reports page's "describe a report" box: a short model call turns the person's words into a ReportQuery through
 * the same run_report tool the console agent uses, and the engine runs it. Only the query comes from the model; every
 * number in the table comes from the hotel's data. A query the engine can't run goes back to the model to fix (a few
 * rounds at most); a request too vague to build comes back as the model's question.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { QueryResult, ReportQuery } from '@/lib/report-query';
import { dayOfWeek } from '../dates';
import { DomainError } from '../errors';
import { logError } from '../log';
import type { Actor } from '../authz';
import { hotelLocale, todayAt } from '../services/hotels';
import { prisma } from '@/lib/prisma';
import { AGENT_MODEL } from './harness';
import { ReportInputError, reportToolDef, runReportTool } from './report-tool';

const MAX_ROUNDS = 3;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface AskedReport {
  /** The report built, or null when the model asked a question instead. */
  query: ReportQuery | null;
  result: QueryResult | null;
  /** The model's short note about the report, or its question. */
  note: string | null;
}

function systemPrompt(hotel: string, today: string, currency: string): string {
  return `You turn a hotel staff member's request into a report for ${hotel}'s property management system. Always answer by calling run_report with the report that best answers the request, even when it's phrased loosely, has typos or leaves things out: pick the dataset, fields, grouping and metrics yourself and choose sensible defaults (an unnamed period means this month so far; "this year" is January 1 to today; "last month" is the whole previous month). Only if the request can't be a report at all, reply with one short question instead.

Along with the call, write one short sentence saying what the report shows (e.g. "Pet fees by month since January."). Give it a short, clear title.

Today at the hotel is ${today} (${WEEKDAY[dayOfWeek(today)]}). Amounts are in ${currency}.`;
}

export async function askForReport(actor: Actor, propertyId: string, question: string, opts: { client?: Anthropic; signal?: AbortSignal } = {}): Promise<AskedReport> {
  const client = opts.client ?? new Anthropic();
  const [property, today, locale] = await Promise.all([prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } }), todayAt(propertyId), hotelLocale(propertyId)]);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: question.trim().slice(0, 1000) }];
  const tool = reportToolDef();
  let lastError = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const message = await client.beta.messages.create(
      {
        model: AGENT_MODEL.model,
        max_tokens: 8000,
        betas: [...AGENT_MODEL.betas],
        fallbacks: 'default',
        output_config: { effort: AGENT_MODEL.effort },
        cache_control: { type: 'ephemeral' },
        system: systemPrompt(property?.name ?? 'the hotel', today, locale.currency),
        tools: [tool],
        tool_choice: { type: 'auto' },
        messages,
      },
      { signal: opts.signal }
    );
    if (message.stop_reason === 'refusal') return { query: null, result: null, note: 'I can’t build that one. Try describing the report differently.' };
    // After a server-side fallback only the text before the last fallback block carries over.
    const boundary = message.content.map((b) => b.type).lastIndexOf('fallback');
    const content = boundary < 0 ? message.content : message.content.filter((b, i) => i >= boundary || b.type === 'text');
    const text = content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    const use = content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'run_report');
    if (!use) return { query: null, result: null, note: text || 'Say a little more about the report you need.' };
    try {
      const { query, result } = await runReportTool(actor, propertyId, use.input);
      return { query, result, note: text || null };
    } catch (e) {
      if (!(e instanceof ReportInputError) && !(e instanceof DomainError)) throw e;
      if (e instanceof DomainError && e.status !== 400) throw e;
      lastError = e.message;
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, is_error: true, content: e.message }] });
    }
  }
  logError('agent/report', 'Report request still invalid after retries:', lastError);
  return { query: null, result: null, note: `I couldn’t build that report (${lastError}). Try saying it another way.` };
}
