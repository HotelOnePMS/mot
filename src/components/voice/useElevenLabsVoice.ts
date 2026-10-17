'use client';

import * as React from 'react';
import { MAX_CAPTIONS, canStart, sessionQuery, type Caption, type VoiceController, type VoiceOptions, type VoiceState } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

interface SessionResponse {
  signedUrl?: string;
  prompt?: string;
  firstMessage?: string;
  tools?: string[];
  token?: string;
  error?: string;
}

interface LiveConversation {
  endSession(): Promise<void>;
  setMicMuted(muted: boolean): void;
  getInputVolume(): number;
  sendContextualUpdate(text: string): void;
}

const friendly = (message: string) => message.replace(/^Server error:\s*/i, '').trim() || 'The voice line reported an error.';

/**
 * ElevenLabs Agents over a WebSocket. The server mints a single-use signed
 * URL for HotelOne's private agent; the hotel's prompt and greeting go up as
 * overrides; tools the agent calls run in the browser (client tools) through
 * the same HotelOne endpoints as GPT-Live, so permission checks and confirm
 * plans are unchanged.
 */
export function useElevenLabsVoice({ propertyId, audience, scope, onToolCall, onStateChange }: VoiceOptions): VoiceController {
  const [state, setStateRaw] = React.useState<VoiceState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [captions, setCaptions] = React.useState<Caption[]>([]);
  const [muted, setMuted] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const [agentSpeaking, setAgentSpeaking] = React.useState(false);
  const [working, setWorking] = React.useState(false);

  const conversation = React.useRef<LiveConversation | null>(null);
  // Every start bumps this; callbacks from an older session are ignored.
  const session = React.useRef(0);
  const tokenRef = React.useRef('');
  const toolCount = React.useRef(0);
  const pendingTools = React.useRef(0);
  const mutedRef = React.useRef(false);
  const raf = React.useRef(0);
  const toolRef = React.useRef(onToolCall);
  toolRef.current = onToolCall;
  const stateCb = React.useRef(onStateChange);
  stateCb.current = onStateChange;

  const setState = React.useCallback((s: VoiceState) => {
    setStateRaw(s);
    stateCb.current?.(s);
  }, []);

  const addCaption = (role: Caption['role'], text: string) => setCaptions((cs) => [...cs.slice(-(MAX_CAPTIONS - 1)), { id: uid(), role, text }]);

  const finish = React.useCallback(
    (next: VoiceState = 'idle') => {
      session.current += 1;
      const token = tokenRef.current;
      if (token) {
        void fetch('/api/voice/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, toolCalls: toolCount.current }),
          keepalive: true,
        }).catch(() => undefined);
      }
      tokenRef.current = '';
      cancelAnimationFrame(raf.current);
      const c = conversation.current;
      conversation.current = null;
      if (c) void c.endSession().catch(() => undefined);
      setLevel(0);
      setAgentSpeaking(false);
      setWorking(false);
      mutedRef.current = false;
      setMuted(false);
      setState(next);
    },
    [setState]
  );

  const start = React.useCallback(async () => {
    if (!canStart({ propertyId, audience, scope }) || state === 'connecting' || state === 'live') return;
    const seq = ++session.current;
    const current = () => seq === session.current;
    // Past our own server, failures are the audio connection's (the SDK's wording isn't for guests).
    let connecting = false;
    setError(null);
    setCaptions([]);
    toolCount.current = 0;
    pendingTools.current = 0;
    setState('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the microphone.');
      // Ask for the microphone straight from the click, so the prompt appears before any network wait.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      if (!current()) return;

      const res = await fetch(`/api/voice/elevenlabs/session?${sessionQuery({ propertyId, audience, scope })}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as SessionResponse;
      if (!res.ok || !body.signedUrl || !body.token) throw new Error(body.error || 'Couldn’t start the voice line.');
      // Hung up while we were connecting: close the usage row and stop here.
      const abandon = () =>
        void fetch('/api/voice/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: body.token, toolCalls: 0 }), keepalive: true }).catch(() => undefined);
      if (!current()) return abandon();
      tokenRef.current = body.token;

      const clientTools = Object.fromEntries(
        (body.tools ?? []).map((name) => [
          name,
          async (params: Record<string, unknown>) => {
            if (!current()) return JSON.stringify({ error: 'This conversation has ended.' });
            toolCount.current += 1;
            pendingTools.current += 1;
            setWorking(true);
            try {
              const output = await toolRef.current({ name, arguments: JSON.stringify(params ?? {}), callId: uid() }, { token: tokenRef.current });
              return JSON.stringify(output ?? {});
            } catch (e) {
              return JSON.stringify({ error: (e as Error).message });
            } finally {
              pendingTools.current -= 1;
              if (pendingTools.current <= 0 && current()) setWorking(false);
            }
          },
        ])
      );

      // Loaded on demand: the SDK (and its WebRTC dependency) only ships when someone talks.
      const { Conversation } = await import('@elevenlabs/client');
      if (!current()) return abandon();
      connecting = true;
      const started = await Conversation.startSession({
        signedUrl: body.signedUrl,
        overrides: { agent: { prompt: { prompt: body.prompt }, firstMessage: body.firstMessage } },
        clientTools,
        // Mute pressed while connecting applies before any audio is sent.
        onConversationCreated: (c) => {
          if (mutedRef.current && c.type === 'voice') (c as unknown as LiveConversation).setMicMuted(true);
        },
        onConnect: () => {
          if (current()) setState('live');
        },
        onDisconnect: (details) => {
          if (!current()) return;
          if (details.reason === 'error') {
            setError(friendly(details.message));
            finish('error');
          } else finish('idle');
        },
        onMessage: ({ message, role }) => {
          if (current() && message?.trim()) addCaption(role === 'agent' ? 'agent' : 'user', message.trim());
        },
        onModeChange: ({ mode }) => {
          if (current()) setAgentSpeaking(mode === 'speaking');
        },
        onError: (message) => {
          if (current()) setError(friendly(message));
        },
      });
      if (started.type !== 'voice' || !current()) {
        void started.endSession().catch(() => undefined);
        return;
      }
      conversation.current = started as unknown as LiveConversation;
      setState('live');
      // Mic level for the orb (the SDK's volume is a band average, so lift it).
      const tick = () => {
        const c = conversation.current;
        if (c) setLevel(Math.min(1, Math.sqrt(c.getInputVolume()) * 1.4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      if (!current()) return;
      const err = e as Error;
      setError(
        err.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser to talk.'
          : connecting
            ? 'The voice line couldn’t connect just now. Check your internet connection and try again.'
            : err.message || 'Couldn’t start the voice line.'
      );
      finish('error');
    }
  }, [propertyId, audience, scope, state, finish, setState]);

  const stop = React.useCallback(() => {
    if (state === 'idle') return;
    setState('ending');
    finish('idle');
  }, [state, finish, setState]);

  const toggleMute = React.useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    conversation.current?.setMicMuted(next);
    setMuted(next);
  }, []);

  const sendContext = React.useCallback((text: string) => {
    try {
      conversation.current?.sendContextualUpdate(text);
    } catch {
      /* the socket closed between checks: nothing to tell */
    }
  }, []);

  React.useEffect(
    () => () => {
      session.current += 1;
      cancelAnimationFrame(raf.current);
      void conversation.current?.endSession().catch(() => undefined);
      conversation.current = null;
    },
    []
  );

  return { state, error, captions, muted, level, agentSpeaking, working, start, stop, toggleMute, clearError: () => setError(null), sendContext };
}
