'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Callout, StatTile } from '@/components/ui/primitives';
import { BrainCircuit, Building2, Loader2, RotateCcw, Send, Square } from 'lucide-react';

type ChatTurn = { role: 'user' | 'assistant'; content: string };

type AdvisorEvent =
  | { type: 'round' }
  | { type: 'discard' }
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'tool'; name: string; label: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

type Overview = {
  today: string;
  role: string;
  /** Null when the properties use different currencies. */
  currency: string | null;
  properties: { id: string; name: string; city: string; state: string; isActive: boolean; rooms: number }[];
  last30Days: { roomRevenue: number; revenueVsLastYearPct: number | null; occupancyPct: number | null; adr: number | null; revpar: number | null };
  next30Days: { occupancyPct: number | null; roomRevenue: number; revenueVsSameTimeLastYearPct: number | null };
};

const SUGGESTIONS = [
  'Which of my properties is underperforming right now, and what is driving it?',
  'Where should I raise or lower rates over the next 30 days?',
  'Compare weekday and weekend demand across my hotels. What should I change?',
  'Brainstorm the five highest-impact ideas to grow revenue next quarter.',
  'How is my booking pace for the next 90 days compared with last year?',
  'What is behind my cancellations and no-shows, and how could I reduce them?',
];

// Older turns are trimmed from what is sent so requests stay small; the full chat stays on screen.
const MAX_TURNS_SENT = 41;

// Portfolio amounts only add up within one currency; with mixed currencies the tiles show a dash.
const money = (n: number | null, currency: string | null) =>
  n === null || currency === null ? '-' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const pct = (n: number | null) => (n === null ? '-' : `${n.toFixed(1)}%`);
