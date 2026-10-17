'use client';

import * as React from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';
import type { VoiceController, VoiceOptions } from './types';
import { useElevenLabsVoice } from './useElevenLabsVoice';
import { useOpenAIVoice } from './useOpenAIVoice';

export type { Caption, VoiceController, VoiceOptions, VoiceState, VoiceToolCall } from './types';

type Provider = 'openai' | 'elevenlabs';
const busy = (c: VoiceController) => c.state === 'connecting' || c.state === 'live' || c.state === 'ending';

/**
 * The voice hook components use. The server picks the provider (ElevenLabs
 * or OpenAI GPT-Live, see /api/config); both expose the same controls and
 * run tools through the same `onToolCall`. Start waits until the provider is
 * known, and a running session is never swapped for the other controller.
 */
export function useLiveVoice(options: VoiceOptions): VoiceController {
  const { data, mutate } = useSWR<{ voiceProvider?: Provider }>('/api/config', fetcher, { revalidateOnFocus: false });
  const openai = useOpenAIVoice(options);
  const elevenlabs = useElevenLabsVoice(options);
  const provider = data?.voiceProvider;
  const preload = options.preload ?? true;

  // Load the ElevenLabs SDK ahead of the tap, so its iOS audio unlock sees the gesture.
  React.useEffect(() => {
    if (provider === 'elevenlabs' && preload) void import('@elevenlabs/client').catch(() => undefined);
  }, [provider, preload]);

  const chosen = provider === 'elevenlabs' ? elevenlabs : openai;
  const active = busy(openai) ? openai : busy(elevenlabs) ? elevenlabs : chosen;
  const startOpenAI = openai.start;
  const startElevenLabs = elevenlabs.start;
  const start = React.useCallback(async () => {
    const p = provider ?? (await mutate().catch(() => undefined))?.voiceProvider;
    await (p === 'elevenlabs' ? startElevenLabs() : startOpenAI());
  }, [provider, mutate, startOpenAI, startElevenLabs]);

  return { ...active, start };
}
