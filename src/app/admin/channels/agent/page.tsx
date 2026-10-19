'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Bot, Check, CheckCircle2, Loader2, MessageSquarePlus, Send, ShieldAlert, Wrench, X, XCircle } from 'lucide-react';
import { apiJson, timeAgo } from '@/components/channels/ChannelBadges';
import { cn } from '@/lib/utils';

type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      isChange: boolean;
      status: 'running' | 'done' | 'failed' | 'rejected' | 'awaiting_approval';
      detail: string | null;
    };

type PendingAction = {
  callId: string;
  toolName: string;
  title: string;
  summary: string;
  details: string[];
  warnings: string[];
  reason: string | null;
};

type ConversationView = {
  id: string;
  title: string | null;
  items: ChatItem[];
  pending: PendingAction[];
  status?: string;
  error?: string | null;
};

const SUGGESTIONS = [
  'What are my Expedia prices for next week?',
  'Raise weekend rates on Booking.com by 10% for all of November',
  'Create a 15% early-booker promotion on Expedia for stays in January, booked at least 30 days ahead',
  'Close the Ocean Suite on all channels for December 24-26',
  'Set a 2-night minimum stay on Booking.com for New Year weekend',
];

/** Minimal formatting for agent replies: **bold** and line breaks */
function FormattedText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <p key={i} className={cn(line.trim() === '' && 'h-2')}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>
          )}
        </p>
      ))}
    </>
  );
}

