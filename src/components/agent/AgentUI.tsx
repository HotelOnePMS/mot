'use client';

import * as React from 'react';
import type { ISODate } from '@/lib/dto';
import type { PlanState } from './useAgent';

export interface AgentUIValue {
  send: (command: string) => void;
  prefill: (command: string) => void;
  confirm: (token: string) => void;
  dismiss: (token: string) => void;
  plans: Record<string, PlanState>;
  today: ISODate;
  busy: boolean;
  /** Narrow layout (side sheet). */
  compact: boolean;
  /** Token of the most recent plan still awaiting a decision. */
  latestPlan?: string;
}

const Ctx = React.createContext<AgentUIValue | null>(null);

export function AgentUIProvider({ value, children }: { value: AgentUIValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAgentUI(): AgentUIValue {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useAgentUI must be used inside <AgentUIProvider>');
  return v;
}
