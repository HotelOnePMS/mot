'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AudioLines, MicOff, PhoneOff, Mic } from 'lucide-react';
import { speakBlocks } from '@/lib/agent/speak';
import { cn } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/button';
import type { AgentController } from '@/components/agent/useAgent';
import { useLiveVoice } from './useLiveVoice';
import { VoiceOrb, VoiceStatus, voicePhase } from './VoiceOrb';

/**
 * Hands-free mode for the agent workspace. The live voice (GPT-Live or
 * ElevenLabs, chosen by the server) listens and talks; every request it
 * delegates runs through the same agent pipeline as typed commands, so the
 * answer builds itself on screen while it's spoken, and changes still need
 * a "yes" to the plan.
 */
export function useStaffVoice(agent: AgentController, propertyId: string | undefined) {
  const agentRef = React.useRef(agent);
  agentRef.current = agent;

  return useLiveVoice({
    propertyId,
    audience: 'staff',
    onToolCall: async (call) => {
      const args = JSON.parse(call.arguments || '{}') as { request?: string };
      const a = agentRef.current;
      if (call.name === 'front_desk') {
        if (!args.request?.trim()) return { error: 'Say what you need.' };
        // Wait for any in-flight command (voice can be faster than the network).
        for (let i = 0; i < 40 && agentRef.current.busy; i++) await new Promise((r) => setTimeout(r, 150));
        const r = await agentRef.current.send(args.request, { via: 'voice' });
        if (r.error && !r.blocks.length) return { error: r.error };
        return speakBlocks(r.blocks);
      }
      if (call.name === 'confirm_plan') {
        const plan = a.pendingPlan;
        if (!plan) return { error: 'There is no plan waiting for confirmation.' };
        return speakBlocks(await a.confirm(plan.token));
      }
      if (call.name === 'dismiss_plan') {
        const plan = a.pendingPlan;
        if (plan) a.dismiss(plan.token);
        return { dismissed: !!plan };
      }
      return { error: `Unknown tool ${call.name}` };
    },
  });
}

export type StaffVoiceController = ReturnType<typeof useStaffVoice>;

export function VoiceTalkButton({ voice, compact }: { voice: StaffVoiceController; compact?: boolean }) {
  const active = voice.state === 'live' || voice.state === 'connecting';
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'secondary' : 'ghost'}
      onClick={() => (active ? voice.stop() : void voice.start())}
      className={cn('rounded-lg', compact ? 'w-9 px-0' : 'gap-1.5 px-2.5', !active && 'text-agent-soft-foreground hover:bg-agent-soft hover:text-agent-soft-foreground')}
      aria-label={active ? 'End the voice conversation' : 'Talk to the agent'}
      title={compact ? (active ? 'End voice' : 'Talk to the agent') : undefined}
    >
      {active ? <PhoneOff aria-hidden /> : <AudioLines aria-hidden />}
      {!compact && (active ? 'End' : 'Talk')}
    </Button>
  );
}

/** The live call strip above the composer: who's talking, the latest words, mute and end. */
export function VoiceLiveBar({ voice }: { voice: StaffVoiceController }) {
  const show = voice.state === 'live' || voice.state === 'connecting' || voice.state === 'ending' || !!voice.error;
  const lastAgent = [...voice.captions].reverse().find((c) => c.role === 'agent');
  const lastUser = [...voice.captions].reverse().find((c) => c.role === 'user');
  const phase = voicePhase({ state: voice.state, speaking: voice.agentSpeaking, working: voice.working, muted: voice.muted, error: voice.error });
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            'mb-2 flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-lifted',
            voice.error ? 'border-destructive/30' : 'border-agent/30'
          )}
          role="region"
          aria-label="Voice conversation"
        >
          <VoiceOrb state={voice.state} level={voice.level} speaking={voice.agentSpeaking} working={voice.working} muted={voice.muted} size={40} />
          <div className="min-w-0 flex-1" aria-live="polite">
            <VoiceStatus phase={phase} className="h-5 border-transparent bg-transparent px-0" />
            {voice.error ? (
              <p className="mt-0.5 text-sm text-destructive">{voice.error}</p>
            ) : voice.state === 'connecting' ? (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                <span className="sr-only">Connecting the voice line. </span>If your browser asks, allow the microphone.
              </p>
            ) : (
              <>
                <p className="mt-0.5 truncate text-sm">{lastAgent?.text || 'Go ahead — just talk.'}</p>
                {lastUser && (
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-medium">You:</span> {lastUser.text}
                  </p>
                )}
              </>
            )}
          </div>
          {voice.error ? (
            <Button size="sm" variant="ghost" onClick={voice.clearError}>
              Dismiss
            </Button>
          ) : (
            <div className="flex shrink-0 gap-1">
              <IconButton
                label={voice.muted ? 'Turn microphone on' : 'Turn microphone off'}
                aria-pressed={voice.muted}
                onClick={voice.toggleMute}
                className={cn(voice.muted && 'text-destructive')}
              >
                {voice.muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
              </IconButton>
              <IconButton label="End the voice conversation" onClick={voice.stop}>
                <PhoneOff aria-hidden />
              </IconButton>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
