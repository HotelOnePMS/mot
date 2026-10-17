'use client';

import * as React from 'react';
import { MAX_CAPTIONS, canStart, sessionQuery, type Caption, type VoiceController, type VoiceOptions, type VoiceState } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * GPT-Live over WebRTC. Audio goes peer-to-peer with OpenAI; the data
 * channel carries captions and delegated tool calls, which we execute in
 * our own code and answer with response.item.create + response.create.
 */
export function useOpenAIVoice({ propertyId, audience, scope, onToolCall, onStateChange }: VoiceOptions): VoiceController {
  const [state, setStateRaw] = React.useState<VoiceState>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [captions, setCaptions] = React.useState<Caption[]>([]);
  const [muted, setMuted] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const [agentSpeaking, setAgentSpeaking] = React.useState(false);
  const [working, setWorking] = React.useState(false);

  const pc = React.useRef<RTCPeerConnection | null>(null);
  const dc = React.useRef<RTCDataChannel | null>(null);
  const mic = React.useRef<MediaStream | null>(null);
  const audioEl = React.useRef<HTMLAudioElement | null>(null);
  const tokenRef = React.useRef<string>('');
  const doneCalls = React.useRef(new Set<string>());
  const toolCount = React.useRef(0);
  const raf = React.useRef<number>(0);
  const audioCtx = React.useRef<AudioContext | null>(null);
  const speakingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolRef = React.useRef(onToolCall);
  toolRef.current = onToolCall;
  const stateCb = React.useRef(onStateChange);
  stateCb.current = onStateChange;

  const setState = React.useCallback((s: VoiceState) => {
    setStateRaw(s);
    stateCb.current?.(s);
  }, []);

  const appendCaption = (role: Caption['role'], delta: string) =>
    setCaptions((cs) => {
      const last = cs[cs.length - 1];
      if (last && last.role === role) return [...cs.slice(0, -1), { ...last, text: last.text + delta }];
      return [...cs.slice(-(MAX_CAPTIONS - 1)), { id: uid(), role, text: delta.trimStart() }];
    });

  const send = (event: Record<string, unknown>) => {
    if (dc.current?.readyState !== 'open') return false;
    dc.current.send(JSON.stringify({ event_id: uid(), ...event }));
    return true;
  };

  const cleanup = React.useCallback(() => {
    cancelAnimationFrame(raf.current);
    try {
      dc.current?.close();
    } catch {
      /* already closed */
    }
    pc.current?.close();
    mic.current?.getTracks().forEach((t) => t.stop());
    void audioCtx.current?.close().catch(() => undefined);
    if (audioEl.current) audioEl.current.srcObject = null;
    pc.current = null;
    dc.current = null;
    mic.current = null;
    audioCtx.current = null;
    setLevel(0);
    setAgentSpeaking(false);
    setWorking(false);
  }, []);

  const finish = React.useCallback(
    (next: VoiceState = 'idle') => {
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
      cleanup();
      setState(next);
    },
    [cleanup, setState]
  );

  async function handleFunctionCall(item: { call_id?: string; name?: string; arguments?: string }) {
    if (!item.call_id || !item.name || doneCalls.current.has(item.call_id)) return;
    doneCalls.current.add(item.call_id);
    toolCount.current += 1;
    setWorking(true);
    let output: unknown;
    try {
      output = await toolRef.current({ name: item.name, arguments: item.arguments ?? '{}', callId: item.call_id }, { token: tokenRef.current });
    } catch (e) {
      output = { error: (e as Error).message };
    } finally {
      setWorking(false);
    }
    if (send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(output ?? {}) } })) {
      send({ type: 'response.create' });
    }
  }

  function onEvent(e: MessageEvent) {
    let ev: { type?: string; delta?: string; error?: { message?: string }; event?: { type?: string; item?: { type?: string; call_id?: string; name?: string; arguments?: string } } };
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }
    switch (ev.type) {
      case 'session.started':
        setState('live');
        break;
      case 'session.closed':
        finish('idle');
        break;
      case 'error':
        setError(ev.error?.message ?? 'The voice line reported an error.');
        break;
      case 'session.input_transcript.delta':
        if (ev.delta) appendCaption('user', ev.delta);
        break;
      case 'session.output_transcript.delta':
        if (ev.delta) {
          appendCaption('agent', ev.delta);
          setAgentSpeaking(true);
          if (speakingTimer.current) clearTimeout(speakingTimer.current);
          speakingTimer.current = setTimeout(() => setAgentSpeaking(false), 900);
        }
        break;
      case 'session.delegation.created':
        setWorking(true);
        break;
      case 'response.event':
        if (ev.event?.type === 'response.output_item.done' && ev.event.item?.type === 'function_call') void handleFunctionCall(ev.event.item);
        if (ev.event?.type === 'response.completed' || ev.event?.type === 'response.failed') setWorking(false);
        break;
    }
  }

  function meter(stream: MediaStream) {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* metering is decorative */
    }
  }

  const start = React.useCallback(async () => {
    if (!canStart({ propertyId, audience, scope }) || state === 'connecting' || state === 'live') return;
    setError(null);
    setCaptions([]);
    doneCalls.current.clear();
    toolCount.current = 0;
    setState('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the microphone.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      mic.current = stream;
      meter(stream);
      const peer = new RTCPeerConnection();
      pc.current = peer;
      audioEl.current ??= Object.assign(new Audio(), { autoplay: true });
      peer.addEventListener('track', (t) => {
        if (audioEl.current) audioEl.current.srcObject = t.streams[0];
      });
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'failed') {
          setError('The voice connection dropped.');
          finish('error');
        }
      });
      stream.getAudioTracks().forEach((t) => peer.addTrack(t, stream));
      const channel = peer.createDataChannel('oai-events');
      dc.current = channel;
      channel.addEventListener('message', onEvent);

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await new Promise<void>((resolve, reject) => {
        if (peer.iceGatheringState === 'complete') return resolve();
        const timer = setTimeout(() => reject(new Error('Network setup timed out.')), 10_000);
        peer.addEventListener('icegatheringstatechange', () => {
          if (peer.iceGatheringState === 'complete') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const res = await fetch(`/api/voice/session?${sessionQuery({ propertyId, audience, scope })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: peer.localDescription?.sdp ?? '',
      });
      const body = (await res.json().catch(() => ({}))) as { sdp?: string; token?: string; error?: string };
      if (!res.ok || !body.sdp || !body.token) throw new Error(body.error || 'Couldn’t start the voice line.');
      tokenRef.current = body.token;
      await peer.setRemoteDescription({ type: 'answer', sdp: body.sdp });
    } catch (e) {
      const msg = (e as Error).name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser to talk.' : (e as Error).message;
      setError(msg);
      finish('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, audience, scope, state]);

  const stop = React.useCallback(() => {
    if (state === 'idle') return;
    setState('ending');
    send({ type: 'session.close' });
    setTimeout(() => finish('idle'), 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, finish]);

  const toggleMute = React.useCallback(() => {
    const next = !muted;
    mic.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    send({ type: next ? 'session.input_audio.mute' : 'session.input_audio.unmute' });
    setMuted(next);
  }, [muted]);

  // A note for the reasoning model (no reply): added to the conversation, no response.create.
  const sendContext = React.useCallback((text: string) => {
    send({ type: 'response.item.create', item: { type: 'message', role: 'developer', content: [{ type: 'input_text', text }] } });
  }, []);

  React.useEffect(() => () => cleanup(), [cleanup]);

  return { state, error, captions, muted, level, agentSpeaking, working, start, stop, toggleMute, clearError: () => setError(null), sendContext };
}
