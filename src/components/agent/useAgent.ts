'use client';

import * as React from 'react';
import type { AgentBlock, AgentContextState, AgentEvent } from '@/lib/agent/blocks';
import { api, ApiError } from '@/lib/fetcher';

export interface AgentTurn {
  id: string;
  role: 'user' | 'agent';
  text?: string;
  blocks: AgentBlock[];
  status?: string;
  pending?: boolean;
  error?: string;
  /** For user turns: lets a failed command be retried. */
  retryable?: boolean;
  /** How the request arrived (voice turns show a mic). */
  via?: 'voice';
  at: number;
  ms?: number;
}

export type PlanState = 'idle' | 'running' | 'done' | 'dismissed' | 'failed';

interface Persisted {
  turns: AgentTurn[];
  context: AgentContextState;
  plans: Record<string, PlanState>;
  history: string[];
}

const MAX_TURNS = 40;
const uid = () => Math.random().toString(36).slice(2, 10);

function storageKey(propertyId: string) {
  return `stayos-agent:v1:${propertyId}`;
}

function load(propertyId: string): Persisted | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(propertyId));
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function save(propertyId: string, data: Persisted) {
  try {
    window.sessionStorage.setItem(storageKey(propertyId), JSON.stringify({ ...data, turns: data.turns.slice(-MAX_TURNS) }));
  } catch {
    /* storage full or unavailable — the conversation just won't survive a reload */
  }
}

