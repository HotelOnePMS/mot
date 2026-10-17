/**
 * Which service carries voice conversations. ElevenLabs when its key is set
 * (or VOICE_PROVIDER=elevenlabs), otherwise OpenAI GPT-Live. Both run the
 * same prompts and the same tools through HotelOne.
 */
export type VoiceProvider = 'elevenlabs' | 'openai';

export function voiceProvider(): VoiceProvider {
  const chosen = process.env.VOICE_PROVIDER?.toLowerCase();
  if (chosen === 'openai' || chosen === 'elevenlabs') return chosen;
  return process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'openai';
}

/** True when the active provider has its key. */
export function voiceAvailable(): boolean {
  return voiceProvider() === 'elevenlabs' ? !!process.env.ELEVENLABS_API_KEY : !!process.env.OPENAI_API_KEY;
}

/**
 * The HotelOne voice concierge (all hotels, on the platform's own pages): on
 * whenever voice is, unless VOICE_CONCIERGE=off.
 */
export function conciergeVoiceAvailable(): boolean {
  return voiceAvailable() && !/^(off|false|0|no)$/i.test(process.env.VOICE_CONCIERGE?.trim() ?? '');
}
