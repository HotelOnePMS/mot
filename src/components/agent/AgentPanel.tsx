'use client';

import * as React from 'react';
import { Eraser, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/primitives';
import { useConsole } from '@/components/console/ConsoleProvider';
import { AgentUIProvider } from './AgentUI';
import { Composer, type ComposerHandle } from './Composer';
import { Timeline, useStickToBottom } from './Timeline';
import { useAgent, type AgentController } from './useAgent';
import { VoiceLiveBar, VoiceTalkButton, useStaffVoice } from '@/components/voice/StaffVoice';

/**
 * Conversation + composer, shared by the full Agentic workspace and the ⌘K
 * side sheet in Classic mode. `empty` renders when there are no turns yet.
 */
export function AgentPanel({
  compact = false,
  empty,
  rail,
  controllerRef,
  title,
}: {
  compact?: boolean;
  /** Visually hidden page heading shown once the conversation has started (the empty state brings its own). */
  title?: string;
  empty?: (send: (cmd: string) => void) => React.ReactNode;
  rail?: (agent: AgentController) => React.ReactNode;
  controllerRef?: React.MutableRefObject<AgentController | null>;
}) {
  const { propertyId, ctx, refresh, property, pendingCommand, takePendingCommand, can } = useConsole();
  const agent = useAgent(propertyId, { onChange: refresh });
  const voice = useStaffVoice(agent, propertyId);
  const voiceReady = !!ctx?.agent.voiceEnabled && can('voice.use');

  // A command handed over from elsewhere in the console ("Fix" on an alert).
  React.useEffect(() => {
    if (!pendingCommand || !propertyId || agent.busy) return;
    const cmd = takePendingCommand();
    if (cmd) void agent.send(cmd);
  }, [pendingCommand, propertyId, agent, takePendingCommand]);
  const composer = React.useRef<ComposerHandle>(null);
  const lastBlockCount = agent.turns.reduce((n, t) => n + t.blocks.length, 0) + agent.turns.length;
  const scrollRef = useStickToBottom<HTMLDivElement>(lastBlockCount + (agent.busy ? 1 : 0), { enabled: agent.turns.length > 0 });
  if (controllerRef) controllerRef.current = agent;

  const latestPlan = React.useMemo(() => {
    for (let i = agent.turns.length - 1; i >= 0; i--) {
      const plan = agent.turns[i].blocks.find((b) => b.type === 'plan');
      if (plan && plan.type === 'plan') {
        const state = agent.plans[plan.plan.token];
        return !state || state === 'idle' ? plan.plan.token : undefined;
      }
    }
    return undefined;
  }, [agent.turns, agent.plans]);

  const ui = {
    send: agent.send,
    prefill: (cmd: string) => composer.current?.setValue(cmd),
    confirm: agent.confirm,
    dismiss: agent.dismiss,
    plans: agent.plans,
    today: ctx?.today ?? new Date().toISOString().slice(0, 10),
    busy: agent.busy,
    compact,
    latestPlan,
  };

  const started = agent.turns.length > 0;

  return (
    <AgentUIProvider value={ui}>
      <div className="flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col">
          {!agent.online && (
            <Callout tone="warning" icon={WifiOff} role="status" className="rounded-none border-x-0 border-b border-t-0 border-warning/30 py-2 text-xs sm:justify-center">
              You’re offline. The classic screens still show the last data loaded; commands work again when you reconnect.
            </Callout>
          )}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
            <div className={compact ? 'px-4 py-5' : 'mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8'}>
              {started && title && <h1 className="sr-only">{title}</h1>}
              {started ? <Timeline turns={agent.turns} onRetry={agent.send} compact={compact} /> : empty?.(agent.send)}
            </div>
          </div>
          <div
            className={
              compact
                ? 'border-t bg-background/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
                : 'bg-gradient-to-t from-background via-background to-background/0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2'
            }
          >
            <div className={compact ? '' : 'mx-auto w-full max-w-3xl px-4 sm:px-6'}>
              {voiceReady && <VoiceLiveBar voice={voice} />}
              <Composer
                extra={voiceReady ? <VoiceTalkButton voice={voice} compact={compact} /> : undefined}
                ref={composer}
                onSend={agent.send}
                onStop={agent.stop}
                busy={agent.busy}
                online={agent.online}
                history={agent.history}
                compact={compact}
                autoFocus
                placeholder={property ? `Ask about ${property.name}, or tell me what to do…` : undefined}
              />
              {started && !compact && (
                <div className="mt-1.5 flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={agent.reset} className="px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground">
                    <Eraser aria-hidden /> Clear conversation
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
        {rail?.(agent)}
      </div>
    </AgentUIProvider>
  );
}