export default function ChannelAgentPage() {
  const [conversations, setConversations] = useState<{ id: string; title: string | null; updatedAt: string }[]>([]);
  const [configured, setConfigured] = useState(true);
  const [view, setView] = useState<ConversationView | null>(null);
  const [input, setInput] = useState('');
  const [askBeforeChanges, setAskBeforeChanges] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const data = await apiJson(await fetch('/api/admin/channels/agent', { cache: 'no-store' }));
      setConversations(data.conversations);
      setConfigured(data.configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [view, working]);

  const openConversation = async (id: string) => {
    setError('');
    try {
      const data = await apiJson<ConversationView>(await fetch(`/api/admin/channels/agent?id=${id}`, { cache: 'no-store' }));
      setView(data);
      setDecisions(Object.fromEntries(data.pending.map((p) => [p.callId, true])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open conversation');
    }
  };

  const send = async (payload: { message?: string; decisions?: Record<string, boolean> }) => {
    setWorking(true);
    setError('');
    if (payload.message) {
      // Show the admin's message right away
      setView((current) => ({
        id: current?.id ?? '',
        title: current?.title ?? payload.message!,
        items: [...(current?.items ?? []), { kind: 'user', text: payload.message! }],
        pending: [],
      }));
    }
    try {
      const data = await apiJson<ConversationView>(
        await fetch('/api/admin/channels/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: view?.id || null, autoApprove: !askBeforeChanges, ...payload }),
        })
      );
      setView(data);
      setDecisions(Object.fromEntries(data.pending.map((p) => [p.callId, true])));
      if (data.error) setError(data.error);
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The agent could not respond');
      if (view?.id) openConversation(view.id);
    } finally {
      setWorking(false);
    }
  };

  const submitMessage = () => {
    const message = input.trim();
    if (!message || working) return;
    setInput('');
    send({ message });
  };

  const pending = view?.pending ?? [];

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="h-6 w-6 text-agent" aria-hidden />
            Channel agent
          </h1>
          <p className="text-muted-foreground text-sm">Ask in plain English to check or change OTA rates, availability and promotions.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={askBeforeChanges} onChange={(e) => setAskBeforeChanges(e.target.checked)} />
          Ask me before applying changes
        </label>
      </div>

      {!configured && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          The channel agent isn’t switched on yet. A platform admin needs to add OPENAI_API_KEY to the server environment and redeploy.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr] flex-1 min-h-0">
        <Card className="hidden lg:flex flex-col">
          <CardContent className="pt-4 space-y-2 overflow-y-auto">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setView(null);
                setError('');
              }}
            >
              <MessageSquarePlus className="h-4 w-4" />
              New conversation
            </Button>
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={cn('w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-muted', view?.id === c.id && 'bg-primary-soft text-primary')}
              >
                <div className="truncate">{c.title || 'Conversation'}</div>
                <div className="text-xs text-muted-foreground">{timeAgo(c.updatedAt)}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="flex flex-col min-h-[60vh]">
          <CardContent className="flex-1 overflow-y-auto pt-6 space-y-4">
            {!view?.items.length && (
              <div className="text-center py-8 space-y-4">
                <p className="text-muted-foreground text-sm">Try one of these, or ask anything about your Expedia and Booking.com distribution:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="rounded-full border px-3 py-1.5 text-sm text-foreground hover:bg-muted/50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Set up connections on the <Link href="/admin/channels" className="underline">Channels</Link> page first.
                </p>
              </div>
            )}

            {view?.items.map((item, index) => {
              if (item.kind === 'user') {
                return (
                  <div key={index} className="flex justify-end">
                    <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground whitespace-pre-wrap">{item.text}</div>
                  </div>
                );
              }
              if (item.kind === 'assistant') {
                return (
                  <div key={index} className="flex gap-2">
                    <Bot className="h-5 w-5 text-primary mt-1 shrink-0" />
                    <div className="max-w-[85%] rounded-lg bg-muted px-4 py-2 text-sm text-foreground space-y-1">
                      <FormattedText text={item.text} />
                    </div>
                  </div>
                );
              }
              return (
                <div key={index} className="ml-7 flex items-start gap-2 text-xs">
                  {item.status === 'done' ? (
                    item.isChange ? <CheckCircle2 className="h-4 w-4 text-success-soft-foreground shrink-0" /> : <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  ) : item.status === 'awaiting_approval' ? (
                    <ShieldAlert className="h-4 w-4 text-warning-soft-foreground shrink-0" />
                  ) : item.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className={cn('h-4 w-4 shrink-0', item.status === 'rejected' ? 'text-muted-foreground' : 'text-destructive')} />
                  )}
                  <div className={cn(item.isChange ? 'text-foreground' : 'text-muted-foreground')}>
                    <span className={cn(item.isChange && 'font-medium')}>
                      {item.label}
                      {item.isChange && item.status === 'done' && ' - applied'}
                      {item.status === 'rejected' && ' - not applied'}
                      {item.status === 'awaiting_approval' && ' - waiting for your approval'}
                    </span>
                    {item.detail && <div className={cn(item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{item.detail}</div>}
                  </div>
                </div>
              );
            })}

            {pending.length > 0 && !working && (
              <div className="ml-7 rounded-lg border border-warning/30 bg-warning-soft p-4 space-y-3">
                <div className="font-medium text-warning-soft-foreground text-sm flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  The agent wants to make {pending.length === 1 ? 'this change' : `${pending.length} changes`}
                </div>
                {pending.map((action) => (
                  <div key={action.callId} className="rounded-md bg-background border p-3 text-sm space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{action.title}</div>
                        <div className="text-foreground">{action.summary}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant={decisions[action.callId] ? 'default' : 'outline'}
                          onClick={() => setDecisions({ ...decisions, [action.callId]: true })}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant={decisions[action.callId] === false ? 'destructive' : 'outline'}
                          onClick={() => setDecisions({ ...decisions, [action.callId]: false })}
                        >
                          <X className="h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </div>
                    </div>
                    {action.details.map((line) => (
                      <div key={line} className="text-muted-foreground text-xs">
                        {line}
                      </div>
                    ))}
                    {action.warnings.map((line) => (
                      <div key={line} className="text-warning-soft-foreground text-xs">
                        {line}
                      </div>
                    ))}
                    {action.reason && <div className="text-xs text-muted-foreground">Reason: {action.reason}</div>}
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => send({ decisions })}>
                    Submit decision{pending.length > 1 ? 's' : ''}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => send({ decisions: Object.fromEntries(pending.map((p) => [p.callId, false])) })}
                  >
                    Reject all
                  </Button>
                </div>
              </div>
            )}

            {working && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground ml-7">
                <Loader2 className="h-4 w-4 animate-spin" />
                The agent is working...
              </div>
            )}
            {error && (
              <div className="ml-7 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </CardContent>

          <div className="border-t p-3 flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitMessage();
                }
              }}
              placeholder={pending.length ? 'Or reply instead of approving...' : 'e.g. Drop Expedia prices 5% for next Tuesday and Wednesday'}
              rows={2}
              className="resize-none"
              disabled={working}
            />
            <Button onClick={submitMessage} disabled={working || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