const signedPct = (n: number | null) => (n === null ? null : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

// A saved conversation is usable only if it alternates user/assistant and ends with an answer.
function isValidConversation(value: unknown): value is ChatTurn[] {
  return (
    Array.isArray(value) &&
    value.length % 2 === 0 &&
    value.every(
      (m, i) => m && m.role === (i % 2 === 0 ? 'user' : 'assistant') && typeof m.content === 'string' && m.content.trim() !== '',
    )
  );
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-2 mt-3 font-semibold text-foreground first:mt-0">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="mb-3 border-l-4 border-border pl-3 text-muted-foreground">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{children}</code>,
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-md border border-border">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap border-b border-border bg-muted px-3 py-2 text-left font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top text-foreground">{children}</td>,
};

export default function AdvisorPage() {
  const { data: session } = useSession();
  const storageKey = session?.user?.id ? `ai-advisor-conversation:${session.user.id}` : null;

  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new output only while the reader is at the bottom of the chat.
  const stickToBottomRef = useRef(true);
  // Bumped by "New conversation" so a turn still finishing cannot write into the new chat.
  const conversationRef = useRef(0);

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        const response = await fetch('/api/admin/business-agent');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setOverviewError(data.error || 'Failed to load portfolio overview');
          return;
        }
        setOverview(data);
      } catch {
        setOverviewError('Unable to connect to the server. Please try again later.');
      }
    };
    fetchOverview();
  }, []);

  // Restore this user's conversation from the browser, and save it after each completed turn.
  useEffect(() => {
    if (!storageKey || restored) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
      if (isValidConversation(saved)) setMessages(saved);
    } catch {
      // Ignore unreadable saved conversations.
    }
    setRestored(true);
  }, [storageKey, restored]);

  useEffect(() => {
    if (!storageKey || !restored || streaming) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // Storage can be full or disabled; the conversation still works without it.
    }
  }, [messages, storageKey, restored, streaming]);

  useEffect(() => {
    if (stickToBottomRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, activity]);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || streaming) return;

      const conversation = conversationRef.current;
      const history: ChatTurn[] = [...messages, { role: 'user', content: text }];
      stickToBottomRef.current = true;
      setMessages([...history, { role: 'assistant', content: '' }]);
      setInput('');
      setError('');
      setActivity('Thinking');
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let answer = '';
      let roundStart = 0;
      const showAnswer = () => {
        if (conversation === conversationRef.current) {
          setMessages((current) => [...current.slice(0, -1), { role: 'assistant', content: answer }]);
        }
      };

      try {
        const response = await fetch('/api/admin/business-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history.slice(-MAX_TURNS_SENT) }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'The advisor could not answer right now.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const line = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (!line.startsWith('data: ')) continue;

            const event = JSON.parse(line.slice(6)) as AdvisorEvent;
            if (event.type === 'round') {
              roundStart = answer.length;
            } else if (event.type === 'discard') {
              answer = answer.slice(0, roundStart);
              showAnswer();
            } else if (event.type === 'text') {
              answer += event.text;
              setActivity(null);
              showAnswer();
            } else if (event.type === 'status') {
              setActivity(event.text);
            } else if (event.type === 'tool') {
              setActivity(event.label);
            } else if (event.type === 'error') {
              setError(event.message);
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'The advisor could not answer right now.');
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setActivity(null);
        if (conversation !== conversationRef.current) {
          // The user started a new conversation while this turn was running.
        } else if (!answer.trim()) {
          // Nothing came back: drop the unanswered question so it can be asked again.
          setMessages(history.slice(0, -1));
          setInput(text);
        } else {
          showAnswer();
        }
      }
    },
    [messages, streaming],
  );

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    conversationRef.current++;
    stop();
    setMessages([]);
    setError('');
  };

  const propertyCount = overview?.properties.length ?? 0;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <div className="border-b bg-card px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary-soft p-2">
                <BrainCircuit className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground sm:text-2xl">AI Business Advisor</h1>
                <p className={cn('text-sm text-muted-foreground', messages.length > 0 && 'hidden sm:block')}>
                  {overview
                    ? `Brainstorm with full context of your ${propertyCount} ${propertyCount === 1 ? 'property' : 'properties'}: performance, bookings, rates and operations.`
                    : 'Brainstorm with full context of your properties: performance, bookings, rates and operations.'}
                </p>
              </div>
            </div>
            {messages.length > 0 && (
              <Button variant="outline" size="sm" onClick={reset} aria-label="New conversation">
                <RotateCcw />
                <span className="hidden sm:inline">New conversation</span>
              </Button>
            )}
          </div>

          {overviewError && <Callout tone="danger">{overviewError}</Callout>}

          {overview && propertyCount > 0 && (
            <div className={cn('flex flex-col gap-4', messages.length > 0 && 'hidden md:flex')}>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <StatTile label="Revenue, last 30 days" value={money(overview.last30Days.roomRevenue, overview.currency)} hint={overview.currency === null ? 'Hotels use different currencies' : signedPct(overview.last30Days.revenueVsLastYearPct) && `${signedPct(overview.last30Days.revenueVsLastYearPct)} vs LY`} />
                <StatTile label="Occupancy, last 30 days" value={pct(overview.last30Days.occupancyPct)} />
                <StatTile label="ADR, last 30 days" value={money(overview.last30Days.adr, overview.currency)} />
                <StatTile
                  label="On the books, next 30 days"
                  value={pct(overview.next30Days.occupancyPct)}
                  hint={signedPct(overview.next30Days.revenueVsSameTimeLastYearPct) && `${signedPct(overview.next30Days.revenueVsSameTimeLastYearPct)} vs STLY`}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {overview.properties.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {p.name}
                    <span className="text-muted-foreground">
                      {p.city}, {p.state} · {p.rooms} rooms
                    </span>
                    {!p.isActive && <span className="rounded bg-muted px-1 text-muted-foreground">inactive</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {overview && propertyCount === 0 && (
            <Callout tone="warning">No properties are assigned to your account yet. Ask an administrator to assign your properties in Team.</Callout>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto px-4 py-6 lg:px-6"
      >
        <div className="mx-auto max-w-4xl space-y-6">
          {messages.length === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ask anything about your business. The advisor sees every property in your portfolio, compares them with each other and with last year, and digs into
                bookings, rates and demand patterns as needed.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={streaming || propertyCount === 0}
                    onClick={() => ask(suggestion)}
                    className="rounded-lg border border-border bg-card p-4 text-left text-sm text-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-primary-soft/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) =>
            message.role === 'user' ? (
              <div key={index} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">{message.content}</div>
              </div>
            ) : (
              <div key={index} className="flex gap-3">
                <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-soft">
                  <BrainCircuit className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1 text-sm text-foreground">
                  {message.content && (
                    <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 shadow-xs">
                      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {message.content}
                      </Markdown>
                    </div>
                  )}
                  {streaming && index === messages.length - 1 && activity && (
                    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', message.content && 'mt-2')}>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{activity}</span>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>
      </div>

      <div className="border-t bg-card px-4 py-4 lg:px-6">
        <form
          className="mx-auto flex max-w-4xl items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Ask about performance, pricing, demand, or brainstorm ideas..."
            rows={2}
            className="min-h-[52px] resize-none"
            disabled={propertyCount === 0 && overview !== null}
          />
          {streaming ? (
            <Button type="button" variant="outline" onClick={stop} className="h-[52px]">
              <Square />
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()} className="h-[52px]">
              <Send />
              Send
            </Button>
          )}
        </form>
        <p className="mx-auto mt-2 hidden max-w-4xl text-xs text-muted-foreground sm:block">
          Enter to send, Shift+Enter for a new line. The advisor can read your data but cannot change anything. Check important figures before acting on them.
        </p>
      </div>
    </div>
  );
}