export function useOnline() {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * Conversation state for the agent: streams NDJSON events into turns,
 * tracks plan confirmations, and keeps context ("them") between commands.
 */
export function useAgent(propertyId: string | undefined, opts: { onChange?: () => void } = {}) {
  const [turns, setTurns] = React.useState<AgentTurn[]>([]);
  const [context, setContext] = React.useState<AgentContextState>({});
  const [plans, setPlans] = React.useState<Record<string, PlanState>>({});
  const [history, setHistory] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const online = useOnline();
  const abortRef = React.useRef<AbortController | null>(null);
  const onChangeRef = React.useRef(opts.onChange);
  onChangeRef.current = opts.onChange;

  // Restore the conversation for this property.
  React.useEffect(() => {
    if (!propertyId) return;
    const saved = load(propertyId);
    setTurns(saved?.turns.map((t) => ({ ...t, pending: false, status: undefined })) ?? []);
    setContext(saved?.context ?? {});
    setPlans(Object.fromEntries(Object.entries(saved?.plans ?? {}).map(([k, v]) => [k, v === 'running' ? 'idle' : v])));
    setHistory(saved?.history ?? []);
  }, [propertyId]);

  React.useEffect(() => {
    if (!propertyId) return;
    save(propertyId, { turns, context, plans, history });
  }, [propertyId, turns, context, plans, history]);

  const updateTurn = (id: string, fn: (t: AgentTurn) => AgentTurn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  const send = React.useCallback(
    async (text: string, opts: { via?: 'voice' } = {}): Promise<{ blocks: AgentBlock[]; error?: string }> => {
      const message = text.trim();
      if (!message || !propertyId) return { blocks: [], error: 'Nothing to send.' };
      if (busy) return { blocks: [], error: 'Still working on the previous request.' };
      const collected: AgentBlock[] = [];
      let failure: string | undefined;
      // What this conversation already asked (for "save that as a shortcut"): commands that didn't fail.
      const recent = turns
        .filter((t, i) => t.role === 'user' && t.text && !turns[i + 1]?.error)
        .map((t) => (t.text as string).slice(0, 600))
        .slice(-10);
      const userTurn: AgentTurn = { id: uid(), role: 'user', text: message, blocks: [], at: Date.now(), via: opts.via };
      const agentTurn: AgentTurn = { id: uid(), role: 'agent', blocks: [], pending: true, status: 'Thinking…', at: Date.now() };
      setTurns((ts) => [...ts, userTurn, agentTurn]);
      setHistory((h) => [...h.filter((x) => x !== message), message].slice(-30));
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch('/api/agent/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId, message, context, recent }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new ApiError(body.error || `Request failed (${res.status})`, res.status);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const event = JSON.parse(line) as AgentEvent;
            if (event.type === 'status') updateTurn(agentTurn.id, (t) => ({ ...t, status: event.text }));
            else if (event.type === 'block') {
              collected.push(event.block);
              updateTurn(agentTurn.id, (t) => ({ ...t, blocks: [...t.blocks, event.block] }));
            } else if (event.type === 'context') setContext(event.context);
            else if (event.type === 'error') {
              failure = event.message;
              updateTurn(agentTurn.id, (t) => ({ ...t, error: event.message }));
            }
            else if (event.type === 'done') updateTurn(agentTurn.id, (t) => ({ ...t, ms: event.ms }));
          }
        }
        updateTurn(agentTurn.id, (t) => ({ ...t, pending: false, status: undefined }));
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          failure = 'Stopped.';
          updateTurn(agentTurn.id, (t) => ({ ...t, pending: false, status: undefined, error: t.blocks.length ? undefined : 'Stopped.' }));
        } else {
          const msg = e instanceof ApiError ? e.message : !navigator.onLine ? 'You’re offline — I’ll be here when you reconnect.' : 'Couldn’t reach the server.';
          failure = msg;
          updateTurn(agentTurn.id, (t) => ({ ...t, pending: false, status: undefined, error: msg }));
          updateTurn(userTurn.id, (t) => ({ ...t, retryable: true }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
      return { blocks: collected, error: failure };
    },
    [propertyId, busy, context, turns]
  );

  const stop = React.useCallback(() => abortRef.current?.abort(), []);

  const confirm = React.useCallback(
    async (token: string): Promise<AgentBlock[]> => {
      if (plans[token] === 'running' || plans[token] === 'done') return [];
      setPlans((p) => ({ ...p, [token]: 'running' }));
      try {
        const res = await api<{ blocks: AgentBlock[]; context: AgentContextState }>('/api/agent/confirm', { method: 'POST', json: { token } });
        const ok = !res.blocks.some((b) => b.type === 'result' && !b.ok);
        setPlans((p) => ({ ...p, [token]: ok ? 'done' : 'failed' }));
        setTurns((ts) => [...ts, { id: uid(), role: 'agent', blocks: res.blocks, at: Date.now() }]);
        if (Object.keys(res.context ?? {}).length) setContext((c) => ({ ...c, ...res.context }));
        onChangeRef.current?.();
        return res.blocks;
      } catch (e) {
        const blocks: AgentBlock[] = [{ type: 'error', text: e instanceof ApiError ? e.message : 'Couldn’t confirm — try again.' }];
        setPlans((p) => ({ ...p, [token]: 'idle' }));
        setTurns((ts) => [...ts, { id: uid(), role: 'agent', blocks, at: Date.now() }]);
        return blocks;
      }
    },
    [plans]
  );

  /** The newest plan still waiting for a decision (what "yes, go ahead" refers to). */
  const pendingPlan = React.useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const plan = turns[i].blocks.find((b): b is Extract<AgentBlock, { type: 'plan' }> => b.type === 'plan');
      if (plan) return !plans[plan.plan.token] || plans[plan.plan.token] === 'idle' ? plan.plan : null;
    }
    return null;
  }, [turns, plans]);

  const dismiss = React.useCallback((token: string) => setPlans((p) => ({ ...p, [token]: 'dismissed' })), []);

  const reset = React.useCallback(() => {
    setTurns([]);
    setContext({});
    setPlans({});
  }, []);

  return { turns, context, plans, history, busy, online, send, stop, confirm, dismiss, reset, pendingPlan };
}

export type AgentController = ReturnType<typeof useAgent>;
